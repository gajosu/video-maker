export const STATUS_ES: Record<string, [string, string]> = {
	working: ["Trabajando…", "bg-sky-400"],
	review: ["Esperando tu aprobación", "bg-amber-300"],
	done: ["Listo", "bg-accent"],
	error: ["Se detuvo", "bg-red-400"],
	cancelled: ["Cancelado", "bg-zinc-500"],
};

export const PHASE_ES: Record<string, string> = {
	script: "Escribiendo el guion",
	"script-changes": "Ajustando el guion",
	build: "Creando el video",
	change: "Aplicando tus cambios",
};
