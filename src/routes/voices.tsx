import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Loader2, Play, Search, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Empty } from "#/components/ui";
import { getProjects } from "#/server/vk";
import {
	getSampleLines,
	getVoices,
	sampleVoice,
	setProjectVoice,
	type VoiceCard,
} from "#/server/voices";

export const Route = createFileRoute("/voices")({
	validateSearch: (s: Record<string, unknown>): { project?: string } => ({
		project: typeof s.project === "string" ? s.project : undefined,
	}),
	loader: async () => ({
		first: await getVoices({
			data: { accent: "latam", gender: "", use: "", search: "", page: 0 },
		}),
		lines: await getSampleLines(),
		projects: await getProjects(),
	}),
	component: Voices,
});

const ACCENTS: [string, string][] = [
	["latam", "Todos los acentos latinos"],
	["latin american", "Latino neutro"],
	["mexican", "Mexicano"],
	["colombian", "Colombiano"],
	["argentine", "Argentino"],
	["peruvian", "Peruano"],
	["chilean", "Chileno"],
	["venezuelan", "Venezolano"],
	["cuban", "Cubano"],
	["ecuadorian", "Ecuatoriano"],
	["puerto rican", "Puertorriqueño"],
	["dominican", "Dominicano"],
	["caribbean", "Caribeño"],
];
const USES: [string, string][] = [
	["", "Cualquier estilo"],
	["advertisement", "Anuncios"],
	["conversational", "Conversacional"],
	["social_media", "Redes sociales"],
	["narrative_story", "Narración"],
	["informative_educational", "Educativo"],
	["entertainment_tv", "Entretenimiento / TV"],
	["characters_animation", "Personajes"],
];
const LABEL: Record<string, string> = {
	male: "hombre",
	female: "mujer",
	young: "joven",
	middle_aged: "adulto",
	"middle-aged": "adulto",
	old: "mayor",
	...Object.fromEntries(ACCENTS.slice(1)),
	...Object.fromEntries(USES.slice(1)),
};
const DEFAULT_TEXT =
	"Hola, así sonaría tu próximo video. Corto, claro y directo.";

const field =
	"h-10 rounded-lg border bg-card px-3 text-sm outline-none focus:border-white/40";

function Voices() {
	const { first, lines, projects } = Route.useLoaderData();
	const { project: projectParam } = Route.useSearch();
	const [project, setProject] = useState(
		projectParam && projects.some((p) => p.slug === projectParam)
			? projectParam
			: (projects[0]?.slug ?? ""),
	);
	const [accent, setAccent] = useState("latam");
	const [gender, setGender] = useState("");
	const [use, setUse] = useState("");
	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [voices, setVoices] = useState<VoiceCard[]>(first.voices);
	const [hasMore, setHasMore] = useState(first.hasMore);
	const [page, setPage] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [text, setText] = useState(lines[0]?.text ?? DEFAULT_TEXT);
	const firstRun = useRef(true);

	const load = async (p: number) => {
		setLoading(true);
		setError("");
		try {
			const r = await getVoices({
				data: { accent, gender, use, search: query, page: p },
			});
			setVoices((old) =>
				p === 0
					? r.voices
					: [
							...old,
							...r.voices.filter((v) => !old.some((o) => o.id === v.id)),
						],
			);
			setHasMore(r.hasMore);
			setPage(p);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload page 0 whenever a filter changes
	useEffect(() => {
		if (firstRun.current) {
			firstRun.current = false;
			return;
		}
		load(0);
	}, [accent, gender, use, query]);

	return (
		<main className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
			<h1 className="text-3xl font-extrabold tracking-tight">
				Voces en español latino
			</h1>
			<p className="mt-1 max-w-3xl text-muted-foreground">
				Unas 1.278 voces de la biblioteca pública de ElevenLabs. El preview de
				cada voz es gratis. «Probar con mi texto» añade la voz a tu cuenta y
				gasta créditos, unos pocos por cada frase.
			</p>

			{projects.length > 0 && (
				<label className="mt-6 flex max-w-md flex-col gap-1.5 text-sm font-medium">
					Proyecto para el que eliges voz
					<select
						className={field}
						value={project}
						onChange={(e) => setProject(e.target.value)}
					>
						{projects.map((p) => (
							<option key={p.slug} value={p.slug}>
								{p.name}
							</option>
						))}
					</select>
				</label>
			)}

			<div className="mt-6 grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)]">
				<select
					className={field}
					value={accent}
					onChange={(e) => setAccent(e.target.value)}
					aria-label="Acento"
				>
					{ACCENTS.map(([v, l]) => (
						<option key={v} value={v}>
							{l}
						</option>
					))}
				</select>
				<select
					className={field}
					value={gender}
					onChange={(e) => setGender(e.target.value)}
					aria-label="Género"
				>
					<option value="">Hombres y mujeres</option>
					<option value="female">Mujeres</option>
					<option value="male">Hombres</option>
				</select>
				<select
					className={field}
					value={use}
					onChange={(e) => setUse(e.target.value)}
					aria-label="Estilo"
				>
					{USES.map(([v, l]) => (
						<option key={v} value={v}>
							{l}
						</option>
					))}
				</select>
				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						setQuery(search.trim());
					}}
				>
					<input
						className={`${field} min-w-0 flex-1`}
						placeholder="Buscar en inglés: warm, deep, energetic…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					<button
						type="submit"
						className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm hover:border-white/40"
					>
						<Search className="size-4" aria-hidden /> Buscar
					</button>
				</form>
			</div>

			<div className="mt-3 flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
				<span className="shrink-0 text-sm font-medium">Texto de prueba</span>
				<select
					className={`${field} sm:w-64`}
					onChange={(e) => setText(e.target.value || DEFAULT_TEXT)}
					value={lines.some((l) => l.text === text) ? text : ""}
					aria-label="Usar la primera línea de un video"
				>
					<option value="">Frase genérica</option>
					{lines.map((l) => (
						<option key={l.label} value={l.text}>
							{l.label}
						</option>
					))}
				</select>
				<input
					className={`${field} min-w-0 flex-1`}
					value={text}
					maxLength={300}
					onChange={(e) => setText(e.target.value)}
					aria-label="Texto de prueba"
				/>
			</div>

			{first.plan === "free" && (
				<p className="mt-4 rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-200">
					Tu cuenta de ElevenLabs está en el plan gratuito: puedes escuchar los
					previews, pero ElevenLabs no permite usar voces de la biblioteca por
					API en ese plan. Para probarlas con tu texto o usarlas en un video
					necesitas un plan de pago (desde Starter).
				</p>
			)}
			{error && <p className="mt-4 text-sm text-red-400">{error}</p>}

			{voices.length === 0 && !loading ? (
				<div className="mt-8">
					<Empty title="Sin resultados">
						Prueba otro acento, estilo o búsqueda.
					</Empty>
				</div>
			) : (
				<ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{voices.map((v) => (
						<VoiceItem key={v.id} v={v} text={text} project={project} />
					))}
				</ul>
			)}

			<div className="mt-8 flex justify-center">
				{loading ? (
					<Loader2
						className="size-6 animate-spin text-muted-foreground"
						aria-label="Cargando"
					/>
				) : (
					hasMore && (
						<button
							type="button"
							onClick={() => load(page + 1)}
							className="rounded-lg border px-5 py-2 text-sm hover:border-white/40"
						>
							Cargar más voces
						</button>
					)
				)}
			</div>
		</main>
	);
}

function VoiceItem({
	v,
	text,
	project,
}: {
	v: VoiceCard;
	text: string;
	project: string;
}) {
	const [sample, setSample] = useState<{ text: string; audio: string } | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const [copied, setCopied] = useState(false);
	const [assigning, setAssigning] = useState(false);
	const [assigned, setAssigned] = useState(false);
	const tags = [v.accent, v.locale, v.gender, v.age, v.use]
		.filter(Boolean)
		.map((t) => LABEL[t] ?? t);

	const tryIt = async () => {
		setBusy(true);
		setErr("");
		try {
			const r = await sampleVoice({
				data: { owner: v.owner, id: v.id, name: v.name, text },
			});
			setSample({ text, audio: r.audio });
		} catch (e) {
			setErr(e instanceof Error ? e.message.slice(0, 260) : String(e));
		} finally {
			setBusy(false);
		}
	};
	const copy = async () => {
		await navigator.clipboard.writeText(
			`voz: ${v.name} — bun vk voices add ${v.owner}/${v.id}`,
		);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	const use = async () => {
		setAssigning(true);
		setErr("");
		try {
			await setProjectVoice({
				data: { project, owner: v.owner, id: v.id, name: v.name },
			});
			setAssigned(true);
			setTimeout(() => setAssigned(false), 2500);
		} catch (e) {
			setErr(e instanceof Error ? e.message.slice(0, 260) : String(e));
		} finally {
			setAssigning(false);
		}
	};

	return (
		<li className="flex flex-col rounded-xl border bg-card p-4">
			<div className="flex items-start justify-between gap-3">
				<h2 className="font-semibold leading-snug">{v.name}</h2>
				<span className="shrink-0 text-xs text-muted-foreground tabular">
					{v.uses.toLocaleString("es")} usos
				</span>
			</div>
			<div className="mt-2 flex flex-wrap gap-1.5">
				{tags.map((t) => (
					<span
						key={t}
						className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
					>
						{t}
					</span>
				))}
			</div>
			{v.description && (
				<p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
					{v.description}
				</p>
			)}
			<div className="mt-auto pt-3">
				{v.preview ? (
					<audio controls preload="none" src={v.preview} className="h-9 w-full">
						<track kind="captions" />
					</audio>
				) : (
					<p className="text-xs text-muted-foreground">Sin preview</p>
				)}
				{sample && (
					<div className="mt-2">
						<p className="mb-1 truncate text-xs text-muted-foreground">
							Con tu texto: «{sample.text}»
						</p>
						<audio controls autoPlay src={sample.audio} className="h-9 w-full">
							<track kind="captions" />
						</audio>
					</div>
				)}
				{err && <p className="mt-2 text-xs text-red-400">{err}</p>}
				<div className="mt-3 flex gap-2">
					<button
						type="button"
						onClick={tryIt}
						disabled={busy || !text.trim()}
						className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Play className="size-4" aria-hidden />
						)}
						Probar con mi texto
					</button>
					<button
						type="button"
						onClick={copy}
						className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:border-white/40"
						title="Copia el nombre y el comando para elegirla"
					>
						{copied ? (
							<Check className="size-4" aria-hidden />
						) : (
							<Copy className="size-4" aria-hidden />
						)}
						{copied ? "Copiado" : "Elegir"}
					</button>
				</div>
				{project && (
					<button
						type="button"
						onClick={use}
						disabled={assigning}
						className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-accent/50 px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"
						title={`Guarda esta voz como la voz por defecto de ${project}`}
					>
						{assigning ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : assigned ? (
							<Check className="size-4" aria-hidden />
						) : (
							<Sparkles className="size-4" aria-hidden />
						)}
						{assigned ? "Voz asignada" : `Usar en ${project}`}
					</button>
				)}
			</div>
		</li>
	);
}
