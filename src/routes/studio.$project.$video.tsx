import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Check, ChevronLeft, Loader2, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Activity } from "#/components/studio-chat";
import { fileUrl, fmtTime } from "#/lib/format";
import { PHASE_ES, STATUS_ES } from "#/lib/studio";
import { cn } from "#/lib/utils";
import { approveJob, cancelJob, getJob } from "#/server/studio";

export const Route = createFileRoute("/studio/$project/$video")({
	loader: ({ params }) => getJob({ data: params }),
	component: JobPage,
});

const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";
const clean = (s: string) => s.replace(/\{#\w+\}/g, "");
function JobPage() {
	const { project, video: slug } = Route.useParams();
	const { job, log, video, voices, plan, projectVoice } = Route.useLoaderData();
	const router = useRouter();
	const working = job.status === "working";

	useEffect(() => {
		if (!working) return;
		const id = setInterval(() => router.invalidate(), 2000);
		return () => clearInterval(id);
	}, [working, router]);

	const [label, dot] = STATUS_ES[job.status] ?? STATUS_ES.error;
	const buildStarted = job.phase === "build" || job.phase === "change";
	const steps: [string, boolean, boolean][] = [
		["Guion", !!video?.lines.length, working && job.phase === "script"],
		[
			"Tu aprobación",
			buildStarted,
			job.status === "review" || (working && job.phase === "script-changes"),
		],
		[
			"Voz",
			video?.status === "voiced" || video?.status === "rendered",
			working && buildStarted && video?.status === "scripted",
		],
		[
			"Escenas",
			buildStarted && !!video?.stills.length,
			working && buildStarted && video?.status === "voiced",
		],
		["Render", !!video?.out, false],
	];
	const base = `videos/${slug}`;

	return (
		<main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
			<Link
				to="/studio"
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ChevronLeft className="size-4" aria-hidden /> Nuevo video
			</Link>
			<div className="mt-2 flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h1 className="truncate text-2xl font-extrabold tracking-tight">
						{job.title}
					</h1>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span className={`size-2 rounded-full ${dot}`} aria-hidden />
						<span className="text-foreground">
							{working ? (PHASE_ES[job.phase] ?? label) : label}
						</span>
						<span>·</span>
						<span>
							{project}/{slug}
						</span>
						{job.cost > 0 && <span>· Claude ≈ US${job.cost.toFixed(2)}</span>}
						{video?.duration ? <span>· {fmtTime(video.duration)}</span> : null}
					</div>
				</div>
				<div className="flex gap-2">
					{video && (
						<Link
							to="/p/$project/v/$video"
							params={{ project, video: slug }}
							className="rounded-lg border px-3 py-2 text-sm hover:border-white/40"
						>
							Abrir en el preview
						</Link>
					)}
					{working && (
						<button
							type="button"
							onClick={async () => {
								await cancelJob({ data: { project, video: slug } });
								router.invalidate();
							}}
							className="inline-flex items-center gap-2 rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-300 hover:border-red-400"
						>
							<Square className="size-3.5" aria-hidden /> Cancelar
						</button>
					)}
				</div>
			</div>

			<ol className="mt-6 grid grid-cols-5 gap-2">
				{steps.map(([name, done, active], i) => (
					<li
						key={name}
						className={cn(
							"rounded-lg border px-3 py-2 text-sm",
							done
								? "border-accent/50"
								: active
									? "border-sky-400/60"
									: "opacity-60",
						)}
					>
						<div className="flex items-center gap-2">
							{done ? (
								<Check className="size-4 text-accent" aria-hidden />
							) : active ? (
								<Loader2
									className="size-4 animate-spin text-sky-300"
									aria-hidden
								/>
							) : (
								<span className="w-4 text-center text-xs text-muted-foreground">
									{i + 1}
								</span>
							)}
							<span className="truncate">{name}</span>
						</div>
					</li>
				))}
			</ol>

			{job.status === "error" && job.error && (
				<p className="mt-4 whitespace-pre-wrap rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">
					{job.error.slice(0, 1200)}
				</p>
			)}

			<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
				<section className="min-w-0">
					{job.status === "review" && video ? (
						<Review
							project={project}
							video={slug}
							lines={video.lines}
							notes={video.notes}
							voices={voices}
							plan={plan}
							projectVoice={projectVoice}
						/>
					) : video?.out ? (
						<div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-4">
							<video
								src={fileUrl(project, `${base}/${video.out}`, video.updatedAt)}
								controls
								className="max-h-[75vh] rounded-lg bg-black"
								style={{ aspectRatio: "9/16" }}
							>
								<track kind="captions" />
							</video>
							<a
								href={fileUrl(project, `${base}/${video.out}`)}
								download
								className="text-sm text-muted-foreground underline hover:text-foreground"
							>
								Descargar MP4
							</a>
						</div>
					) : video?.stills.length && buildStarted ? (
						<div className="rounded-xl border bg-card p-4">
							<p className="mb-3 text-sm text-muted-foreground">
								Últimas vistas previas de las escenas
							</p>
							<div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
								{video.stills.slice(-8).map((s) => (
									<img
										key={s}
										src={fileUrl(project, `${base}/${s}`, video.updatedAt)}
										alt=""
										className="aspect-[9/16] w-full rounded-md object-cover"
									/>
								))}
							</div>
						</div>
					) : (
						<div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
							{working ? (
								<span className="inline-flex items-center gap-2">
									<Loader2 className="size-4 animate-spin" aria-hidden />{" "}
									{PHASE_ES[job.phase]}… la actividad aparece a la derecha.
								</span>
							) : (
								"Aquí aparecerán el guion, las escenas y el video."
							)}
						</div>
					)}
				</section>
				<Activity
					project={project}
					video={slug}
					log={log}
					status={job.status}
					className="h-[calc(100dvh-18rem)]"
				/>
			</div>
		</main>
	);
}

function Review({
	project,
	video,
	lines,
	notes,
	voices,
	plan,
	projectVoice,
}: {
	project: string;
	video: string;
	lines: string[];
	notes: string;
	voices: { id: string; name: string; kind: string }[];
	plan: string;
	projectVoice: string;
}) {
	const router = useRouter();
	const [voice, setVoice] = useState("");
	const [library, setLibrary] = useState("");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const projectVoiceName =
		voices.find((v) => v.id === projectVoice)?.name ?? projectVoice;
	const libId = library.match(/(\w+\/\w+)/)?.[1] ?? "";

	const approve = async () => {
		setBusy(true);
		setError("");
		try {
			await approveJob({
				data: { project, video, voice: libId || voice, note },
			});
			router.invalidate();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setBusy(false);
		}
	};

	return (
		<div className="grid gap-4">
			<div className="rounded-xl border bg-card p-5">
				<h2 className="font-semibold">Guion propuesto</h2>
				<ol className="mt-3 grid gap-2">
					{lines.map((l, i) => (
						<li key={l} className="flex gap-3 text-[15px] leading-relaxed">
							<span className="w-5 shrink-0 text-right text-muted-foreground tabular">
								{i + 1}.
							</span>
							<span>{clean(l)}</span>
						</li>
					))}
				</ol>
				{notes && (
					<details className="mt-4 text-sm text-muted-foreground">
						<summary className="cursor-pointer">Notas del guion</summary>
						<p className="mt-2 whitespace-pre-wrap">{notes}</p>
					</details>
				)}
				<p className="mt-4 text-xs text-muted-foreground">
					¿Quieres cambios? Escríbelos en el chat de la derecha y Claude ajusta
					el guion antes de seguir.
				</p>
			</div>

			<div className="rounded-xl border bg-card p-5">
				<h2 className="font-semibold">Voz</h2>
				<div className="mt-3 grid gap-3 sm:grid-cols-2">
					<label className="grid gap-1.5 text-sm">
						De tu cuenta de ElevenLabs
						<select
							className={field}
							value={voice}
							onChange={(e) => setVoice(e.target.value)}
							disabled={!!libId}
						>
							<option value="">Voz del proyecto ({projectVoiceName})</option>
							{voices
								.filter((v) => v.id !== projectVoice)
								.map((v) => (
									<option key={v.id} value={v.id}>
										{v.name}
										{v.kind === "premade" ? "" : ` · ${v.kind}`}
									</option>
								))}
						</select>
					</label>
					<label className="grid gap-1.5 text-sm">
						<span>
							O de la biblioteca (pega lo que copia «Elegir» en{" "}
							<Link to="/voices" target="_blank" className="underline">
								Voces
							</Link>
							)
						</span>
						<input
							className={field}
							value={library}
							onChange={(e) => setLibrary(e.target.value)}
							placeholder="owner/voiceId"
						/>
					</label>
				</div>
				{libId && plan === "free" && (
					<p className="mt-3 text-sm text-amber-200">
						Tu plan de ElevenLabs es gratuito y no permite voces de la
						biblioteca por API. Si no has cambiado de plan, Claude usará la voz
						del proyecto.
					</p>
				)}
				<label className="mt-4 grid gap-1.5 text-sm">
					Indicaciones para el video (opcional)
					<textarea
						className={`${field} min-h-20`}
						value={note}
						maxLength={2000}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Ej: usa la interfaz real de WhatsApp, que el cierre sea sobre fondo azul…"
					/>
				</label>
				{error && <p className="mt-3 text-sm text-red-400">{error}</p>}
				<div className="mt-4 flex justify-end">
					<button
						type="button"
						onClick={approve}
						disabled={busy}
						className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Check className="size-4" aria-hidden />
						)}
						Aprobar y crear el video
					</button>
				</div>
			</div>
		</div>
	);
}
