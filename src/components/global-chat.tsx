// Floating chat available on every page. It infers "what's on screen" from the current
// route (project/video params) and routes each message to the matching job: the video's
// studio job when a video is open, or the project's job (project-setup.ts) otherwise —
// same "one Claude process at a time" jobs the dedicated pages already use, just reachable
// from anywhere instead of only from their own page.
import { useRouterState } from "@tanstack/react-router";
import { Loader2, MessageCircle, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Activity } from "#/components/studio-chat";
import { cn } from "#/lib/utils";
import { cancelSetupJob, getSetup, messageSetup } from "#/server/project-setup";
import { cancelJob, getChat, messageJob } from "#/server/studio";
import { getProjects } from "#/server/vk";

type ChatData = {
	status: string;
	log: { id: number; t: number; k: string; x: string }[];
};

export function GlobalChat() {
	const routeParams = useRouterState({
		select: (s) => {
			const p = s.matches.at(-1)?.params as
				| { project?: string; video?: string }
				| undefined;
			return { project: p?.project, video: p?.video };
		},
	});
	const [open, setOpen] = useState(false);
	const [projects, setProjects] = useState<{ slug: string; name: string }[]>(
		[],
	);
	const [stickyProject, setStickyProject] = useState("");
	const [d, setD] = useState<ChatData | null>(null);

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

	useEffect(() => {
		if (open) load();
	}, [open, load]);
	useEffect(() => {
		if (!open || d?.status !== "working") return;
		const id = setInterval(load, 2000);
		return () => clearInterval(id);
	}, [open, d?.status, load]);

	const projectName = projects.find((p) => p.slug === project)?.name ?? project;
	const working = d?.status === "working";

	return (
		<div className="fixed bottom-5 left-5 z-40">
			{open ? (
				<div className="flex h-[min(600px,80dvh)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
					<div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
						<div className="min-w-0">
							<div className="text-sm font-semibold">Chat con Claude</div>
							<div className="truncate text-xs text-muted-foreground">
								{mode === "video"
									? `${projectName} · ${video}`
									: mode === "project"
										? projectName
										: "Elige un proyecto"}
							</div>
						</div>
						<div className="flex items-center gap-2">
							{working && (
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
					{mode === "none" ? (
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
							onSend={(text, refs) =>
								mode === "video"
									? messageJob({ data: { project, video, text, refs } })
									: messageSetup({ data: { project, text, refs } })
							}
							onSent={load}
							className="h-auto flex-1 lg:static"
							empty={
								mode === "video"
									? "Pide cualquier cambio a este video."
									: "Pídele algo sobre este proyecto: marca, base de conocimiento, voz…"
							}
							placeholder={
								working
									? "Espera a que termine…"
									: mode === "video"
										? "Pide un cambio al video…"
										: "Pide un cambio al proyecto…"
							}
						/>
					)}
				</div>
			) : (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={cn(
						"flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-xl hover:brightness-110",
					)}
					aria-label="Abrir chat"
				>
					{working ? (
						<Loader2 className="size-6 animate-spin" aria-hidden />
					) : (
						<MessageCircle className="size-6" aria-hidden />
					)}
				</button>
			)}
		</div>
	);
}
