import { createServerFn } from "@tanstack/react-start";
import { loadManifest } from "../../cli/lib/assets.ts";
import {
	editFlowImage,
	FLOW_DURATIONS,
	flowStatus,
	genFlowImage,
	genFlowVideo,
	upscaleFlowImage,
} from "../../cli/lib/flow.ts";
import { listProjects, loadProject } from "../../cli/lib/project.ts";

const obj = (d: unknown) => (d ?? {}) as Record<string, unknown>;
const txt = (x: unknown, max: number) =>
	String(x ?? "")
		.trim()
		.slice(0, max);
const NAME = /^[a-z0-9][\w.-]{0,59}$/i;

function project(d: Record<string, unknown>) {
	const p = txt(d.project, 60);
	if (!listProjects().some((x) => x.slug === p))
		throw new Error("Proyecto inválido");
	return p;
}
function assetName(
	d: Record<string, unknown>,
	p: string,
	key = "name",
	mustExist = false,
) {
	const n = txt(d[key], 60);
	if (!NAME.test(n))
		throw new Error(`Nombre inválido: usa letras, números, - y _`);
	const exists = !!loadManifest(p).assets[n];
	if (mustExist && !exists) throw new Error(`No existe el asset "${n}"`);
	if (!mustExist && exists && d.replace !== true)
		throw new Error(`Ya existe un asset llamado "${n}"`);
	return n;
}
function imageRefs(p: string, x: unknown, max = 5) {
	const list = (Array.isArray(x) ? x : [])
		.map((r) => txt(r, 60))
		.filter(Boolean);
	if (list.length > max) throw new Error(`Máximo ${max} referencias`);
	const m = loadManifest(p);
	for (const r of list)
		if (m.assets[r]?.kind !== "image")
			throw new Error(`"${r}" no es una imagen de la biblioteca`);
	return list;
}
const oneOf = <T extends string>(
	x: unknown,
	allowed: readonly T[],
	fallback: T,
) => (allowed.includes(x as T) ? (x as T) : fallback);

/** flowkit reachable? extension connected? cooldown? */
export const getFlowStatus = createServerFn({ method: "GET" }).handler(
	async () => {
		try {
			const { status } = await flowStatus();
			const g = status.generation_throttle ?? {};
			return {
				running: true,
				connected: !!status.connected,
				project: status.flow_project_id ?? null,
				cooldown: g.cooldown_active
					? Math.round(g.cooldown_remaining_s ?? 0)
					: 0,
				error: "",
			};
		} catch (e) {
			return {
				running: false,
				connected: false,
				project: null,
				cooldown: 0,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	},
);

/** generate images or a video with Google Flow and add them to the project's assets (takes ~20–90 s) */
export const flowGenerate = createServerFn({ method: "POST" })
	.validator((raw: unknown) => {
		const d = obj(raw);
		const p = project(d);
		const kind = oneOf(d.kind, ["image", "video"] as const, "image");
		const prompt = txt(d.prompt, 2000);
		if (prompt.length < 3) throw new Error("Escribe qué quieres generar");
		const o = obj(d.opts);
		if (kind === "image")
			return {
				kind,
				p,
				name: assetName(d, p),
				prompt,
				image: {
					model: oneOf(o.model, ["pro", "nb2", "lite"] as const, "pro"),
					shape: oneOf(
						o.shape,
						["portrait", "landscape", "square", "3:4", "4:3"] as const,
						"portrait",
					),
					count: Math.max(1, Math.min(4, Math.round(Number(o.count) || 1))),
					refs: imageRefs(p, o.refs),
				},
			};
		const mode = oneOf(o.mode, ["text", "frames", "refs"] as const, "text");
		const from = mode === "frames" ? imageRefs(p, [o.from], 1)[0] : undefined;
		if (mode === "frames" && !from) throw new Error("Elige la imagen inicial");
		const to =
			mode === "frames" && o.to ? imageRefs(p, [o.to], 1)[0] : undefined;
		const refs = mode === "refs" ? imageRefs(p, o.refs, 3) : [];
		if (mode === "refs" && !refs.length)
			throw new Error("Elige al menos una referencia");
		const duration = Number(o.duration);
		return {
			kind,
			p,
			name: assetName(d, p),
			prompt,
			video: {
				duration: FLOW_DURATIONS.includes(duration) ? duration : 6,
				shape: oneOf(o.shape, ["portrait", "landscape"] as const, "portrait"),
				quality: oneOf(o.quality, ["720p", "360p"] as const, "720p"),
				model:
					mode === "frames"
						? oneOf(
								o.model,
								["omni", "veo-lite", "veo-fast", "veo-quality"] as const,
								"omni",
							)
						: ("omni" as const),
				from,
				to,
				refs,
			},
		};
	})
	.handler(async ({ data }) => {
		if (data.kind === "image" && data.image) {
			const out = await genFlowImage(
				data.p,
				data.name,
				data.prompt,
				data.image,
			);
			return { assets: out.map((a) => a.name) };
		}
		if (data.video) {
			const a = await genFlowVideo(data.p, data.name, data.prompt, {
				...data.video,
				fps: loadProject(data.p).format.fps,
			});
			return { assets: [a.name] };
		}
		throw new Error("Nada que generar");
	});

/** edit an existing image with a prompt */
export const flowEdit = createServerFn({ method: "POST" })
	.validator((raw: unknown) => {
		const d = obj(raw);
		const p = project(d);
		const prompt = txt(d.prompt, 2000);
		if (prompt.length < 3) throw new Error("Describe el cambio");
		const o = obj(d.opts);
		return {
			p,
			name: assetName(d, p),
			source: assetName(d, p, "source", true),
			prompt,
			model: oneOf(o.model, ["pro", "nb2", "lite"] as const, "pro"),
			refs: imageRefs(p, o.refs),
		};
	})
	.handler(async ({ data }) => {
		const out = await editFlowImage(
			data.p,
			data.name,
			data.source,
			data.prompt,
			{ model: data.model, refs: data.refs },
		);
		return { assets: out.map((a) => a.name) };
	});

/** export an image at 2K / 4K */
export const flowUpscale = createServerFn({ method: "POST" })
	.validator((raw: unknown) => {
		const d = obj(raw);
		const p = project(d);
		return {
			p,
			name: assetName(d, p),
			source: assetName(d, p, "source", true),
			quality: oneOf(obj(d.opts).quality, ["2k", "4k"] as const, "2k"),
		};
	})
	.handler(async ({ data }) => {
		const a = await upscaleFlowImage(
			data.p,
			data.name,
			data.source,
			data.quality,
		);
		return { assets: [a.name] };
	});
