import { useRouter } from "@tanstack/react-router";
import {
	Film,
	ImageIcon,
	Loader2,
	Search,
	Send,
	Square,
	Wrench,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fileUrl } from "#/lib/format";
import { PHASE_ES } from "#/lib/studio";
import { cn } from "#/lib/utils";
import { cancelJob, getChat, messageJob } from "#/server/studio";

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

type Ev = { id: number; t: number; k: string; x: string };

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
}: {
	project: string;
	video?: string;
	log: Ev[];
	status: string;
	className?: string;
	/** sends a follow-up message for this chat's job (default: the video job via messageJob) */
	onSend?: (text: string) => Promise<unknown>;
	onSent?: () => void;
	empty?: string;
	placeholder?: string;
}) {
	const router = useRouter();
	const [msg, setMsg] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const box = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState<string | null>(null);
	const working = status === "working";
	const n = log.length;

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
		if (!msg.trim()) return;
		setBusy(true);
		setError("");
		try {
			await (onSend?.(msg) ??
				messageJob({ data: { project, video, text: msg } }));
			setMsg("");
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
					? "Espera a que termine este paso…"
					: "Dile que continúe o qué corregir…");

	return (
		<aside
			className={cn(
				"flex h-[calc(100dvh-8rem)] min-h-[420px] flex-col rounded-xl border bg-card lg:sticky lg:top-20",
				className,
			)}
		>
			<div className="border-b px-4 py-3 text-sm font-semibold">
				Chat con Claude
			</div>
			<div ref={box} className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
				{log.length === 0 && empty && (
					<p className="text-muted-foreground">{empty}</p>
				)}
				{log.map((e) =>
					e.k === "you" ? (
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
					),
				)}
				{working && (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" aria-hidden /> trabajando…
					</div>
				)}
			</div>
			<form onSubmit={send} className="border-t p-3">
				{error && <p className="mb-2 text-xs text-red-400">{error}</p>}
				<div className="flex gap-2">
					<textarea
						className={`${field} min-h-11 flex-1 resize-none`}
						rows={2}
						value={msg}
						disabled={working || busy}
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
						type="submit"
						disabled={working || busy || !msg.trim()}
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

/** chat for any video (preview page): loads its job log, polls while Claude works */
export function VideoChat({
	project,
	video,
}: {
	project: string;
	video: string;
}) {
	const [d, setD] = useState<Awaited<ReturnType<typeof getChat>> | null>(null);
	const load = useCallback(
		async () => setD(await getChat({ data: { project, video } })),
		[project, video],
	);
	useEffect(() => {
		load();
	}, [load]);
	useEffect(() => {
		if (d?.status !== "working") return;
		const id = setInterval(load, 2000);
		return () => clearInterval(id);
	}, [d?.status, load]);
	if (!d)
		return (
			<Loader2
				className="size-5 animate-spin text-muted-foreground"
				aria-label="Cargando"
			/>
		);
	return (
		<div className="grid gap-2">
			{d.status === "working" && (
				<div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-sm">
					<span className="inline-flex items-center gap-2">
						<Loader2 className="size-4 animate-spin text-sky-300" aria-hidden />
						{PHASE_ES[d.phase] ?? "Trabajando"}… el preview se actualiza solo al
						terminar.
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
				log={d.log}
				status={d.status}
				onSent={load}
				className="h-[calc(100dvh-15rem)] lg:static"
				empty="Pide cualquier cambio a este video (textos, escenas, colores, ritmo, voz…). Claude lo edita, revisa las vistas previas y vuelve a renderizar."
			/>
		</div>
	);
}
