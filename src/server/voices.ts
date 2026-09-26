import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import {
	addShared,
	FREE_LIBRARY_MSG,
	LATAM_ACCENTS,
	listShared,
	type SharedVoice,
	speak,
	tier,
} from "../../cli/lib/elevenlabs.ts";
import { projectDir } from "../../cli/lib/paths.ts";
import { listProjects, listVideos } from "../../cli/lib/project.ts";

const USE_CASES = [
	"advertisement",
	"conversational",
	"social_media",
	"narrative_story",
	"informative_educational",
	"entertainment_tv",
	"characters_animation",
];

type Query = {
	accent: string;
	gender: string;
	use: string;
	search: string;
	page: number;
};

function query(d: unknown): Query {
	const o = (d ?? {}) as Record<string, unknown>;
	const accent = String(o.accent ?? "latam");
	const gender = String(o.gender ?? "");
	const use = String(o.use ?? "");
	if (accent !== "latam" && !LATAM_ACCENTS.includes(accent))
		throw new Error("invalid accent");
	if (!["", "male", "female"].includes(gender))
		throw new Error("invalid gender");
	if (use && !USE_CASES.includes(use)) throw new Error("invalid use");
	return {
		accent,
		gender,
		use,
		search: String(o.search ?? "").slice(0, 60),
		page: Math.max(0, Math.min(50, Number(o.page) || 0)),
	};
}

const card = (v: SharedVoice) => ({
	id: v.voice_id,
	owner: v.public_owner_id,
	name: v.name.trim(),
	accent: v.accent ?? "",
	locale: v.locale ?? "",
	gender: v.gender ?? "",
	age: v.age ?? "",
	use: v.use_case ?? "",
	description: (v.description ?? "").replace(/\s+/g, " ").trim(),
	preview: v.preview_url ?? "",
	uses: v.cloned_by_count ?? 0,
});
export type VoiceCard = ReturnType<typeof card>;

/** Latin American Spanish voices from the public ElevenLabs library ("latam" merges every accent, most used first) */
export const getVoices = createServerFn({ method: "GET" })
	.validator(query)
	.handler(async ({ data }) => {
		const accents = data.accent === "latam" ? LATAM_ACCENTS : [data.accent];
		const pageSize = data.accent === "latam" ? 8 : 24;
		const pages = await Promise.all(
			accents.map((accent) =>
				listShared({
					language: "es",
					accent,
					gender: data.gender || undefined,
					useCase: data.use || undefined,
					search: data.search || undefined,
					page: data.page,
					pageSize,
				}).catch(() => ({ voices: [], hasMore: false })),
			),
		);
		const seen = new Set<string>();
		const voices: VoiceCard[] = [];
		for (const p of pages)
			for (const v of p.voices)
				if (!seen.has(v.voice_id)) {
					seen.add(v.voice_id);
					voices.push(card(v));
				}
		voices.sort((a, b) => b.uses - a.uses);
		const plan =
			data.page === 0 ? await tier().catch(() => "unknown") : undefined;
		return { voices, hasMore: pages.some((p) => p.hasMore), plan };
	});

/** first script line of every video (most recently edited first), to hear a voice read real copy */
export const getSampleLines = createServerFn({ method: "GET" }).handler(
	async () =>
		listProjects()
			.flatMap((p) =>
				listVideos(p.slug)
					.filter((v) => v.script?.lines.length)
					.map((v) => ({
						label: `${p.name} · ${v.title}`,
						text: (v.script?.lines[0]?.text ?? "").replace(/\{#\w+\}/g, ""),
						at: v.updatedAt,
					})),
			)
			.sort((a, b) => b.at - a.at),
);

const samples = new Map<string, string>();

/** adds the library voice to the account (TTS needs that) and speaks a short text; spends ElevenLabs credits */
export const sampleVoice = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = (d ?? {}) as Record<string, unknown>;
		for (const k of ["owner", "id"])
			if (typeof o[k] !== "string" || !/^\w+$/.test(o[k] as string))
				throw new Error(`invalid ${k}`);
		const text = String(o.text ?? "")
			.trim()
			.slice(0, 300);
		if (!text) throw new Error("empty text");
		return {
			owner: o.owner as string,
			id: o.id as string,
			name: String(o.name ?? "voice").slice(0, 60),
			text,
		};
	})
	.handler(async ({ data }) => {
		const k = `${data.id}|${data.text}`;
		const hit = samples.get(k);
		if (hit) return { audio: hit };
		let audio: Buffer;
		try {
			const voiceId = await addShared(data.owner, data.id, data.name);
			({ audio } = await speak(data.text, {
				provider: "elevenlabs",
				voiceId,
				model: "eleven_multilingual_v2",
				languageCode: "es",
			}));
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e);
			throw new Error(
				/paid_plan_required|payment_required/.test(m) ? FREE_LIBRARY_MSG : m,
			);
		}
		const url = `data:audio/mpeg;base64,${audio.toString("base64")}`;
		samples.set(k, url);
		return { audio: url };
	});

/** adds the library voice to the account (if needed) and sets it as the project's default voice in project.json */
export const setProjectVoice = createServerFn({ method: "POST" })
	.validator((d: unknown) => {
		const o = (d ?? {}) as Record<string, unknown>;
		const project = String(o.project ?? "");
		if (!/^[\w-]+$/.test(project)) throw new Error("invalid project");
		for (const k of ["owner", "id"])
			if (typeof o[k] !== "string" || !/^\w+$/.test(o[k] as string))
				throw new Error(`invalid ${k}`);
		return {
			project,
			owner: o.owner as string,
			id: o.id as string,
			name: String(o.name ?? "voice").slice(0, 60),
		};
	})
	.handler(async ({ data }) => {
		let voiceId: string;
		try {
			voiceId = await addShared(data.owner, data.id, data.name);
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e);
			throw new Error(
				/paid_plan_required|payment_required/.test(m) ? FREE_LIBRARY_MSG : m,
			);
		}
		const f = join(projectDir(data.project), "project.json");
		const pj = JSON.parse(readFileSync(f, "utf8"));
		pj.voice = { ...pj.voice, provider: "elevenlabs", voiceId };
		writeFileSync(f, `${JSON.stringify(pj, null, 2)}\n`);
		return { voiceId };
	});
