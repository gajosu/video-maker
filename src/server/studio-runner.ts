// Runs Claude Code headless (claude -p, stream-json) behind the "Nuevo video" page.
// State lives in projects/<p>/jobs/<video>/{job.json,log.jsonl} so it survives dev-server reloads.
import { spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { projectDir, ROOT } from "../../cli/lib/paths.ts";

export type Phase = "script" | "script-changes" | "build" | "change";
export type JobStatus = "working" | "review" | "done" | "error" | "cancelled";
export type Job = {
	project: string;
	video: string;
	title: string;
	idea: string;
	duration: number;
	style: string;
	status: JobStatus;
	phase: Phase;
	session?: string;
	pid?: number;
	voice?: string;
	error?: string;
	summary?: string;
	cost: number;
	createdAt: number;
	updatedAt: number;
};
export type LogEvent = {
	t: number;
	k: "you" | "say" | "tool" | "done" | "error";
	x: string;
};

const jobDir = (p: string, v: string) => join(projectDir(p), "jobs", v);
const jobFile = (p: string, v: string) => join(jobDir(p, v), "job.json");
const logFile = (p: string, v: string) => join(jobDir(p, v), "log.jsonl");

const alive = (pid?: number) => {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

export function saveJob(j: Job) {
	mkdirSync(jobDir(j.project, j.video), { recursive: true });
	j.updatedAt = Date.now();
	writeFileSync(jobFile(j.project, j.video), `${JSON.stringify(j, null, 1)}\n`);
}

export function log(p: string, v: string, k: LogEvent["k"], x: string) {
	mkdirSync(jobDir(p, v), { recursive: true });
	appendFileSync(logFile(p, v), `${JSON.stringify({ t: Date.now(), k, x })}\n`);
}

const readRaw = (p: string, v: string): Job | null =>
	existsSync(jobFile(p, v))
		? JSON.parse(readFileSync(jobFile(p, v), "utf8"))
		: null;

export function readJob(p: string, v: string): Job | null {
	const j = readRaw(p, v);
	if (!j) return null;
	if (j.status === "working" && !alive(j.pid)) {
		j.status = "error";
		j.error =
			"El proceso se detuvo sin terminar (¿se reinició el servidor?). Puedes pedir que continúe desde el chat.";
		saveJob(j);
	}
	return j;
}

export function readLog(
	p: string,
	v: string,
	n = 300,
): (LogEvent & { id: number })[] {
	if (!existsSync(logFile(p, v))) return [];
	const lines = readFileSync(logFile(p, v), "utf8").trim().split("\n");
	const from = Math.max(0, lines.length - n);
	return lines.slice(from).flatMap((l, i) => {
		try {
			return [{ ...(JSON.parse(l) as LogEvent), id: from + i }];
		} catch {
			return [];
		}
	});
}

export function listJobs(projects: string[]): Job[] {
	const out: Job[] = [];
	for (const p of projects) {
		const dir = join(projectDir(p), "jobs");
		if (!existsSync(dir)) continue;
		for (const v of readdirSync(dir)) {
			const j = readJob(p, v);
			if (j) out.push(j);
		}
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const anyRunning = (projects: string[]) =>
	listJobs(projects).find((j) => j.status === "working");

const claudeBin = () => {
	if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
	const local = join(homedir(), ".local", "bin", "claude");
	return existsSync(local) ? local : "claude";
};

// Everything the pipeline needs, nothing else: in -p mode any other tool call is denied, not prompted.
const ALLOWED = [
	"Read",
	"Edit",
	"Write",
	"Glob",
	"Grep",
	"Skill",
	"WebFetch",
	"WebSearch",
	"TodoWrite",
	"Bash(bun vk:*)",
	"Bash(bun cli/index.ts:*)",
	"Bash(bunx tsc:*)",
	"Bash(ffmpeg:*)",
	"Bash(ffprobe:*)",
	"Bash(ls:*)",
];

const SYSTEM = [
	"Estás trabajando detrás de la interfaz web de video-kit (página «Nuevo video»). El usuario no ve la terminal ni puede responder preguntas a mitad de un paso:",
	"no uses AskUserQuestion ni esperes confirmación; decide lo razonable y explícalo en tu resumen final.",
	"Sigue los skills del repo (vk-make, vk-script, vk-scenes, vk-assets, vk-learn) y las reglas de CLAUDE.md y del knowledge base del proyecto.",
	"Termina cada turno con un resumen breve en español (3-6 líneas) de lo que hiciste y lo que queda.",
].join(" ");

function describe(name: string, input: Record<string, unknown>): string {
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

/** start (or resume) a Claude session for this job with `prompt`; returns immediately */
export function run(job: Job, phase: Phase, prompt: string) {
	const args = [
		"-p",
		prompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		"acceptEdits",
		"--append-system-prompt",
		SYSTEM,
		"--allowedTools",
		...ALLOWED,
	];
	if (job.session) args.push("--resume", job.session);
	const child = spawn(claudeBin(), args, {
		cwd: ROOT,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	job.status = "working";
	job.phase = phase;
	job.pid = child.pid;
	job.error = undefined;
	saveJob(job);
	const { project: p, video: v } = job;
	let buf = "";
	let stderr = "";
	let lastResult: { ok: boolean; text: string } | null = null;
	// hold the latest assistant text until we know it isn't the final answer (logged as "done")
	let pending = "";
	const flush = () => {
		if (pending) log(p, v, "say", pending);
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
				saveJob(job);
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
							p,
							v,
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
		const j = readRaw(p, v) ?? job;
		if (j.status === "cancelled") return;
		j.pid = undefined;
		j.session = job.session ?? j.session;
		j.cost = job.cost;
		const res = lastResult as { ok: boolean; text: string } | null;
		if (!res?.ok || pending.trim() !== res.text.trim()) flush();
		if (res?.ok) {
			j.status =
				phase === "script" || phase === "script-changes" ? "review" : "done";
			j.error = undefined;
			j.summary = res.text;
			log(p, v, "done", res.text);
		} else {
			j.status = "error";
			j.error =
				res?.text || stderr.trim() || `claude terminó con código ${code}`;
			log(p, v, "error", j.error);
		}
		saveJob(j);
	});
	child.on("error", (err) => {
		const j = readRaw(p, v) ?? job;
		j.status = "error";
		j.pid = undefined;
		j.error = `No se pudo iniciar Claude Code: ${err.message}`;
		log(p, v, "error", j.error);
		saveJob(j);
	});
}

export function cancel(p: string, v: string) {
	const j = readJob(p, v);
	if (!j) return;
	if (j.pid && alive(j.pid)) process.kill(j.pid, "SIGTERM");
	j.status = "cancelled";
	j.pid = undefined;
	log(p, v, "error", "Cancelado por el usuario.");
	saveJob(j);
}
