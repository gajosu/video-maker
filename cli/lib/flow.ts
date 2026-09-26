// Google Flow through a local flowkit agent (https://github.com/crisng95/flowkit): its Chrome extension
// runs Flow's RPCs inside the user's signed-in flow.google.com tab and the agent exposes them at
// FLOWKIT_URL (default http://127.0.0.1:8100). Spends the user's own Flow credits.
// Covers: text/frame/reference → video (Omni Flash, Veo), text → image (Nano Banana), image edit,
// image export 2K/4K, uploads (cached per Flow project). Video upscale is not available on Flow's
// current transport (flowkit reports UNSUPPORTED_ON_BATCH_API), so it is not exposed.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { type Asset, addFile, assetFile, assetsDir } from "./assets.ts";

export const FLOW_DURATIONS = [4, 6, 8, 10];
export const FLOW_IMAGE_MODELS: Record<string, string> = { pro: "GEM_PIX_2", nb2: "NARWHAL", lite: "HARBOR_SEAL" };
const IMAGE_ASPECTS: Record<string, string> = { portrait: "9:16", landscape: "16:9", square: "1:1", "9:16": "9:16", "16:9": "16:9", "1:1": "1:1", "3:4": "3:4", "4:3": "4:3" };

const base = () => (process.env.FLOWKIT_URL || "http://127.0.0.1:8100").replace(/\/+$/, "");
const SETUP = 'Start flowkit (bun run flowkit), load its "Flow Kit" extension in Chrome and keep https://flow.google.com open and signed in.';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, body?: unknown, raw = false) {
	let res: Response;
	try {
		res = await fetch(`${base()}/api/flow${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	} catch {
		throw new Error(`flowkit is not reachable at ${base()}. ${SETUP}`);
	}
	if (!res.ok) {
		const text = await res.text();
		const hint =
			res.status === 503 ? ` (the Flow Kit extension is not connected. ${SETUP})`
			: /UNUSUAL_ACTIVITY/.test(text) ? " (Google flagged unusual activity: stop and wait before retrying)"
			: /UNSUPPORTED_ON_BATCH_API/.test(text) ? " (Flow's current API does not support this mode; try --model omni)"
			: "";
		throw new Error(`flowkit ${path} failed: HTTP ${res.status}${hint} ${text.slice(0, 300)}`);
	}
	if (raw) return res;
	const text = await res.text();
	return text ? JSON.parse(text) : {};
}

/** extension connection, pinned project, cooldown and credits */
export async function flowStatus() {
	const status = await call("/status");
	const credits = status.connected ? await call("/credits").catch((e: Error) => ({ error: e.message })) : null;
	return { status, credits };
}

let projectCache: string | undefined;
async function flowProject(): Promise<string> {
	if (projectCache !== undefined) return projectCache;
	const st = await call("/status");
	projectCache = String(st.flow_project_id || st.session_project?.project_id || "");
	return projectCache;
}

// ---------- uploads (asset name or file → Flow media id, cached) ----------

const tmpDir = (p: string) => {
	const d = join(assetsDir(p), ".tmp");
	mkdirSync(d, { recursive: true });
	return d;
};
const cachePath = (p: string) => join(assetsDir(p), ".flow-media.json");
const readCache = (p: string): Record<string, string> => (existsSync(cachePath(p)) ? JSON.parse(readFileSync(cachePath(p), "utf8")) : {});

/** SVG (logos) → PNG, since Flow only takes raster images */
async function rasterize(svgFile: string, out: string) {
	const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
	try {
		const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
		const svg = readFileSync(svgFile, "utf8");
		await page.setContent(`<html><body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;width:1024px;height:1024px"><div style="width:880px;height:880px;display:flex;align-items:center;justify-content:center">${svg.replace("<svg", '<svg style="max-width:100%;max-height:100%;width:100%;height:100%"')}</div></body></html>`);
		await page.screenshot({ path: out, type: "png" });
	} finally {
		await browser.close();
	}
}

/** an image asset name (or a file path) → Flow media id, uploading once per Flow project */
export async function flowMedia(p: string, ref: string): Promise<string> {
	const file = assetFile(p, ref) ?? (existsSync(ref) ? ref : undefined);
	if (!file) throw new Error(`"${ref}" is neither an image asset nor a file`);
	const project = await flowProject();
	const st = statSync(file);
	const key = `${ref}|${st.size}|${Math.round(st.mtimeMs)}|${project}`;
	const cache = readCache(p);
	if (cache[key]) return cache[key];
	let src = file;
	const ext = extname(file).toLowerCase();
	if (ext === ".svg") {
		src = join(tmpDir(p), `${ref.replace(/[^\w.-]/g, "_")}.png`);
		await rasterize(file, src);
	} else if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error(`"${ref}": Flow takes PNG, JPEG, WebP or SVG images`);
	const mime = src.endsWith(".png") ? "image/png" : src.endsWith(".webp") ? "image/webp" : "image/jpeg";
	console.log(`  uploading ${ref} to Flow…`);
	const up = await call("/upload-image", { image_base64: readFileSync(src).toString("base64"), mime_type: mime, file_name: `${ref.replace(/[^\w.-]/g, "_")}${extname(src)}`, project_id: project });
	if (!up.media_id) throw new Error(`Flow upload returned no media id: ${JSON.stringify(up).slice(0, 200)}`);
	writeFileSync(cachePath(p), `${JSON.stringify({ ...cache, [key]: up.media_id }, null, 1)}\n`);
	return up.media_id;
}

/** remember the Flow media id of a generated asset so it can be edited / used as a reference without re-uploading */
function rememberMedia(p: string, a: Asset, mediaId: string, project: string) {
	const f = join(assetsDir(p), a.file);
	const st = statSync(f);
	const cache = readCache(p);
	cache[`${a.name}|${st.size}|${Math.round(st.mtimeMs)}|${project}`] = mediaId;
	writeFileSync(cachePath(p), `${JSON.stringify(cache, null, 1)}\n`);
}

async function download(url: string, out: string) {
	const dl = await fetch(url);
	if (!dl.ok) throw new Error(`downloading from Flow failed: HTTP ${dl.status}`);
	writeFileSync(out, Buffer.from(await dl.arrayBuffer()));
}

const refList = (refs?: string | string[]) => (Array.isArray(refs) ? refs : (refs ?? "").split(",")).map((r) => r.trim()).filter(Boolean);

// ---------- video ----------

export type FlowVideoOpts = {
	duration?: number;
	shape?: "portrait" | "landscape";
	quality?: "360p" | "720p";
	/** start frame (image asset or file) → image-to-video */
	from?: string;
	/** end frame, needs `from` */
	to?: string;
	/** reference images ("ingredients": a character, a product, a logo) → reference-to-video */
	refs?: string | string[];
	/** omni (Gemini Omni Flash, default) or veo (Veo 3.1; start frame only on Flow's current API) */
	model?: "omni" | "veo";
	fps?: number;
};

/** poll either Omni workflows or operations until the clip has a URL */
async function pollVideo(name: string, sub: Record<string, any>): Promise<{ url: string; mediaId?: string }> {
	const polling = sub.flowkitPolling ?? {};
	const workflows = polling.workflows ?? (polling.mode === "batch_media" ? sub.workflows : undefined);
	const operations = polling.operations ?? sub.operations;
	if (!workflows?.length && !operations?.length) throw new Error(`flowkit returned no job to poll: ${JSON.stringify(sub).slice(0, 300)}`);
	const t0 = Date.now();
	for (;;) {
		await sleep(10_000);
		const st = await call("/check-status", workflows?.length ? { workflows, project_id: polling.project_id ?? "" } : { operations, project_id: polling.project_id ?? "" });
		if (workflows?.length) {
			const w = st.workflows?.[0];
			if (w?.error) throw new Error(`Google Flow job failed: ${JSON.stringify(w.error).slice(0, 300)}`);
			if (st.done && w?.media?.url) return { url: w.media.url, mediaId: w.primary_media_id };
		} else {
			const op = st.operations?.[0];
			if (op?.status === "MEDIA_GENERATION_STATUS_FAILED") throw new Error(`Google Flow job failed: ${JSON.stringify(op).slice(0, 300)}`);
			const v = op?.operation?.metadata?.video;
			if (op?.status === "MEDIA_GENERATION_STATUS_SUCCESSFUL" && v?.fifeUrl) return { url: v.fifeUrl, mediaId: v.mediaId };
		}
		const secs = Math.round((Date.now() - t0) / 1000);
		if (secs > 10 * 60) throw new Error("Google Flow video still pending after 10 min");
		console.log(`  ${name}: pending… ${secs}s`);
	}
}

/** text / start(+end) frame / references → video; downloads the clip and adds it as a video asset */
export async function genFlowVideo(p: string, name: string, prompt: string, o: FlowVideoOpts = {}) {
	const duration = o.duration ?? 8;
	if (!FLOW_DURATIONS.includes(duration)) throw new Error(`--duration must be one of ${FLOW_DURATIONS.join(", ")} seconds`);
	const aspect_ratio = o.shape === "landscape" ? "VIDEO_ASPECT_RATIO_LANDSCAPE" : "VIDEO_ASPECT_RATIO_PORTRAIT";
	const resolution = o.quality ?? "720p";
	const refs = refList(o.refs);
	if (o.to && !o.from) throw new Error("--to (end frame) needs --from (start frame)");
	if (refs.length && o.from) throw new Error("use either --from (frames) or --refs (references), not both");
	const model_family = o.model === "veo" ? "veo" : "omni_flash";
	const project_id = await flowProject();
	let sub: Record<string, any>;
	let mode: string;
	if (refs.length) {
		mode = `references (${refs.join(", ")})`;
		const reference_media_ids = [];
		for (const r of refs) reference_media_ids.push(await flowMedia(p, r));
		console.log(`  ${name}: ${duration}s ${o.shape ?? "portrait"} video from ${mode}…`);
		sub = await call("/generate-video-refs", { reference_media_ids, prompt, project_id, scene_id: randomUUID(), aspect_ratio, model_family, duration_s: duration, resolution });
	} else if (o.from) {
		mode = o.to ? `frames ${o.from} → ${o.to}` : `start frame ${o.from}`;
		const start_image_media_id = await flowMedia(p, o.from);
		const end_image_media_id = o.to ? await flowMedia(p, o.to) : undefined;
		console.log(`  ${name}: ${duration}s ${o.shape ?? "portrait"} video from ${mode}…`);
		sub = await call("/generate-video", { start_image_media_id, end_image_media_id, prompt, project_id, scene_id: randomUUID(), aspect_ratio, model_family, duration_s: duration, resolution });
	} else {
		mode = "text";
		console.log(`  ${name}: ${duration}s ${o.shape ?? "portrait"} video from text…`);
		sub = await call("/generate-video-omni-text", { prompt, project_id, duration_s: duration, resolution, aspect_ratio });
	}
	const { url, mediaId } = await pollVideo(name, sub);
	const f = join(tmpDir(p), `${name}.mp4`);
	await download(url, f);
	const a = addFile(p, f, { name, kind: "video", source: { type: "google-flow", prompt, model: `${model_family === "veo" ? "veo-3.1" : "omni-flash"} ${duration}s ${mode}` }, license: "own", credit: "generated with Google Flow", fps: o.fps });
	if (mediaId) rememberMedia(p, a, mediaId, project_id);
	return a;
}

// ---------- images ----------

export type FlowImageOpts = { model?: string; shape?: string; count?: number; seed?: number; refs?: string | string[] };

const imageModel = (m?: string) => (m ? (FLOW_IMAGE_MODELS[m] ?? m) : undefined);
const imageAspect = (s?: string) => {
	const a = IMAGE_ASPECTS[s ?? "portrait"];
	if (!a) throw new Error(`--shape must be one of ${Object.keys(IMAGE_ASPECTS).join(", ")}`);
	return a;
};

/** save every variant: name, name-2, name-3 … */
async function saveImages(p: string, name: string, data: Record<string, any>, prompt: string, model: string, project: string): Promise<Asset[]> {
	const media: Record<string, any>[] = data.media ?? [];
	if (!media.length) throw new Error(`Flow returned no images: ${JSON.stringify(data).slice(0, 300)}`);
	const out: Asset[] = [];
	for (const [i, m] of media.entries()) {
		const img = m.image?.generatedImage ?? {};
		const n = i === 0 ? name : `${name}-${i + 1}`;
		const f = join(tmpDir(p), `${n}.jpg`);
		if (img.fifeUrl) await download(img.fifeUrl, f);
		else if (img.encodedImage) writeFileSync(f, Buffer.from(img.encodedImage, "base64"));
		else continue;
		const a = addFile(p, f, { name: n, kind: "image", source: { type: "google-flow", prompt, model }, license: "own", credit: "generated with Google Flow" });
		if (img.mediaId) rememberMedia(p, a, img.mediaId, project);
		out.push(a);
	}
	if (data.failed_variants?.length) console.log(`  ${data.failed_variants.length} variant(s) failed: ${JSON.stringify(data.failed_variants).slice(0, 200)}`);
	return out;
}

/** text (+ optional reference images) → 1–4 images with Nano Banana Pro / 2 / 2 Lite */
export async function genFlowImage(p: string, name: string, prompt: string, o: FlowImageOpts = {}) {
	const project_id = await flowProject();
	const reference_media_ids = [];
	for (const r of refList(o.refs)) reference_media_ids.push(await flowMedia(p, r));
	const image_model = imageModel(o.model);
	const data = await call("/generate-image", { prompt, project_id, image_model, aspect_ratio: imageAspect(o.shape), count: o.count ?? 1, seed: o.seed, reference_media_ids: reference_media_ids.length ? reference_media_ids : undefined });
	return saveImages(p, name, data, prompt, `nano-banana ${o.model ?? "pro"}`, project_id);
}

/** edit an existing image (asset or file) with a prompt; the source is sent as Flow's BASE_IMAGE */
export async function editFlowImage(p: string, name: string, source: string, prompt: string, o: FlowImageOpts = {}) {
	const project_id = await flowProject();
	const source_media_id = await flowMedia(p, source);
	const reference_media_ids = [];
	for (const r of refList(o.refs)) reference_media_ids.push(await flowMedia(p, r));
	const data = await call("/edit-image", { prompt, source_media_id, project_id, image_model: imageModel(o.model), aspect_ratio: imageAspect(o.shape), count: o.count ?? 1, seed: o.seed, reference_media_ids: reference_media_ids.length ? reference_media_ids : undefined });
	return saveImages(p, name, data, `edit of ${source}: ${prompt}`, `nano-banana edit ${o.model ?? "pro"}`, project_id);
}

/** export (upsample) an image to 2K or 4K (4K is plan-gated) */
export async function upscaleFlowImage(p: string, name: string, source: string, quality: "2k" | "4k" = "2k") {
	const project_id = await flowProject();
	const media_id = await flowMedia(p, source);
	const res = (await call("/export-image", { media_id, project_id, quality }, true)) as Response;
	const f = join(tmpDir(p), `${name}.jpg`);
	writeFileSync(f, Buffer.from(await res.arrayBuffer()));
	return addFile(p, f, { name, kind: "image", source: { type: "google-flow", prompt: `${quality} export of ${source}`, model: `flow-export ${quality}` }, license: "own", credit: "exported with Google Flow" });
}
