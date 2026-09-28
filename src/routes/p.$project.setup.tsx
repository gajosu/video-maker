import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ChevronLeft,
	ImagePlus,
	Loader2,
	Sparkles,
	Square,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "#/components/studio-chat";
import { fileUrl } from "#/lib/format";
import {
	cancelSetupJob,
	getSetup,
	messageSetup,
	sendSetupMessagesNow,
	startSetup,
	unqueueSetupMessage,
} from "#/server/project-setup";

export const Route = createFileRoute("/p/$project/setup")({
	loader: ({ params }) => getSetup({ data: { project: params.project } }),
	component: ProjectSetup,
});

const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";

function ProjectSetup() {
	const { project } = Route.useParams();
	const initial = Route.useLoaderData();
	const [d, setD] = useState(initial);
	const [brief, setBrief] = useState("");
	const [url, setUrl] = useState("");
	const [refs, setRefs] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);

	const reload = useCallback(
		async () => setD(await getSetup({ data: { project } })),
		[project],
	);
	useEffect(() => {
		if (d.status !== "working") return;
		const id = setInterval(reload, 2000);
		return () => clearInterval(id);
	}, [d.status, reload]);

	const started = d.status !== "";

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
			await startSetup({ data: { project, brief, url, refs } });
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSending(false);
		}
	};

	return (
		<main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
			<Link
				to="/p/$project"
				params={{ project }}
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ChevronLeft className="size-4" aria-hidden /> {project}
			</Link>
			<h1 className="mt-2 text-3xl font-extrabold tracking-tight">
				Configurar con Claude
			</h1>
			<p className="mt-1 max-w-2xl text-muted-foreground">
				Cuéntale de qué se trata, pega la URL del sitio y sube fotos del logo o
				capturas de referencia. Claude completa el resto: colores, tono,
				públicos, base de conocimiento — el skill <b>vk-project</b>.
			</p>

			{!started ? (
				<form
					onSubmit={submit}
					className="mt-6 grid gap-4 rounded-xl border bg-card p-5"
				>
					<label className="grid gap-1.5 text-sm font-medium">
						Descríbelo
						<textarea
							className={`${field} min-h-40 leading-relaxed`}
							value={brief}
							maxLength={6000}
							onChange={(e) => setBrief(e.target.value)}
							placeholder="Qué es, para quién, precio/oferta, tono (3 adjetivos), cosas que nunca hay que decir…"
						/>
					</label>
					<label className="grid gap-1.5 text-sm font-medium">
						Sitio web{" "}
						<span className="font-normal text-muted-foreground">
							(opcional)
						</span>
						<input
							className={field}
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://…"
						/>
					</label>
					<div className="grid gap-1.5 text-sm font-medium">
						Imágenes de referencia{" "}
						<span className="font-normal text-muted-foreground">
							(logo, capturas — opcional)
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

					{error && <p className="text-sm text-red-400">{error}</p>}
					<div className="flex justify-end">
						<button
							type="submit"
							disabled={
								sending ||
								uploading ||
								(!brief.trim() && !url.trim() && refs.length === 0)
							}
							className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
						>
							{sending ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<Sparkles className="size-4" aria-hidden />
							)}
							Configurar con Claude
						</button>
					</div>
				</form>
			) : (
				<div className="mt-6 grid gap-2">
					{d.status === "working" && (
						<div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-sm">
							<span className="inline-flex items-center gap-2">
								<Loader2
									className="size-4 animate-spin text-sky-300"
									aria-hidden
								/>
								Configurando el proyecto…
							</span>
							<button
								type="button"
								onClick={async () => {
									await cancelSetupJob({ data: { project } });
									reload();
								}}
								className="inline-flex items-center gap-1 text-red-300 hover:text-red-200"
							>
								<Square className="size-3" aria-hidden /> Cancelar
							</button>
						</div>
					)}
					{d.status === "done" && (
						<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
							<span>Listo. Puedes seguir pidiendo cambios abajo.</span>
							<Link
								to="/p/$project"
								params={{ project }}
								search={{ tab: "knowledge" }}
								className="font-medium text-accent hover:underline"
							>
								Ver knowledge base →
							</Link>
						</div>
					)}
					<Activity
						project={project}
						log={d.log}
						status={d.status}
						queue
						onUnqueue={(mid) => unqueueSetupMessage({ data: { project, mid } })}
						onSendNow={() => sendSetupMessagesNow({ data: { project } })}
						onSend={(text, refs) =>
							messageSetup({ data: { project, text, refs } })
						}
						onSent={reload}
						className="h-[calc(100dvh-16rem)]"
						placeholder={
							d.status === "working"
								? "Escribe cuando quieras: queda pendiente y le llega sin cortar lo que hace…"
								: "Pide un cambio (colores, tono, un dato que falta…)"
						}
					/>
				</div>
			)}
		</main>
	);
}
