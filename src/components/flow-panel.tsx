import { useRouter } from "@tanstack/react-router";
import {
	Check,
	ImageIcon,
	Loader2,
	Maximize2,
	Pencil,
	Sparkles,
	Video,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileUrl } from "#/lib/format";
import { cn } from "#/lib/utils";
import {
	flowEdit,
	flowGenerate,
	flowUpscale,
	getFlowStatus,
} from "#/server/flow";
import type { Asset } from "../../cli/lib/assets.ts";

export type FlowTab = "image" | "video" | "edit" | "upscale";
/** what an asset-card action asks the panel to open with */
export type FlowDraft = {
	tab: FlowTab;
	mode?: "text" | "frames" | "refs";
	from?: string;
	source?: string;
	addRef?: string;
	nonce: number;
};

const field =
	"w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-white/40";
const TABS: [FlowTab, string, typeof ImageIcon][] = [
	["image", "Imagen", ImageIcon],
	["video", "Video", Video],
	["edit", "Editar imagen", Pencil],
	["upscale", "Escalar 2K/4K", Maximize2],
];
const slug = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.split("-")
		.slice(0, 5)
		.join("-")
		.slice(0, 48);

function Pick({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid gap-1.5 text-sm">
			<span className="font-medium">{label}</span>
			{children}
		</div>
	);
}

function Seg<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (v: T) => void;
	options: [T, string][];
}) {
	return (
		<div className="flex flex-wrap gap-1 rounded-lg border bg-background p-1">
			{options.map(([v, l]) => (
				<button
					key={v}
					type="button"
					onClick={() => onChange(v)}
					className={cn(
						"rounded-md px-3 py-1.5 text-xs font-medium",
						value === v
							? "bg-white/10 text-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{l}
				</button>
			))}
		</div>
	);
}

/** thumbnail strip of the project's images; single or multi select */
function AssetPicker({
	project,
	images,
	value,
	onChange,
	max = 1,
}: {
	project: string;
	images: Asset[];
	value: string[];
	onChange: (v: string[]) => void;
	max?: number;
}) {
	if (!images.length)
		return (
			<p className="text-xs text-muted-foreground">
				No hay imágenes en la biblioteca todavía: súbelas o genéralas primero.
			</p>
		);
	const toggle = (n: string) => {
		if (value.includes(n)) onChange(value.filter((x) => x !== n));
		else if (max === 1) onChange([n]);
		else if (value.length < max) onChange([...value, n]);
	};
	return (
		<div className="flex gap-2 overflow-x-auto pb-1">
			{images.map((a) => {
				const on = value.includes(a.name);
				return (
					<button
						key={a.name}
						type="button"
						onClick={() => toggle(a.name)}
						title={a.description ? `${a.name} — ${a.description}` : a.name}
						className={cn(
							"relative w-20 shrink-0 overflow-hidden rounded-lg border-2",
							on
								? "border-accent"
								: "border-transparent opacity-80 hover:opacity-100",
						)}
					>
						<div className="checker aspect-[9/16]">
							<img
								src={fileUrl(project, `assets/${a.file}`)}
								alt=""
								loading="lazy"
								className="size-full object-contain"
							/>
						</div>
						<div className="truncate bg-black/70 px-1 py-0.5 text-[10px] text-white">
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
	);
}

export function FlowPanel({
	project,
	images,
	draft,
}: {
	project: string;
	images: Asset[];
	draft: FlowDraft | null;
}) {
	const router = useRouter();
	const box = useRef<HTMLElement>(null);
	const [status, setStatus] = useState<Awaited<
		ReturnType<typeof getFlowStatus>
	> | null>(null);
	const [tab, setTab] = useState<FlowTab>("image");
	const [prompt, setPrompt] = useState("");
	const [name, setName] = useState("");
	const [nameTouched, setNameTouched] = useState(false);
	// image
	const [model, setModel] = useState<"pro" | "nb2" | "lite">("pro");
	const [shape, setShape] = useState<
		"portrait" | "landscape" | "square" | "3:4" | "4:3"
	>("portrait");
	const [count, setCount] = useState(1);
	const [refs, setRefs] = useState<string[]>([]);
	// video
	const [mode, setMode] = useState<"text" | "frames" | "refs">("text");
	const [from, setFrom] = useState<string[]>([]);
	const [to, setTo] = useState<string[]>([]);
	const [duration, setDuration] = useState(6);
	const [vshape, setVshape] = useState<"portrait" | "landscape">("portrait");
	const [quality, setQuality] = useState<"720p" | "360p">("720p");
	const [vmodel, setVmodel] = useState<"omni" | "veo">("omni");
	// edit / upscale
	const [source, setSource] = useState<string[]>([]);
	const [scale, setScale] = useState<"2k" | "4k">("2k");
	// run
	const [busy, setBusy] = useState(false);
	const [secs, setSecs] = useState(0);
	const [error, setError] = useState("");
	const [done, setDone] = useState<string[]>([]);

	useEffect(() => {
		let alive = true;
		const load = () => getFlowStatus().then((s) => alive && setStatus(s));
		load();
		const id = setInterval(load, 15_000);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, []);

	// asset-card actions open the panel in the right mode
	useEffect(() => {
		if (!draft) return;
		setTab(draft.tab);
		if (draft.mode) setMode(draft.mode);
		if (draft.from) setFrom([draft.from]);
		if (draft.source) setSource([draft.source]);
		if (draft.addRef) {
			if (draft.tab === "video") setMode("refs");
			setRefs((r) =>
				r.includes(draft.addRef as string)
					? r
					: [...r, draft.addRef as string].slice(-3),
			);
		}
		setError("");
		setDone([]);
		box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, [draft]);

	useEffect(() => {
		if (!busy) return;
		const t0 = Date.now();
		const id = setInterval(
			() => setSecs(Math.round((Date.now() - t0) / 1000)),
			1000,
		);
		return () => clearInterval(id);
	}, [busy]);

	const autoName =
		tab === "upscale"
			? `${source[0] ?? "imagen"}-${scale}`
			: tab === "edit"
				? `${source[0] ?? "imagen"}-edit`
				: slug(prompt) || (tab === "video" ? "clip" : "imagen");
	const finalName = nameTouched && name ? name : autoName;

	const run = async () => {
		setBusy(true);
		setSecs(0);
		setError("");
		setDone([]);
		try {
			const base = { project, name: finalName, prompt };
			const r =
				tab === "image"
					? await flowGenerate({
							data: {
								...base,
								kind: "image",
								opts: { model, shape, count, refs },
							},
						})
					: tab === "video"
						? await flowGenerate({
								data: {
									...base,
									kind: "video",
									opts: {
										mode,
										from: from[0],
										to: to[0],
										refs,
										duration,
										shape: vshape,
										quality,
										model: vmodel,
									},
								},
							})
						: tab === "edit"
							? await flowEdit({
									data: { ...base, source: source[0], opts: { model, refs } },
								})
							: await flowUpscale({
									data: {
										project,
										name: finalName,
										source: source[0],
										opts: { quality: scale },
									},
								});
			setDone(r.assets);
			setNameTouched(false);
			setName("");
			router.invalidate();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const ready = status?.running && status.connected && !status.cooldown;
	const canRun =
		!busy &&
		ready &&
		(tab === "upscale"
			? !!source.length
			: prompt.trim().length >= 3 &&
				(tab !== "edit" || !!source.length) &&
				(tab !== "video" || mode !== "frames" || !!from.length) &&
				(tab !== "video" || mode !== "refs" || !!refs.length));

	return (
		<section ref={box} className="rounded-xl border bg-card p-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="flex items-center gap-2 font-semibold">
						<Sparkles className="size-4 text-accent" aria-hidden /> Crear con
						Google Flow
					</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">
						Imágenes (Nano Banana) y videos (Omni Flash / Veo) con tu cuenta de
						Flow. Lo que generes queda en la biblioteca del proyecto.
					</p>
				</div>
				<span
					className={cn(
						"inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
						ready
							? "bg-accent/15 text-accent"
							: status?.running
								? "bg-amber-300/15 text-amber-200"
								: "bg-red-400/15 text-red-300",
					)}
				>
					<span
						className={cn(
							"size-1.5 rounded-full",
							ready
								? "bg-accent"
								: status?.running
									? "bg-amber-300"
									: "bg-red-400",
						)}
					/>
					{!status
						? "Comprobando…"
						: !status.running
							? "flowkit no está corriendo"
							: !status.connected
								? "Extensión desconectada"
								: status.cooldown
									? `En pausa ${status.cooldown}s`
									: "Conectado"}
				</span>
			</div>
			{status && !ready && (
				<p className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
					{!status.running ? (
						<>
							Arranca flowkit en una terminal de WSL:{" "}
							<code className="font-mono">
								~/tools/flowkit/start-flowkit.sh
							</code>
						</>
					) : !status.connected ? (
						"Abre https://flow.google.com en Chrome (con la extensión Flow Kit activa) y entra a un proyecto."
					) : (
						"Google marcó actividad inusual; flowkit espera antes de volver a generar."
					)}
				</p>
			)}

			<div className="mt-4 flex flex-wrap gap-2">
				{TABS.map(([t, l, Icon]) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={cn(
							"inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
							tab === t
								? "border-accent/60 bg-accent/10 text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<Icon className="size-4" aria-hidden /> {l}
					</button>
				))}
			</div>

			<div className="mt-4 grid gap-4">
				{(tab === "edit" || tab === "upscale") && (
					<Pick label={tab === "edit" ? "Imagen a editar" : "Imagen a escalar"}>
						<AssetPicker
							project={project}
							images={images}
							value={source}
							onChange={setSource}
						/>
					</Pick>
				)}
				{tab === "video" && (
					<Pick label="Punto de partida">
						<Seg
							value={mode}
							onChange={setMode}
							options={[
								["text", "Solo texto"],
								["frames", "Animar una imagen"],
								["refs", "Con referencias (personaje, producto, logo)"],
							]}
						/>
					</Pick>
				)}
				{tab === "video" && mode === "frames" && (
					<>
						<Pick label="Imagen inicial">
							<AssetPicker
								project={project}
								images={images}
								value={from}
								onChange={setFrom}
							/>
						</Pick>
						<Pick label="Imagen final (opcional)">
							<AssetPicker
								project={project}
								images={images}
								value={to}
								onChange={setTo}
							/>
						</Pick>
					</>
				)}
				{((tab === "video" && mode === "refs") ||
					tab === "image" ||
					tab === "edit") && (
					<Pick
						label={
							tab === "video"
								? "Referencias (hasta 3)"
								: "Referencias (opcional, hasta 5)"
						}
					>
						<AssetPicker
							project={project}
							images={images}
							value={refs}
							onChange={setRefs}
							max={tab === "video" ? 3 : 5}
						/>
					</Pick>
				)}
				{tab !== "upscale" && (
					<Pick
						label={
							tab === "edit"
								? "¿Qué quieres cambiar?"
								: tab === "video"
									? "Describe el clip (acción, cámara, luz)"
									: "Describe la imagen"
						}
					>
						<textarea
							className={`${field} min-h-24`}
							value={prompt}
							maxLength={2000}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder={
								tab === "video"
									? "Plano vertical, una recepcionista sonríe al leer un mensaje en su celular, luz natural suave, clínica blanca con azul claro, sin texto"
									: tab === "edit"
										? "La misma escena de noche, con lámparas cálidas encendidas"
										: "Recepción de clínica estética moderna, escritorio blanco, luz natural, acentos azul claro, foto realista, sin texto"
							}
						/>
					</Pick>
				)}

				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{(tab === "image" || tab === "edit") && (
						<Pick label="Modelo">
							<select
								className={field}
								value={model}
								onChange={(e) => setModel(e.target.value as typeof model)}
							>
								<option value="pro">Nano Banana Pro</option>
								<option value="nb2">Nano Banana 2</option>
								<option value="lite">Nano Banana 2 Lite</option>
							</select>
						</Pick>
					)}
					{tab === "image" && (
						<>
							<Pick label="Formato">
								<select
									className={field}
									value={shape}
									onChange={(e) => setShape(e.target.value as typeof shape)}
								>
									<option value="portrait">Vertical 9:16</option>
									<option value="landscape">Horizontal 16:9</option>
									<option value="square">Cuadrado 1:1</option>
									<option value="3:4">Retrato 3:4</option>
									<option value="4:3">Paisaje 4:3</option>
								</select>
							</Pick>
							<Pick label="Variantes">
								<Seg
									value={String(count) as "1"}
									onChange={(v) => setCount(Number(v))}
									options={["1", "2", "3", "4"].map((n) => [n as "1", n])}
								/>
							</Pick>
						</>
					)}
					{tab === "video" && (
						<>
							<Pick label="Duración">
								<Seg
									value={String(duration) as "6"}
									onChange={(v) => setDuration(Number(v))}
									options={["4", "6", "8", "10"].map((n) => [
										n as "6",
										`${n} s`,
									])}
								/>
							</Pick>
							<Pick label="Formato">
								<Seg
									value={vshape}
									onChange={setVshape}
									options={[
										["portrait", "Vertical"],
										["landscape", "Horizontal"],
									]}
								/>
							</Pick>
							<Pick label="Calidad">
								<Seg
									value={quality}
									onChange={setQuality}
									options={[
										["720p", "720p"],
										["360p", "360p"],
									]}
								/>
							</Pick>
							{mode === "frames" && (
								<Pick label="Modelo">
									<Seg
										value={vmodel}
										onChange={setVmodel}
										options={[
											["omni", "Omni Flash"],
											["veo", "Veo 3.1"],
										]}
									/>
								</Pick>
							)}
						</>
					)}
					{tab === "upscale" && (
						<Pick label="Resolución">
							<Seg
								value={scale}
								onChange={setScale}
								options={[
									["2k", "2K"],
									["4k", "4K (según plan)"],
								]}
							/>
						</Pick>
					)}
					<Pick label="Nombre del asset">
						<input
							className={`${field} font-mono`}
							value={nameTouched ? name : autoName}
							onChange={(e) => {
								setNameTouched(true);
								setName(slug(e.target.value) || e.target.value.toLowerCase());
							}}
						/>
					</Pick>
				</div>

				{error && (
					<p className="flex items-start gap-2 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200">
						<X className="mt-0.5 size-4 shrink-0" aria-hidden />{" "}
						{error.slice(0, 500)}
					</p>
				)}
				{done.length > 0 && (
					<p className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
						<Check className="size-4 text-accent" aria-hidden /> Listo:{" "}
						{done.join(", ")} ya está en la biblioteca.
					</p>
				)}
				<div className="flex items-center justify-end gap-3">
					{busy && (
						<span className="text-sm text-muted-foreground">
							Generando en Google Flow… {secs}s{" "}
							{tab === "video" ? "(un clip tarda ~30–90 s)" : ""}
						</span>
					)}
					<button
						type="button"
						onClick={run}
						disabled={!canRun}
						className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
					>
						{busy ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : (
							<Sparkles className="size-4" aria-hidden />
						)}
						{tab === "upscale"
							? "Escalar"
							: tab === "edit"
								? "Editar"
								: "Generar"}
					</button>
				</div>
			</div>
		</section>
	);
}
