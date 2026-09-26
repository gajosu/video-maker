import { useRouter } from "@tanstack/react-router";
import { Loader2, Send, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PHASE_ES } from "#/lib/studio";
import { cn } from "#/lib/utils";
import { cancelJob, getChat, messageJob } from "#/server/studio";

const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";

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
	video,
	log,
	status,
	className,
	onSent,
	empty,
}: {
	project: string;
	video: string;
	log: Ev[];
	status: string;
	className?: string;
	onSent?: () => void;
	empty?: string;
}) {
	const router = useRouter();
	const [msg, setMsg] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const box = useRef<HTMLDivElement>(null);
	const working = status === "working";
	const n = log.length;

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new events arrive
	useEffect(() => {
		if (box.current) box.current.scrollTop = box.current.scrollHeight;
	}, [n]);

	const send = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!msg.trim()) return;
		setBusy(true);
		setError("");
		try {
			await messageJob({ data: { project, video, text: msg } });
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
		status === "review"
			? "Pide cambios al guion…"
			: status === "done" || !status
				? "Pide un cambio al video…"
				: status === "working"
					? "Espera a que termine este paso…"
					: "Dile que continúe o qué corregir…";

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
