import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { marked } from "marked";
import type { PkgSummary } from "#/lib/studio";
import { loadManifest } from "../../cli/lib/assets.ts";
import { readJob as readPkgJob } from "../../cli/lib/job.ts";
import { PROJECTS_DIR, projectDir, videoDir } from "../../cli/lib/paths.ts";
import {
	listProjects,
	listVideos,
	loadProject,
	loadVideo,
	readKnowledge,
} from "../../cli/lib/project.ts";

/** the Grokbot package job for a video, if any (a video the "Nuevo video" studio made has no `pkg.json`) */
function pkgSummary(p: string, v: string): PkgSummary | null {
	const j = readPkgJob(p, v);
	if (!j) return null;
	return {
		state: j.state,
		step: j.step,
		progress: j.progress,
		error: j.error,
		warnings: j.warnings,
		imagesDone: j.package.imagesDone,
		imagesTotal: j.package.imagesToGenerate,
	};
}

const slugs =
	<T extends Record<string, string>>(keys: (keyof T)[]) =>
	(d: unknown): T => {
		const o = (d ?? {}) as Record<string, unknown>;
		for (const k of keys)
			if (
				typeof o[k as string] !== "string" ||
				!/^[\w-]+$/.test(o[k as string] as string)
			)
				throw new Error(`invalid ${String(k)}`);
		return o as T;
	};

export const getProjects = createServerFn({ method: "GET" }).handler(async () =>
	listProjects().map((p) => {
		const videos = listVideos(p.slug);
		return {
			slug: p.slug,
			name: p.name,
			description: p.description,
			brand: p.brand,
			language: p.language,
			videos: videos.length,
			rendered: videos.filter((v) => v.files.out).length,
			cover: videos.find((v) => v.files.stills.length),
			updatedAt: Math.max(0, ...videos.map((v) => v.updatedAt)),
		};
	}),
);

export const getProject = createServerFn({ method: "GET" })
	.validator(slugs<{ project: string }>(["project"]))
	.handler(async ({ data }) => {
		const project = loadProject(data.project);
		const knowledge = readKnowledge(data.project).map((d) => ({
			...d,
			html: marked.parse(d.body, { async: false }),
		}));
		const manifest = loadManifest(data.project);
		const videos = listVideos(data.project);
		const pkgJobs: Record<string, PkgSummary> = {};
		for (const v of videos) {
			const j = pkgSummary(data.project, v.slug);
			if (j) pkgJobs[v.slug] = j;
		}
		return { project, videos, knowledge, manifest, pkgJobs };
	});

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z][a-z0-9-]*$/;

/** mirrors `bun vk init`: copies projects/_example (minus its videos) and overrides name/brand/language */
export const createProject = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = (d ?? {}) as Record<string, unknown>;
		const slug = String(o.slug ?? "");
		if (!SLUG.test(slug))
			throw new Error(
				"el identificador debe empezar con una letra y usar solo minúsculas, números y guiones",
			);
		const name = String(o.name ?? "")
			.trim()
			.slice(0, 80);
		if (!name) throw new Error("falta el nombre");
		const primary = String(o.primary ?? "");
		const secondary = String(o.secondary ?? "");
		if (!HEX.test(primary) || !HEX.test(secondary))
			throw new Error("color inválido");
		const language = /^[a-z]{2}$/.test(String(o.language))
			? String(o.language)
			: "es";
		const description = String(o.description ?? "")
			.trim()
			.slice(0, 300);
		return { slug, name, primary, secondary, language, description };
	})
	.handler(async ({ data }) => {
		const dst = projectDir(data.slug);
		if (existsSync(dst))
			throw new Error(`ya existe un proyecto "${data.slug}"`);
		const src = join(PROJECTS_DIR, "_example");
		cpSync(src, dst, {
			recursive: true,
			filter: (f) => !f.includes(join(src, "videos")),
		});
		mkdirSync(join(dst, "videos"), { recursive: true });
		const pj = JSON.parse(readFileSync(join(dst, "project.json"), "utf8"));
		pj.name = data.name;
		pj.brand.name = data.name;
		pj.brand.primary = data.primary;
		pj.brand.secondary = data.secondary;
		pj.language = data.language;
		pj.description = data.description;
		pj.voice.voiceId = "";
		writeFileSync(
			join(dst, "project.json"),
			`${JSON.stringify(pj, null, 2)}\n`,
		);
		return { slug: data.slug };
	});

export const getVideo = createServerFn({ method: "GET" })
	.validator(slugs<{ project: string; video: string }>(["project", "video"]))
	.handler(async ({ data }) => ({
		project: loadProject(data.project),
		video: loadVideo(data.project, data.video),
		pkgJob: pkgSummary(data.project, data.video),
	}));

/** true if a video job or the project-setup chat is still running (their job.json files all share a "status" field) */
function hasRunningJob(slug: string): boolean {
	const dir = join(projectDir(slug), "jobs");
	if (!existsSync(dir)) return false;
	for (const v of readdirSync(dir)) {
		const f = join(dir, v, "job.json");
		if (!existsSync(f)) continue;
		try {
			if (JSON.parse(readFileSync(f, "utf8")).status === "working") return true;
		} catch {}
	}
	return false;
}

/** irreversible: deletes projects/<slug> entirely. Requires typing the slug back to confirm. */
export const deleteProject = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = (d ?? {}) as Record<string, unknown>;
		const slug = String(o.slug ?? "");
		if (!/^[\w-]+$/.test(slug)) throw new Error("invalid project");
		return { slug, confirm: String(o.confirm ?? "") };
	})
	.handler(async ({ data }) => {
		if (data.slug === "_example")
			throw new Error("No se puede eliminar el proyecto de ejemplo");
		const dir = projectDir(data.slug);
		if (!existsSync(dir))
			throw new Error(`no existe el proyecto "${data.slug}"`);
		if (data.confirm !== data.slug)
			throw new Error("Escribe el nombre del proyecto para confirmar");
		if (hasRunningJob(data.slug))
			throw new Error(
				"Hay un video o una configuración en proceso para este proyecto. Espera a que termine o cancélalo antes de eliminarlo.",
			);
		rmSync(dir, { recursive: true, force: true });
		return { ok: true };
	});

function videoJobRunning(project: string, video: string): boolean {
	const f = join(projectDir(project), "jobs", video, "job.json");
	if (!existsSync(f)) return false;
	try {
		return JSON.parse(readFileSync(f, "utf8")).status === "working";
	} catch {
		return false;
	}
}

/** irreversible: deletes projects/<p>/videos/<v> (and its job/chat history). Requires typing the video's slug to confirm. */
export const deleteVideo = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = (d ?? {}) as Record<string, unknown>;
		const project = String(o.project ?? "");
		const video = String(o.video ?? "");
		if (!/^[\w-]+$/.test(project) || !/^[\w-]+$/.test(video))
			throw new Error("invalid");
		return { project, video, confirm: String(o.confirm ?? "") };
	})
	.handler(async ({ data }) => {
		const dir = videoDir(data.project, data.video);
		if (!existsSync(dir)) throw new Error(`no existe el video "${data.video}"`);
		if (data.confirm !== data.video)
			throw new Error("Escribe el nombre del video para confirmar");
		if (videoJobRunning(data.project, data.video))
			throw new Error(
				"Hay un trabajo en proceso para este video. Espera a que termine o cancélalo antes de eliminarlo.",
			);
		rmSync(dir, { recursive: true, force: true });
		rmSync(join(projectDir(data.project), "jobs", data.video), {
			recursive: true,
			force: true,
		});
		return { ok: true };
	});
