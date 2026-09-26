import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { marked } from "marked";
import { loadManifest } from "../../cli/lib/assets.ts";
import { PROJECTS_DIR, projectDir } from "../../cli/lib/paths.ts";
import {
	listProjects,
	listVideos,
	loadProject,
	loadVideo,
	readKnowledge,
} from "../../cli/lib/project.ts";

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
		return { project, videos: listVideos(data.project), knowledge, manifest };
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
	}));
