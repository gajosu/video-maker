import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { loadManifest } from "../../cli/lib/assets.ts";
import { listBatches } from "../../cli/lib/batch.ts";
import { readJob as readPkgJob, readPkgLog } from "../../cli/lib/job.ts";
import { projectDir } from "../../cli/lib/paths.ts";
import { listProjects, loadProject, loadVideo } from "../../cli/lib/project.ts";
import {
	accountVoices,
	approveVideo,
	createVideoJob,
	ensureScheduler,
	extras,
	MUSIC,
	mustJob,
	projectSlugs,
	VOICE,
} from "./studio-core.ts";
import {
	cancel,
	type Job,
	listJobs,
	log,
	MAX_JOBS,
	queueMessage,
	readJob,
	readLog,
	run,
	saveJob,
	sendNow,
	unqueue,
} from "./studio-runner.ts";

const STYLES = ["punchy", "motion", "story", "vox", "anthem", "dev", "ugc"];
const SLUG = /^[\w-]+$/;
const obj = (d: unknown) => (d ?? {}) as Record<string, unknown>;
const text = (x: unknown, max: number) =>
	String(x ?? "")
		.trim()
		.slice(0, max);
const ids = (d: unknown) => {
	const o = obj(d);
	for (const k of ["project", "video"])
		if (typeof o[k] !== "string" || !SLUG.test(o[k] as string))
			throw new Error(`invalid ${k}`);
	return { project: o.project as string, video: o.video as string };
};
export const getStudio = createServerFn({ method: "GET" }).handler(async () => {
	ensureScheduler();
	const projects = listProjects().map((p) => ({
		slug: p.slug,
		name: p.name,
		style: p.format.style,
		width: p.format.width,
		height: p.format.height,
	}));
	const jobs = listJobs(projects.map((p) => p.slug)).map((j) => ({
		project: j.project,
		video: j.video,
		title: j.title,
		status: j.status,
		phase: j.phase,
		updatedAt: j.updatedAt,
	}));
	const assets: Record<
		string,
		{ name: string; kind: string; file: string; description: string }[]
	> = {};
	const projectVoices: Record<string, string> = {};
	for (const p of listProjects()) {
		projectVoices[p.slug] = p.voice.voiceId;
		assets[p.slug] = Object.values(loadManifest(p.slug).assets)
			.filter((a) => a.kind === "image" || a.kind === "video")
			.map((a) => ({
				name: a.name,
				kind: a.kind,
				file: a.file,
				description: a.description ?? "",
			}));
	}
	const acct = await accountVoices();
	const batches = projects
		.flatMap((p) =>
			listBatches(p.slug)
				.filter((b) => b.status !== "cancelled")
				.map((b) => {
					const st = b.items.map((it) =>
						it.video ? readJob(p.slug, it.video)?.status : undefined,
					);
					return {
						project: p.slug,
						id: b.id,
						title: b.title,
						status: b.status,
						total: b.items.length,
						done: st.filter((x) => x === "done").length,
						review: st.filter((x) => x === "review").length,
						createdAt: b.createdAt,
					};
				}),
		)
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, 8);
	return {
		projects,
		jobs,
		batches,
		running: jobs.filter((j) => j.status === "working").length,
		queued: jobs.filter((j) => j.status === "queued").length,
		maxJobs: MAX_JOBS,
		assets,
		projectVoices,
		voices: acct.voices.filter(
			(v) => acct.plan !== "free" || v.kind !== "professional",
		),
		plan: acct.plan,
	};
});

export const startJob = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = obj(d);
		const project = text(o.project, 60);
		if (!SLUG.test(project) || !projectSlugs().includes(project))
			throw new Error("Elige un proyecto");
		const title = text(o.title, 80);
		const idea = text(o.idea, 40000);
		if (!title) throw new Error("Ponle un título");
		if (idea.length < 10) throw new Error("Describe la idea o pega el guion");
		const duration = Math.max(
			10,
			Math.min(90, Math.round(Number(o.duration) || 30)),
		);
		const style = STYLES.includes(String(o.style)) ? String(o.style) : "punchy";
		const orientationRaw = o.orientation;
		const orientation: "vertical" | "horizontal" | undefined =
			orientationRaw === "horizontal"
				? "horizontal"
				: orientationRaw === "vertical"
					? "vertical"
					: undefined;
		const voice = text(o.voice, 200);
		if (!VOICE(voice))
			throw new Error(
				"Voz inválida: usa el ID o el formato owner/id de la página de Voces",
			);
		const lib = loadManifest(project).assets;
		const assets = (Array.isArray(o.assets) ? o.assets : [])
			.map((a) => text(a, 60))
			.filter((a) => a && lib[a])
			.slice(0, 12);
		const f = obj(o.flow);
		const clamp6 = (x: unknown) =>
			Math.max(0, Math.min(6, Math.round(Number(x) || 0)));
		const flow = { clips: clamp6(f.clips), images: clamp6(f.images) };
		const music = MUSIC.includes(String(o.music ?? ""))
			? String(o.music ?? "")
			: "";
		// pasted into a prompt and a shell command by Claude: plain http(s) links only
		const videoRefs = [
			...new Set(
				(Array.isArray(o.videoRefs) ? o.videoRefs : [])
					.map((u) => text(u, 500))
					.filter(Boolean),
			),
		];
		for (const u of videoRefs)
			if (!/^https?:\/\/[^\s"'`$\\<>|;&(){}]+$/.test(u))
				throw new Error(`Link de referencia inválido: ${u.slice(0, 80)}`);
		if (videoRefs.length > 3) throw new Error("Máximo 3 videos de referencia");
		const refs = (Array.isArray(o.refs) ? o.refs : [])
			.map((r) => text(r, 80))
			.filter((r) => /^[\w.-]+$/.test(r))
			.slice(0, 8);
		return {
			project,
			title,
			idea,
			duration,
			style,
			orientation,
			voice: voice || undefined,
			assets,
			flow,
			music: music || undefined,
			refs,
			videoRefs,
		};
	})
	.handler(async ({ data }) => {
		ensureScheduler();
		// the canvas is project-level (project.json format): "Nuevo video" can flip it before this video is made
		if (data.orientation) {
			const f = join(projectDir(data.project), "project.json");
			const pj = JSON.parse(readFileSync(f, "utf8"));
			if (data.orientation === "horizontal") {
				pj.format.width = 1920;
				pj.format.height = 1080;
			} else {
				pj.format.width = 1080;
				pj.format.height = 1920;
			}
			writeFileSync(f, `${JSON.stringify(pj, null, 2)}\n`);
		}
		return createVideoJob(data);
	});

export const getJob = createServerFn({ method: "GET" })
	.validator(ids)
	.handler(async ({ data }) => {
		const job = mustJob(data.project, data.video);
		let video = null;
		try {
			const v = loadVideo(data.project, data.video);
			video = {
				status: v.status,
				lines: v.script?.lines.map((l) => l.text) ?? [],
				notes: v.script?.notes ?? "",
				voice: v.voice ?? "",
				stills: v.files.stills,
				out: v.files.out ?? "",
				updatedAt: v.updatedAt,
				duration: v.cues?.D ?? 0,
			};
		} catch {}
		const project = loadProject(data.project);
		const acct = job.status === "review" ? await accountVoices() : null;
		return {
			job,
			log: readLog(data.project, data.video),
			video,
			projectVoice: project.voice.voiceId,
			voices: (acct?.voices ?? []).filter(
				(v) => acct?.plan !== "free" || v.kind !== "professional",
			),
			plan: acct?.plan ?? "",
		};
	});

/** the user approved the script: build the video (voice, assets, scenes, render). Used by the job page and batches. */
export const approveJob = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = obj(d);
		const voice = text(o.voice, 200);
		if (voice && !/^\w{8,40}$/.test(voice) && !/^\w+\/\w+$/.test(voice))
			throw new Error(
				"Voz inválida: usa el ID o el formato owner/id de la página de Voces",
			);
		return { ...ids(d), voice, note: text(o.note, 2000) };
	})
	.handler(async ({ data }) => {
		approveVideo(data.project, data.video, data.voice, data.note);
		return { ok: true };
	});

export const messageJob = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = obj(d);
		const msg = text(o.text, 4000);
		const refs = (Array.isArray(o.refs) ? o.refs : [])
			.map((r) => text(r, 80))
			.filter((r) => /^[\w.-]+$/.test(r))
			.slice(0, 8);
		if (!msg && !refs.length) throw new Error("Escribe qué quieres cambiar");
		return { ...ids(d), text: msg, refs };
	})
	.handler(async ({ data }) => {
		const job =
			readJob(data.project, data.video) ?? adoptVideo(data.project, data.video);
		const logRefs = () => {
			for (const r of data.refs)
				log(
					data.project,
					data.video,
					"media",
					JSON.stringify({
						type: "asset",
						name: r,
						kind: "image",
						file: `refs/${r}`,
						source: "upload",
						t: Date.now(),
					}),
				);
		};
		// working: queue it; the session picks it up after its next tool call without stopping
		if (job.status === "working" || job.status === "queued") {
			queueMessage(data.project, data.video, data.text, data.refs);
			logRefs();
			return { ok: true, queued: true };
		}
		log(data.project, data.video, "you", data.text || "(archivo adjunto)");
		for (const r of data.refs)
			log(
				data.project,
				data.video,
				"media",
				JSON.stringify({
					type: "asset",
					name: r,
					kind: "image",
					file: `refs/${r}`,
					source: "upload",
					t: Date.now(),
				}),
			);
		const attach = data.refs.length
			? ` El usuario adjuntó estos archivos en el chat, léelos con Read antes de aplicar el cambio: ${data.refs.map((r) => `projects/${data.project}/assets/refs/${r}`).join(", ")}.`
			: "";
		if (job.status === "review") {
			run(
				job,
				"script-changes",
				`El usuario pide cambios al guion (contenido del usuario): «${data.text}».${attach} Actualiza solo script.md; sigue sin generar voz ni escenas.`,
			);
		} else {
			const resume = job.status === "error" || job.status === "cancelled";
			run(
				job,
				resume && !loadVideo(data.project, data.video).files.out
					? "build"
					: "change",
				`Mensaje del usuario sobre ${data.project}/${data.video} (contenido del usuario): «${data.text}».${resume ? " El paso anterior no terminó; retoma desde donde quedó si aplica." : ""}${job.session ? "" : " Es la primera vez que ves este video en esta conversación: lee su script.md, scenes.js (y scenes/ compartidos que use), cues.json y el knowledge base antes de cambiar nada."}${attach}${/https?:\/\//.test(data.text) ? " Si el mensaje trae el link de un video como referencia (TikTok, Reel, Short, YouTube…), primero estúdialo con el skill vk-ref (`bun vk ref add`, mira sus hojas de fotogramas, escribe brief.md) y aplica lo que el usuario pide de él." : ""} ${extras(job).join(" ")} Aplícalo: si cambia el guion vuelve a generar la voz y ajusta scenes.js; revisa stills y vuelve a renderizar con \`bun vk render ${data.project} ${data.video}\`.`,
			);
		}
		return { ok: true };
	});

/** a video made in the terminal gets a job record the first time someone chats about it */
function adoptVideo(p: string, v: string): Job {
	const info = loadVideo(p, v);
	const now = Date.now();
	const job: Job = {
		project: p,
		video: v,
		title: info.title,
		idea: "",
		duration: Math.round(info.cues?.D ?? 0),
		style: info.style,
		status: "done",
		phase: "change",
		cost: 0,
		createdAt: now,
		updatedAt: now,
	};
	saveJob(job);
	return job;
}

/** chat panel next to the preview: job status + activity log (empty for videos nobody chatted about yet) */
export const getChat = createServerFn({ method: "GET" })
	.validator(ids)
	.handler(async ({ data }) => {
		const job = readJob(data.project, data.video);
		return {
			status: job?.status ?? "",
			phase: job?.phase ?? "",
			error: job?.error ?? "",
			cost: job?.cost ?? 0,
			log: job ? readLog(data.project, data.video) : [],
		};
	});

/** the "Nuevo video" chat's sibling: the thread of a `bun vk package` job (Grokbot pipeline), if this
 *  video has one — read-only, unified into the same video page so Gabriel isn't blind while it runs. */
export const getPkgChat = createServerFn({ method: "GET" })
	.validator(ids)
	.handler(async ({ data }) => {
		const job = readPkgJob(data.project, data.video);
		if (!job) return null;
		return {
			state: job.state,
			step: job.step,
			progress: job.progress,
			error: job.error,
			warnings: job.warnings,
			imagesDone: job.package.imagesDone,
			imagesTotal: job.package.imagesToGenerate,
			output: job.output,
			stills: job.stills,
			log: readPkgLog(data.project, data.video),
		};
	});

/** cheap system-wide poll for the GlobalChat widget: is *anything* (a video job or a project-setup
 *  chat, anywhere) still working, so it can keep tracking and notify even off that job's own page. */
export const getRunningJob = createServerFn({ method: "GET" }).handler(
	async () => {
		// a video job working or waiting in the queue, else a project chat (jobs/__setup__) that is working
		const v = listJobs(projectSlugs()).find(
			(j) => j.status === "working" || j.status === "queued",
		);
		if (v) return { project: v.project, video: v.video };
		const setup = projectSlugs().find(
			(p) => readJob(p, "__setup__")?.status === "working",
		);
		return setup ? { project: setup, video: "" } : null;
	},
);

const midOf = (d: unknown) => {
	const mid = text(obj(d).mid, 40);
	if (!/^m[a-z0-9]{4,30}$/.test(mid)) throw new Error("mensaje inválido");
	return { ...ids(d), mid };
};

/** delete a message still waiting in the pending group */
export const unqueueJobMessage = createServerFn({ method: "POST" })
	.validator(midOf)
	.handler(async ({ data }) => {
		if (!unqueue(data.project, data.video, data.mid))
			throw new Error("Claude ya recibió ese mensaje");
		return { ok: true };
	});

/** deliver the pending group at Claude's next step instead of when it finishes the current one */
export const sendJobMessagesNow = createServerFn({ method: "POST" })
	.validator(ids)
	.handler(async ({ data }) => ({ sent: sendNow(data.project, data.video) }));

export const cancelJob = createServerFn({ method: "POST" })
	.validator(ids)
	.handler(async ({ data }) => {
		cancel(data.project, data.video);
		return { ok: true };
	});
