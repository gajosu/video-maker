// Video batches: several videos planned together (by the global chat's "director" session or from the terminal)
// and built in parallel by the web studio. projects/<p>/batches/<id>/batch.json holds the plan; launching turns
// every item into a studio job (projects/<p>/jobs/<video>/), which the web server's scheduler runs up to
// VK_STUDIO_MAX_JOBS at a time. Each job stops at its script for approval in the batch panel.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withLockSync } from "./lock.ts";
import { projectDir } from "./paths.ts";
import { STYLE_NAMES } from "./styles.ts";

export type BatchItem = {
	title: string;
	/** the idea, angle or full script for this video */
	idea: string;
	style?: string;
	duration?: number;
	voice?: string;
	music?: string;
	/** reference video links for this item (vk-ref) */
	videoRefs?: string[];
	/** library asset names to use */
	assets?: string[];
	/** the video slug, once the job exists */
	video?: string;
};
export type BatchDefaults = {
	style: string;
	duration: number;
	voice?: string;
	music?: string;
	/** shared reference links (every item studies them) */
	videoRefs?: string[];
	flow?: { clips: number; images: number };
};
/** draft: editable, nothing spent · launching: waiting for the web scheduler to create the jobs */
export type BatchStatus = "draft" | "launching" | "running" | "done" | "cancelled";
export type Batch = {
	id: string;
	project: string;
	title: string;
	status: BatchStatus;
	defaults: BatchDefaults;
	items: BatchItem[];
	createdAt: number;
	updatedAt: number;
};

export const MAX_BATCH = 12;
export const MUSIC_PRESETS = ["", "beat", "pulse", "ambient", "pluck", "none"];
const LINK = /^https?:\/\/[^\s"'`$\\<>|;&(){}]+$/;
const VOICE = /^(\w{8,40}|\w+\/\w+)$/;

export const batchesDir = (p: string) => join(projectDir(p), "batches");
const batchFile = (p: string, id: string) => join(batchesDir(p), assertBatchId(id), "batch.json");

export function assertBatchId(id: string): string {
	if (!/^b[a-z0-9-]{3,40}$/.test(id)) throw new Error(`invalid batch id "${id}"`);
	return id;
}

export function loadBatch(p: string, id: string): Batch | null {
	try {
		return JSON.parse(readFileSync(batchFile(p, id), "utf8"));
	} catch {
		return null;
	}
}

function writeBatch(b: Batch) {
	b.updatedAt = Date.now();
	const f = batchFile(b.project, b.id);
	mkdirSync(join(f, ".."), { recursive: true });
	const tmp = `${f}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(b, null, 1)}\n`);
	renameSync(tmp, f);
}

/** read-modify-write under a lock (the web, the scheduler and the CLI all touch batches) */
export function updateBatch<T>(p: string, id: string, fn: (b: Batch) => T): T {
	mkdirSync(batchesDir(p), { recursive: true });
	return withLockSync(join(batchesDir(p), `.${assertBatchId(id)}.lock`), () => {
		const b = loadBatch(p, id);
		if (!b) throw new Error(`no batch "${id}" in ${p}`);
		const r = fn(b);
		writeBatch(b);
		return r;
	});
}

export function listBatches(p: string): Batch[] {
	if (!existsSync(batchesDir(p))) return [];
	return readdirSync(batchesDir(p))
		.filter((d) => d.startsWith("b"))
		.flatMap((id) => {
			const b = loadBatch(p, id);
			return b ? [b] : [];
		})
		.sort((a, b) => b.createdAt - a.createdAt);
}

const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
function links(x: unknown, what: string): string[] {
	const out = [...new Set((Array.isArray(x) ? x : []).map((u) => str(u, 500)).filter(Boolean))];
	for (const u of out) if (!LINK.test(u)) throw new Error(`${what}: invalid link ${u.slice(0, 80)}`);
	if (out.length > 3) throw new Error(`${what}: at most 3 reference links`);
	return out;
}
const style = (x: unknown, fallback: string) => (STYLE_NAMES.includes(x as never) ? String(x) : fallback);
const duration = (x: unknown, fallback: number) => (x === undefined ? fallback : Math.max(10, Math.min(90, Math.round(Number(x) || fallback))));
function voice(x: unknown, what: string): string | undefined {
	const v = str(x, 200);
	if (v && !VOICE.test(v)) throw new Error(`${what}: invalid voice "${v}" (an account voice id or owner/id from the library)`);
	return v || undefined;
}
function music(x: unknown): string | undefined {
	const m = str(x, 20);
	return MUSIC_PRESETS.includes(m) && m ? m : undefined;
}

/** validate a plan ({title, defaults, items}) as written by the director or the batch panel */
export function normalizePlan(raw: unknown): Pick<Batch, "title" | "defaults" | "items"> {
	const o = (raw ?? {}) as Record<string, unknown>;
	const d = (o.defaults ?? {}) as Record<string, unknown>;
	const f = (d.flow ?? {}) as Record<string, unknown>;
	const clamp6 = (x: unknown) => Math.max(0, Math.min(6, Math.round(Number(x) || 0)));
	const defaults: BatchDefaults = {
		style: style(d.style, "punchy"),
		duration: duration(d.duration, 30),
		voice: voice(d.voice, "defaults"),
		music: music(d.music),
		videoRefs: links(d.videoRefs, "defaults"),
		flow: { clips: clamp6(f.clips), images: clamp6(f.images) },
	};
	const rawItems = Array.isArray(o.items) ? o.items : [];
	if (!rawItems.length) throw new Error("a batch needs at least one video (items: [{title, idea}])");
	if (rawItems.length > MAX_BATCH) throw new Error(`at most ${MAX_BATCH} videos per batch`);
	const items = rawItems.map((it, i) => {
		const r = (it ?? {}) as Record<string, unknown>;
		const title = str(r.title, 80);
		const idea = str(r.idea, 20000);
		if (!title) throw new Error(`item ${i + 1}: missing title`);
		if (idea.length < 10) throw new Error(`item ${i + 1} ("${title}"): describe the idea (10+ characters)`);
		const item: BatchItem = { title, idea };
		if (r.style !== undefined) item.style = style(r.style, defaults.style);
		if (r.duration !== undefined) item.duration = duration(r.duration, defaults.duration);
		const v = voice(r.voice, `item ${i + 1}`);
		if (v) item.voice = v;
		const m = music(r.music);
		if (m) item.music = m;
		const refs = links(r.videoRefs, `item ${i + 1}`);
		if (refs.length) item.videoRefs = refs;
		const assets = (Array.isArray(r.assets) ? r.assets : []).map((a) => str(a, 60)).filter((a) => /^[\w-]+$/.test(a)).slice(0, 12);
		if (assets.length) item.assets = assets;
		if (typeof r.video === "string" && /^[\w-]+$/.test(r.video)) item.video = r.video;
		return item;
	});
	return { title: str(o.title, 80) || `Lote de ${items.length} videos`, defaults, items };
}

export function createBatch(p: string, raw: unknown, o: { launch?: boolean } = {}): Batch {
	const plan = normalizePlan(raw);
	const now = Date.now();
	const b: Batch = {
		id: `b${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
		project: p,
		...plan,
		status: o.launch ? "launching" : "draft",
		createdAt: now,
		updatedAt: now,
	};
	writeBatch(b);
	return b;
}

/** item settings with the batch defaults filled in */
export function resolvedItem(b: Batch, it: BatchItem) {
	return {
		title: it.title,
		idea: it.idea,
		style: it.style ?? b.defaults.style,
		duration: it.duration ?? b.defaults.duration,
		voice: it.voice ?? b.defaults.voice,
		music: it.music ?? b.defaults.music,
		videoRefs: [...new Set([...(b.defaults.videoRefs ?? []), ...(it.videoRefs ?? [])])].slice(0, 3),
		assets: it.assets ?? [],
		flow: b.defaults.flow ?? { clips: 0, images: 0 },
	};
}
