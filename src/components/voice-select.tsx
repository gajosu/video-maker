import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "#/lib/utils";

const field =
	"w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-white/40";

export type AccountVoice = { id: string; name: string; kind: string };

/** an account voice, or a library voice pasted as owner/id ("" = the project's voice) */
export function VoiceSelect({
	value,
	onChange,
	voices,
	projectVoice,
	emptyLabel,
	compact,
}: {
	value: string;
	onChange: (v: string) => void;
	voices: AccountVoice[];
	projectVoice: string;
	/** label for "" (default: the project's voice) */
	emptyLabel?: string;
	compact?: boolean;
}) {
	const [library, setLibrary] = useState(value.includes("/") ? value : "");
	const projectVoiceName =
		voices.find((v) => v.id === projectVoice)?.name ?? "voz del proyecto";
	return (
		<div className={cn("grid gap-1.5", !compact && "sm:grid-cols-2 sm:gap-3")}>
			<select
				className={field}
				value={value.includes("/") ? "" : value}
				disabled={!!library}
				onChange={(e) => onChange(e.target.value)}
				aria-label="Voz"
			>
				<option value="">
					{emptyLabel ?? `Voz del proyecto (${projectVoiceName})`}
				</option>
				{voices
					.filter((v) => v.id !== projectVoice)
					.map((v) => (
						<option key={v.id} value={v.id}>
							{v.name}
							{v.kind === "premade" ? "" : ` · ${v.kind}`}
						</option>
					))}
			</select>
			<input
				className={field}
				value={library}
				onChange={(e) => {
					setLibrary(e.target.value);
					onChange(e.target.value.match(/(\w+\/\w+)/)?.[1] ?? "");
				}}
				placeholder="o pega owner/id de la biblioteca"
				title="Lo que copia «Elegir» en la página Voces"
			/>
			{!compact && (
				<span className="text-xs text-muted-foreground sm:col-span-2">
					Escucha y elige voces en{" "}
					<Link to="/voices" target="_blank" className="underline">
						Voces
					</Link>
					.
				</span>
			)}
		</div>
	);
}
