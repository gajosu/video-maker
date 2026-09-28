// Video jobs behind the "Nuevo video" page, the video chats and batches: each is a headless Claude session
// (session.ts). State lives in projects/<p>/jobs/<video>/{job.json,log.jsonl,inbox.jsonl} so it survives
// dev-server reloads. Up to MAX_JOBS run at once; the rest wait as "queued" and a scheduler (pump) starts them.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	hasInbox,
	type LogEvent,
	type LogKind,
	logTo,
	queueMessage as queueIn,
	readLogFrom,
} from "../../cli/lib/inbox.ts";
import { withLockSync } from "../../cli/lib/lock.ts";
import { PROJECTS_DIR, projectDir } from "../../cli/lib/paths.ts";
import { listProjects } from "../../cli/lib/project.ts";
import { mediaDiff, mediaSnap, searchResults } from "./media.ts";
import { alive, runSession } from "./session.ts";

export { CLAUDE_MODEL } from "./session.ts";
export type { LogEvent };

export type Phase = "script" | "script-changes" | "build" | "change";
export type JobStatus =
	| "queued"
	| "working"
	| "review"
	| "done"
	| "error"
	| "cancelled";
export type Job = {
	project: string;
	video: string;
	title: string;
	idea: string;
	duration: number;
	style: string;
	/** if set, the project's canvas orientation was (re)applied when this job started */
	orientation?: "vertical" | "horizontal";
	status: JobStatus;
	phase: Phase;
	session?: string;
	pid?: number;
	voice?: string;
	/** library assets the user picked for this video */
	assets?: string[];
	/** reference files the user uploaded when creating this video (assets/refs/<name>) */
	refs?: string[];
	/** links to videos this one should recreate as closely as possible (vk-ref), never reuse */
	videoRefs?: string[];
	/** Google Flow generation budget (0 = not allowed) */
	flow?: { clips: number; images: number };
	/** music preset override ("" = the style's default) */
	music?: string;
	/** the batch this video belongs to (cli/lib/batch.ts) */
	batch?: string;
	/** queued: the run to start when a slot frees up */
	next?: { phase: Phase; prompt: string; at: number };
	error?: string;
	summary?: string;
	cost: number;
	createdAt: number;
	updatedAt: number;
};

export const jobDir = (p: string, v: string) => join(projectDir(p), "jobs", v);
const jobFile = (p: string, v: string) => join(jobDir(p, v), "job.json");

export function saveJob(j: Job) {
	mkdirSync(jobDir(j.project, j.video), { recursive: true });
	j.updatedAt = Date.now();
	writeFileSync(jobFile(j.project, j.video), `${JSON.stringify(j, null, 1)}\n`);
}

export const log = (p: string, v: string, k: LogKind, x: string) =>
	logTo(jobDir(p, v), k, x);
export const readLog = (p: string, v: string, n = 300) =>
	readLogFrom(jobDir(p, v), n);
/** a chat message sent while the job works: Claude gets it after its next tool call */
export const queueMessage = (
	p: string,
	v: string,
	text: string,
	refs: string[] = [],
) => queueIn(jobDir(p, v), text, refs);

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

export function listJobs(projects: string[]): Job[] {
	const out: Job[] = [];
	for (const p of projects) {
		const dir = join(projectDir(p), "jobs");
		if (!existsSync(dir)) continue;
		for (const v of readdirSync(dir)) {
			if (v.startsWith("__")) continue; // project chats (project-setup.ts)
			const j = readJob(p, v);
			if (j) out.push(j);
		}
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

const allProjects = () => listProjects().map((p) => p.slug);

export const runningJobs = (projects: string[] = allProjects()) =>
	listJobs(projects).filter((j) => j.status === "working");

/** how many videos can be built at the same time (one headless Claude each) */
export const MAX_JOBS = Math.max(
	1,
	Number(process.env.VK_STUDIO_MAX_JOBS) || 3,
);

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
	"Sigue los skills del repo (vk-make, vk-script, vk-scenes, vk-assets, vk-ref, vk-learn) y las reglas de CLAUDE.md y del knowledge base del proyecto.",
	"Termina cada turno con un resumen breve en español (3-6 líneas) de lo que hiciste y lo que queda.",
].join(" ");

/** what to do with messages that arrived when no run was listening */
function followUp(j: Job): { phase: Phase; prompt: string } {
	const { project: p, video: v } = j;
	return j.status === "review"
		? {
				phase: "script-changes",
				prompt:
					"Aplica al guion los mensajes nuevos del usuario (abajo). Actualiza solo script.md; sigue sin generar voz ni escenas.",
			}
		: {
				phase: "change",
				prompt: `Aplica los mensajes nuevos del usuario (abajo) a ${p}/${v}: si cambia el guion regenera la voz y ajusta scenes.js; revisa stills y vuelve a renderizar con \`bun vk render ${p} ${v}\`.`,
			};
}

/** run a phase now, or queue it if MAX_JOBS sessions are already working; returns immediately */
export function run(job: Job, phase: Phase, prompt: string) {
	const busy = runningJobs().filter(
		(j) => !(j.project === job.project && j.video === job.video),
	).length;
	if (busy >= MAX_JOBS) {
		job.status = "queued";
		job.phase = phase;
		job.pid = undefined;
		job.next = { phase, prompt, at: Date.now() };
		saveJob(job);
		return;
	}
	start(job, phase, prompt);
}

function start(job: Job, phase: Phase, prompt: string) {
	const { project: p, video: v } = job;
	job.phase = phase;
	job.next = undefined;
	let snap = mediaSnap(p, v);
	const media = (k: LogKind, x: string) => log(p, v, k, x);
	runSession({
		job,
		dir: jobDir(p, v),
		project: p,
		prompt,
		allowed: ALLOWED,
		system: SYSTEM,
		save: saveJob,
		reload: () => readRaw(p, v),
		onToolResult: (text) => {
			const items = searchResults(text);
			if (items.length)
				media(
					"media",
					JSON.stringify({
						type: "search",
						items: items.slice(0, 12),
						t: Date.now(),
					}),
				);
			const now = mediaSnap(p, v);
			mediaDiff(media, p, v, snap, now);
			snap = now;
		},
		onFinish: (j, res) => {
			if (res.ok) {
				j.status =
					phase === "script" || phase === "script-changes" ? "review" : "done";
				j.summary = res.text;
			}
			saveJob(j);
			// a message that landed after the Stop hook's last look: keep going instead of leaving it queued
			if (res.ok && hasInbox(jobDir(p, v))) {
				const f = followUp(j);
				start(j, f.phase, f.prompt);
			}
			pump();
		},
	});
}

export function cancel(p: string, v: string) {
	const j = readJob(p, v);
	if (!j) return;
	if (j.pid && alive(j.pid)) process.kill(j.pid, "SIGTERM");
	j.status = "cancelled";
	j.pid = undefined;
	j.next = undefined;
	log(p, v, "error", "Cancelado por el usuario.");
	saveJob(j);
	pump();
}

// ---------- scheduler ----------
// Starts queued jobs (oldest first) while there are free slots, lets other modules add work (batches being
// launched, see batch.ts), and wakes idle jobs that got messages from the terminal (`bun vk batch msg`).
const extraWork: (() => void)[] = [];
export const onPump = (fn: () => void) => {
	if (!extraWork.includes(fn)) extraWork.push(fn);
};

let pumping = false;
export function pump() {
	if (pumping) return;
	pumping = true;
	try {
		// one scheduler at a time even with two servers running (e.g. a second `bun run dev`): whoever holds the
		// lock decides; the other skips this round, so a queued job is never started twice
		withLockSync(join(PROJECTS_DIR, ".scheduler.lock"), schedule, {
			timeoutMs: 300,
		});
	} catch (e) {
		// a timeout means another process is scheduling right now; anything else is a real problem
		if (!String((e as Error).message).startsWith("timed out"))
			console.error("[studio] scheduler:", (e as Error).message);
	} finally {
		pumping = false;
	}
}

function schedule() {
	for (const fn of extraWork) {
		try {
			fn();
		} catch (e) {
			console.error("[studio] scheduler:", (e as Error).message);
		}
	}
	const jobs = listJobs(allProjects());
	let free = MAX_JOBS - jobs.filter((j) => j.status === "working").length;
	for (const j of jobs)
		if (
			(j.status === "review" || j.status === "done" || j.status === "error") &&
			hasInbox(jobDir(j.project, j.video))
		) {
			const f = followUp(j);
			j.status = "queued";
			j.next = { ...f, at: Date.now() };
			saveJob(j);
		}
	const queued = listJobs(allProjects())
		.filter((j) => j.status === "queued" && j.next)
		.sort((a, b) => (a.next?.at ?? 0) - (b.next?.at ?? 0));
	for (const j of queued) {
		if (free <= 0) break;
		const n = j.next as NonNullable<Job["next"]>;
		start(j, n.phase, n.prompt);
		free--;
	}
}

// one timer per server process, surviving hot reloads (it calls the latest pump)
const g = globalThis as unknown as {
	__vkPump?: () => void;
	__vkPumpTimer?: ReturnType<typeof setInterval>;
};
g.__vkPump = pump;
g.__vkPumpTimer ??= setInterval(() => g.__vkPump?.(), 2000);
