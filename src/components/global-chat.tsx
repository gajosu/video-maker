// Floating chat available on every page. On a video page it talks to that video's studio job; anywhere else to
// the project's chat session (project-setup.ts), the "director" that edits the brand/knowledge and plans batches
// of videos built in parallel. Both take messages mid-turn (queued, delivered after Claude's next tool call).
// The "Trabajos" tab lists what is in progress (batches, videos working / queued / waiting for approval), and a
// background watcher shows a toast when a job finishes, even with the panel closed or on another page.
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Layers, Loader2, MessageCircle, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "#/components/studio-chat";
import { PHASE_ES, STATUS_ES } from "#/lib/studio";
import { cn } from "#/lib/utils";
import { getWork } from "#/server/batch";
import { cancelSetupJob, getSetup, messageSetup } from "#/server/project-setup";
import { cancelJob, getChat, getRunningJob, messageJob } from "#/server/studio";
import { getProjects } from "#/server/vk";

type ChatData = {
	status: string;
	log: { id: number; t: number; k: string; x: string; mid?: string }[];
};
type Work = Awaited<ReturnType<typeof getWork>>;

export function GlobalChat() {
	const routeParams = useRouterState({
		select: (s) => {
			const p = s.matches.at(-1)?.params as
				| { project?: string; video?: string }
				| undefined;
			return { project: p?.project, video: p?.video };
		},
	});
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<"chat" | "work">("chat");
	const [projects, setProjects] = useState<{ slug: string; name: string }[]>(
		[],
	);
	const [stickyProject, setStickyProject] = useState("");
	const [d, setD] = useState<ChatData | null>(null);
	const [work, setWork] = useState<Work | null>(null);
	// tracked regardless of whether the panel is open or which page we're on, so a job started from
	// "Nuevo video" (or the setup chat) still gets noticed even if the user closes the widget or navigates away
	const [globalWorking, setGlobalWorking] = useState(false);
	const [toast, setToast] = useState<{
		project: string;
		video: string;
		ok: boolean;
	} | null>(null);
	const watchedRef = useRef<{ project: string; video: string } | null>(null);
	const WATCH_KEY = "vk-watched-job";

	// once you've visited a project, the widget keeps talking about it even from other pages
	useEffect(() => {
		if (routeParams.project) setStickyProject(routeParams.project);
	}, [routeParams.project]);

	const project = routeParams.project || stickyProject;
	const video = routeParams.project ? (routeParams.video ?? "") : "";
	const mode = video ? "video" : project ? "project" : "none";

	useEffect(() => {
		if (open && projects.length === 0)
			getProjects().then((ps) =>
				setProjects(ps.map((p) => ({ slug: p.slug, name: p.name }))),
			);
	}, [open, projects.length]);

	const load = useCallback(async () => {
		if (mode === "video") setD(await getChat({ data: { project, video } }));
		else if (mode === "project") setD(await getSetup({ data: { project } }));
		else setD(null);
	}, [mode, project, video]);
	const loadWork = useCallback(
		() =>
			getWork({ data: { project: "" } })
				.then(setWork)
				.catch(() => {}),
		[],
	);

	useEffect(() => {
		if (open) load();
	}, [open, load]);
	const working = d?.status === "working" || d?.status === "queued";
	useEffect(() => {
		if (!open || !working) return;
		const id = setInterval(load, 2000);
		return () => clearInterval(id);
	}, [open, working, load]);
	// the badge and the Trabajos tab: every few seconds (faster while the tab is open)
	useEffect(() => {
		loadWork();
		const id = setInterval(loadWork, open && tab === "work" ? 3000 : 8000);
		return () => clearInterval(id);
	}, [open, tab, loadWork]);

	// background watcher: runs at all times (panel closed, any page), so "te aviso cuando esté listo"
	// is actually true instead of silently going quiet once you close the chat or navigate away
	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			try {
				if (!watchedRef.current) {
					try {
						const raw = localStorage.getItem(WATCH_KEY);
						if (raw) watchedRef.current = JSON.parse(raw);
					} catch {}
				}
				if (!watchedRef.current) {
					const r = await getRunningJob();
					if (!cancelled) setGlobalWorking(!!r);
					if (!r) return;
					watchedRef.current = { project: r.project, video: r.video };
					try {
						localStorage.setItem(WATCH_KEY, JSON.stringify(watchedRef.current));
					} catch {}
					return;
				}
				const { project: wp, video: wv } = watchedRef.current;
				const s = wv
					? await getChat({ data: { project: wp, video: wv } })
					: await getSetup({ data: { project: wp } });
				if (cancelled) return;
				if (s.status === "working" || s.status === "queued") {
					setGlobalWorking(true);
					return;
				}
				watchedRef.current = null;
				try {
					localStorage.removeItem(WATCH_KEY);
				} catch {}
				setGlobalWorking(false);
				if (s.status)
					setToast({ project: wp, video: wv, ok: s.status !== "error" });
				if (
					open &&
					wp === (routeParams.project || stickyProject) &&
					wv === video
				)
					load();
			} catch {}
		};
		tick();
		const id = setInterval(tick, 4000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [open, video, routeParams.project, stickyProject, load]);

	useEffect(() => {
		if (!toast) return;
		const id = setTimeout(() => setToast(null), 12000);
		return () => clearTimeout(id);
	}, [toast]);

	const projectName = projects.find((p) => p.slug === project)?.name ?? project;
	const busyCount = (work?.running ?? 0) + (work?.queued ?? 0);
	const reviewCount = work?.review ?? 0;

	return (
		<div className="fixed bottom-5 left-5 z-40 flex flex-col items-start gap-2">
			{toast && (
				<div
					className={cn(
						"flex w-72 items-start gap-2 rounded-lg border p-3 text-xs shadow-xl",
						toast.ok
							? "border-accent/40 bg-accent/10 text-accent"
							: "border-red-400/40 bg-red-400/10 text-red-200",
					)}
				>
					<div className="min-w-0 flex-1">
						<div className="font-semibold">
							{toast.ok ? "Listo" : "Hubo un error"}
						</div>
						<div className="truncate text-muted-foreground">
							{toast.project}
							{toast.video ? ` · ${toast.video}` : " · configuración"}
						</div>
					</div>
					<button
						type="button"
						onClick={() => {
							setStickyProject(toast.project);
							setOpen(true);
							navigate({
								to: toast.video ? "/p/$project/v/$video" : "/p/$project/setup",
								params: toast.video
									? { project: toast.project, video: toast.video }
									: { project: toast.project },
							});
							setToast(null);
						}}
						className="shrink-0 font-medium underline-offset-2 hover:underline"
					>
						Ver
					</button>
					<button
						type="button"
						onClick={() => setToast(null)}
						className="shrink-0 text-muted-foreground hover:text-foreground"
						aria-label="Cerrar aviso"
					>
						<X className="size-3.5" aria-hidden />
					</button>
				</div>
			)}
			{open ? (
				<div className="flex h-[min(640px,82dvh)] w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
					<div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
						<div className="min-w-0">
							<div className="text-sm font-semibold">Chat con Claude</div>
							<div className="truncate text-xs text-muted-foreground">
								{mode === "video"
									? `${projectName} · ${video}`
									: mode === "project"
										? `${projectName} · proyecto y lotes de videos`
										: "Elige un proyecto"}
							</div>
						</div>
						<div className="flex items-center gap-2">
							{working && tab === "chat" && (
								<button
									type="button"
									onClick={async () => {
										if (mode === "video")
											await cancelJob({ data: { project, video } });
										else if (mode === "project")
											await cancelSetupJob({ data: { project } });
										load();
									}}
									className="inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200"
								>
									<Square className="size-3" aria-hidden /> Cancelar
								</button>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="text-muted-foreground hover:text-foreground"
								aria-label="Cerrar chat"
							>
								<X className="size-4" aria-hidden />
							</button>
						</div>
					</div>
					<div className="flex border-b text-sm">
						{(
							[
								["chat", "Chat"],
								["work", "Trabajos"],
							] as const
						).map(([k, l]) => (
							<button
								key={k}
								type="button"
								onClick={() => setTab(k)}
								className={cn(
									"flex flex-1 items-center justify-center gap-1.5 py-2",
									tab === k
										? "border-b-2 border-accent font-medium text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{l}
								{k === "work" && (busyCount > 0 || reviewCount > 0) && (
									<span className="rounded-full bg-muted px-1.5 text-[11px] tabular">
										{busyCount + reviewCount}
									</span>
								)}
							</button>
						))}
					</div>
					{tab === "work" ? (
						<WorkList work={work} onNavigate={() => setOpen(false)} />
					) : mode === "none" ? (
						<div className="grid flex-1 place-items-center gap-3 p-6 text-center text-sm text-muted-foreground">
							<p>Elige un proyecto para empezar a chatear sobre él.</p>
							<select
								className="w-full max-w-56 rounded-lg border bg-background px-3 py-2 text-sm"
								onChange={(e) => setStickyProject(e.target.value)}
								defaultValue=""
							>
								<option value="" disabled>
									{projects.length ? "Selecciona…" : "Cargando…"}
								</option>
								{projects.map((p) => (
									<option key={p.slug} value={p.slug}>
										{p.name}
									</option>
								))}
							</select>
						</div>
					) : (
						<Activity
							project={project}
							video={video}
							log={d?.log ?? []}
							status={d?.status ?? ""}
							queue
							header={false}
							onSend={(text, refs) =>
								mode === "video"
									? messageJob({ data: { project, video, text, refs } })
									: messageSetup({ data: { project, text, refs } })
							}
							onSent={load}
							className="h-auto flex-1 rounded-none border-0 lg:static"
							empty={
								mode === "video"
									? "Pide cualquier cambio a este video."
									: "Pídele algo sobre este proyecto (marca, base de conocimiento, voz…) o varios videos a la vez: «haz 4 reels sobre…». Los planifica como un lote que se trabaja en paralelo."
							}
							placeholder={
								working
									? "Escribe cuando quieras: lo toma sin detener lo que está haciendo…"
									: mode === "video"
										? "Pide un cambio al video…"
										: "Pide cambios al proyecto o un lote de videos…"
							}
						/>
					)}
				</div>
			) : (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="relative flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-xl hover:brightness-110"
					aria-label={`Abrir chat${busyCount ? ` (${busyCount} videos en proceso)` : ""}`}
				>
					{working || globalWorking ? (
						<Loader2 className="size-6 animate-spin" aria-hidden />
					) : (
						<MessageCircle className="size-6" aria-hidden />
					)}
					{(busyCount > 0 || reviewCount > 0) && (
						<span
							className={cn(
								"absolute -top-1 -right-1 min-w-5 rounded-full px-1.5 text-center text-xs font-semibold leading-5 tabular",
								reviewCount
									? "bg-amber-300 text-black"
									: "bg-sky-400 text-black",
							)}
							title={`${busyCount} en proceso · ${reviewCount} por aprobar`}
						>
							{busyCount + reviewCount}
						</span>
					)}
				</button>
			)}
		</div>
	);
}

function WorkList({
	work,
	onNavigate,
}: {
	work: Work | null;
	onNavigate: () => void;
}) {
	if (!work)
		return (
			<div className="grid flex-1 place-items-center">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	const loose = work.jobs.filter((j) => !j.batch);
	return (
		<div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
			<div className="text-xs text-muted-foreground">
				{work.running} trabajando · {work.queued} en cola · {work.review} por
				aprobar (máx. {work.maxJobs} a la vez)
			</div>
			{work.batches.length > 0 && (
				<section className="grid gap-2">
					<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Lotes
					</h3>
					{work.batches.map((b) => {
						const p = b.progress;
						const pct = (n: number) => `${(n / Math.max(1, p.total)) * 100}%`;
						return (
							<Link
								key={`${b.project}/${b.id}`}
								to="/studio/batch/$project/$batch"
								params={{ project: b.project, batch: b.id }}
								onClick={onNavigate}
								className="block rounded-lg border p-2.5 hover:border-white/30"
							>
								<div className="flex items-center gap-1.5">
									<Layers
										className="size-3.5 text-muted-foreground"
										aria-hidden
									/>
									<span className="truncate font-medium">{b.title}</span>
								</div>
								<div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
									<div className="bg-accent" style={{ width: pct(p.done) }} />
									<div
										className="bg-amber-300"
										style={{ width: pct(p.review) }}
									/>
									<div
										className="bg-sky-400"
										style={{ width: pct(p.working) }}
									/>
									<div
										className="bg-violet-300/70"
										style={{ width: pct(p.queued) }}
									/>
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									{b.status === "draft"
										? `Borrador · ${p.total} videos · listo para lanzar`
										: `${p.done}/${p.total} listos${p.review ? ` · ${p.review} por aprobar` : ""}${p.working ? ` · ${p.working} trabajando` : ""}${p.queued ? ` · ${p.queued} en cola` : ""}`}
								</div>
							</Link>
						);
					})}
				</section>
			)}
			{loose.length > 0 && (
				<section className="grid gap-1.5">
					<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Videos
					</h3>
					{loose.map((j) => {
						const [label, dot] = STATUS_ES[j.status] ?? STATUS_ES.error;
						return (
							<Link
								key={`${j.project}/${j.video}`}
								to="/studio/$project/$video"
								params={{ project: j.project, video: j.video }}
								onClick={onNavigate}
								className="flex items-center gap-2 rounded-lg border px-2.5 py-2 hover:border-white/30"
							>
								<span
									className={`size-2 shrink-0 rounded-full ${dot}`}
									aria-hidden
								/>
								<span className="min-w-0 flex-1 truncate">{j.title}</span>
								<span className="shrink-0 text-xs text-muted-foreground">
									{j.status === "working"
										? (PHASE_ES[j.phase] ?? label)
										: label}
								</span>
							</Link>
						);
					})}
				</section>
			)}
			{!work.batches.length && !loose.length && (
				<p className="py-8 text-center text-muted-foreground">
					Nada en proceso. Pide videos en el chat o crea uno en «Nuevo video».
				</p>
			)}
		</div>
	);
}
