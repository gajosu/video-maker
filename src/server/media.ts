// Media shown inline in a chat: after every tool result a session diffs the asset library, reference videos,
// batches, and (for a video) its stills and render, and reads stock-search output, so generated / added / found
// media appears in the chat as pictures, players and cards, not just text.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "../../cli/lib/assets.ts";
import { listBatches } from "../../cli/lib/batch.ts";
import type { LogKind } from "../../cli/lib/inbox.ts";
import { projectDir, videoDir } from "../../cli/lib/paths.ts";
import { listRefs, loadAnalysis, refsDir } from "../../cli/lib/refs.ts";

export type MediaLog = (k: LogKind, x: string) => void;
export type MediaSnap = {
	assets: Record<string, string>;
	refs: Record<string, number>;
	batches: Record<string, string>;
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
export function mediaSnap(p: string, v?: string): MediaSnap {
	const assets: Record<string, string> = {};
	try {
		for (const a of Object.values(loadManifest(p).assets))
			assets[a.name] =
				`${a.file}|${mtime(join(projectDir(p), "assets", a.file))}`;
	} catch {}
	const refs: Record<string, number> = {};
	if (existsSync(refsDir(p)))
		for (const n of readdirSync(refsDir(p)))
			refs[n] = mtime(join(refsDir(p), n, "analysis.json"));
	// a batch card is posted when a batch appears, changes status or changes size (not on every job update)
	const batches: Record<string, string> = {};
	for (const b of listBatches(p))
		batches[b.id] = `${b.status}|${b.items.length}`;
	const stills: Record<string, number> = {};
	if (!v) return { assets, refs, batches, stills, out: 0 };
	const sd = join(videoDir(p, v), "stills");
	if (existsSync(sd))
		for (const f of readdirSync(sd))
			if (f.endsWith(".jpg")) stills[f] = mtime(join(sd, f));
	return {
		assets,
		refs,
		batches,
		stills,
		out: mtime(join(videoDir(p, v), "out", `${v}.mp4`)),
	};
}
export function mediaDiff(
	log: MediaLog,
	p: string,
	v: string | undefined,
	before: MediaSnap,
	after: MediaSnap,
) {
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
	for (const [name, m] of Object.entries(after.refs)) {
		if (!m || before.refs[name] === m) continue;
		const meta = listRefs(p).find((r) => r.name === name);
		const a = loadAnalysis(p, name);
		if (!meta || !a) continue;
		log(
			"media",
			JSON.stringify({
				type: "reference",
				name,
				title: meta.title ?? name,
				url: meta.url,
				duration: a.video.duration,
				shots: a.cuts?.shots,
				avgShot: a.cuts?.avgShot,
				wpm: a.speech?.wpm,
				palette: [
					...(a.palette?.main.slice(0, 4) ?? []),
					...(a.palette?.accents.slice(0, 2) ?? []),
				].map((c) => c.hex),
				images: a.images ? ["hook.jpg", "timeline.jpg"] : [],
				t: Date.now(),
			}),
		);
	}
	for (const [id, sig] of Object.entries(after.batches))
		if (before.batches[id] !== sig)
			log("media", JSON.stringify({ type: "batch", id, t: Date.now() }));
	const newStills = Object.entries(after.stills)
		.filter(([f, m]) => before.stills[f] !== m)
		.map(([f]) => f)
		.sort(
			(a, b) => Number.parseFloat(a.slice(1)) - Number.parseFloat(b.slice(1)),
		);
	if (newStills.length)
		log(
			"media",
			JSON.stringify({
				type: "stills",
				files: newStills.slice(0, 16),
				t: Date.now(),
			}),
		);
	if (after.out && after.out !== before.out)
		log(
			"media",
			JSON.stringify({ type: "render", file: `out/${v}.mp4`, t: Date.now() }),
		);
}
/** "bun vk asset search" output → thumbnails */
export function searchResults(text: string) {
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
