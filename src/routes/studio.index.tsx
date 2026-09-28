import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileUrl, fmtAgo } from "#/lib/format";
import { STATUS_ES } from "#/lib/studio";
import { cn } from "#/lib/utils";
import { getFlowStatus } from "#/server/flow";
import { getStudio, startJob } from "#/server/studio";

export const Route = createFileRoute("/studio/")({
	loader: () => getStudio(),
	component: Studio,
});

const STYLES: [string, string][] = [
	["punchy", "Punchy (redes, rápido)"],
	["motion", "Motion graphics"],
	["story", "Storytelling"],
	["vox", "Explainer tipo Vox"],
	["anthem", "Manifiesto / brand film"],
	["dev", "Dev tools"],
	["ugc", "UGC (personajes, contenido realista)"],
];
const MUSIC: [string, string][] = [
	["", "Automática (según el estilo)"],
	["beat", "Beat (percusión, redes)"],
	["pulse", "Pulse (electrónica)"],
	["ambient", "Ambient (suave, sin batería)"],
	["pluck", "Lofi pluck"],
	["none", "Sin música"],
];
const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";

function Studio() {
	const { projects, jobs, running, assets, projectVoices, voices } =
		Route.useLoaderData();
	const navigate = useNavigate();
	const [project, setProject] = useState(
		projects.find((p) => p.slug !== "_example")?.slug ??
			projects[0]?.slug ??
			"",
	);
	const [title, setTitle] = useState("");
	const [style, setStyle] = useState("punchy");
	const [duration, setDuration] = useState(30);
	const [orientation, setOrientation] = useState<"vertical" | "horizontal">(
		"vertical",
	);
	const [idea, setIdea] = useState("");
	const [voice, setVoice] = useState("");
	const [libVoice, setLibVoice] = useState("");
	const [music, setMusic] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [refs, setRefs] = useState<string[]>([]);
	const [videoRefs, setVideoRefs] = useState("");
	const [uploading, setUploading] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const [flowOn, setFlowOn] = useState(false);
	const [clips, setClips] = useState(2);
	const [images, setImages] = useState(0);
	const [flow, setFlow] = useState<Awaited<
		ReturnType<typeof getFlowStatus>
	> | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const lib = assets[project] ?? [];
	const projectVoiceName =
		voices.find((v) => v.id === projectVoices[project])?.name ??
		"voz del proyecto";
	const libId = libVoice.match(/(\w+\/\w+)/)?.[1] ?? "";

	useEffect(() => {
		getFlowStatus().then(setFlow);
	}, []);
	// assets belong to one project
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the project changes
	useEffect(() => {
		setPicked([]);
		setRefs([]);
		const p = projects.find((x) => x.slug === project);
		setOrientation(p && p.height < p.width ? "horizontal" : "vertical");
	}, [project]);

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
				if (!r.ok) throw new Error(body.error ?? "no se pudo subir la imagen");
				setRefs((old) => [...old, body.name as string]);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setUploading(false);
		}
	};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSending(true);
		setError("");
		try {
			const r = await startJob({
				data: {
					project,
					title,
					style,
					duration,
					orientation,
					idea,
					voice: libId || voice,
					music,
					assets: picked,
					refs,
					videoRefs: videoRefs.split(/\s+/).filter(Boolean),
					flow: flowOn ? { clips, images } : { clips: 0, images: 0 },
				},
			});
			await navigate({ to: "/studio/$project/$video", params: r });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setSending(false);
		}
	};

	return (
		<main className="mx-auto grid max-w-[1400px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
			<section>
				<h1 className="text-3xl font-extrabold tracking-tight">Nuevo video</h1>
				<p className="mt-1 max-w-2xl text-muted-foreground">
					Describe la idea o pega un guion. Claude escribe el guion y te lo
					muestra. Tú lo apruebas y eliges la voz, y él arma el video completo:
					voz, escenas, revisión y render.
				</p>
				<form
					onSubmit={submit}
					className="mt-6 grid gap-4 rounded-xl border bg-card p-5"
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<label className="grid gap-1.5 text-sm font-medium">
							Proyecto
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
						<label className="grid gap-1.5 text-sm font-medium">
							Título
							<input
								className={field}
								value={title}
								maxLength={80}
								onChange={(e) => setTitle(e.target.value)}
								placeholder="Ej: 3 cosas que no sabías"
							/>
						</label>
						<label className="grid gap-1.5 text-sm font-medium">
							Estilo
							<select
								className={field}
								value={style}
								onChange={(e) => setStyle(e.target.value)}
							>
								{STYLES.map(([v, l]) => (
									<option key={v} value={v}>
										{l}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1.5 text-sm font-medium">
							Duración
							<select
								className={field}
								value={duration}
								onChange={(e) => setDuration(Number(e.target.value))}
							>
								{[15, 20, 30, 45, 60].map((d) => (
									<option key={d} value={d}>
										~{d} segundos
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1.5 text-sm font-medium">
							Formato
							<select
								className={field}
								value={orientation}
								onChange={(e) =>
									setOrientation(e.target.value as "vertical" | "horizontal")
								}
							>
								<option value="vertical">Vertical · 1080×1920</option>
								<option value="horizontal">Horizontal · 1920×1080</option>
							</select>
							<span className="text-xs text-muted-foreground">
								Es del proyecto entero: cambia también sus otros videos.
							</span>
						</label>
					</div>
					<label className="grid gap-1.5 text-sm font-medium">
						Idea o guion
						<textarea
							className={`${field} min-h-56 leading-relaxed`}
							value={idea}
							maxLength={40000}
							onChange={(e) => setIdea(e.target.value)}
							placeholder="Qué quieres contar, a quién, qué debe hacer al final (CTA). También puedes pegar un guion completo."
						/>
					</label>
					<div className="grid gap-4 sm:grid-cols-2">
						<label className="grid gap-1.5 text-sm font-medium">
							Voz
							<select
								className={field}
								value={voice}
								onChange={(e) => setVoice(e.target.value)}
								disabled={!!libId}
							>
								<option value="">{projectVoiceName} (la del proyecto)</option>
								{voices
									.filter((v) => v.id !== projectVoices[project])
									.map((v) => (
										<option key={v.id} value={v.id}>
											{v.name}
										</option>
									))}
							</select>
							<input
								className={field}
								value={libVoice}
								onChange={(e) => setLibVoice(e.target.value)}
								placeholder="o pega una de la biblioteca (botón «Elegir» en Voces)"
							/>
						</label>
						<label className="grid content-start gap-1.5 text-sm font-medium">
							Música
							<select
								className={field}
								value={music}
								onChange={(e) => setMusic(e.target.value)}
							>
								{MUSIC.map(([v, l]) => (
									<option key={v} value={v}>
										{l}
									</option>
								))}
							</select>
						</label>
					</div>

					<div className="grid gap-1.5 text-sm">
						<span className="font-medium">
							Assets de la biblioteca para usar{" "}
							<span className="font-normal text-muted-foreground">
								(opcional · {picked.length} elegidos)
							</span>
						</span>
						{lib.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								Este proyecto no tiene imágenes ni videos todavía. Súbelos o
								créalos en la pestaña Assets.
							</p>
						) : (
							<div className="flex gap-2 overflow-x-auto pb-1">
								{lib.map((a) => {
									const on = picked.includes(a.name);
									return (
										<button
											key={a.name}
											type="button"
											title={
												a.description ? `${a.name} — ${a.description}` : a.name
											}
											onClick={() =>
												setPicked((x) =>
													on
														? x.filter((n) => n !== a.name)
														: x.length < 12
															? [...x, a.name]
															: x,
												)
											}
											className={cn(
												"relative w-20 shrink-0 overflow-hidden rounded-lg border-2",
												on
													? "border-accent"
													: "border-transparent opacity-80 hover:opacity-100",
											)}
										>
											<div className="checker aspect-[9/16]">
												{a.kind === "video" ? (
													<video
														src={fileUrl(project, `assets/${a.file}`)}
														muted
														preload="metadata"
														className="size-full object-cover"
													/>
												) : (
													<img
														src={fileUrl(project, `assets/${a.file}`)}
														alt=""
														loading="lazy"
														className="size-full object-contain"
													/>
												)}
											</div>
											<div className="truncate bg-black/70 px-1 py-0.5 text-[10px] text-white">
												{a.kind === "video" ? "▶ " : ""}
												{a.name}
											</div>
											{on && (
												<span className="absolute top-1 right-1 rounded-full bg-accent p-0.5 text-accent-foreground">
													<Check className="size-3" aria-hidden />
												</span>
											)}
										</button>
									);
								})}
							</div>
						)}
					</div>

					<div className="grid gap-1.5 text-sm">
						<span className="font-medium">
							Subir archivos de referencia{" "}
							<span className="font-normal text-muted-foreground">
								(logo, capturas, fotos — opcional)
							</span>
						</span>
						<div className="flex flex-wrap gap-2">
							{refs.map((r) => (
								<div
									key={r}
									className="relative size-20 overflow-hidden rounded-lg border"
								>
									<img
										src={fileUrl(project, `assets/refs/${r}`)}
										alt=""
										className="size-full object-cover"
									/>
									<button
										type="button"
										onClick={() => setRefs((old) => old.filter((x) => x !== r))}
										className="absolute top-0.5 right-0.5 rounded-full bg-black/70 p-0.5 text-white"
										aria-label={`Quitar ${r}`}
									>
										<X className="size-3" aria-hidden />
									</button>
								</div>
							))}
							<button
								type="button"
								onClick={() => fileInput.current?.click()}
								disabled={uploading}
								className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:border-white/40 disabled:opacity-50"
							>
								{uploading ? (
									<Loader2 className="size-4 animate-spin" aria-hidden />
								) : (
									<ImagePlus className="size-4" aria-hidden />
								)}
								Subir
							</button>
							<input
								ref={fileInput}
								type="file"
								accept="image/png,image/jpeg,image/webp"
								multiple
								hidden
								onChange={(e) => upload(e.target.files)}
							/>
						</div>
					</div>

					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">
							Videos de referencia{" "}
							<span className="font-normal text-muted-foreground">
								(links de TikTok, Reels, Shorts, YouTube… uno por línea, máx. 3
								— opcional)
							</span>
						</span>
						<textarea
							value={videoRefs}
							onChange={(e) => setVideoRefs(e.target.value)}
							rows={2}
							placeholder="https://www.tiktok.com/@marca/video/…"
							className={cn(field, "font-mono text-xs")}
						/>
						<span className="text-xs text-muted-foreground">
							Claude los descarga y estudia la voz, el ritmo, los cortes y el
							estilo gráfico para imitarlos. Nunca usa su material en tu video.
						</span>
					</label>

					<div className="grid gap-3 rounded-lg border bg-background/40 p-4 text-sm">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<label className="inline-flex items-center gap-2 font-medium">
								<input
									type="checkbox"
									checked={flowOn}
									onChange={(e) => setFlowOn(e.target.checked)}
									className="size-4 accent-[var(--accent)]"
								/>
								Generar clips e imágenes nuevas con Google Flow
							</label>
							<span
								className={cn(
									"rounded-full px-2.5 py-0.5 text-xs",
									flow?.running && flow.connected
										? "bg-accent/15 text-accent"
										: "bg-amber-300/15 text-amber-200",
								)}
							>
								{!flow
									? "Comprobando…"
									: !flow.running
										? "flowkit apagado"
										: !flow.connected
											? "extensión desconectada"
											: flow.cooldown
												? `en pausa ${flow.cooldown}s`
												: "Flow conectado"}
							</span>
						</div>
						{flowOn && (
							<div className="grid gap-3 sm:grid-cols-2">
								<label className="grid gap-1.5">
									Máximo de clips de video
									<select
										className={field}
										value={clips}
										onChange={(e) => setClips(Number(e.target.value))}
									>
										{[0, 1, 2, 3, 4, 5, 6].map((n) => (
											<option key={n} value={n}>
												{n}
											</option>
										))}
									</select>
								</label>
								<label className="grid gap-1.5">
									Máximo de imágenes
									<select
										className={field}
										value={images}
										onChange={(e) => setImages(Number(e.target.value))}
									>
										{[0, 1, 2, 3, 4, 5, 6].map((n) => (
											<option key={n} value={n}>
												{n}
											</option>
										))}
									</select>
								</label>
								<p className="text-xs text-muted-foreground sm:col-span-2">
									Claude los genera solo si aportan al video, con tus créditos
									de Flow y sin pasar este límite. Puede animar los assets que
									elegiste o usarlos como referencia.
									{flow && !(flow.running && flow.connected)
										? " Arranca flowkit y abre flow.google.com antes de aprobar el guion."
										: ""}
								</p>
							</div>
						)}
					</div>

					{error && <p className="text-sm text-red-400">{error}</p>}
					{running && (
						<p className="text-sm text-amber-200">
							Hay un video en proceso; espera a que termine para crear otro.
						</p>
					)}
					<div className="flex justify-end">
						<button
							type="submit"
							disabled={sending || running || !project}
							className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
						>
							{sending ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<Sparkles className="size-4" aria-hidden />
							)}
							Crear video
						</button>
					</div>
				</form>
			</section>

			<aside>
				<h2 className="text-lg font-semibold">Videos creados aquí</h2>
				{jobs.length === 0 ? (
					<p className="mt-3 text-sm text-muted-foreground">Todavía ninguno.</p>
				) : (
					<ul className="mt-3 grid gap-2">
						{jobs.map((j) => {
							const [label, dot] = STATUS_ES[j.status] ?? STATUS_ES.error;
							return (
								<li key={`${j.project}/${j.video}`}>
									<Link
										to="/studio/$project/$video"
										params={{ project: j.project, video: j.video }}
										className="block rounded-xl border bg-card p-3 transition-colors hover:border-white/25"
									>
										<div className="truncate font-medium">{j.title}</div>
										<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
											<span
												className={`size-1.5 rounded-full ${dot}`}
												aria-hidden
											/>
											{label} · {j.project} · {fmtAgo(j.updatedAt)}
										</div>
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</aside>
		</main>
	);
}
