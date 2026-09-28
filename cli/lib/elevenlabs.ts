import { existsSync, readFileSync } from "node:fs";
import type { Alignment } from "./cues.ts";
import type { Voice } from "./project.ts";

const API = "https://api.elevenlabs.io";

// Bun loads .env for the CLI; the Vite dev server (Node) does not, so read it here as a fallback.
function fromDotEnv(name: string): string | undefined {
	if (!existsSync(".env")) return undefined;
	const m = readFileSync(".env", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
	return m?.[1].trim().replace(/^["']|["']$/g, "") || undefined;
}

function key(): string {
	const k = process.env.ELEVENLABS_API_KEY || fromDotEnv("ELEVENLABS_API_KEY");
	if (!k) throw new Error("ELEVENLABS_API_KEY is not set (copy .env.example to .env and fill it in)");
	return k;
}

async function call(path: string, init: RequestInit = {}) {
	const res = await fetch(API + path, {
		...init,
		headers: { "xi-api-key": key(), "content-type": "application/json", ...init.headers },
	});
	if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 500)}`);
	return res.json();
}

export type Speech = { audio: Buffer; alignment: Alignment };

/** TTS with per-character timestamps (one request for the whole script keeps prosody natural). */
export async function speak(text: string, voice: Voice): Promise<Speech> {
	if (!voice.voiceId) throw new Error('project.json voice.voiceId is empty (run "bun vk voices" to pick one)');
	const body: Record<string, unknown> = { text, model_id: voice.model };
	if (voice.settings) body.voice_settings = voice.settings;
	if (voice.languageCode) body.language_code = voice.languageCode;
	const r = await call(`/v1/text-to-speech/${voice.voiceId}/with-timestamps?output_format=mp3_44100_128`, {
		method: "POST",
		body: JSON.stringify(body),
	});
	return { audio: Buffer.from(r.audio_base64, "base64"), alignment: r.alignment };
}

export type VoiceListing = { voice_id: string; name: string; category?: string; labels?: Record<string, string> };

export async function listVoices(search?: string): Promise<VoiceListing[]> {
	const q = new URLSearchParams({ page_size: "100" });
	if (search) q.set("search", search);
	const r = await call(`/v2/voices?${q}`);
	return r.voices;
}

/** a voice from the public ElevenLabs voice library */
export type SharedVoice = {
	voice_id: string;
	public_owner_id: string;
	name: string;
	accent?: string;
	gender?: string;
	age?: string;
	use_case?: string;
	locale?: string;
	description?: string;
	preview_url?: string;
	cloned_by_count?: number;
};

export const LATAM_ACCENTS = ["latin american", "mexican", "colombian", "argentine", "peruvian", "chilean", "venezuelan", "cuban", "ecuadorian", "puerto rican", "dominican", "caribbean"];

export type SharedQuery = { language?: string; accent?: string; gender?: string; useCase?: string; search?: string; sort?: string; page?: number; pageSize?: number };

export async function listShared(o: SharedQuery): Promise<{ voices: SharedVoice[]; hasMore: boolean }> {
	const q = new URLSearchParams({ page_size: String(o.pageSize ?? 30), page: String(o.page ?? 0) });
	if (o.language) q.set("language", o.language);
	if (o.accent) q.set("accent", o.accent);
	if (o.gender) q.set("gender", o.gender);
	if (o.useCase) q.set("use_cases", o.useCase);
	if (o.search) q.set("search", o.search);
	if (o.sort) q.set("sort", o.sort);
	const r = await call(`/v1/shared-voices?${q}`);
	return { voices: r.voices ?? [], hasMore: !!r.has_more };
}

/** subscription tier ("free", "starter", "creator", …); free accounts can't use library voices through the API */
export async function tier(): Promise<string> {
	const r = await call("/v1/user/subscription");
	return String(r.tier ?? "unknown");
}

export const FREE_LIBRARY_MSG =
	"Tu plan gratuito de ElevenLabs no permite usar voces de la biblioteca por API (ni para probarlas ni para grabar videos). Los previews sí funcionan. Para usarlas necesitas un plan de pago (desde Starter).";

/** copy a library voice into the account so TTS can use it; returns the voice id to put in script.md `voice:` */
export async function addShared(owner: string, voiceId: string, name: string): Promise<string> {
	const mine = await listVoices();
	const have = mine.find((v) => v.voice_id === voiceId);
	if (have) return have.voice_id;
	const r = await call(`/v1/voices/add/${owner}/${voiceId}`, { method: "POST", body: JSON.stringify({ new_name: name }) });
	return r.voice_id;
}

/** Instant Voice Clone: create a new account voice from one or more clean audio samples (30s-3min each is plenty).
 * Only clone voices you have the rights to use. Returns the new voice id to put in script.md `voice:`. */
export async function cloneVoice(name: string, filePaths: string[], description?: string): Promise<string> {
	const form = new FormData();
	form.append("name", name);
	if (description) form.append("description", description);
	for (const p of filePaths) form.append("files", new Blob([readFileSync(p)]), p.split("/").pop() ?? "sample.mp3");
	const res = await fetch(`${API}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": key() }, body: form });
	if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 500)}`);
	return (await res.json()).voice_id;
}

export type SttWord = { text: string; start: number; end: number; type: "word" | "spacing" | "audio_event"; speaker_id?: string };
export type Transcript = { language_code?: string; text: string; words: SttWord[]; model: string };

/** Speech-to-text (Scribe) with word timestamps, for measuring the cadence of a reference video.
 * Tries VK_STT_MODEL (default scribe_v2), then scribe_v1. */
export async function transcribe(file: string): Promise<Transcript> {
	const models = [...new Set([process.env.VK_STT_MODEL || "scribe_v2", "scribe_v1"])];
	let last = "";
	for (const model of models) {
		const form = new FormData();
		form.append("model_id", model);
		form.append("timestamps_granularity", "word");
		form.append("tag_audio_events", "true");
		form.append("file", new Blob([readFileSync(file)]), file.split("/").pop() ?? "audio.mp3");
		const res = await fetch(`${API}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: form });
		if (res.ok) return { ...(await res.json()), model };
		last = `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 400)}`;
		if (res.status !== 400 && res.status !== 422) break; // only a bad model id is worth retrying
	}
	throw new Error(last);
}
