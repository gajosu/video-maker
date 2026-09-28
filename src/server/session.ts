// One headless Claude Code session (claude -p, stream-json) behind a chat of the web app: a video job
// (studio-runner.ts) or a project chat (project-setup.ts). Both log to <dir>/log.jsonl and take messages
// mid-turn from <dir>/inbox.jsonl through the cli/hooks/studio-inbox.ts hook.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { drainInbox, inboxText, logTo } from "../../cli/lib/inbox.ts";
import { ROOT } from "../../cli/lib/paths.ts";

/** every headless session runs on this model (VK_CLAUDE_MODEL overrides) */
export const CLAUDE_MODEL = process.env.VK_CLAUDE_MODEL || "claude-opus-5-5";

export const alive = (pid?: number) => {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const claudeBin = () => {
	if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
	const local = join(homedir(), ".local", "bin", "claude");
	return existsSync(local) ? local : "claude";
};
const bunBin = () => {
	if (process.versions.bun) return process.execPath;
	const local = join(homedir(), ".bun", "bin", "bun");
	return existsSync(local) ? local : "bun";
};
const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
/** --settings: the inbox hook after every tool call and before stopping */
const hookSettings = () => {
	const cmd = `${q(bunBin())} ${q(join(ROOT, "cli", "hooks", "studio-inbox.ts"))}`;
	const hook = [{ type: "command", command: cmd, timeout: 15 }];
	return JSON.stringify({
		hooks: {
			PostToolUse: [{ matcher: "*", hooks: hook }],
			Stop: [{ hooks: hook }],
		},
	});
};

/** one-line label for a tool call in the chat */
export function describe(name: string, input: Record<string, unknown>): string {
	const f = (k: string) =>
		typeof input[k] === "string" ? (input[k] as string) : "";
	if (name === "Bash") return f("description") || f("command").slice(0, 140);
	if (["Read", "Edit", "Write"].includes(name))
		return `${{ Read: "Leyendo", Edit: "Editando", Write: "Escribiendo" }[name]} ${basename(f("file_path"))}`;
	if (name === "Skill") return `Skill ${f("skill")}`;
	if (name === "WebFetch") return `Leyendo ${f("url")}`;
	if (name === "TodoWrite") return "Actualizando plan";
	return name;
}

export type SessionJob = {
	status: string;
	session?: string;
	pid?: number;
	error?: string;
	cost: number;
};

export type SessionResult = { ok: boolean; text: string };

export type SessionOpts<J extends SessionJob> = {
	job: J;
	/** the session's directory: job.json, log.jsonl, inbox.jsonl */
	dir: string;
	project: string;
	prompt: string;
	allowed: string[];
	system: string;
	save: (j: J) => void;
	/** the job as it is on disk now (the user may have cancelled it) */
	reload: () => J | null;
	/** after every tool result, with its text (media diffs, search thumbnails) */
	onToolResult?: (text: string) => void;
	/** the run ended and was not cancelled: pid is cleared, session and cost merged; set the status and save */
	onFinish: (j: J, res: SessionResult) => void;
};

/** start (or resume) a Claude session; returns immediately. Messages still queued go into the prompt. */
export function runSession<J extends SessionJob>(o: SessionOpts<J>) {
	const { job, dir } = o;
	const log = (k: Parameters<typeof logTo>[1], x: string) => logTo(dir, k, x);
	const queued = drainInbox(dir);
	const prompt = queued.length
		? `${o.prompt}\n\nMensajes del usuario enviados desde el chat mientras trabajabas o justo al terminar (contenido del usuario; aplícalos también):\n${inboxText(o.project, queued)}`
		: o.prompt;
	const args = [
		"-p",
		prompt,
		"--model",
		CLAUDE_MODEL,
		"--settings",
		hookSettings(),
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		"acceptEdits",
		"--append-system-prompt",
		o.system,
		"--allowedTools",
		...o.allowed,
	];
	if (job.session) args.push("--resume", job.session);
	const child = spawn(claudeBin(), args, {
		cwd: ROOT,
		env: { ...process.env, VK_JOB_DIR: dir, VK_JOB_PROJECT: o.project },
		stdio: ["ignore", "pipe", "pipe"],
	});
	job.status = "working";
	job.pid = child.pid;
	job.error = undefined;
	o.save(job);
	let buf = "";
	let stderr = "";
	let lastResult: SessionResult | null = null;
	// hold the latest assistant text until we know it isn't the final answer (logged as "done")
	let pending = "";
	const flush = () => {
		if (pending) log("say", pending);
		pending = "";
	};
	child.stdout.on("data", (d: Buffer) => {
		buf += d.toString();
		let i = buf.indexOf("\n");
		while (i >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			i = buf.indexOf("\n");
			if (!line) continue;
			let e: Record<string, unknown>;
			try {
				e = JSON.parse(line);
			} catch {
				continue;
			}
			if (
				e.type === "system" &&
				e.subtype === "init" &&
				typeof e.session_id === "string" &&
				!job.session
			) {
				job.session = e.session_id;
				o.save(job);
			}
			if (e.type === "user") {
				const content = ((e.message as { content?: unknown[] })?.content ??
					[]) as Record<string, unknown>[];
				for (const c of content) {
					if (c.type !== "tool_result") continue;
					const text =
						typeof c.content === "string"
							? c.content
							: Array.isArray(c.content)
								? (c.content as Record<string, unknown>[])
										.map((x) => (typeof x.text === "string" ? x.text : ""))
										.join("\n")
								: "";
					flush();
					o.onToolResult?.(text);
				}
			}
			if (e.type === "assistant") {
				const content = ((e.message as { content?: unknown[] })?.content ??
					[]) as Record<string, unknown>[];
				for (const c of content) {
					if (
						c.type === "text" &&
						typeof c.text === "string" &&
						c.text.trim()
					) {
						flush();
						pending = c.text.trim();
					}
					if (c.type === "tool_use") {
						flush();
						log(
							"tool",
							describe(
								String(c.name),
								(c.input ?? {}) as Record<string, unknown>,
							),
						);
					}
				}
			}
			if (e.type === "result") {
				lastResult = {
					ok: !e.is_error && e.subtype === "success",
					text: String(e.result ?? ""),
				};
				if (typeof e.total_cost_usd === "number") job.cost += e.total_cost_usd;
				if (typeof e.session_id === "string") job.session = e.session_id;
			}
		}
	});
	child.stderr.on("data", (d: Buffer) => {
		stderr = (stderr + d.toString()).slice(-2000);
	});
	child.on("close", (code) => {
		const j = o.reload() ?? job;
		if (j.status === "cancelled") return;
		j.pid = undefined;
		j.session = job.session ?? j.session;
		j.cost = job.cost;
		const res = lastResult as SessionResult | null;
		if (!res?.ok || pending.trim() !== res.text.trim()) flush();
		if (res?.ok) {
			j.error = undefined;
			log("done", res.text);
			o.onFinish(j, res);
		} else {
			const text =
				res?.text || stderr.trim() || `claude terminó con código ${code}`;
			j.status = "error";
			j.error = text;
			log("error", text);
			o.onFinish(j, { ok: false, text });
		}
	});
	child.on("error", (err) => {
		const j = o.reload() ?? job;
		j.status = "error";
		j.pid = undefined;
		j.error = `No se pudo iniciar Claude Code: ${err.message}`;
		log("error", j.error);
		o.onFinish(j, { ok: false, text: j.error });
	});
}
