import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
	Check,
	ChevronLeft,
	Film,
	Loader2,
	Plus,
	Rocket,
	Send,
	Square,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { VoiceSelect } from "#/components/voice-select";
import { fileUrl } from "#/lib/format";
import {
	MUSIC_OPTIONS,
	PHASE_ES,
	STATUS_ES,
	STYLE_OPTIONS,
} from "#/lib/studio";
import { cn } from "#/lib/utils";
import {
	approveBatch,
	type BatchView,
	cancelBatch,
	getBatch,
	type JobCard,
	launchBatch,
	saveDraft,
} from "#/server/batch";
import { messageJob } from "#/server/studio";

export const Route = createFileRoute("/studio/batch/$project/$batch")({
	loader: ({ params }) =>
		getBatch({ data: { project: params.project, id: params.batch } }),
	component: BatchPage,
});

const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";
const clean = (s: string) => s.replace(/\{#\w+\}/g, "");
const BATCH_ES: Record<string, string> = {
	draft: "Borrador",
	launching: "Lanzando…",
	running: "En curso",
	done: "Terminado",
	cancelled: "Cancelado",
};

function BatchPage() {
	const { project } = Route.useParams();
	const { batch, projectName, voices, projectVoice, maxJobs } =
		Route.useLoaderData();
	const router = useRouter();
	const active =
		batch.status === "launching" ||
		batch.items.some((i) =>
			["working", "queued"].includes(i.job?.status ?? ""),
		);
	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => router.invalidate(), 2500);
		return () => clearInterval(id);
	}, [active, router]);

	return (
		<main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
			<Link
				to="/studio"
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ChevronLeft className="size-4" aria-hidden /> Nuevo video
			</Link>
			<div className="mt-2 flex flex-wrap items-end justify-between gap-3">
				<div className="min-w-0">
					<h1 className="truncate text-2xl font-extrabold tracking-tight">
						{batch.title}
					</h1>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span className="text-foreground">{BATCH_ES[batch.status]}</span>
						<span>·</span>
						<span>{projectName}</span>
						<span>·</span>
						<span>{batch.items.length} videos</span>
						{batch.cost > 0 && (
							<span>· Claude ≈ US${batch.cost.toFixed(2)}</span>
						)}
					</div>
				</div>
				{batch.status !== "draft" && (
					<Progress batch={batch} maxJobs={maxJobs} />
				)}
			</div>

			{batch.status === "draft" ? (
				<DraftEditor
					project={project}
					batch={batch}
					voices={voices}
					projectVoice={projectVoice}
				/>
			) : (
				<Running
					project={project}
					batch={batch}
					voices={voices}
					projectVoice={projectVoice}
				/>
			)}
		</main>
	);
}

function Progress({ batch, maxJobs }: { batch: BatchView; maxJobs: number }) {
	const p = batch.progress;
	const pct = (n: number) => `${(n / Math.max(1, p.total)) * 100}%`;
	return (
		<div className="w-full max-w-md">
			<div className="flex h-2 overflow-hidden rounded-full bg-muted">
				<div className="bg-accent" style={{ width: pct(p.done) }} />
				<div className="bg-amber-300" style={{ width: pct(p.review) }} />
				<div className="bg-sky-400" style={{ width: pct(p.working) }} />
				<div className="bg-violet-300/70" style={{ width: pct(p.queued) }} />
				<div className="bg-red-400" style={{ width: pct(p.error) }} />
			</div>
			<div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
				<span>
					{p.done}/{p.total} listos
				</span>
				{p.review > 0 && (
					<span className="text-amber-200">
						{p.review} esperan tu aprobación
					</span>
				)}
				{p.working > 0 && (
					<span>
						{p.working} trabajando (máx. {maxJobs} a la vez)
					</span>
				)}
				{p.queued > 0 && <span>{p.queued} en cola</span>}
				{p.error > 0 && (
					<span className="text-red-300">{p.error} con error</span>
				)}
			</div>
		</div>
	);
}

// ---------- draft ----------

type Item = BatchView["items"][number];

function DraftEditor({
	project,
	batch,
	voices,
	projectVoice,
}: {
	project: string;
	batch: BatchView;
	voices: { id: string; name: string; kind: string }[];
	projectVoice: string;
}) {
	const router = useRouter();
	const [title, setTitle] = useState(batch.title);
	const [d, setD] = useState(batch.defaults);
	const [items, setItems] = useState<Item[]>(batch.items);
	const [refsText, setRefsText] = useState(
		(batch.defaults.videoRefs ?? []).join("\n"),
	);
	const [busy, setBusy] = useState<"" | "save" | "launch">("");
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);

	const plan = () => ({
		title,
		defaults: {
			...d,
			videoRefs: refsText.split(/\s+/).filter(Boolean),
		},
		items: items.map(({ job: _job, ...it }) => it),
	});
	const save = async (launch = false) => {
		setBusy(launch ? "launch" : "save");
		setError("");
		try {
			await saveDraft({ data: { project, id: batch.id, plan: plan() } });
			if (launch) await launchBatch({ data: { project, id: batch.id } });
			setSaved(!launch);
			router.invalidate();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy("");
		}
	};
	const setItem = (i: number, patch: Partial<Item>) =>
		setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));

	return (
		<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
			<section className="grid content-start gap-3">
				{items.map((it, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: items have no id until launched
						key={i}
						className="grid gap-2 rounded-xl border bg-card p-4"
					>
						<div className="flex items-center gap-2">
							<span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular">
								{i + 1}.
							</span>
							<input
								className={cn(field, "font-medium")}
								value={it.title}
								maxLength={80}
								onChange={(e) => setItem(i, { title: e.target.value })}
								aria-label="Título"
							/>
							<button
								type="button"
								onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}
								className="rounded-lg border p-2 text-muted-foreground hover:border-red-400/60 hover:text-red-300"
								aria-label={`Quitar ${it.title}`}
								disabled={items.length <= 1}
							>
								<Trash2 className="size-4" aria-hidden />
							</button>
						</div>
						<textarea
							className={cn(field, "min-h-24")}
							value={it.idea}
							onChange={(e) => setItem(i, { idea: e.target.value })}
							aria-label="Idea"
						/>
						<div className="grid gap-2 sm:grid-cols-[1fr_110px_1.3fr]">
							<select
								className={field}
								value={it.style ?? ""}
								onChange={(e) =>
									setItem(i, { style: e.target.value || undefined })
								}
								aria-label="Estilo"
							>
								<option value="">Estilo del lote</option>
								{STYLE_OPTIONS.map(([v, l]) => (
									<option key={v} value={v}>
										{l}
									</option>
								))}
							</select>
							<input
								type="number"
								min={10}
								max={90}
								className={field}
								value={it.duration ?? ""}
								placeholder={`${d.duration} s`}
								onChange={(e) =>
									setItem(i, {
										duration: e.target.value
											? Number(e.target.value)
											: undefined,
									})
								}
								aria-label="Duración"
							/>
							<input
								className={cn(field, "font-mono text-xs")}
								value={(it.videoRefs ?? []).join(" ")}
								placeholder="links de referencia solo para este video"
								onChange={(e) =>
									setItem(i, {
										videoRefs: e.target.value.split(/\s+/).filter(Boolean),
									})
								}
								aria-label="Referencias"
							/>
						</div>
					</div>
				))}
				<button
					type="button"
					onClick={() =>
						setItems((xs) => [
							...xs,
							{ title: "Nuevo video", idea: "", job: null },
						])
					}
					disabled={items.length >= 12}
					className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground hover:border-white/40 hover:text-foreground disabled:opacity-40"
				>
					<Plus className="size-4" aria-hidden /> Agregar video
				</button>
			</section>

			<aside className="grid content-start gap-4 rounded-xl border bg-card p-4 lg:sticky lg:top-20">
				<label className="grid gap-1.5 text-sm">
					Nombre del lote
					<input
						className={field}
						value={title}
						maxLength={80}
						onChange={(e) => setTitle(e.target.value)}
					/>
				</label>
				<div className="grid grid-cols-[1fr_100px] gap-2">
					<label className="grid gap-1.5 text-sm">
						Estilo
						<select
							className={field}
							value={d.style}
							onChange={(e) => setD({ ...d, style: e.target.value })}
						>
							{STYLE_OPTIONS.map(([v, l]) => (
								<option key={v} value={v}>
									{l}
								</option>
							))}
						</select>
					</label>
					<label className="grid gap-1.5 text-sm">
						Duración
						<input
							type="number"
							min={10}
							max={90}
							className={field}
							value={d.duration}
							onChange={(e) => setD({ ...d, duration: Number(e.target.value) })}
						/>
					</label>
				</div>
				<label className="grid gap-1.5 text-sm">
					Música
					<select
						className={field}
						value={d.music ?? ""}
						onChange={(e) => setD({ ...d, music: e.target.value || undefined })}
					>
						{MUSIC_OPTIONS.map(([v, l]) => (
							<option key={v} value={v}>
								{l}
							</option>
						))}
					</select>
				</label>
				<div className="grid gap-1.5 text-sm">
					Voz para todos (la eliges de nuevo al aprobar cada guion)
					<VoiceSelect
						value={d.voice ?? ""}
						onChange={(v) => setD({ ...d, voice: v || undefined })}
						voices={voices}
						projectVoice={projectVoice}
						compact
					/>
				</div>
				<label className="grid gap-1.5 text-sm">
					Videos de referencia para todos
					<textarea
						className={cn(field, "min-h-16 font-mono text-xs")}
						value={refsText}
						onChange={(e) => setRefsText(e.target.value)}
						placeholder="https://www.tiktok.com/@marca/video/…"
					/>
				</label>
				<div className="grid gap-1.5 text-sm">
					Google Flow por video
					<div className="grid grid-cols-2 gap-2">
						<label className="grid gap-1 text-xs text-muted-foreground">
							Clips
							<input
								type="number"
								min={0}
								max={6}
								className={field}
								value={d.flow?.clips ?? 0}
								onChange={(e) =>
									setD({
										...d,
										flow: {
											clips: Number(e.target.value),
											images: d.flow?.images ?? 0,
										},
									})
								}
							/>
						</label>
						<label className="grid gap-1 text-xs text-muted-foreground">
							Imágenes
							<input
								type="number"
								min={0}
								max={6}
								className={field}
								value={d.flow?.images ?? 0}
								onChange={(e) =>
									setD({
										...d,
										flow: {
											clips: d.flow?.clips ?? 0,
											images: Number(e.target.value),
										},
									})
								}
							/>
						</label>
					</div>
				</div>
				{error && <p className="text-sm text-red-400">{error}</p>}
				<div className="grid gap-2">
					<button
						type="button"
						onClick={() => save(true)}
						disabled={!!busy}
						className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
					>
						{busy === "launch" ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Rocket className="size-4" aria-hidden />
						)}
						Lanzar lote ({items.length} videos)
					</button>
					<button
						type="button"
						onClick={() => save(false)}
						disabled={!!busy}
						className="rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:border-white/40 hover:text-foreground disabled:opacity-50"
					>
						{busy === "save"
							? "Guardando…"
							: saved
								? "Guardado ✓"
								: "Guardar borrador"}
					</button>
					<p className="text-xs text-muted-foreground">
						Cada video escribe su guion y se detiene para que lo apruebes aquí.
						Se trabajan varios a la vez; el resto espera en cola.
					</p>
				</div>
			</aside>
		</div>
	);
}

// ---------- running ----------

function Running({
	project,
	batch,
	voices,
	projectVoice,
}: {
	project: string;
	batch: BatchView;
	voices: { id: string; name: string; kind: string }[];
	projectVoice: string;
}) {
	const router = useRouter();
	const [choice, setChoice] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const inReview = batch.items.flatMap((i) =>
		i.job?.status === "review" ? [i.job] : [],
	);
	const voiceOf = (j: JobCard) =>
		choice[j.video] ?? (j.voice || batch.defaults.voice || "");

	const approve = async (jobs: JobCard[]) => {
		setBusy(jobs.length > 1 ? "all" : jobs[0].video);
		setError("");
		try {
			const r = await approveBatch({
				data: {
					project,
					id: batch.id,
					items: jobs.map((j) => ({ video: j.video, voice: voiceOf(j) })),
				},
			});
			if (r.failed.length) setError(r.failed.join(" · "));
			router.invalidate();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy("");
		}
	};

	return (
		<>
			<div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
				<div className="text-sm text-muted-foreground">
					{batch.status === "launching"
						? "Creando los trabajos…"
						: inReview.length
							? `${inReview.length} guion${inReview.length > 1 ? "es" : ""} listo${inReview.length > 1 ? "s" : ""} para revisar: elige la voz de cada uno y apruébalos.`
							: batch.status === "done"
								? "Lote terminado."
								: "Los videos se están trabajando; los guiones aparecen aquí para aprobarlos."}
				</div>
				<div className="flex flex-wrap gap-2">
					{inReview.length > 1 && (
						<button
							type="button"
							onClick={() => approve(inReview)}
							disabled={!!busy}
							className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
						>
							{busy === "all" ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<Check className="size-4" aria-hidden />
							)}
							Aprobar los {inReview.length} guiones
						</button>
					)}
					{batch.status !== "done" && batch.status !== "cancelled" && (
						<button
							type="button"
							onClick={async () => {
								if (
									!confirm(
										"¿Cancelar los videos del lote que siguen en proceso?",
									)
								)
									return;
								await cancelBatch({ data: { project, id: batch.id } });
								router.invalidate();
							}}
							className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-red-300 hover:border-red-400/60"
						>
							<Square className="size-3.5" aria-hidden /> Cancelar lote
						</button>
					)}
				</div>
			</div>
			{error && <p className="mt-3 text-sm text-red-400">{error}</p>}
			<div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{batch.items.map((it, i) => (
					<VideoCard
						key={it.video ?? i}
						project={project}
						n={i + 1}
						item={it}
						voice={it.job ? voiceOf(it.job) : ""}
						onVoice={(v) =>
							it.job && setChoice((c) => ({ ...c, [it.job?.video ?? ""]: v }))
						}
						onApprove={() => it.job && approve([it.job])}
						approving={busy === it.video || busy === "all"}
						voices={voices}
						projectVoice={projectVoice}
					/>
				))}
			</div>
		</>
	);
}

function VideoCard({
	project,
	n,
	item,
	voice,
	onVoice,
	onApprove,
	approving,
	voices,
	projectVoice,
}: {
	project: string;
	n: number;
	item: Item;
	voice: string;
	onVoice: (v: string) => void;
	onApprove: () => void;
	approving: boolean;
	voices: { id: string; name: string; kind: string }[];
	projectVoice: string;
}) {
	const router = useRouter();
	const j = item.job;
	const [open, setOpen] = useState(false);
	const [msg, setMsg] = useState("");
	const [sending, setSending] = useState(false);
	const [label, dot] = j
		? (STATUS_ES[j.status] ?? STATUS_ES.error)
		: ["Por crear", "bg-zinc-500"];
	const base = j ? `videos/${j.video}` : "";
	const sendChange = async () => {
		if (!j || !msg.trim()) return;
		setSending(true);
		try {
			await messageJob({
				data: { project, video: j.video, text: msg.trim(), refs: [] },
			});
			setMsg("");
			setOpen(false);
			router.invalidate();
		} finally {
			setSending(false);
		}
	};
	return (
		<article className="flex flex-col overflow-hidden rounded-xl border bg-card">
			<div className="flex gap-3 p-3">
				<div className="relative aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
					{j?.out ? (
						<video
							src={fileUrl(project, `${base}/${j.out}`, j.videoUpdatedAt)}
							muted
							loop
							playsInline
							preload="metadata"
							onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
							onMouseLeave={(e) => e.currentTarget.pause()}
							className="size-full object-cover"
						>
							<track kind="captions" />
						</video>
					) : j?.still ? (
						<img
							src={fileUrl(project, `${base}/${j.still}`, j.videoUpdatedAt)}
							alt=""
							className="size-full object-cover"
						/>
					) : (
						<div className="grid size-full place-items-center text-muted-foreground">
							{j && (j.status === "working" || j.status === "queued") ? (
								<Loader2 className="size-5 animate-spin" aria-hidden />
							) : (
								<Film className="size-5" aria-hidden />
							)}
						</div>
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="text-xs text-muted-foreground">#{n}</div>
					<h3 className="line-clamp-2 font-semibold leading-snug">
						{j ? (
							<Link
								to="/studio/$project/$video"
								params={{ project, video: j.video }}
								className="hover:underline"
							>
								{item.title}
							</Link>
						) : (
							item.title
						)}
					</h3>
					<div className="mt-1 flex items-center gap-1.5 text-xs">
						<span className={`size-2 rounded-full ${dot}`} aria-hidden />
						<span>
							{j?.status === "working" ? (PHASE_ES[j.phase] ?? label) : label}
						</span>
						{j && j.cost > 0 && (
							<span className="text-muted-foreground">
								· US${j.cost.toFixed(2)}
							</span>
						)}
					</div>
					{j?.status === "error" ? (
						<p className="mt-1.5 line-clamp-3 text-xs text-red-300">
							{j.error}
						</p>
					) : (
						j?.last && (
							<p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">
								{j.last}
							</p>
						)
					)}
					{j?.status === "done" && (
						<Link
							to="/p/$project/v/$video"
							params={{ project, video: j.video }}
							className="mt-2 inline-block text-xs text-accent underline"
						>
							Abrir en el preview
						</Link>
					)}
				</div>
			</div>
			{j?.status === "review" && (
				<div className="grid gap-2 border-t p-3">
					<ol className="grid max-h-52 gap-1 overflow-y-auto text-sm">
						{j.lines.map((l, k) => (
							<li key={l} className="flex gap-2">
								<span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular">
									{k + 1}
								</span>
								<span>{clean(l)}</span>
							</li>
						))}
					</ol>
					<VoiceSelect
						value={voice}
						onChange={onVoice}
						voices={voices}
						projectVoice={projectVoice}
						compact
					/>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onApprove}
							disabled={approving}
							className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
						>
							{approving ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<Check className="size-4" aria-hidden />
							)}
							Aprobar
						</button>
						<button
							type="button"
							onClick={() => setOpen((o) => !o)}
							className="rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:border-white/40 hover:text-foreground"
						>
							Pedir cambios
						</button>
					</div>
				</div>
			)}
			{open && j && (
				<div className="flex gap-2 border-t p-3">
					<textarea
						className={cn(field, "min-h-16 flex-1")}
						value={msg}
						onChange={(e) => setMsg(e.target.value)}
						placeholder="Qué cambiar en este guion…"
					/>
					<button
						type="button"
						onClick={sendChange}
						disabled={sending || !msg.trim()}
						className="self-end rounded-lg bg-accent p-2.5 text-accent-foreground disabled:opacity-40"
						aria-label="Enviar"
					>
						{sending ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Send className="size-4" aria-hidden />
						)}
					</button>
				</div>
			)}
		</article>
	);
}
