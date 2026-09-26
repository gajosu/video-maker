// Runs Claude Code headless (claude -p, stream-json) behind the "Nuevo video" page.
// State lives in projects/<p>/jobs/<video>/{job.json,log.jsonl} so it survives dev-server reloads.
import { spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { loadManifest } from "../../cli/lib/assets.ts";
import { projectDir, ROOT, videoDir } from "../../cli/lib/paths.ts";

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
	/** library assets the user picked for this video */
	assets?: string[];
	/** Google Flow generation budget (0 = not allowed) */
	flow?: { clips: number; images: number };
	/** music preset override ("" = the style's default) */
	music?: string;
	error?: string;
	summary?: string;
	cost: number;
	createdAt: number;
	updatedAt: number;
};
export type LogEvent = {
	t: number;
	k: "you" | "say" | "tool" | "done" | "error" | "media";
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

// ---------- media shown inline in the chat ----------
// After every tool result we diff the asset library, the video's stills and its render, and read stock-search
// output, so generated / added / found media appears in the chat as pictures and players, not just text.
type MediaSnap = {
	assets: Record<string, string>;
	stills: Record<string, number>;
	out: number;
};
const mtime = (f: string) => {
	try {
		return statSync(f).mtimeMs;
	} catch {
		return 0;
	}
};
function mediaSnap(p: string, v: string): MediaSnap {
	const assets: Record<string, string> = {};
	try {
		for (const a of Object.values(loadManifest(p).assets))
			assets[a.name] =
				`${a.file}|${mtime(join(projectDir(p), "assets", a.file))}`;
	} catch {}
	const stills: Record<string, number> = {};
	const sd = join(videoDir(p, v), "stills");
	if (existsSync(sd))
		for (const f of readdirSync(sd))
			if (f.endsWith(".jpg")) stills[f] = mtime(join(sd, f));
	return {
		assets,
		stills,
		out: mtime(join(videoDir(p, v), "out", `${v}.mp4`)),
	};
}
function mediaDiff(p: string, v: string, before: MediaSnap, after: MediaSnap) {
	const lib = (() => {
		try {
			return loadManifest(p).assets;
		} catch {
			return {};
		}
	})();
	for (const [name, sig] of Object.entries(after.assets)) {
		if (before.assets[name] === sig) continue;
		const a = lib[name];
		if (!a || (a.kind !== "image" && a.kind !== "video")) continue;
		log(
			p,
			v,
			"media",
			JSON.stringify({
				type: "asset",
				name,
				kind: a.kind,
				file: a.file,
				source: a.source?.type ?? "",
				updated: !!before.assets[name],
				prompt:
					"prompt" in (a.source ?? {})
						? (a.source as { prompt?: string }).prompt?.slice(0, 200)
						: undefined,
				t: Date.now(),
			}),
		);
	}
	const newStills = Object.entries(after.stills)
		.filter(([f, m]) => before.stills[f] !== m)
		.map(([f]) => f)
		.sort(
			(a, b) => Number.parseFloat(a.slice(1)) - Number.parseFloat(b.slice(1)),
		);
	if (newStills.length)
		log(
			p,
			v,
			"media",
			JSON.stringify({
				type: "stills",
				files: newStills.slice(0, 16),
				t: Date.now(),
			}),
		);
	if (after.out && after.out !== before.out)
		log(
			p,
			v,
			"media",
			JSON.stringify({ type: "render", file: `out/${v}.mp4`, t: Date.now() }),
		);
}
/** "bun vk asset search" output → thumbnails */
function searchResults(text: string) {
	const lines = text.split("\n");
	const items: { n: number; title: string; thumb: string; source: string }[] =
		[];
	for (let i = 0; i < lines.length - 1; i++) {
		const m =
			lines[i].match(/^\s*(\d+)\. \[(\w+)\] (.+?)\s{2,}/) ??
			lines[i].match(/^\s*(\d+)\. \[(\w+)\] (\S+)/);
		const url = lines[i + 1].trim();
		if (m && /^https:\/\/\S+\.(jpe?g|png|webp)/i.test(url))
			items.push({
				n: Number(m[1]),
				source: m[2],
				title: m[3].trim(),
				thumb: url,
			});
	}
	return items;
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
	let snap = mediaSnap(p, v);
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
			if (e.type === "user") {
				const content = ((e.message as { content?: unknown[] })?.content ??
					[]) as Record<string, unknown>[];
				let toolDone = false;
				for (const c of content) {
					if (c.type !== "tool_result") continue;
					toolDone = true;
					const text =
						typeof c.content === "string"
							? c.content
							: Array.isArray(c.content)
								? (c.content as Record<string, unknown>[])
										.map((x) => (typeof x.text === "string" ? x.text : ""))
										.join("\n")
								: "";
					const items = searchResults(text);
					if (items.length) {
						flush();
						log(
							p,
							v,
							"media",
							JSON.stringify({
								type: "search",
								items: items.slice(0, 12),
								t: Date.now(),
							}),
						);
					}
				}
				if (toolDone) {
					const now = mediaSnap(p, v);
					flush();
					mediaDiff(p, v, snap, now);
					snap = now;
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
