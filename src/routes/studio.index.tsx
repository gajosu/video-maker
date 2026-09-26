import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { fmtAgo } from "#/lib/format";
import { STATUS_ES } from "#/lib/studio";
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
];
const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";

function Studio() {
	const { projects, jobs, running } = Route.useLoaderData();
	const navigate = useNavigate();
	const [project, setProject] = useState(
		projects.find((p) => p.slug !== "_example")?.slug ??
			projects[0]?.slug ??
			"",
	);
	const [title, setTitle] = useState("");
	const [style, setStyle] = useState("punchy");
	const [duration, setDuration] = useState(30);
	const [idea, setIdea] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSending(true);
		setError("");
		try {
			const r = await startJob({
				data: { project, title, style, duration, idea },
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
					</div>
					<label className="grid gap-1.5 text-sm font-medium">
						Idea o guion
						<textarea
							className={`${field} min-h-56 leading-relaxed`}
							value={idea}
							maxLength={8000}
							onChange={(e) => setIdea(e.target.value)}
							placeholder="Qué quieres contar, a quién, qué debe hacer al final (CTA). También puedes pegar un guion completo."
						/>
					</label>
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
