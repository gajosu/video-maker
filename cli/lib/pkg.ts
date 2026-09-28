// Grokbot content packages: a pre-written narration script + a background-music link +
// cover headlines + N visual prompts (markdown, see docs/grokbot-integration.md, or the
// equivalent JSON manifest), ingested straight into a video-kit script.md + scenes.js with
// no interactive/creative step. The narration is never paraphrased, only split into lines.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { projectDir } from "./paths.ts";

export type PackageVisual = { id: string; title: string; prompt: string; image?: string };
/** One beat of the house "story" layout: one or more images (crossfaded if several), one on-screen
 *  caption (already stripped of `*hl*` markup, with the matching word indexes), an optional sfx name,
 *  and the beat's exact voiced line(s). */
export type PackageSceneBeat = { images: string[]; caption: string; hl: number[]; sfx?: string; voice: string[] };
export type PackageScenes = { place?: string; finalTitle?: string; beats: PackageSceneBeat[] };
export type Package = {
	title: string;
	narration: string;
	music?: { url: string; label?: string };
	headlines: string[];
	visuals: PackageVisual[];
	/** Optional "## 5. Escenas" section (or its JSON equivalent): an exact beat-by-beat scene plan. */
	scenes?: PackageScenes;
};

const pad2 = (n: string | number) => String(n).padStart(2, "0");

/** `*word*` / `*two words*` -> plain text + the hl word indexes (asterisks stripped). Counts words by
 *  their position in the star-stripped text, so punctuation glued to a `*word*` (`*Solnitsata*:`) stays
 *  attached to that word instead of becoming its own token. */
export function parseCaptionMarkup(raw: string): { text: string; hl: number[] } {
	const text = raw
		.replace(/\*/g, "")
		.trim()
		.replace(/\s+/g, " ");
	const hl: number[] = [];
	const re = /\*([^*]+)\*/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec-in-while loop
	while ((m = re.exec(raw))) {
		const before = raw.slice(0, m.index).replace(/\*/g, "").trim();
		const wordsBefore = before ? before.split(/\s+/).length : 0;
		const span = m[1].trim().split(/\s+/).filter(Boolean).length;
		for (let i = 0; i < span; i++) hl.push(wordsBefore + i);
	}
	return { text, hl };
}

/** The optional "## 5. Escenas" section: `Lugar:` / `Título final:` header lines, then `N. img <ids> |
 *  <caption> [| sfx <name>]` beats, each followed by one or more indented voiced lines. */
function parseScenesSection(body: string): PackageScenes | undefined {
	if (!body.trim()) return undefined;
	const place = body.match(/^Lugar:\s*(.+)$/m)?.[1]?.trim();
	const finalTitle = body.match(/^T[íi]tulo final:\s*(.+)$/m)?.[1]?.trim();
	const beats: PackageSceneBeat[] = [];
	for (const block of body.split(/\n(?=\s*\d+\.\s)/)) {
		const lines = block.split(/\r?\n/);
		const head = lines[0]?.match(/^\s*\d+\.\s*(.+)$/)?.[1]?.trim();
		if (!head) continue; // the Lugar:/Título final: preface block, or a stray blank chunk
		const parts = head.split("|").map((s) => s.trim());
		const imgIds = parts[0]?.match(/^img\s+(.+)$/i)?.[1];
		if (!imgIds) continue;
		const images = imgIds
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.map((n) => pad2(Number(n)));
		const { text: caption, hl } = parseCaptionMarkup(parts[1] ?? "");
		const sfx = parts
			.slice(2)
			.find((s) => /^sfx\s+/i.test(s))
			?.replace(/^sfx\s+/i, "")
			.trim();
		const voice = lines
			.slice(1)
			.map((l) => l.trim())
			.filter(Boolean);
		if (images.length && caption && voice.length) beats.push({ images, caption, hl, sfx, voice });
	}
	return beats.length ? { place, finalTitle, beats } : undefined;
}

/** Text of a `## N. Heading` section, up to the next `## `. */
function section(body: string, n: number): string {
	const m = body.match(new RegExp(`^##\\s*${n}\\.[^\\n]*$`, "m"));
	if (!m || m.index === undefined) return "";
	const rest = body.slice(m.index + m[0].length);
	const next = rest.search(/^##\s/m);
	return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

/** The 4-section markdown format Grokbot sends (see ejemplo-guion-solnitsata.md). */
export function parseMarkdownPackage(src: string): Package {
	const h1 = src.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
	const title = h1.includes("—") ? h1.split("—").slice(1).join("—").trim() : h1;

	const narration = section(src, 1);
	const musicSec = section(src, 2);
	const headlinesSec = section(src, 3);
	const visualsSec = section(src, 4);
	const scenes = parseScenesSection(section(src, 5));

	let music: Package["music"];
	const mm = musicSec.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
	if (mm) music = { label: mm[1].trim(), url: mm[2].trim() };

	const headlines = [...headlinesSec.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)].map((m) => m[1].trim());

	const visuals: PackageVisual[] = [];
	for (const block of visualsSec.split(/\n\s*\n/)) {
		const lines = block.trim().split(/\r?\n/);
		const head = lines[0]?.match(/^(\d{1,3})\s*[—-]\s*(.+)$/);
		if (!head) continue;
		visuals.push({ id: pad2(Number(head[1])), title: head[2].trim(), prompt: lines.slice(1).join(" ").trim() });
	}

	if (!narration) throw new Error('package markdown is missing a "## 1. Guión narrativo" section');
	if (!visuals.length) throw new Error('package markdown is missing "## 4. … prompts visuales" entries (expected "NN — title" blocks, one prompt line each)');
	return { title: title || "Untitled", narration, music, headlines, visuals, scenes };
}

/** Same shape as `Package`, plus an optional per-visual `image` (path, relative to the package's directory). */
function parseJsonPackage(src: string): Package {
	// biome-ignore lint: package JSON is untyped input, validated field by field below
	const j: any = JSON.parse(src);
	if (!j.narration || !Array.isArray(j.visuals) || !j.visuals.length)
		throw new Error('package JSON needs at least "narration" (string) and "visuals" (non-empty array)');
	let scenes: PackageScenes | undefined;
	if (Array.isArray(j.scenes) && j.scenes.length) {
		const beats: PackageSceneBeat[] = j.scenes
			.map((s: Record<string, unknown>) => {
				const ids = Array.isArray(s.images) ? s.images : [s.images];
				const images = ids.filter((v: unknown) => v !== undefined && v !== null && v !== "").map((n: string | number) => pad2(n));
				const { text, hl } = parseCaptionMarkup(String(s.caption ?? ""));
				const voice = Array.isArray(s.voice) ? s.voice.map(String) : s.voice ? [String(s.voice)] : [];
				return { images, caption: text, hl: Array.isArray(s.hl) ? (s.hl as number[]) : hl, sfx: s.sfx ? String(s.sfx) : undefined, voice };
			})
			.filter((b: PackageSceneBeat) => b.images.length && b.caption && b.voice.length);
		if (beats.length) scenes = { place: j.place ? String(j.place) : undefined, finalTitle: j.finalTitle ? String(j.finalTitle) : undefined, beats };
	}
	return {
		title: String(j.title ?? "Untitled"),
		narration: String(j.narration),
		music: j.music?.url ? { url: String(j.music.url), label: j.music.label ? String(j.music.label) : undefined } : undefined,
		headlines: Array.isArray(j.headlines) ? j.headlines.map(String) : [],
		visuals: j.visuals.map((v: Record<string, unknown>, i: number) => ({
			id: pad2((v.id as string | number) ?? i + 1),
			title: String(v.title ?? `visual ${i + 1}`),
			prompt: String(v.prompt ?? ""),
			image: v.image ? String(v.image) : undefined,
		})),
		scenes,
	};
}

export type LoadedPackage = { pkg: Package; dir: string };

/** Load a package from a directory (package.json, else the one *.md file in it), a .json file, or a .md file. */
export function loadPackage(pathArg: string): LoadedPackage {
	const abs = resolve(pathArg);
	if (!existsSync(abs)) throw new Error(`package path not found: ${abs}`);
	if (statSync(abs).isDirectory()) {
		const j = join(abs, "package.json");
		if (existsSync(j)) return { pkg: parseJsonPackage(readFileSync(j, "utf8")), dir: abs };
		const mds = readdirSync(abs).filter((f) => f.endsWith(".md"));
		if (mds.length !== 1)
			throw new Error(`expected a package.json or exactly one .md file in ${abs} (found ${mds.length} .md files)`);
		return { pkg: parseMarkdownPackage(readFileSync(join(abs, mds[0]), "utf8")), dir: abs };
	}
	const ext = extname(abs).toLowerCase();
	if (ext === ".json") return { pkg: parseJsonPackage(readFileSync(abs, "utf8")), dir: dirname(abs) };
	if (ext === ".md") return { pkg: parseMarkdownPackage(readFileSync(abs, "utf8")), dir: dirname(abs) };
	throw new Error(`unrecognized package file "${abs}" (use .md or .json, or a directory containing one of those)`);
}

/**
 * Match a supplied images folder's files to visual ids by their leading number (01.png, 01-title.png,
 * 1_whatever.jpg…). A visual's own `image` (from a JSON package) is resolved against `packageDir` first.
 */
export function matchImages(visuals: PackageVisual[], imagesDir: string | undefined, packageDir: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const v of visuals) {
		if (!v.image) continue;
		const abs = isAbsolute(v.image) ? v.image : resolve(packageDir, v.image);
		if (existsSync(abs)) found.set(v.id, abs);
	}
	if (!imagesDir || !existsSync(imagesDir)) return found;
	const files = readdirSync(imagesDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
	for (const v of visuals) {
		if (found.has(v.id)) continue;
		const n = Number(v.id);
		const f = files.find((f) => {
			const m = f.match(/^0*(\d+)[-_. ]/);
			return m && Number(m[1]) === n;
		});
		if (f) found.set(v.id, join(imagesDir, f));
	}
	return found;
}

/** Paragraphs -> sentences: keeps the narration's exact wording (no facts rewritten), just split into caption-sized lines. */
export function splitNarration(text: string): string[] {
	return text
		.split(/\n\s*\n/)
		.flatMap((para) => para.trim().split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/))
		.map((s) => s.replace(/\s+/g, " ").trim())
		.filter(Boolean);
}

/** Slug from a title, avoiding collisions with existing videos or job dirs (mirrors the web Studio's slugify). */
export function slugifyVideo(title: string, p: string): string {
	const base =
		title
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "video";
	let s = base;
	for (let i = 2; existsSync(join(projectDir(p), "videos", s)) || existsSync(join(projectDir(p), "jobs", s)); i++) s = `${base}-${i}`;
	return s;
}
