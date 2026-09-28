export const STATUS_ES: Record<string, [string, string]> = {
	queued: ["En cola", "bg-violet-300"],
	working: ["Trabajando…", "bg-sky-400"],
	review: ["Esperando tu aprobación", "bg-amber-300"],
	done: ["Listo", "bg-accent"],
	error: ["Se detuvo", "bg-red-400"],
	cancelled: ["Cancelado", "bg-zinc-500"],
};

/** «Nuevo video» form and batch panel choices: [value, label] */
export const STYLE_OPTIONS: [string, string][] = [
	["punchy", "Punchy (redes, rápido)"],
	["motion", "Motion graphics"],
	["story", "Storytelling"],
	["vox", "Explainer tipo Vox"],
	["anthem", "Manifiesto / brand film"],
	["dev", "Dev tools"],
	["ugc", "UGC (personajes, contenido realista)"],
];
export const MUSIC_OPTIONS: [string, string][] = [
	["", "Automática (según el estilo)"],
	["beat", "Beat (percusión, redes)"],
	["pulse", "Pulse (electrónica)"],
	["ambient", "Ambient (suave, sin batería)"],
	["pluck", "Lofi pluck"],
	["none", "Sin música"],
];
export const PHASE_ES: Record<string, string> = {
	script: "Escribiendo el guion",
	"script-changes": "Ajustando el guion",
	build: "Creando el video",
	change: "Aplicando tus cambios",
};

// ---------- Grokbot package pipeline (`bun vk package`) ----------

export type PkgSummary = {
	state: "queued" | "running" | "done" | "error";
	step: string;
	progress: number;
	error?: string;
	warnings?: string[];
	imagesDone?: number;
	imagesTotal?: number;
};

export const PKG_STEP_ES: Record<string, string> = {
	queued: "En cola",
	images: "Generando imágenes",
	music: "Buscando música",
	voice: "Generando la voz",
	check: "Revisando",
	stills: "Vistas previas",
	render: "Renderizando",
	done: "Listo",
};

/** short label for a badge: "En cola" | "En proceso" | "Listo" | "Error" */
export function pkgBadgeLabel(job: PkgSummary): string {
	if (job.state === "queued") return "En cola";
	if (job.state === "done") return "Listo";
	if (job.state === "error") return "Error";
	return "En proceso";
}

/** the current step, in plain Spanish, with progress where it's meaningful (e.g. "Generando imágenes 7/20") */
export function pkgStepText(job: PkgSummary): string {
	if (job.state === "queued") return "En cola";
	if (job.state === "done") return "Listo";
	if (job.state === "error") return job.error || "Se detuvo con un error";
	if (job.step === "images" && job.imagesTotal)
		return `Generando imágenes ${job.imagesDone ?? 0}/${job.imagesTotal}`;
	return PKG_STEP_ES[job.step] ?? "En proceso";
}

type PkgEv = {
	id: number;
	t: number;
	k: "say" | "tool" | "done" | "error" | "media";
	x: string;
};

/** one `pkg-log.jsonl` line -> a readable Spanish message (best-effort: unrecognized lines pass through as-is) */
function translatePkgLine(msg: string): { text: string; k: PkgEv["k"] } {
	const trimmed = msg.trim();
	const step = trimmed.match(/^step: (\w+)$/);
	if (step)
		return { text: `Paso: ${PKG_STEP_ES[step[1]] ?? step[1]}`, k: "tool" };
	const imageOk = trimmed.match(
		/^(?:generated image (\S+)|image (\S+): ok(?: \(retry (\d+)\))?)$/,
	);
	if (imageOk) {
		const name = imageOk[1] ?? imageOk[2];
		return {
			text: `Imagen ${name} generada${imageOk[3] ? ` (reintento ${imageOk[3]})` : ""}.`,
			k: "say",
		};
	}
	const imageRetry = trimmed.match(
		/^image (\S+): retry (\d+) of \d+ \((.+)\)$/,
	);
	if (imageRetry)
		return {
			text: `Imagen ${imageRetry[1]}: reintentando (intento ${Number(imageRetry[2]) + 1}) — ${imageRetry[3]}`,
			k: "tool",
		};
	const imageFailed = trimmed.match(/^image (\S+): failed \((.+)\)$/);
	if (imageFailed)
		return {
			text: `Imagen ${imageFailed[1]}: no se pudo generar — ${imageFailed[2]}`,
			k: "error",
		};
	const musicOk = trimmed.match(/^downloaded music from (\S+)$/);
	if (musicOk)
		return { text: `Música descargada desde ${musicOk[1]}.`, k: "say" };
	if (/^OPENAI_API_KEY not set/.test(trimmed))
		return { text: trimmed, k: "error" };
	if (/^music download failed/.test(trimmed))
		return {
			text: "No se pudo descargar la música indicada; se usará la música por defecto del estilo.",
			k: "error",
		};
	if (/^voice: vo\.mp3 \+ cues\.json already present/.test(trimmed))
		return { text: "La voz ya estaba generada; se reutiliza.", k: "say" };
	if (/^speaking \d+ lines/.test(trimmed)) {
		const d = trimmed.match(/D=([\d.]+)s/)?.[1];
		return { text: `Voz generada${d ? ` (duración ${d}s)` : ""}.`, k: "say" };
	}
	if (/^✓ /.test(trimmed))
		return { text: `Revisión superada: ${trimmed.slice(2)}`, k: "say" };
	if (/^✗ /.test(trimmed))
		return { text: `Revisión con problemas:\n${trimmed}`, k: "error" };
	if (trimmed.includes("/stills/") && /\.jpg$/.test(trimmed))
		return {
			text: `Vistas previas generadas (${trimmed.split("\n").filter(Boolean).length}).`,
			k: "say",
		};
	if (/^1\/4 events/.test(trimmed))
		return { text: "Render terminado.", k: "say" };
	if (trimmed === "done") return { text: "Video terminado.", k: "done" };
	const error = trimmed.match(/^error: (.+)$/);
	if (error) return { text: error[1], k: "error" };
	return { text: msg, k: "say" };
}

/** the whole `pkg-log.jsonl` -> chat-style events (same shape the web Studio's own chat uses), plus the
 *  final render + stills once the job is done so they show up inline, like the Studio chat's own media. */
export function pkgLogToEvents(
	log: { t: number; msg: string }[],
	job: PkgSummary & { output?: string; stills?: string[] },
	video: string,
): PkgEv[] {
	const out: PkgEv[] = log.map((e, i) => {
		const { text, k } = translatePkgLine(e.msg);
		return { id: -100_000 + i, t: e.t, k, x: text };
	});
	if (job.state === "done") {
		if (job.stills?.length)
			out.push({
				id: -100_000 + log.length,
				t: Date.now(),
				k: "media",
				x: JSON.stringify({
					type: "stills",
					files: job.stills.map((s) => s.split("/").pop()),
					t: Date.now(),
				}),
			});
		if (job.output)
			out.push({
				id: -100_000 + log.length + 1,
				t: Date.now(),
				k: "media",
				x: JSON.stringify({
					type: "render",
					file: `out/${video}.mp4`,
					t: Date.now(),
				}),
			});
	}
	for (const w of job.warnings ?? [])
		if (!log.some((e) => e.msg.includes(w.slice(0, 40))))
			out.push({ id: -100_000 - out.length - 1, t: 0, k: "error", x: w });
	return out.sort((a, b) => a.t - b.t);
}
