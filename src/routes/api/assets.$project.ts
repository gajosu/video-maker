import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { addFile, assetsDir, loadManifest } from "../../../cli/lib/assets.ts";
import { assertSlug } from "../../../cli/lib/paths.ts";
import { loadProject } from "../../../cli/lib/project.ts";

const MAX = 300 * 1024 * 1024;
// no SVG: it can carry scripts and /api/files serves uploads as-is
const OK = /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v|mp3|wav|m4a|ogg)$/i;

const assetSlug = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\.[a-z0-9]+$/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);

const err = (error: string, status: number) =>
	Response.json({ error }, { status });

// POST /api/assets/<project>: free upload from the Assets tab (file, name?, description?, kind?, replace?)
export const Route = createFileRoute("/api/assets/$project")({
	server: {
		handlers: {
			POST: async ({ params, request }) => {
				try {
					// only the local preview may write: refuse cross-site form posts
					const origin = request.headers.get("origin");
					if (origin && new URL(origin).host !== new URL(request.url).host)
						return err("origen no permitido", 403);
					const p = assertSlug(params.project);
					const project = loadProject(p);
					const form = await request.formData();
					const file = form.get("file");
					if (!(file instanceof File)) return err("falta el archivo", 400);
					if (file.size > MAX)
						return err("archivo demasiado grande (máx. 300 MB)", 413);
					if (!OK.test(file.name))
						return err(
							"tipo no soportado: usa PNG, JPG, WebP, GIF, MP4, MOV, WebM, MP3, WAV, M4A u OGG",
							415,
						);
					const name = assetSlug(String(form.get("name") || "") || file.name);
					if (!name) return err("nombre inválido", 400);
					if (loadManifest(p).assets[name] && form.get("replace") !== "1")
						return err(`ya existe un asset llamado "${name}"`, 409);
					const description =
						String(form.get("description") ?? "")
							.trim()
							.slice(0, 300) || undefined;
					const audio = /\.(mp3|wav|m4a|ogg)$/i.test(file.name);
					const kind = audio
						? form.get("kind") === "music"
							? "music"
							: "sfx"
						: undefined;
					const tmpDir = join(assetsDir(p), ".tmp");
					mkdirSync(tmpDir, { recursive: true });
					const tmp = join(
						tmpDir,
						`${name}${extname(file.name).toLowerCase()}`,
					);
					writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
					try {
						const asset = addFile(p, tmp, {
							name,
							kind,
							description,
							source: { type: "upload" },
							license: "own",
							fps: project.format.fps,
						});
						return Response.json({ asset });
					} finally {
						rmSync(tmp, { force: true });
					}
				} catch (e) {
					return err(String((e as Error).message), 500);
				}
			},
		},
	},
});
