// Server functions for video batches (cli/lib/batch.ts): the batch panel, the batch card in the chats and the
// "Trabajos" tab of the global chat. Launching only flags the batch; the studio scheduler (studio.ts →
// launchPendingBatches) creates the jobs and runs them up to MAX_JOBS at a time.
import { createServerFn } from "@tanstack/react-start";
import {
	type Batch,
	createBatch,
	listBatches,
	loadBatch,
	normalizePlan,
	updateBatch,
} from "../../cli/lib/batch.ts";
import { listProjects, loadProject, loadVideo } from "../../cli/lib/project.ts";
import { accountVoices, approveVideo, ensureScheduler } from "./studio-core.ts";
import {
	cancel,
	type Job,
	listJobs,
	MAX_JOBS,
	pump,
	readJob,
	readLog,
} from "./studio-runner.ts";

const SLUG = /^[\w-]+$/;
const obj = (d: unknown) => (d ?? {}) as Record<string, unknown>;
const projectOf = (d: unknown) => {
	const p = String(obj(d).project ?? "");
	if (!SLUG.test(p) || !listProjects().some((x) => x.slug === p))
		throw new Error("proyecto inválido");
	return p;
};
const idsOf = (d: unknown) => {
	const id = String(obj(d).id ?? "");
	if (!/^b[a-z0-9-]{3,40}$/.test(id)) throw new Error("lote inválido");
	return { project: projectOf(d), id };
};
const mustBatch = (p: string, id: string): Batch => {
	const b = loadBatch(p, id);
	if (!b) throw new Error("No existe ese lote");
	return b;
};

/** one line per job for cards and lists */
function jobCard(j: Job | null) {
	if (!j) return null;
	const last = readLog(j.project, j.video, 60)
		.reverse()
		.find((e) => e.k === "say" || e.k === "done" || e.k === "tool");
	let v: ReturnType<typeof loadVideo> | null = null;
	try {
		v = loadVideo(j.project, j.video);
	} catch {}
	return {
		video: j.video,
		title: j.title,
		status: j.status,
		phase: j.phase,
		cost: j.cost,
		updatedAt: j.updatedAt,
		error: j.error ?? "",
		last: last?.x.slice(0, 160) ?? "",
		lines:
			j.status === "review" ? (v?.script?.lines.map((l) => l.text) ?? []) : [],
		still: v?.files.stills.at(-1) ?? "",
		out: v?.files.out ?? "",
		duration: v?.cues?.D ?? 0,
		voice: j.voice ?? v?.voice ?? "",
		videoUpdatedAt: v?.updatedAt ?? 0,
	};
}
export type JobCard = NonNullable<ReturnType<typeof jobCard>>;

function batchView(b: Batch) {
	const items = b.items.map((it) => ({
		...it,
		job: it.video ? jobCard(readJob(b.project, it.video)) : null,
	}));
	const jobs = items.flatMap((i) => (i.job ? [i.job] : []));
	const count = (s: string) => jobs.filter((j) => j.status === s).length;
	return {
		...b,
		items,
		progress: {
			total: b.items.length,
			done: count("done"),
			review: count("review"),
			working: count("working"),
			queued: count("queued"),
			error: count("error") + count("cancelled"),
		},
		cost: jobs.reduce((a, j) => a + j.cost, 0),
	};
}
export type BatchView = ReturnType<typeof batchView>;

export const getBatch = createServerFn({ method: "GET" })
	.validator(idsOf)
	.handler(async ({ data }) => {
		ensureScheduler();
		const b = batchView(mustBatch(data.project, data.id));
		const needVoices =
			b.status === "draft" || b.items.some((i) => i.job?.status === "review");
		const acct = needVoices ? await accountVoices() : null;
		return {
			batch: b,
			projectName: loadProject(data.project).name,
			projectVoice: loadProject(data.project).voice.voiceId,
			voices: (acct?.voices ?? []).filter(
				(v) => acct?.plan !== "free" || v.kind !== "professional",
			),
			maxJobs: MAX_JOBS,
		};
	});

/** everything in progress, for the global chat's "Trabajos" tab, its badge and the studio home */
export const getWork = createServerFn({ method: "GET" })
	.validator((d: unknown) => ({ project: String(obj(d).project ?? "") }))
	.handler(async ({ data }) => {
		ensureScheduler();
		const projects = listProjects()
			.map((p) => p.slug)
			.filter((p) => !data.project || p === data.project);
		const jobs = listJobs(projects);
		const active = jobs.filter((j) =>
			["working", "queued", "review"].includes(j.status),
		);
		const batches = projects.flatMap((p) =>
			listBatches(p)
				.filter((b) => b.status !== "cancelled")
				.slice(0, 8)
				.map((b) => {
					const v = batchView(b);
					return {
						project: p,
						id: b.id,
						title: b.title,
						status: b.status,
						progress: v.progress,
						createdAt: b.createdAt,
					};
				}),
		);
		return {
			running: jobs.filter((j) => j.status === "working").length,
			queued: jobs.filter((j) => j.status === "queued").length,
			review: jobs.filter((j) => j.status === "review").length,
			maxJobs: MAX_JOBS,
			jobs: active.slice(0, 20).map((j) => ({
				project: j.project,
				video: j.video,
				title: j.title,
				status: j.status,
				phase: j.phase,
				batch: j.batch ?? "",
			})),
			batches: batches.sort((a, b) => b.createdAt - a.createdAt).slice(0, 12),
		};
	});

export const createBatchFn = createServerFn({ method: "POST" })
	.validator((d: unknown) => ({ project: projectOf(d), plan: obj(d).plan }))
	.handler(async ({ data }) => {
		const b = createBatch(data.project, data.plan);
		return { id: b.id };
	});

/** edit a draft (items, defaults) before launching */
export const saveDraft = createServerFn({ method: "POST" })
	.validator((d: unknown) => ({
		...idsOf(d),
		plan: normalizePlan(obj(d).plan),
	}))
	.handler(async ({ data }) => {
		updateBatch(data.project, data.id, (b) => {
			if (b.status !== "draft")
				throw new Error("Este lote ya se lanzó: ya no se puede editar");
			b.title = data.plan.title;
			b.defaults = data.plan.defaults;
			b.items = data.plan.items;
		});
		return { ok: true };
	});

export const launchBatch = createServerFn({ method: "POST" })
	.validator(idsOf)
	.handler(async ({ data }) => {
		ensureScheduler();
		updateBatch(data.project, data.id, (b) => {
			if (b.status !== "draft") throw new Error("Este lote ya se lanzó");
			b.status = "launching";
		});
		pump();
		return { ok: true };
	});

/** approve the scripts waiting in this batch, each with its chosen voice ("" = the project's) */
export const approveBatch = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = obj(d);
		const items = (Array.isArray(o.items) ? o.items : []).map((x) => {
			const r = obj(x);
			const video = String(r.video ?? "");
			const voice = String(r.voice ?? "").trim();
			if (!SLUG.test(video)) throw new Error("video inválido");
			if (voice && !/^(\w{8,40}|\w+\/\w+)$/.test(voice))
				throw new Error(`Voz inválida para ${video}`);
			return { video, voice };
		});
		return { ...idsOf(d), items };
	})
	.handler(async ({ data }) => {
		ensureScheduler();
		const b = mustBatch(data.project, data.id);
		const mine = new Set(b.items.map((i) => i.video));
		const failed: string[] = [];
		for (const it of data.items) {
			if (!mine.has(it.video)) continue;
			try {
				approveVideo(data.project, it.video, it.voice);
			} catch (e) {
				failed.push((e as Error).message);
			}
		}
		return { ok: true, failed };
	});

export const cancelBatch = createServerFn({ method: "POST" })
	.validator(idsOf)
	.handler(async ({ data }) => {
		const b = mustBatch(data.project, data.id);
		for (const it of b.items) {
			const j = it.video ? readJob(data.project, it.video) : null;
			if (j && ["working", "queued"].includes(j.status))
				cancel(data.project, j.video);
		}
		updateBatch(data.project, data.id, (bb) => {
			bb.status = "cancelled";
		});
		return { ok: true };
	});
