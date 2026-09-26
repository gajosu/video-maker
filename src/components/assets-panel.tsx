import { useRouter } from "@tanstack/react-router";
import {
	ImageIcon,
	Maximize2,
	Music,
	Pencil,
	Plus,
	Sparkles,
	Upload,
	Video,
	Volume2,
} from "lucide-react";
import { useState } from "react";
import { AssetUpload } from "#/components/asset-upload";
import { type FlowDraft, FlowPanel } from "#/components/flow-panel";
import { Cmd, Empty } from "#/components/ui";
import { fileUrl } from "#/lib/format";
import { cn } from "#/lib/utils";
import type { Asset, AssetRequest, Manifest } from "../../cli/lib/assets.ts";

const KINDS = [
	{ kind: "image", label: "Images", icon: ImageIcon },
	{ kind: "video", label: "Video", icon: Video },
	{ kind: "sfx", label: "Sound effects", icon: Volume2 },
	{ kind: "music", label: "Music", icon: Music },
] as const;

export function AssetsPanel({
	project,
	manifest,
}: {
	project: string;
	manifest: Manifest;
}) {
	const open = manifest.requests.filter((r) => r.status === "open");
	const assets = Object.values(manifest.assets);
	const images = assets.filter((a) => a.kind === "image");
	const [draft, setDraft] = useState<FlowDraft | null>(null);
	const act = (d: Omit<FlowDraft, "nonce">) =>
		setDraft({ ...d, nonce: Date.now() });
	if (!assets.length && !open.length)
		return (
			<div className="space-y-8">
				<FlowPanel project={project} images={images} draft={draft} />
				<AssetUpload project={project} />
				<Empty title="No assets yet">
					<p>
						Search stock: <Cmd>bun vk asset search {project} coffee</Cmd>
					</p>
					<p className="mt-2">
						Ask for a screenshot:{" "}
						<Cmd>
							bun vk asset request {project} app-home "Home screen, light mode"
						</Cmd>
					</p>
				</Empty>
			</div>
		);
	return (
		<div className="space-y-8">
			<FlowPanel project={project} images={images} draft={draft} />
			<AssetUpload project={project} />
			{open.length > 0 && (
				<section>
					<h2 className="font-semibold">Requested from you</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Scenes show a placeholder until you upload these. Real screenshots
						and recordings from your phone work best.
					</p>
					<ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{open.map((r) => (
							<RequestCard key={r.id} project={project} req={r} />
						))}
					</ul>
				</section>
			)}
			{KINDS.map(({ kind, label, icon: Icon }) => {
				const list = assets.filter((a) => a.kind === kind);
				if (!list.length) return null;
				return (
					<section key={kind}>
						<h2 className="flex items-center gap-2 font-semibold">
							<Icon className="size-4 text-muted-foreground" aria-hidden />
							{label}
							<span className="text-sm font-normal text-muted-foreground tabular">
								{list.length}
							</span>
						</h2>
						<ul
							className={cn(
								"mt-4 grid gap-4",
								kind === "image" || kind === "video"
									? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6"
									: "sm:grid-cols-2 xl:grid-cols-3",
							)}
						>
							{list.map((a) => (
								<AssetCard key={a.name} project={project} asset={a} act={act} />
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

function Meta({ a }: { a: Asset }) {
	const landing = "landing" in a.source ? a.source.landing : undefined;
	return (
		<div className="mt-2 min-w-0 text-xs">
			<div className="truncate font-mono text-sm text-foreground">{a.name}</div>
			{a.description && (
				<div
					className="line-clamp-2 text-muted-foreground"
					title={a.description}
				>
					{a.description}
				</div>
			)}
			<div className="truncate text-muted-foreground">
				{[
					a.width ? `${a.width}×${a.height}` : "",
					a.duration ? `${a.duration}s` : "",
					a.source.type,
				]
					.filter(Boolean)
					.join(" · ")}
			</div>
			<div className="truncate text-muted-foreground">
				{landing ? (
					<a
						href={landing}
						target="_blank"
						rel="noreferrer"
						className="hover:text-foreground hover:underline"
					>
						{a.license ?? "?"}
						{a.credit ? ` · ${a.credit}` : ""}
					</a>
				) : (
					<>
						{a.license ?? "license unknown"}
						{a.credit ? ` · ${a.credit}` : ""}
					</>
				)}
			</div>
		</div>
	);
}

const ACTIONS: [
	string,
	typeof Sparkles,
	(n: string) => Omit<FlowDraft, "nonce">,
][] = [
	["Animar", Sparkles, (n) => ({ tab: "video", mode: "frames", from: n })],
	["Editar", Pencil, (n) => ({ tab: "edit", source: n })],
	["2K / 4K", Maximize2, (n) => ({ tab: "upscale", source: n })],
	["Referencia", Plus, (n) => ({ tab: "image", addRef: n })],
];

function AssetCard({
	project,
	asset: a,
	act,
}: {
	project: string;
	asset: Asset;
	act: (d: Omit<FlowDraft, "nonce">) => void;
}) {
	const url = fileUrl(project, `assets/${a.file}`);
	if (a.kind === "image" || a.kind === "video")
		return (
			<li>
				<div
					className={cn(
						"group relative aspect-[9/16] overflow-hidden rounded-xl border",
						a.kind === "image" ? "checker" : "bg-muted",
					)}
				>
					{a.kind === "image" && (
						<div className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-2 gap-1 bg-gradient-to-t from-black/85 to-transparent p-2 pt-8 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
							{ACTIONS.map(([label, Icon, mk]) => (
								<button
									key={label}
									type="button"
									onClick={() => act(mk(a.name))}
									className="inline-flex items-center justify-center gap-1 rounded-md bg-white/15 px-1.5 py-1 text-[11px] font-medium text-white hover:bg-white/25"
								>
									<Icon className="size-3" aria-hidden /> {label}
								</button>
							))}
						</div>
					)}
					{a.kind === "image" ? (
						<img
							src={url}
							alt={a.name}
							loading="lazy"
							className="size-full object-contain"
						/>
					) : (
						<video
							src={url}
							muted
							loop
							playsInline
							className="size-full object-cover"
							onMouseEnter={(e) => e.currentTarget.play()}
						/>
					)}
				</div>
				<Meta a={a} />
			</li>
		);
	return (
		<li className="rounded-xl border bg-card p-3">
			{/* biome-ignore lint/a11y/useMediaCaption: sound effect preview */}
			<audio src={url} controls preload="none" className="h-9 w-full" />
			<Meta a={a} />
		</li>
	);
}

function RequestCard({ project, req }: { project: string; req: AssetRequest }) {
	const router = useRouter();
	const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
	const [error, setError] = useState("");
	const accept =
		req.kind === "video"
			? "video/*"
			: req.kind === "sfx" || req.kind === "music"
				? "audio/*"
				: "image/*";

	const upload = async (file: File) => {
		setState("uploading");
		const body = new FormData();
		body.set("file", file);
		const res = await fetch(`/api/upload/${project}/${req.name}`, {
			method: "POST",
			body,
		});
		if (res.ok) {
			setState("idle");
			router.invalidate();
		} else {
			setState("error");
			setError(
				((await res.json().catch(() => ({}))) as { error?: string }).error ??
					`HTTP ${res.status}`,
			);
		}
	};

	return (
		<li>
			<label
				className={cn(
					"flex h-full cursor-pointer flex-col rounded-xl border border-dashed p-4 transition-colors hover:border-accent/60 hover:bg-accent/5",
					state === "uploading" && "pointer-events-none opacity-60",
				)}
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => {
					e.preventDefault();
					const f = e.dataTransfer.files[0];
					if (f) upload(f);
				}}
			>
				<span className="flex items-center gap-2 font-mono text-sm">
					<Upload className="size-4 text-accent" aria-hidden />
					{req.name}
				</span>
				<span className="mt-2 text-sm">{req.description}</span>
				<span className="mt-auto pt-3 text-xs text-muted-foreground">
					{req.kind}
					{req.size ? ` · ${req.size}` : ""}
					{req.video ? ` · for ${req.video}` : ""} ·{" "}
					{state === "uploading" ? "uploading…" : "drop a file or click"}
				</span>
				{state === "error" && (
					<span className="mt-2 text-xs text-destructive">{error}</span>
				)}
				<input
					type="file"
					accept={accept}
					className="sr-only"
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) upload(f);
					}}
				/>
			</label>
		</li>
	);
}
