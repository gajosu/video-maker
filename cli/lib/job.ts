// Background job for `bun vk package`: state lives in projects/<p>/jobs/<v>/pkg.json (+
// pkg-log.jsonl), a sibling of (but distinct from, different filename) the web Studio's own
// jobs/<v>/job.json so the two runners never confuse each other's records. The worker itself
// re-invokes this CLI's own commands (voice/check/stills/render) as subprocesses, so the
// package pipeline reuses exactly the same tested logic a human `bun vk` session would run.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addUrl, loadManifest } from "./assets.ts";
import { genImage, OpenAIError } from "./generate.ts";
import { ROOT, projectDir, videoDir } from "./paths.ts";
import { loadVideo } from "./project.ts";

export type JobState = "queued" | "running" | "done" | "error";
export type Step = "queued" | "images" | "music" | "voice" | "check" | "stills" | "render" | "done";

export type PkgJob = {
	project: string;
	video: string;
	source: "grokbot-package";
	state: JobState;
	step: Step;
	progress: number;
	pid?: number;
	error?: string;
	warnings: string[];
	output?: string;
	stills: string[];
	package: { sourcePath: string; title: string; visuals: number; imagesProvided: number; imagesToGenerate: number; imagesDone?: number };
	musicUrl?: string;
	musicLabel?: string;
	startedAt: number;
	updatedAt: number;
};

const jobDir = (p: string, v: string) => join(projectDir(p), "jobs", v);
const jobFile = (p: string, v: string) => join(jobDir(p, v), "pkg.json");
const logFile = (p: string, v: string) => join(jobDir(p, v), "pkg-log.jsonl");

export function saveJob(j: PkgJob) {
	mkdirSync(jobDir(j.project, j.video), { recursive: true });
	j.updatedAt = Date.now();
	writeFileSync(jobFile(j.project, j.video), `${JSON.stringify(j, null, 1)}\n`);
}

const alive = (pid?: number) => {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

export function readJob(p: string, v: string): PkgJob | null {
	const f = jobFile(p, v);
	if (!existsSync(f)) return null;
	const j = JSON.parse(readFileSync(f, "utf8")) as PkgJob;
	if (j.state === "running" && !alive(j.pid)) {
		j.state = "error";
		j.error = `worker process stopped without finishing (crash or restart). Re-run: bun vk package resume ${p} ${v}`;
		saveJob(j);
	}
	return j;
}

export function logLine(p: string, v: string, msg: string) {
	mkdirSync(jobDir(p, v), { recursive: true });
	appendFileSync(logFile(p, v), `${JSON.stringify({ t: Date.now(), msg })}\n`);
}

export type PkgLogEntry = { t: number; msg: string };

/** For the web UI's job thread: every `pkg-log.jsonl` line, oldest first. */
export function readPkgLog(p: string, v: string, n = 1000): PkgLogEntry[] {
	const f = logFile(p, v);
	if (!existsSync(f)) return [];
	const lines = readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
	const from = Math.max(0, lines.length - n);
	return lines.slice(from).flatMap((l) => {
		try {
			return [JSON.parse(l) as PkgLogEntry];
		} catch {
			return [];
		}
	});
}

/** Spawn the background worker, detached so it outlives the caller's shell (renders can take minutes). */
export function spawnWorker(p: string, v: string): number | undefined {
	mkdirSync(jobDir(p, v), { recursive: true });
	const fd = openSync(logFile(p, v), "a");
	const child = spawn(process.execPath, [join(ROOT, "cli", "index.ts"), "package", "worker", p, v], {
		cwd: ROOT,
		detached: true,
		stdio: ["ignore", fd, fd],
	});
	child.unref();
	return child.pid;
}

/** Run one of this CLI's own commands as a subprocess (reuses its exact tested logic; throws with its stderr on failure). */
function runCli(args: string[]): string {
	const r = spawnSync(process.execPath, [join(ROOT, "cli", "index.ts"), ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
	const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
	if (r.status !== 0) throw new Error(out.trim() || `bun vk ${args.join(" ")} failed`);
	return out.trim();
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** timeouts, 5xx and 429s are worth a retry; a bad prompt or a missing key is not. */
function isRetryable(e: unknown): boolean {
	if (e instanceof OpenAIError && e.status !== undefined) return e.status === 429 || e.status >= 500;
	const name = (e as { name?: string })?.name;
	if (name === "TimeoutError" || name === "AbortError") return true;
	return /timed? ?out|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test((e as Error)?.message ?? "");
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function pMap<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await fn(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/** Images are generated in parallel (default concurrency 5, `VK_IMAGE_CONCURRENCY`) with a per-request
 *  timeout and up to 2 retries with backoff on timeout/5xx/429. A single image that still fails becomes a
 *  warning (left as an open request; the render uses a placeholder) unless more than half of them fail,
 *  in which case the whole step throws. */
async function fulfillImageRequests(p: string, v: string, j: PkgJob) {
	const key = process.env.OPENAI_API_KEY;
	const open = loadManifest(p).requests.filter((r) => r.status === "open" && r.video === v && r.kind === "image");
	if (!open.length) return;
	if (!key) {
		const msg = `OPENAI_API_KEY not set: ${open.length} image(s) left as open requests (the render uses placeholders for them).`;
		j.warnings.push(msg);
		logLine(p, v, msg);
		return;
	}
	const model = process.env.VK_IMAGE_MODEL ?? "gpt-image-2";
	const concurrency = Math.max(1, Math.min(20, Number(process.env.VK_IMAGE_CONCURRENCY) || 5));
	const total = open.length;
	let done = 0;
	const failed: string[] = [];
	const reportProgress = () => {
		j.package.imagesDone = done;
		j.step = "images";
		j.progress = Math.min(0.22, 0.05 + 0.17 * (done / total));
		saveJob(j);
	};
	reportProgress();
	await pMap(open, concurrency, async (r) => {
		for (let attempt = 0; ; attempt++) {
			try {
				await genImage(p, r.name, r.description, "portrait", { model, timeoutMs: 180_000 });
				logLine(p, v, `image ${r.name}: ok${attempt ? ` (retry ${attempt})` : ""}`);
				break;
			} catch (e) {
				const err = e as Error;
				if (attempt < 2 && isRetryable(err)) {
					logLine(p, v, `image ${r.name}: retry ${attempt + 1} of 2 (${err.message.slice(0, 200)})`);
					await sleep(1500 * 2 ** attempt);
					continue;
				}
				failed.push(r.name);
				const msg = `image "${r.name}" generation failed: ${err.message}`;
				j.warnings.push(msg);
				logLine(p, v, `image ${r.name}: failed (${err.message.slice(0, 300)})`);
				break;
			}
		}
		done++;
		reportProgress();
	});
	if (failed.length > total / 2)
		throw new Error(`${failed.length}/${total} images failed to generate (more than half) — aborting. Failed: ${failed.join(", ")}`);
}

/** Remove a `music: bgmusic` override from script.md so the video falls back to the project/style default preset. */
function clearMusicOverride(p: string, v: string) {
	const f = join(videoDir(p, v), "script.md");
	const src = readFileSync(f, "utf8");
	const updated = src.replace(/^music:\s*bgmusic\s*$\n?/m, "");
	if (updated !== src) writeFileSync(f, updated);
}

async function resolveMusicAsset(p: string, v: string, j: PkgJob, musicUrl?: string, label?: string) {
	if (!musicUrl) return;
	if (loadManifest(p).assets.bgmusic) return; // already downloaded (resume)
	try {
		const res = await fetch(musicUrl, { headers: { "user-agent": "Mozilla/5.0", accept: "audio/*,*/*;q=0.8" } });
		const ct = res.headers.get("content-type") ?? "";
		if (!res.ok || !/audio\//.test(ct))
			throw new Error(
				`not a direct audio link (status ${res.status}, content-type "${ct}"). Pixabay/Mixkit page URLs are usually behind a Cloudflare/JS wall; a direct CDN .mp3 link works.`,
			);
		await addUrl(p, musicUrl, { name: "bgmusic", kind: "music", license: "pixabay/mixkit (verify terms on the source page)", credit: label, source: { type: "url", url: musicUrl } });
		logLine(p, v, `downloaded music from ${musicUrl}`);
	} catch (e) {
		const msg = `music download failed (${(e as Error).message}); using the style's default music preset instead.`;
		j.warnings.push(msg);
		logLine(p, v, msg);
		clearMusicOverride(p, v);
	}
}

/** The pipeline: images -> music -> voice -> check -> stills -> render. Safe to re-run (skips work already done). */
export async function runPackageJob(p: string, v: string) {
	const j = readJob(p, v);
	if (!j) throw new Error(`no job record for ${p}/${v}`);
	const musicUrl = j.musicUrl;
	const musicLabel = j.musicLabel;
	j.state = "running";
	j.pid = process.pid;
	j.error = undefined;
	saveJob(j);
	const step = (s: Step, progress: number) => {
		j.step = s;
		j.progress = progress;
		saveJob(j);
		logLine(p, v, `step: ${s}`);
	};
	try {
		step("images", 0.05);
		await fulfillImageRequests(p, v, j);

		step("music", 0.25);
		await resolveMusicAsset(p, v, j, musicUrl, musicLabel);

		step("voice", 0.4);
		const before = loadVideo(p, v);
		if (before.files.vo && before.cues) logLine(p, v, "voice: vo.mp3 + cues.json already present, skipping TTS");
		else logLine(p, v, runCli(["voice", p, v]));

		step("check", 0.7);
		logLine(p, v, runCli(["check", p, v]));

		step("stills", 0.78);
		try {
			logLine(p, v, runCli(["stills", p, v]));
		} catch (e) {
			j.warnings.push(`stills failed: ${(e as Error).message}`);
		}

		step("render", 0.85);
		logLine(p, v, runCli(["render", p, v]));

		const info = loadVideo(p, v);
		j.output = info.files.out ? join("projects", p, "videos", v, info.files.out) : undefined;
		j.stills = info.files.stills.map((s) => join("projects", p, "videos", v, s));
		j.state = "done";
		j.step = "done";
		j.progress = 1;
		saveJob(j);
		logLine(p, v, "done");
	} catch (e) {
		j.state = "error";
		j.error = (e as Error).message;
		saveJob(j);
		logLine(p, v, `error: ${(e as Error).message}`);
	}
}
