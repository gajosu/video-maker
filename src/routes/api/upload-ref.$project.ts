import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { assertSlug, projectDir } from "../../../cli/lib/paths.ts";

const MAX = 15 * 1024 * 1024;
const OK = /\.(png|jpe?g|webp)$/i;

// POST /api/upload-ref/<project>: save a reference image (logo, screenshot, brand pic) for the
// "Nuevo proyecto" chat — Claude reads these with the Read tool while filling in project.json.
export const Route = createFileRoute("/api/upload-ref/$project")({
	server: {
		handlers: {
			POST: async ({ params, request }) => {
				try {
					const p = assertSlug(params.project);
					const form = await request.formData();
					const file = form.get("file");
					if (!(file instanceof File))
						return Response.json({ error: "missing file" }, { status: 400 });
					if (file.size > MAX)
						return Response.json({ error: "file too large" }, { status: 413 });
					if (!OK.test(file.name))
						return Response.json(
							{ error: "unsupported file type" },
							{ status: 415 },
						);
					const dir = join(projectDir(p), "assets", "refs");
					mkdirSync(dir, { recursive: true });
					const n = readdirSync(dir).length + 1;
					const name = `ref-${n}${extname(file.name).toLowerCase()}`;
					writeFileSync(join(dir, name), Buffer.from(await file.arrayBuffer()));
					return Response.json({ name });
				} catch (e) {
					return Response.json(
						{ error: (e as Error).message },
						{ status: 400 },
					);
				}
			},
		},
	},
});
