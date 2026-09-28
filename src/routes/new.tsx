import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { createProject } from "#/server/vk";

export const Route = createFileRoute("/new")({
	component: NewProject,
});

const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";

const slugify = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

function NewProject() {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [slugTouched, setSlugTouched] = useState(false);
	const [primary, setPrimary] = useState("#6366f1");
	const [secondary, setSecondary] = useState("#22d3ee");
	const [language, setLanguage] = useState("es");
	const [orientation, setOrientation] = useState<"vertical" | "horizontal">(
		"vertical",
	);
	const [description, setDescription] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");

	const onName = (v: string) => {
		setName(v);
		if (!slugTouched) setSlug(slugify(v));
	};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSending(true);
		setError("");
		try {
			const r = await createProject({
				data: {
					slug,
					name,
					primary,
					secondary,
					language,
					description,
					orientation,
				},
			});
			await navigate({ to: "/p/$project/setup", params: { project: r.slug } });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setSending(false);
		}
	};

	return (
		<main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
			<h1 className="text-3xl font-extrabold tracking-tight">Nuevo proyecto</h1>
			<p className="mt-1 text-muted-foreground">
				Una marca o producto con su propia identidad, voz y base de
				conocimiento. Después puedes ajustar todo desde la pestaña «Brand &amp;
				voice» o pidiéndoselo a Claude con el skill <b>vk-project</b>.
			</p>

			<form
				onSubmit={submit}
				className="mt-6 grid gap-4 rounded-xl border bg-card p-5"
			>
				<label className="grid gap-1.5 text-sm font-medium">
					Nombre
					<input
						className={field}
						value={name}
						maxLength={80}
						onChange={(e) => onName(e.target.value)}
						placeholder="Ej: Hyppe"
						required
					/>
				</label>
				<label className="grid gap-1.5 text-sm font-medium">
					Identificador (slug)
					<input
						className={`${field} font-mono`}
						value={slug}
						maxLength={40}
						onChange={(e) => {
							setSlugTouched(true);
							setSlug(slugify(e.target.value));
						}}
						placeholder="hyppe"
						required
					/>
					<span className="font-sans font-normal text-xs text-muted-foreground">
						Se usa en la URL y en la carpeta{" "}
						<code className="font-mono">projects/{slug || "…"}</code>. Solo
						minúsculas, números y guiones.
					</span>
				</label>
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="grid gap-1.5 text-sm font-medium">
						Color primario
						<div className="flex items-center gap-2">
							<input
								type="color"
								value={primary}
								onChange={(e) => setPrimary(e.target.value)}
								className="size-10 shrink-0 rounded-lg border bg-card"
							/>
							<input
								className={`${field} font-mono`}
								value={primary}
								onChange={(e) => setPrimary(e.target.value)}
							/>
						</div>
					</label>
					<label className="grid gap-1.5 text-sm font-medium">
						Color secundario
						<div className="flex items-center gap-2">
							<input
								type="color"
								value={secondary}
								onChange={(e) => setSecondary(e.target.value)}
								className="size-10 shrink-0 rounded-lg border bg-card"
							/>
							<input
								className={`${field} font-mono`}
								value={secondary}
								onChange={(e) => setSecondary(e.target.value)}
							/>
						</div>
					</label>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="grid gap-1.5 text-sm font-medium">
						Idioma
						<select
							className={field}
							value={language}
							onChange={(e) => setLanguage(e.target.value)}
						>
							<option value="es">Español</option>
							<option value="en">Inglés</option>
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
							<option value="vertical">
								Vertical · 1080×1920 (Reels/TikTok)
							</option>
							<option value="horizontal">
								Horizontal · 1920×1080 (YouTube)
							</option>
						</select>
					</label>
				</div>
				<label className="grid gap-1.5 text-sm font-medium">
					Descripción{" "}
					<span className="font-normal text-muted-foreground">(opcional)</span>
					<textarea
						className={`${field} min-h-24`}
						value={description}
						maxLength={300}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="En una frase: qué es y para quién"
					/>
				</label>

				{error && <p className="text-sm text-red-400">{error}</p>}
				<div className="flex justify-end">
					<button
						type="submit"
						disabled={sending || !name.trim() || !slug}
						className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
					>
						{sending ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Sparkles className="size-4" aria-hidden />
						)}
						Crear proyecto
					</button>
				</div>
			</form>
		</main>
	);
}
