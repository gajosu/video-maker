import { useRouter } from "@tanstack/react-router";
import { Check, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "#/lib/utils";

const ACCEPT =
	".png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.m4v,.mp3,.wav,.m4a,.ogg";
const AUDIO = /\.(mp3|wav|m4a|ogg)$/i;
const field =
	"w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-white/40";

const slug = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\.[a-z0-9]+$/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);

type Item = {
	id: string;
	file: File;
	name: string;
	description: string;
	kind: "sfx" | "music";
	preview?: string;
	state: "ready" | "uploading" | "done" | "error";
	error?: string;
	replace?: boolean;
};

/** free upload for the Assets tab: drop files, name + describe them, upload */
export function AssetUpload({ project }: { project: string }) {
	const router = useRouter();
	const input = useRef<HTMLInputElement>(null);
	const [items, setItems] = useState<Item[]>([]);
	const [over, setOver] = useState(false);
	const [busy, setBusy] = useState(false);

	const add = (files: FileList | null) => {
		if (!files) return;
		const next = [...files].map((file) => ({
			id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
			file,
			name: slug(file.name),
			description: "",
			kind: "sfx" as const,
			preview: file.type.startsWith("image/")
				? URL.createObjectURL(file)
				: undefined,
			state: "ready" as const,
		}));
		setItems((old) => [...old, ...next]);
	};
	const patch = (id: string, p: Partial<Item>) =>
		setItems((old) => old.map((it) => (it.id === id ? { ...it, ...p } : it)));

	const uploadAll = async () => {
		setBusy(true);
		let ok = 0;
		for (const it of items) {
			if (it.state === "done") continue;
			patch(it.id, { state: "uploading", error: undefined });
			const body = new FormData();
			body.set("file", it.file);
			body.set("name", it.name);
			body.set("description", it.description);
			body.set("kind", it.kind);
			if (it.replace) body.set("replace", "1");
			try {
				const res = await fetch(`/api/assets/${project}`, {
					method: "POST",
					body,
				});
				const j = (await res.json()) as { error?: string };
				if (!res.ok) throw new Error(j.error ?? `error ${res.status}`);
				patch(it.id, { state: "done" });
				ok++;
			} catch (e) {
				patch(it.id, {
					state: "error",
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
		setBusy(false);
		if (ok) {
			router.invalidate();
			setTimeout(
				() => setItems((old) => old.filter((it) => it.state !== "done")),
				1500,
			);
		}
	};

	const pending = items.filter((it) => it.state !== "done").length;

	return (
		<section>
			<h2 className="font-semibold">Subir assets</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				Personajes (como Elio), logos, capturas, videos o sonidos. Ponles un
				nombre y una descripción corta, y luego pídelos en el chat del video
				(ej. «usa elio-saludando en el cierre»). Para personajes, lo mejor es un
				PNG con fondo transparente por pose.
			</p>
			<button
				type="button"
				onClick={() => input.current?.click()}
				onDragOver={(e) => {
					e.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(e) => {
					e.preventDefault();
					setOver(false);
					add(e.dataTransfer.files);
				}}
				className={cn(
					"mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm text-muted-foreground transition-colors",
					over
						? "border-accent bg-accent/5 text-foreground"
						: "hover:border-white/30",
				)}
			>
				<Upload className="size-6" aria-hidden />
				Arrastra archivos aquí o haz clic para elegirlos
				<span className="text-xs">
					PNG, JPG, WebP, GIF, MP4, MOV, WebM, MP3, WAV · hasta 300 MB
				</span>
			</button>
			<input
				ref={input}
				type="file"
				multiple
				accept={ACCEPT}
				className="hidden"
				onChange={(e) => {
					add(e.target.files);
					e.target.value = "";
				}}
			/>

			{items.length > 0 && (
				<div className="mt-4 grid gap-3">
					{items.map((it) => (
						<div
							key={it.id}
							className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-3 sm:flex-nowrap"
						>
							<div className="checker flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border text-xs text-muted-foreground">
								{it.preview ? (
									<img
										src={it.preview}
										alt=""
										className="size-full object-contain"
									/>
								) : (
									it.file.name.split(".").pop()?.toUpperCase()
								)}
							</div>
							<div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
								<input
									className={`${field} font-mono`}
									value={it.name}
									onChange={(e) =>
										patch(it.id, {
											name:
												slug(e.target.value) || e.target.value.toLowerCase(),
										})
									}
									aria-label="Nombre del asset"
									placeholder="nombre"
									disabled={it.state === "uploading" || it.state === "done"}
								/>
								<input
									className={field}
									value={it.description}
									maxLength={300}
									onChange={(e) =>
										patch(it.id, { description: e.target.value })
									}
									aria-label="Descripción"
									placeholder="Qué es: «Elio saludando, fondo transparente»"
									disabled={it.state === "uploading" || it.state === "done"}
								/>
								{AUDIO.test(it.file.name) ? (
									<select
										className={field}
										value={it.kind}
										onChange={(e) =>
											patch(it.id, { kind: e.target.value as Item["kind"] })
										}
										aria-label="Tipo de audio"
									>
										<option value="sfx">Efecto</option>
										<option value="music">Música</option>
									</select>
								) : (
									<span className="hidden sm:block" />
								)}
								{it.error && (
									<div className="text-xs text-red-400 sm:col-span-3">
										{it.error}
										{it.error.startsWith("ya existe") && (
											<label className="ml-3 inline-flex items-center gap-1 text-foreground">
												<input
													type="checkbox"
													checked={!!it.replace}
													onChange={(e) =>
														patch(it.id, { replace: e.target.checked })
													}
												/>{" "}
												reemplazar
											</label>
										)}
									</div>
								)}
							</div>
							<div className="flex size-9 shrink-0 items-center justify-center">
								{it.state === "uploading" ? (
									<Loader2
										className="size-4 animate-spin"
										aria-label="Subiendo"
									/>
								) : it.state === "done" ? (
									<Check className="size-4 text-accent" aria-label="Subido" />
								) : (
									<button
										type="button"
										onClick={() =>
											setItems((old) => old.filter((x) => x.id !== it.id))
										}
										className="rounded-lg p-2 text-muted-foreground hover:text-foreground"
										aria-label="Quitar"
									>
										<X className="size-4" aria-hidden />
									</button>
								)}
							</div>
						</div>
					))}
					<div className="flex justify-end">
						<button
							type="button"
							onClick={uploadAll}
							disabled={
								busy ||
								!pending ||
								items.some((it) => it.state !== "done" && !it.name)
							}
							className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
						>
							{busy ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<Upload className="size-4" aria-hidden />
							)}
							Subir {pending} {pending === 1 ? "archivo" : "archivos"}
						</button>
					</div>
				</div>
			)}
		</section>
	);
}
