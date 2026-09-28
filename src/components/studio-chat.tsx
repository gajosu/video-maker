import { Link, useRouter } from "@tanstack/react-router";
import {
	Bot,
	CheckCheck,
	Clapperboard,
	Clock,
	Film,
	ImageIcon,
	Layers,
	Loader2,
	Paperclip,
	Rocket,
	Search,
	Send,
	Square,
	Trash2,
	Wrench,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fileUrl } from "#/lib/format";
import { PHASE_ES, pkgLogToEvents, pkgStepText } from "#/lib/studio";
import { cn } from "#/lib/utils";
import { getBatch, launchBatch } from "#/server/batch";
import {
	cancelJob,
	getChat,
	getPkgChat,
	messageJob,
	sendJobMessagesNow,
	unqueueJobMessage,
} from "#/server/studio";

const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";

type Media =
	| {
			type: "asset";
			name: string;
			kind: "image" | "video";
			file: string;
			source?: string;
			updated?: boolean;
			prompt?: string;
			t: number;
	  }
	| { type: "stills"; files: string[]; t: number }
	| { type: "render"; file: string; t: number }
	| { type: "batch"; id: string; t: number }
	| {
			type: "reference";
			name: string;
			title: string;
			url?: string;
			duration: number;
			shots?: number;
			avgShot?: number;
			wpm?: number;
			palette: string[];
			images: string[];
			t: number;
	  }
	| {
			type: "search";
			items: { n: number; title: string; thumb: string; source: string }[];
			t: number;
	  };

const SOURCE_ES: Record<string, string> = {
	"google-flow": "Generado con Google Flow",
	openai: "Generado con OpenAI",
	elevenlabs: "Generado con ElevenLabs",
	pexels: "De Pexels",
	openverse: "De Openverse",
	upload: "Subido",
	html: "Pantalla renderizada",
	url: "Descargado",
	file: "Añadido",
};

const DOT: Record<string, string> = {
	queued: "bg-violet-300/70",
	working: "bg-sky-400 animate-pulse",
	review: "bg-amber-300",
	done: "bg-accent",
	error: "bg-red-400",
	cancelled: "bg-zinc-500",
};

/** a batch planned in the chat: live status per video, launch it or open its panel */
function BatchCard({ project, id }: { project: string; id: string }) {
	const [d, setD] = useState<Awaited<ReturnType<typeof getBatch>> | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const load = useCallback(
		() =>
			getBatch({ data: { project, id } })
				.then(setD)
				.catch((e) => setError(String(e.message ?? e))),
		[project, id],
	);
	useEffect(() => {
		load();
	}, [load]);
	const b = d?.batch;
	const live =
		b &&
		(b.status === "launching" ||
			b.items.some((i) => ["working", "queued"].includes(i.job?.status ?? "")));
	useEffect(() => {
		if (!live) return;
		const t = setInterval(load, 4000);
		return () => clearInterval(t);
	}, [live, load]);
	if (error) return <p className="text-xs text-red-300">Lote: {error}</p>;
	if (!b)
		return (
			<Loader2
				className="size-4 animate-spin text-muted-foreground"
				aria-label="Cargando lote"
			/>
		);
	const p = b.progress;
	return (
		<div className="max-w-[340px] rounded-lg border border-accent/30 bg-background/60 p-3">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Layers className="size-3" aria-hidden />
				{b.status === "draft"
					? "Lote en borrador"
					: b.status === "done"
						? "Lote terminado"
						: b.status === "cancelled"
							? "Lote cancelado"
							: "Lote en curso"}
			</div>
			<div className="mt-0.5 font-medium text-foreground">{b.title}</div>
			<ol className="mt-2 grid gap-1 text-xs">
				{b.items.map((it, i) => (
					<li key={it.video ?? i} className="flex items-center gap-2">
						<span
							className={cn(
								"size-2 shrink-0 rounded-full",
								it.job ? DOT[it.job.status] : "bg-zinc-600",
							)}
							aria-hidden
						/>
						<span className="truncate">{it.title}</span>
					</li>
				))}
			</ol>
			{b.status !== "draft" && (
				<div className="mt-2 text-xs text-muted-foreground">
					{p.done}/{p.total} listos
					{p.review ? ` · ${p.review} por aprobar` : ""}
					{p.working ? ` · ${p.working} trabajando` : ""}
					{p.queued ? ` · ${p.queued} en cola` : ""}
				</div>
			)}
			<div className="mt-3 flex gap-2">
				{b.status === "draft" && (
					<button
						type="button"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await launchBatch({ data: { project, id } });
								await load();
							} catch (e) {
								setError(e instanceof Error ? e.message : String(e));
							} finally {
								setBusy(false);
							}
						}}
						className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50"
					>
						{busy ? (
							<Loader2 className="size-3 animate-spin" aria-hidden />
						) : (
							<Rocket className="size-3" aria-hidden />
						)}
						Lanzar lote
					</button>
				)}
				<Link
					to="/studio/batch/$project/$batch"
					params={{ project, batch: id }}
					className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:border-white/40 hover:text-foreground"
				>
					{b.status === "draft" ? "Revisar y editar" : "Ver lote"}
				</Link>
			</div>
		</div>
	);
}

/** generated / found media, shown inline in the chat */
function MediaEvent({
	project,
	video,
	raw,
	onZoom,
}: {
	project: string;
	video: string;
	raw: string;
	onZoom: (src: string) => void;
}) {
	let m: Media;
	try {
		m = JSON.parse(raw);
	} catch {
		return null;
	}
	if (m.type === "asset") {
		const src = fileUrl(project, `assets/${m.file}`, m.t);
		return (
			<div className="max-w-[260px] overflow-hidden rounded-lg border bg-background/60">
				{m.kind === "image" ? (
					<button
						type="button"
						onClick={() => onZoom(src)}
						className="checker block w-full"
					>
						<img
							src={src}
							alt={m.name}
							className="max-h-72 w-full object-contain"
						/>
					</button>
				) : (
					<video
						src={src}
						controls
						muted
						loop
						playsInline
						className="max-h-80 w-full bg-black"
					>
						<track kind="captions" />
					</video>
				)}
				<div className="px-2.5 py-2 text-xs">
					<div className="flex items-center gap-1.5 font-mono text-foreground">
						{m.kind === "image" ? (
							<ImageIcon className="size-3" aria-hidden />
						) : (
							<Film className="size-3" aria-hidden />
						)}
						{m.name}
					</div>
					<div className="mt-0.5 text-muted-foreground">
						{m.updated ? "Actualizado · " : ""}
						{SOURCE_ES[m.source ?? ""] ?? "Añadido a la biblioteca"}
					</div>
					{m.prompt && (
						<div className="mt-1 line-clamp-2 text-muted-foreground/80 italic">
							«{m.prompt}»
						</div>
					)}
				</div>
			</div>
		);
	}
	if (m.type === "stills")
		return (
			<div className="rounded-lg border bg-background/60 p-2">
				<div className="mb-1.5 text-xs text-muted-foreground">
					Vistas previas de escenas ({m.files.length})
				</div>
				<div className="grid grid-cols-4 gap-1.5">
					{m.files.map((f) => {
						const src = fileUrl(project, `videos/${video}/stills/${f}`, m.t);
						return (
							<button
								key={f}
								type="button"
								onClick={() => onZoom(src)}
								className="overflow-hidden rounded"
								title={f.replace(/^t|\.jpg$/g, "") + " s"}
							>
								<img
									src={src}
									alt=""
									className="aspect-[9/16] w-full object-cover"
								/>
							</button>
						);
					})}
				</div>
			</div>
		);
	if (m.type === "batch") return <BatchCard project={project} id={m.id} />;
	if (m.type === "reference")
		return (
			<div className="max-w-[340px] rounded-lg border bg-background/60 p-2">
				<div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
					<Clapperboard className="size-3" aria-hidden /> Video de referencia
					analizado
				</div>
				<div className="line-clamp-2 text-xs font-medium text-foreground">
					{m.url ? (
						<a
							href={m.url}
							target="_blank"
							rel="noreferrer"
							className="hover:underline"
						>
							{m.title}
						</a>
					) : (
						m.title
					)}
				</div>
				<div className="mt-1 text-xs text-muted-foreground">
					{[
						`${Math.round(m.duration)} s`,
						m.shots !== undefined && `${m.shots} planos (~${m.avgShot} s c/u)`,
						m.wpm !== undefined && `${m.wpm} palabras/min`,
					]
						.filter(Boolean)
						.join(" · ")}
				</div>
				{m.palette.length > 0 && (
					<div className="mt-1.5 flex gap-1">
						{m.palette.map((c) => (
							<span
								key={c}
								title={c}
								className="size-4 rounded-sm border border-white/20"
								style={{ background: c }}
							/>
						))}
					</div>
				)}
				{m.images.length > 0 && (
					<div className="mt-2 grid gap-1.5">
						{m.images.map((f) => {
							const src = fileUrl(project, `references/${m.name}/${f}`, m.t);
							return (
								<button
									key={f}
									type="button"
									onClick={() => onZoom(src)}
									className="overflow-hidden rounded"
									title={
										f === "hook.jpg" ? "Primeros 3 s, 4 fps" : "Todo el video"
									}
								>
									<img src={src} alt="" className="w-full" />
								</button>
							);
						})}
					</div>
				)}
			</div>
		);
	if (m.type === "render")
		return (
			<div className="max-w-[280px] overflow-hidden rounded-lg border border-accent/40 bg-accent/5">
				<video
					src={fileUrl(project, `videos/${video}/${m.file}`, m.t)}
					controls
					playsInline
					className="w-full bg-black"
					style={{ aspectRatio: "9/16" }}
				>
					<track kind="captions" />
				</video>
				<div className="px-2.5 py-2 text-xs text-accent">Render listo</div>
			</div>
		);
	return (
		<div className="rounded-lg border bg-background/60 p-2">
			<div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
				<Search className="size-3" aria-hidden /> Resultados de búsqueda (
				{m.items.length})
			</div>
			<div className="flex gap-1.5 overflow-x-auto pb-1">
				{m.items.map((it) => (
					<button
						key={`${it.n}-${it.thumb}`}
						type="button"
						onClick={() => onZoom(it.thumb)}
						className="relative w-20 shrink-0 overflow-hidden rounded"
						title={`${it.n}. ${it.title}`}
					>
						<img
							src={it.thumb}
							alt={it.title}
							loading="lazy"
							className="aspect-[9/16] w-full object-cover"
						/>
						<span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
							{it.n}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

// tiny, safe markdown: **bold** and `code` only
export const md = (s: string) =>
	s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
		part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: fixed split of one string
			<strong key={i}>{part.slice(2, -2)}</strong>
		) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: fixed split of one string
			<code key={i} className="rounded bg-black/30 px-1 font-mono text-[0.9em]">
				{part.slice(1, -1)}
			</code>
		) : (
			part
		),
	);

type Ev = { id: number; t: number; k: string; x: string; mid?: string };

export function Activity({
	project,
	video = "",
	log,
	status,
	className,
	onSend,
	onSent,
	empty,
	placeholder: placeholderProp,
	queue,
	header = true,
	onUnqueue,
	onSendNow,
}: {
	project: string;
	video?: string;
	log: Ev[];
	status: string;
	className?: string;
	/** sends a follow-up message for this chat's job (default: the video job via messageJob) */
	onSend?: (text: string, refs?: string[]) => Promise<unknown>;
	onSent?: () => void;
	empty?: string;
	placeholder?: string;
	/** accept messages while the session works (they're delivered mid-turn); default: when using messageJob */
	queue?: boolean;
	/** the "Chat con Claude" title bar (off when the container has its own) */
	header?: boolean;
	/** delete a pending message / deliver the pending group now (default: the video job's) */
	onUnqueue?: (mid: string) => Promise<unknown>;
	onSendNow?: () => Promise<unknown>;
}) {
	const router = useRouter();
	const [msg, setMsg] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [pendingRefs, setPendingRefs] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const box = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState<string | null>(null);
	const working = status === "working" || status === "queued";
	// sessions take messages mid-turn (queued, delivered after Claude's next tool call)
	const canQueue = queue ?? !onSend;
	const locked = working && !canQueue;
	// messages sent while Claude works wait as one pending group (cli/lib/inbox.ts): shown in a tray above the
	// input until delivered ("seen", then drawn where Claude got them, grouped) or deleted ("unqueued")
	const settled = new Set(
		log.filter((e) => e.k === "seen" || e.k === "unqueued").map((e) => e.x),
	);
	const sent = new Map(
		log.flatMap((e) => (e.k === "you" && e.mid ? [[e.mid, e] as const] : [])),
	);
	const pending = log.filter(
		(e) => e.k === "you" && e.mid && !settled.has(e.mid),
	);
	const urgent =
		pending.length > 0 &&
		log.some((e) => e.k === "now" && e.t >= (pending[0]?.t ?? 0));
	const rows: ({ e: Ev } | { group: Ev[]; key: number })[] = [];
	for (const e of log) {
		if (e.k === "unqueued" || e.k === "now" || (e.k === "you" && e.mid))
			continue;
		if (e.k === "seen") {
			const m = sent.get(e.x);
			if (!m) continue;
			const last = rows.at(-1);
			if (last && "group" in last) last.group.push(m);
			else rows.push({ group: [m], key: e.id });
			continue;
		}
		rows.push({ e });
	}
	const [queueBusy, setQueueBusy] = useState("");
	const unqueue = async (mid: string) => {
		setQueueBusy(mid);
		setError("");
		try {
			await (onUnqueue?.(mid) ??
				unqueueJobMessage({ data: { project, video, mid } }));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setQueueBusy("");
			onSent?.();
			router.invalidate();
		}
	};
	const sendNow = async () => {
		setQueueBusy("now");
		setError("");
		try {
			await (onSendNow?.() ?? sendJobMessagesNow({ data: { project, video } }));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setQueueBusy("");
			onSent?.();
			router.invalidate();
		}
	};
	const n = log.length;

	const upload = async (files: FileList | null) => {
		if (!files?.length) return;
		setUploading(true);
		setError("");
		try {
			for (const file of Array.from(files)) {
				const form = new FormData();
				form.append("file", file);
				const r = await fetch(`/api/upload-ref/${project}`, {
					method: "POST",
					body: form,
				});
				const body = await r.json();
				if (!r.ok) throw new Error(body.error ?? "no se pudo subir el archivo");
				setPendingRefs((old) => [...old, body.name as string]);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setUploading(false);
		}
	};

	// stay pinned to the bottom while new events arrive and their media loads, unless the user scrolled up
	const pinned = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new events arrive
	useEffect(() => {
		if (box.current && pinned.current)
			box.current.scrollTop = box.current.scrollHeight;
	}, [n]);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const onScroll = () => {
			pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
		};
		const ro = new ResizeObserver(() => {
			if (pinned.current) el.scrollTop = el.scrollHeight;
		});
		for (const c of Array.from(el.children)) ro.observe(c);
		const mo = new MutationObserver(() => {
			for (const c of Array.from(el.children)) ro.observe(c);
		});
		mo.observe(el, { childList: true });
		el.addEventListener("scroll", onScroll);
		return () => {
			el.removeEventListener("scroll", onScroll);
			ro.disconnect();
			mo.disconnect();
		};
	}, []);

	const send = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!msg.trim() && !pendingRefs.length) return;
		const text = msg.trim() || "(archivo adjunto)";
		setBusy(true);
		setError("");
		try {
			await (onSend?.(text, pendingRefs) ??
				messageJob({ data: { project, video, text, refs: pendingRefs } }));
			setMsg("");
			setPendingRefs([]);
			onSent?.();
			router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const placeholder =
		placeholderProp ??
		(status === "review"
			? "Pide cambios al guion…"
			: status === "done" || !status
				? "Pide un cambio al video…"
				: status === "working"
					? canQueue
						? "Escribe cuando quieras: queda pendiente y le llega sin cortar lo que hace…"
						: "Espera a que termine este paso…"
					: "Dile que continúe o qué corregir…");

	return (
		<aside
			className={cn(
				"flex h-[calc(100dvh-8rem)] min-h-[420px] flex-col rounded-xl border bg-card lg:sticky lg:top-20",
				className,
			)}
		>
			{header && (
				<div className="border-b px-4 py-3 text-sm font-semibold">
					Chat con Claude
				</div>
			)}
			<div ref={box} className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
				{log.length === 0 && empty && (
					<p className="text-muted-foreground">{empty}</p>
				)}
				{rows.map((r) => {
					if ("group" in r)
						return (
							<div
								key={`g${r.key}`}
								className="ml-8 rounded-lg bg-muted px-3 py-2"
							>
								{r.group.length > 1 && (
									<div className="mb-1 text-[11px] text-muted-foreground">
										{r.group.length} mensajes que dejaste mientras trabajaba
									</div>
								)}
								<div className="grid gap-1.5">
									{r.group.map((m) => (
										<div key={m.id} className="whitespace-pre-wrap">
											{m.x}
										</div>
									))}
								</div>
								<div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
									<CheckCheck className="size-3" aria-hidden /> Claude{" "}
									{r.group.length > 1 ? "los recibió juntos" : "lo recibió"}
								</div>
							</div>
						);
					const { e } = r;
					return e.k === "you" ? (
						<div
							key={e.id}
							className="ml-8 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2"
						>
							{e.x}
						</div>
					) : e.k === "media" ? (
						<div key={e.id}>
							<MediaEvent
								project={project}
								video={video}
								raw={e.x}
								onZoom={setZoom}
							/>
						</div>
					) : e.k === "tool" ? (
						<div
							key={e.id}
							className="flex items-start gap-2 font-mono text-xs text-muted-foreground"
						>
							<Wrench className="mt-0.5 size-3 shrink-0" aria-hidden />
							<span className="break-all">{e.x}</span>
						</div>
					) : e.k === "done" ? (
						<div
							key={e.id}
							className="whitespace-pre-wrap rounded-lg border border-accent/40 bg-accent/10 px-3 py-2"
						>
							{md(e.x)}
						</div>
					) : e.k === "note" ? (
						<div
							key={e.id}
							className="flex items-center justify-center gap-1.5 text-center text-[11px] text-violet-200/80"
						>
							<Square className="size-2.5" aria-hidden /> {e.x}
						</div>
					) : e.k === "error" ? (
						<div
							key={e.id}
							className="whitespace-pre-wrap rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-red-200"
						>
							{e.x.slice(0, 800)}
						</div>
					) : (
						<div key={e.id} className="whitespace-pre-wrap text-foreground/90">
							{md(e.x)}
						</div>
					);
				})}
				{working && (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" aria-hidden />{" "}
						{status === "queued"
							? "en cola: empieza cuando se libere un turno…"
							: "trabajando…"}
					</div>
				)}
			</div>
			<form onSubmit={send} className="border-t p-3">
				{error && <p className="mb-2 text-xs text-red-400">{error}</p>}
				{pending.length > 0 && (
					<div className="mb-2 rounded-lg border border-violet-300/30 bg-violet-300/5 p-2">
						<div className="flex items-center justify-between gap-2">
							<div className="flex min-w-0 items-center gap-1.5 text-xs">
								<Clock
									className="size-3 shrink-0 text-violet-200"
									aria-hidden
								/>
								<span className="font-medium text-violet-100">
									Pendientes ({pending.length})
								</span>
								<span className="truncate text-muted-foreground">
									{urgent
										? "· interrumpiendo el paso actual para enviarlos…"
										: working
											? "· se envían juntos cuando termine este paso"
											: "· se envían al empezar el siguiente turno"}
								</span>
							</div>
							{!urgent && working && (
								<button
									type="button"
									onClick={sendNow}
									disabled={!!queueBusy}
									title="Interrumpe lo que está haciendo Claude y le envía estos mensajes ya"
									className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-300/20 px-2 py-1 text-[11px] font-medium text-violet-100 hover:bg-violet-300/30 disabled:opacity-50"
								>
									{queueBusy === "now" ? (
										<Loader2 className="size-3 animate-spin" aria-hidden />
									) : (
										<Send className="size-3" aria-hidden />
									)}
									Enviar ahora
								</button>
							)}
						</div>
						<ul className="mt-1.5 grid max-h-32 gap-1 overflow-y-auto">
							{pending.map((m) => (
								<li
									key={m.mid}
									className="flex items-start gap-2 rounded-md bg-background/60 px-2 py-1.5 text-xs"
								>
									<span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap">
										{m.x}
									</span>
									<button
										type="button"
										onClick={() => m.mid && unqueue(m.mid)}
										disabled={!!queueBusy}
										className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-red-300 disabled:opacity-40"
										aria-label="Borrar mensaje pendiente"
										title="Borrar (aún no se envió)"
									>
										{queueBusy === m.mid ? (
											<Loader2 className="size-3.5 animate-spin" aria-hidden />
										) : (
											<Trash2 className="size-3.5" aria-hidden />
										)}
									</button>
								</li>
							))}
						</ul>
					</div>
				)}
				{pendingRefs.length > 0 && (
					<div className="mb-2 flex flex-wrap gap-1.5">
						{pendingRefs.map((r) => (
							<div
								key={r}
								className="relative size-12 overflow-hidden rounded-lg border"
							>
								<img
									src={fileUrl(project, `assets/refs/${r}`)}
									alt=""
									className="size-full object-cover"
								/>
								<button
									type="button"
									onClick={() =>
										setPendingRefs((old) => old.filter((x) => x !== r))
									}
									className="absolute top-0 right-0 rounded-bl bg-black/70 p-0.5 text-white"
									aria-label={`Quitar ${r}`}
								>
									<X className="size-2.5" aria-hidden />
								</button>
							</div>
						))}
					</div>
				)}
				<div className="flex gap-2">
					<textarea
						className={`${field} min-h-11 flex-1 resize-none`}
						rows={2}
						value={msg}
						disabled={locked || busy}
						onChange={(e) => setMsg(e.target.value)}
						placeholder={placeholder}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
					/>
					<button
						type="button"
						onClick={() => fileInput.current?.click()}
						disabled={locked || busy || uploading}
						className="self-end rounded-lg border p-2.5 text-muted-foreground hover:border-white/40 hover:text-foreground disabled:opacity-40"
						aria-label="Adjuntar archivo"
						title="Adjuntar imagen"
					>
						{uploading ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Paperclip className="size-4" aria-hidden />
						)}
					</button>
					<input
						ref={fileInput}
						type="file"
						accept="image/png,image/jpeg,image/webp"
						multiple
						hidden
						onChange={(e) => upload(e.target.files)}
					/>
					<button
						type="submit"
						disabled={locked || busy || (!msg.trim() && !pendingRefs.length)}
						className="self-end rounded-lg bg-accent p-2.5 text-accent-foreground disabled:opacity-40"
						aria-label="Enviar"
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Send className="size-4" aria-hidden />
						)}
					</button>
				</div>
			</form>
			{zoom && (
				<button
					type="button"
					onClick={() => setZoom(null)}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
					aria-label="Cerrar"
				>
					<img
						src={zoom}
						alt=""
						className="max-h-full max-w-full rounded-lg object-contain"
					/>
					<X className="absolute top-5 right-5 size-6 text-white" aria-hidden />
				</button>
			)}
		</aside>
	);
}

/** chat for any video (preview page): loads its job log, polls while Claude works. If the video has a
 *  `bun vk package` (Grokbot) job, its thread (translated to Spanish) is shown first, clearly labeled as
 *  the automatic pipeline, with the normal Studio chat unified right below it for changes afterwards. */
export function VideoChat({
	project,
	video,
}: {
	project: string;
	video: string;
}) {
	const [d, setD] = useState<Awaited<ReturnType<typeof getChat>> | null>(null);
	const [pkg, setPkg] = useState<
		Awaited<ReturnType<typeof getPkgChat>> | undefined
	>(undefined);
	const load = useCallback(
		async () => setD(await getChat({ data: { project, video } })),
		[project, video],
	);
	const loadPkg = useCallback(
		async () => setPkg(await getPkgChat({ data: { project, video } })),
		[project, video],
	);
	useEffect(() => {
		load();
		loadPkg();
	}, [load, loadPkg]);
	useEffect(() => {
		if (d?.status !== "working" && d?.status !== "queued") return;
		const id = setInterval(load, 2000);
		return () => clearInterval(id);
	}, [d?.status, load]);
	const pkgActive = pkg?.state === "queued" || pkg?.state === "running";
	useEffect(() => {
		if (!pkgActive) return;
		const id = setInterval(loadPkg, 2000);
		return () => clearInterval(id);
	}, [pkgActive, loadPkg]);
	if (!d || pkg === undefined)
		return (
			<Loader2
				className="size-5 animate-spin text-muted-foreground"
				aria-label="Cargando"
			/>
		);
	const pkgEvents = pkg ? pkgLogToEvents(pkg.log, pkg, video) : [];
	const log = [...pkgEvents, ...d.log];
	const status = pkgActive ? "working" : d.status;
	return (
		<div className="grid gap-2">
			{pkg && (
				<div className="flex items-center gap-2 rounded-lg border border-violet-400/40 bg-violet-400/5 px-3 py-2 text-sm">
					<Bot className="size-4 shrink-0 text-violet-300" aria-hidden />
					<span className="min-w-0 flex-1">
						<span className="font-medium text-violet-200">
							Pipeline automático de Grokbot
						</span>
						{pkgActive && (
							<>
								{" · "}
								<Loader2 className="inline size-3 animate-spin" aria-hidden />{" "}
								{pkgStepText(pkg)} ({Math.round(pkg.progress * 100)}%)
							</>
						)}
						{pkg.state === "done" && " · listo"}
						{pkg.state === "error" &&
							` · ${pkg.error || "se detuvo con un error"}`}
					</span>
				</div>
			)}
			{!pkgActive && (d.status === "working" || d.status === "queued") && (
				<div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-sm">
					<span className="inline-flex items-center gap-2">
						<Loader2 className="size-4 animate-spin text-sky-300" aria-hidden />
						{d.status === "queued"
							? "En cola: empieza cuando termine otro video."
							: `${PHASE_ES[d.phase] ?? "Trabajando"}… el preview se actualiza solo al terminar.`}
					</span>
					<button
						type="button"
						onClick={async () => {
							await cancelJob({ data: { project, video } });
							load();
						}}
						className="inline-flex items-center gap-1 text-red-300 hover:text-red-200"
					>
						<Square className="size-3" aria-hidden /> Cancelar
					</button>
				</div>
			)}
			<Activity
				project={project}
				video={video}
				log={log}
				status={status}
				onSent={load}
				className="h-[calc(100dvh-15rem)] lg:static"
				placeholder={
					pkgActive
						? "El pipeline automático de Grokbot está trabajando…"
						: undefined
				}
				empty="Pide cualquier cambio a este video (textos, escenas, colores, ritmo, voz…). Claude lo edita, revisa las vistas previas y vuelve a renderizar."
			/>
		</div>
	);
}
