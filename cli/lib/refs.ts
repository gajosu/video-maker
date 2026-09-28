// Reference videos: projects/<p>/references/<name>/ holds a downloaded (or local) video that we study, never
// ship: its voice cadence, cut rhythm, hook, palette and graphic style. `analyze` writes analysis.json +
// report.md and contact sheets (shots.jpg, timeline.jpg, hook.jpg) that Claude reads to write a style brief.
// Downloads go through yt-dlp (tools/bin/yt-dlp from `bun run setup`, or one on PATH), with a cobalt API
// instance (COBALT_API_URL [+ COBALT_API_KEY]) as the fallback.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { transcribe, type Transcript } from "./elevenlabs.ts";
import { decodeMono, duration, run, SR, speechSegments } from "./ffmpeg.ts";
import { projectDir, ROOT } from "./paths.ts";

export const refsDir = (p: string) => join(projectDir(p), "references");
export const refDir = (p: string, name: string) => join(refsDir(p), assertRefName(name));

export function assertRefName(n: string): string {
	if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(n)) throw new Error(`invalid reference name "${n}" (lowercase letters, numbers, - and _)`);
	return n;
}

export type RefMeta = {
	name: string;
	url?: string;
	file: string;
	title?: string;
	uploader?: string;
	platform?: string;
	via: "yt-dlp" | "cobalt" | "file";
	downloadedAt: string;
	note: string;
};

const NOTE = "Reference only: study it, never use its footage, audio, music or script in a video.";

function readJson<T>(f: string): T | undefined {
	try {
		return JSON.parse(readFileSync(f, "utf8"));
	} catch {
		return undefined;
	}
}

export const loadRef = (p: string, name: string) => readJson<RefMeta>(join(refDir(p, name), "ref.json"));
export const loadAnalysis = (p: string, name: string) => readJson<Analysis>(join(refDir(p, name), "analysis.json"));

export function listRefs(p: string): RefMeta[] {
	if (!existsSync(refsDir(p))) return [];
	return readdirSync(refsDir(p))
		.map((n) => readJson<RefMeta>(join(refsDir(p), n, "ref.json")))
		.filter((m): m is RefMeta => !!m)
		.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
}

export function removeRef(p: string, name: string) {
	const d = refDir(p, name);
	if (!existsSync(d)) throw new Error(`no reference "${name}"`);
	rmSync(d, { recursive: true, force: true });
}

/** a name from the video title / url */
export function refNameFrom(s: string): string {
	const base =
		s
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/^https?:\/\/(www\.)?/, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 41)
			.replace(/-[^-]*$|-+$/, "") || "ref";
	return /^[a-z0-9]/.test(base) ? base : `ref-${base}`;
}

// ---------- download ----------

export function ytDlpBin(): string | undefined {
	const local = join(ROOT, "tools", "bin", "yt-dlp");
	if (existsSync(local)) return local;
	return spawnSync("yt-dlp", ["--version"]).status === 0 ? "yt-dlp" : undefined;
}

function viaYtDlp(url: string, dir: string, maxSeconds: number): Omit<RefMeta, "name" | "downloadedAt" | "note"> {
	const bin = ytDlpBin();
	if (!bin) throw new Error("yt-dlp is not installed (run: bun run setup)");
	const extra = (process.env.VK_YTDLP_ARGS ?? "").split(/\s+/).filter(Boolean); // e.g. --cookies cookies.txt
	const r = spawnSync(
		bin,
		[
			"--no-playlist", "--no-progress", "--js-runtimes", "bun",
			"-f", "bv*[height<=1920]+ba/b", "--merge-output-format", "mp4",
			"--match-filter", `duration <? ${maxSeconds}`, "--max-filesize", "400M",
			"--write-info-json", "-o", join(dir, "video.%(ext)s"),
			...extra, "--", url,
		],
		{ encoding: "utf8", maxBuffer: 1 << 26 },
	);
	const file = readdirSync(dir).find((f) => f.startsWith("video.") && !f.endsWith(".json") && !f.includes(".part"));
	if (r.status !== 0 || !file) {
		const why = `${r.stderr ?? ""}${r.stdout ?? ""}`.split("\n").filter((l) => /ERROR|does not pass filter|larger than/.test(l));
		throw new Error(`yt-dlp: ${why.join(" ").slice(0, 500) || `exit ${r.status}`}`);
	}
	const info = readJson<Record<string, unknown>>(join(dir, "video.info.json")) ?? {};
	rmSync(join(dir, "video.info.json"), { force: true }); // big (formats, thumbnails); keep what matters in ref.json
	const s = (k: string) => (typeof info[k] === "string" ? (info[k] as string) : undefined);
	return { url, file, title: s("title") ?? s("fulltitle"), uploader: s("uploader") ?? s("channel"), platform: s("extractor_key"), via: "yt-dlp" };
}

async function viaCobalt(url: string, dir: string): Promise<Omit<RefMeta, "name" | "downloadedAt" | "note">> {
	const api = process.env.COBALT_API_URL;
	if (!api) throw new Error("cobalt not configured (set COBALT_API_URL, and COBALT_API_KEY if the instance needs one)");
	const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
	if (process.env.COBALT_API_KEY) headers.authorization = `Api-Key ${process.env.COBALT_API_KEY}`;
	const res = await fetch(api.replace(/\/?$/, "/"), {
		method: "POST",
		headers,
		body: JSON.stringify({ url, videoQuality: "1080", downloadMode: "auto", youtubeVideoCodec: "h264" }),
	});
	const j = (await res.json().catch(() => ({}))) as {
		status?: string;
		url?: string;
		filename?: string;
		picker?: { type: string; url: string }[];
		error?: { code?: string };
	};
	const media = j.status === "tunnel" || j.status === "redirect" ? j.url : j.status === "picker" ? j.picker?.find((x) => x.type === "video")?.url : undefined;
	if (!media) throw new Error(`cobalt: ${j.error?.code ?? j.status ?? res.status}`);
	const dl = await fetch(media);
	if (!dl.ok || !dl.body) throw new Error(`cobalt download ${dl.status}`);
	const file = `video${extname(j.filename ?? "") || ".mp4"}`;
	writeFileSync(join(dir, file), Buffer.from(await dl.arrayBuffer()));
	return { url, file, title: j.filename?.replace(/\.[^.]+$/, ""), via: "cobalt" };
}

/** download a url (or copy a local file) into references/<name>/ */
export async function addRef(p: string, src: string, o: { name?: string; via?: "yt-dlp" | "cobalt"; maxSeconds?: number } = {}): Promise<RefMeta> {
	const isUrl = /^https?:\/\//i.test(src);
	if (!isUrl && !existsSync(src)) throw new Error(`not a url or file: ${src}`);
	const tmp = join(refsDir(p), `.tmp-${Date.now()}`);
	mkdirSync(tmp, { recursive: true });
	try {
		let got: Omit<RefMeta, "name" | "downloadedAt" | "note">;
		if (!isUrl) {
			const file = `source${extname(src).toLowerCase() || ".mp4"}`;
			copyFileSync(src, join(tmp, file));
			got = { file, title: src.split("/").pop(), via: "file" };
		} else if (o.via === "cobalt") got = await viaCobalt(src, tmp);
		else if (o.via === "yt-dlp" || !process.env.COBALT_API_URL) got = viaYtDlp(src, tmp, o.maxSeconds ?? 900);
		else {
			try {
				got = viaYtDlp(src, tmp, o.maxSeconds ?? 900);
			} catch (e) {
				for (const f of readdirSync(tmp)) rmSync(join(tmp, f), { force: true });
				try {
					got = await viaCobalt(src, tmp);
				} catch (e2) {
					throw new Error(`${(e as Error).message}\n${(e2 as Error).message}`);
				}
			}
		}
		const name = assertRefName(o.name ?? refNameFrom(got.title ?? src));
		const dir = refDir(p, name);
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(refsDir(p), { recursive: true });
		renameSync(tmp, dir);
		const meta: RefMeta = { name, ...got, downloadedAt: new Date().toISOString(), note: NOTE };
		writeFileSync(join(dir, "ref.json"), `${JSON.stringify(meta, null, 1)}\n`);
		return meta;
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// ---------- analysis ----------

export type Phrase = { start: number; end: number; words: number; text: string };
export type Analysis = {
	video: { duration: number; width: number; height: number; fps: number; audio: boolean };
	cuts?: { times: number[]; fades: number[]; shots: number; avgShot: number; minShot: number; maxShot: number; inFirst3s: number };
	palette?: { main: Swatch[]; accents: Swatch[] };
	audio?: { lufs: number; speechRatio: number; bedDb?: number };
	speech?: {
		language?: string;
		model: string;
		firstWord: number;
		words: number;
		wpm: number;
		articulationWps: number;
		pauses: { count: number; median: number; max: number };
		phrases: Phrase[];
		avgPhraseWords: number;
		events: string[];
	};
	images?: { shots: string; timeline: string; hook: string; frames: { file: string; t: number }[] };
	analyzedAt: string;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]) => {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
};

function probe(file: string) {
	const j = JSON.parse(
		run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).stdout.toString(),
	) as { streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[]; format: { duration?: string } };
	const v = j.streams.find((s) => s.codec_type === "video" && (s.width ?? 0) > 16) ?? { width: 0, height: 0, avg_frame_rate: "0/1" };
	const [a, b] = (v.avg_frame_rate ?? "30/1").split("/").map(Number);
	return {
		duration: r2(Number.parseFloat(j.format.duration ?? "0") || duration(file)),
		width: v.width ?? 0,
		height: v.height ?? 0,
		fps: r2(b ? a / b : 0),
		audio: j.streams.some((s) => s.codec_type === "audio"),
	};
}

/** Cuts ("cut") and dissolves or big camera moves ("fade"). Tiny grey frames at 10 fps; a change is scored by
 * the 85th-percentile pixel difference, so a b-roll window that fills a third of a framed layout still counts.
 * Hard cuts spike frame-to-frame; dissolves show up comparing frames 0.5 s apart. Both must stand out from how
 * much the picture moves on at least one side (motion graphics and pans move constantly, cuts do not). */
function detectCuts(file: string, dur: number): { t: number; kind: "cut" | "fade" }[] {
	const W = 54;
	const H = 96;
	const FPS = 10;
	const PX = W * H;
	const L = 5;
	const raw = run("ffmpeg", ["-loglevel", "error", "-i", file, "-vf", `fps=${FPS},scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]).stdout;
	const n = Math.floor(raw.length / PX);
	const buf = new Uint8Array(PX);
	const diff = (a: number, b: number) => {
		for (let i = 0; i < PX; i++) buf[i] = Math.abs(raw[a * PX + i] - raw[b * PX + i]);
		buf.sort();
		return buf[Math.floor(PX * 0.85)];
	};
	const d1 = Array.from({ length: n }, (_, f) => (f ? diff(f, f - 1) : 0));
	const dl = Array.from({ length: n }, (_, f) => (f >= L ? diff(f, f - L) : 0));
	const calm = (xs: number[], f: number, near: number, far: number) =>
		Math.min(median(xs.slice(Math.max(1, f - far), Math.max(1, f - near))) || 99, median(xs.slice(f + near + 1, f + far + 1)) || 99);
	const found: { t: number; kind: "cut" | "fade" }[] = [];
	for (let f = 1; f < n; f++) {
		if (d1[f] >= 20 && d1[f] > 3 * calm(d1, f, 0, 6) + 4) found.push({ t: f / FPS, kind: "cut" });
		if (f >= 2 * L && dl[f] === Math.max(...dl.slice(f - L, f + L + 1)) && dl[f] >= 30 && dl[f] > 2 * calm(dl, f, L, 20) + 6)
			found.push({ t: (f - L / 2) / FPS, kind: "fade" });
	}
	found.sort((a, b) => a.t - b.t);
	const out: typeof found = [];
	for (const c of found) {
		if (c.t < 0.3 || c.t > dur - 0.2) continue;
		const last = out[out.length - 1];
		if (last && c.t - last.t < 0.6) {
			if (c.kind === "cut") out[out.length - 1] = c;
		} else out.push(c);
	}
	return out.map((c) => ({ t: r2(c.t), kind: c.kind }));
}

// thumbnails keep the reference's orientation (9:16, 16:9 or 1:1) so the sheets stay readable
function boxFor(w: number, h: number): string {
	const [bw, bh] = h > w * 1.1 ? [270, 480] : w > h * 1.1 ? [480, 270] : [360, 360];
	return `scale=${bw}:${bh}:force_original_aspect_ratio=decrease,pad=${bw}:${bh}:(ow-iw)/2:(oh-ih)/2:color=0x111111`;
}

function frameAt(file: string, t: number, out: string, box: string) {
	run("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", box, "-q:v", "4", out]);
}

function sheet(frames: string[], out: string, cols = 6) {
	if (!frames.length) return;
	const listDir = join(out, "..", ".sheet");
	rmSync(listDir, { recursive: true, force: true });
	mkdirSync(listDir);
	frames.forEach((f, i) => copyFileSync(f, join(listDir, `${String(i).padStart(3, "0")}.jpg`)));
	const rows = Math.ceil(frames.length / cols);
	run("ffmpeg", ["-loglevel", "error", "-y", "-i", join(listDir, "%03d.jpg"), "-vf", `tile=${Math.min(cols, frames.length)}x${rows}:padding=6:margin=6:color=0x000000`, "-frames:v", "1", "-q:v", "3", out]);
	rmSync(listDir, { recursive: true, force: true });
}

type Swatch = { hex: string; share: number };

/** dominant colors (1 fps tiny frames, 4-bit buckets, near neighbours merged) plus the saturated accents,
 * which a dark or white background would otherwise bury */
function palette(file: string, dur: number): { main: Swatch[]; accents: Swatch[] } {
	const fps = Math.min(1, 40 / Math.max(1, dur));
	const raw = run("ffmpeg", ["-loglevel", "error", "-i", file, "-vf", `fps=${fps},scale=36:64`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout;
	const counts = new Map<number, number>();
	for (let i = 0; i + 2 < raw.length; i += 3) {
		const k = ((raw[i] >> 4) << 8) | ((raw[i + 1] >> 4) << 4) | (raw[i + 2] >> 4);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	const total = raw.length / 3;
	const rgb = (k: number) => [((k >> 8) & 15) * 17 + 8, ((k >> 4) & 15) * 17 + 8, (k & 15) * 17 + 8].map((x) => Math.min(255, x));
	const group = (entries: [number, number][], max: number): Swatch[] => {
		const picked: { c: number[]; n: number }[] = [];
		for (const [k, n] of entries.sort((a, b) => b[1] - a[1])) {
			const c = rgb(k);
			const near = picked.find((p) => Math.hypot(p.c[0] - c[0], p.c[1] - c[1], p.c[2] - c[2]) < 48);
			if (near) near.n += n;
			else picked.push({ c, n });
		}
		return picked
			.sort((a, b) => b.n - a.n)
			.slice(0, max)
			.filter((p) => p.n / total >= 0.002)
			.map((p) => ({ hex: `#${p.c.map((x) => x.toString(16).padStart(2, "0")).join("")}`, share: r2(p.n / total) }));
	};
	const chroma = (k: number) => {
		const c = rgb(k);
		return Math.max(...c) - Math.min(...c);
	};
	return { main: group([...counts], 8), accents: group([...counts].filter(([k]) => chroma(k) >= 90), 5) };
}

function speechStats(t: Transcript): NonNullable<Analysis["speech"]> {
	const words = t.words.filter((w) => w.type === "word");
	const events = t.words.filter((w) => w.type === "audio_event").map((w) => `${r2(w.start)}s ${w.text}`);
	if (!words.length) return { language: t.language_code, model: t.model, firstWord: 0, words: 0, wpm: 0, articulationWps: 0, pauses: { count: 0, median: 0, max: 0 }, phrases: [], avgPhraseWords: 0, events };
	const gaps = words.slice(1).map((w, i) => w.start - words[i].end);
	const pauses = gaps.filter((g) => g >= 0.25);
	const span = words[words.length - 1].end - words[0].start;
	const talking = span - pauses.reduce((a, b) => a + b, 0);
	const phrases: Phrase[] = [];
	let cur: typeof words = [];
	words.forEach((w, i) => {
		cur.push(w);
		const next = words[i + 1];
		if (!next || next.start - w.end >= 0.35 || /[.?!…]$/.test(w.text)) {
			phrases.push({ start: r2(cur[0].start), end: r2(w.end), words: cur.length, text: cur.map((x) => x.text).join(" ") });
			cur = [];
		}
	});
	return {
		language: t.language_code,
		model: t.model,
		firstWord: r2(words[0].start),
		words: words.length,
		wpm: Math.round((words.length / span) * 60),
		articulationWps: r2(words.length / Math.max(0.1, talking)),
		pauses: { count: pauses.length, median: r2(median(pauses)), max: r2(Math.max(0, ...pauses)) },
		phrases,
		avgPhraseWords: r2(words.length / phrases.length),
		events,
	};
}

/** loudness of the gaps between words: a music bed or ambience shows up as -45 dB or louder */
function bedLevel(audio: string, t: Transcript): number | undefined {
	const x = decodeMono(audio);
	const words = t.words.filter((w) => w.type === "word");
	let sum = 0;
	let n = 0;
	for (let i = 1; i < words.length; i++) {
		const a = Math.floor((words[i - 1].end + 0.05) * SR);
		const b = Math.floor((words[i].start - 0.05) * SR);
		for (let k = a; k < b && k < x.length; k++) {
			sum += x[k] * x[k];
			n++;
		}
	}
	return n > SR * 0.3 ? r2(10 * Math.log10(sum / n + 1e-12)) : undefined;
}

/** cuts, palette and the contact sheets */
function visuals(dir: string, file: string, video: Analysis["video"]): Pick<Analysis, "cuts" | "palette" | "images"> {
	const box = boxFor(video.width, video.height);
	// cuts → shots; one frame from the middle of each shot (evenly thinned to 24)
	const changes = detectCuts(file, video.duration);
	const times = changes.map((c) => c.t);
	const bounds = [0, ...times, video.duration];
	const shots = bounds.slice(1).map((e, i) => e - bounds[i]);
	const fdir = join(dir, "frames");
	rmSync(fdir, { recursive: true, force: true });
	mkdirSync(fdir);
	const pickN = <T>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]));
	const shotMids = pickN(shots.map((d, i) => r2(bounds[i] + d / 2)), 24);
	const frames: { file: string; t: number }[] = [];
	for (const t of shotMids) {
		const f = `frames/shot-${t.toFixed(2)}.jpg`;
		frameAt(file, t, join(dir, f), box);
		frames.push({ file: f, t });
	}
	const timeline: string[] = [];
	for (let i = 0; i < 24; i++) {
		const t = r2(((i + 0.5) * video.duration) / 24);
		const f = join(fdir, `time-${t.toFixed(2)}.jpg`);
		frameAt(file, t, f, box);
		timeline.push(f);
	}
	// the hook, frame by frame: first 3 s at 4 fps, to read how things enter and move
	const hook: string[] = [];
	for (let i = 0; i < 12; i++) {
		const t = r2(i / 4);
		if (t >= video.duration) break;
		const f = join(fdir, `hook-${t.toFixed(2)}.jpg`);
		frameAt(file, t, f, box);
		hook.push(f);
	}
	sheet(frames.map((f) => join(dir, f.file)), join(dir, "shots.jpg"));
	sheet(timeline, join(dir, "timeline.jpg"));
	sheet(hook, join(dir, "hook.jpg"));

	return {
		cuts: {
			times,
			fades: changes.filter((c) => c.kind === "fade").map((c) => c.t),
			shots: shots.length,
			avgShot: r2(video.duration / shots.length),
			minShot: r2(Math.min(...shots)),
			maxShot: r2(Math.max(...shots)),
			inFirst3s: times.filter((t) => t < 3).length,
		},
		palette: palette(file, video.duration),
		images: { shots: "shots.jpg", timeline: "timeline.jpg", hook: "hook.jpg", frames },
	};
}

export async function analyzeRef(p: string, name: string, o: { transcribe?: boolean } = {}): Promise<Analysis> {
	const meta = loadRef(p, name);
	if (!meta) throw new Error(`no reference "${name}" (bun vk ref add ${p} <url>)`);
	const dir = refDir(p, name);
	const file = join(dir, meta.file);
	const video = probe(file);
	if (!video.width && !video.audio) throw new Error("no video or audio stream");
	const analysis: Analysis = { video, ...(video.width ? visuals(dir, file, video) : {}), analyzedAt: new Date().toISOString() };

	if (video.audio) {
		const audio = join(dir, "audio.mp3");
		run("ffmpeg", ["-loglevel", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", audio]);
		const eb = run("ffmpeg", ["-hide_banner", "-i", audio, "-af", "ebur128", "-f", "null", "-"]).stderr;
		const lufs = Number.parseFloat(eb.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold[\s\S]*$/)?.[1] ?? "NaN");
		const speaking = speechSegments(audio, video.duration).reduce((a, [s, e]) => a + e - s, 0);
		analysis.audio = { lufs, speechRatio: r2(speaking / video.duration) };
		if (o.transcribe !== false) {
			// the transcript is paid per minute: reuse it on re-analysis
			const tf = join(dir, "transcript.json");
			const t = readJson<Transcript>(tf) ?? (await transcribe(audio));
			writeFileSync(tf, `${JSON.stringify(t)}\n`);
			analysis.speech = speechStats(t);
			analysis.audio.bedDb = bedLevel(audio, t);
		}
	}
	writeFileSync(join(dir, "analysis.json"), `${JSON.stringify(analysis, null, 1)}\n`);
	writeFileSync(join(dir, "report.md"), report(meta, analysis));
	return analysis;
}

/** one row per shot: time range, length and the frame that shows it */
function shotRows(a: Analysis): string[] {
	if (!a.cuts) return [];
	const b = [0, ...a.cuts.times, a.video.duration];
	const frames = a.images?.frames ?? [];
	return b.slice(1).map((end, i) => {
		const start = b[i];
		const f = frames.find((x) => x.t >= start && x.t <= end);
		return `- ${i + 1}. ${start.toFixed(2)}–${end.toFixed(2)} (${(end - start).toFixed(1)} s)${f ? ` ${f.file}` : ""}`;
	});
}

const pct = (c: Swatch) => `${c.hex} ${c.share < 0.01 ? "<1" : Math.round(c.share * 100)}%`;

export function report(m: RefMeta, a: Analysis): string {
	const s = a.speech;
	const orient = a.video.height > a.video.width ? "vertical" : a.video.height === a.video.width ? "square" : "horizontal";
	const rows: (string | false)[] = [
		`# Reference: ${m.title ?? m.name}`,
		"",
		`${m.url ?? m.file}${m.uploader ? ` · ${m.uploader}` : ""}${m.platform ? ` · ${m.platform}` : ""} · via ${m.via}`,
		`> ${m.note}`,
		"",
		"## Format",
		a.video.width
			? `- ${a.video.duration} s · ${a.video.width}×${a.video.height} (${orient}) · ${a.video.fps} fps`
			: `- ${a.video.duration} s · audio only`,
	];
	const c = a.cuts;
	if (c)
		rows.push(
			"",
			"## Editing rhythm",
			`- ${c.shots} shots, average ${c.avgShot} s (shortest ${c.minShot} s, longest ${c.maxShot} s), ${c.inFirst3s} cut(s) in the first 3 s`,
			`- changes at: ${c.times.map((t) => (c.fades.includes(t) ? `${t}~` : String(t))).join(", ") || "none detected (one continuous shot or animated graphics; look at timeline.jpg)"}`,
			"  (~ = dissolve or a big camera/graphic move; plain = hard cut)",
			"",
			"### Shots (recreate them one by one)",
			...shotRows(a),
		);
	if (a.palette)
		rows.push(
			"",
			"## Palette (share of screen)",
			`- ${a.palette.main.map(pct).join(" · ")}`,
			a.palette.accents.length > 0 && `- accents: ${a.palette.accents.map(pct).join(" · ")}`,
		);
	if (a.audio)
		rows.push(
			"",
			"## Audio",
			`- loudness ${Number.isNaN(a.audio.lufs) ? "?" : `${a.audio.lufs} LUFS`} · non-silent over ${Math.round(a.audio.speechRatio * 100)}% of the runtime`,
			a.audio.bedDb !== undefined && `- between words: ${a.audio.bedDb} dB (${a.audio.bedDb > -45 ? "music bed or ambience under the voice" : "near silence, dry voice"})`,
		);
	if (s)
		rows.push(
			"",
			"## Voice and cadence",
			`- language ${s.language ?? "?"} · first word at ${s.firstWord} s · ${s.words} words`,
			`- ${s.wpm} words/min overall, ${s.articulationWps} words/s while talking`,
			`- ${s.pauses.count} pauses ≥0.25 s (median ${s.pauses.median} s, longest ${s.pauses.max} s)`,
			`- ${s.phrases.length} phrases, ${s.avgPhraseWords} words each on average`,
			s.events.length > 0 && `- audio events: ${s.events.join(", ")}`,
			"",
			"### Phrases",
			...s.phrases.map((ph) => `- ${ph.start.toFixed(2)}–${ph.end.toFixed(2)} (${ph.words}w) ${ph.text}`),
		);
	if (a.images)
		rows.push(
			"",
			"## Pictures (read them)",
			"- `hook.jpg`: first 3 s at 4 fps (left→right, top→bottom): how the hook enters and moves",
			"- `shots.jpg`: one frame per shot, in order",
			"- `timeline.jpg`: 24 evenly spaced frames (useful when cuts are not detected)",
			`- single frames: ${a.images.frames.map((f) => f.file).join(", ")}`,
		);
	return `${rows.filter((r) => r !== false).join("\n")}\n`;
}
