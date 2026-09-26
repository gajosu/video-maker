#!/usr/bin/env bash
# video-kit setup for a fresh machine (Linux or WSL on Windows): `bun run setup`. Safe to re-run.
# Checks system tools, installs JS deps + Chromium, creates .env, installs flowkit (Google Flow agent)
# at a pinned, reviewed commit with its own Python venv, and copies its Chrome extension to Windows (WSL).
set -u
cd "$(dirname "$0")/.." || exit 1

FLOWKIT_REPO="https://github.com/crisng95/flowkit.git"
FLOWKIT_REF="${FLOWKIT_REF:-cd9f156}" # reviewed version; bump it deliberately after reviewing the new code

ok() { printf '  \033[32mok\033[0m     %s\n' "$1"; }
warn() { printf '  \033[33maviso\033[0m  %s\n' "$1"; }
miss() {
	printf '  \033[31mfalta\033[0m  %s\n' "$1"
	MISSING=1
}
MISSING=0

echo "video-kit · instalación"
echo
echo "1. Herramientas del sistema"
command -v bun >/dev/null && ok "bun $(bun --version)" || miss "bun → curl -fsSL https://bun.sh/install | bash"
command -v git >/dev/null && ok "git" || miss "git → sudo apt-get install -y git"
command -v ffmpeg >/dev/null && ok "ffmpeg" || miss "ffmpeg → sudo apt-get install -y ffmpeg"
command -v python3 >/dev/null && ok "python3 $(python3 -V 2>&1 | cut -d' ' -f2)" || miss "python3 → sudo apt-get install -y python3"
python3 -c "import ensurepip, venv" >/dev/null 2>&1 && ok "python3-venv" || miss "python3-venv → sudo apt-get install -y python3-venv"
command -v claude >/dev/null && ok "Claude Code CLI (página «Nuevo video» y chat)" || warn "Claude Code CLI no encontrado: la página «Nuevo video» y el chat lo necesitan (https://claude.com/claude-code, luego «claude» para iniciar sesión)"
if [ "$MISSING" = 1 ]; then
	echo
	echo "Instala lo que falta y vuelve a correr:  bun run setup"
	exit 1
fi

echo
echo "2. Dependencias y navegador para el render"
bun install --silent && ok "dependencias (bun install)"
bunx playwright install chromium >/dev/null 2>&1 && ok "Chromium de Playwright"
if bun -e 'import { chromium } from "playwright"; const b = await chromium.launch(); await b.close();' >/dev/null 2>&1; then
	ok "Chromium arranca"
else
	warn "Chromium no arranca (faltan librerías del sistema) → sudo bunx playwright install-deps chromium"
fi

echo
echo "3. Configuración (.env)"
if [ ! -f .env ]; then
	cp .env.example .env
	warn ".env creado desde .env.example: complétalo (no se copia entre máquinas, tiene tus claves)"
fi
has() { grep -qE "^$1=.+" .env; }
has ELEVENLABS_API_KEY && ok "ELEVENLABS_API_KEY" || warn "ELEVENLABS_API_KEY vacío (voz)"
has PEXELS_API_KEY && ok "PEXELS_API_KEY" || warn "PEXELS_API_KEY vacío (clips de stock; opcional)"
has OPENAI_API_KEY && ok "OPENAI_API_KEY" || warn "OPENAI_API_KEY vacío (imágenes con OpenAI; opcional)"

echo
echo "4. flowkit (Google Flow)"
if [ ! -d tools/flowkit/.git ]; then
	git clone -q "$FLOWKIT_REPO" tools/flowkit && ok "flowkit clonado"
fi
if git -C tools/flowkit cat-file -e "$FLOWKIT_REF^{commit}" 2>/dev/null || git -C tools/flowkit fetch -q origin 2>/dev/null; then
	git -C tools/flowkit -c advice.detachedHead=false checkout -q "$FLOWKIT_REF" && ok "flowkit en la versión revisada ($FLOWKIT_REF)"
else
	warn "no pude fijar flowkit en $FLOWKIT_REF"
fi
if ! tools/flowkit/venv/bin/python -c "import sys" >/dev/null 2>&1; then
	rm -rf tools/flowkit/venv
	python3 -m venv tools/flowkit/venv && ok "entorno de Python creado"
fi
tools/flowkit/venv/bin/pip install -q --disable-pip-version-check -r tools/flowkit/requirements.txt && ok "dependencias de flowkit"
has FLOW_PROJECT_ID && ok "FLOW_PROJECT_ID" || warn "FLOW_PROJECT_ID vacío en .env: crea un proyecto en https://flow.google.com y copia el uuid de su URL"
if grep -qi microsoft /proc/version 2>/dev/null && [ -d /mnt/c/Users ]; then
	WINUSER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
	if [ -n "$WINUSER" ] && [ -d "/mnt/c/Users/$WINUSER" ]; then
		rm -rf "/mnt/c/Users/$WINUSER/flowkit-extension"
		cp -r tools/flowkit/extension "/mnt/c/Users/$WINUSER/flowkit-extension"
		ok "extensión copiada a C:\\Users\\$WINUSER\\flowkit-extension"
		EXT="C:\\Users\\$WINUSER\\flowkit-extension"
	fi
fi
EXT="${EXT:-$(pwd)/tools/flowkit/extension}"

echo
echo "Listo. Para usar Google Flow:"
echo "  1. Chrome → chrome://extensions → Modo de desarrollador → «Cargar extensión sin empaquetar» → $EXT"
echo "  2. Abre https://flow.google.com con tu cuenta y entra a un proyecto (su uuid va en FLOW_PROJECT_ID)"
echo "  3. bun run flowkit   (déjalo corriendo)"
echo "  4. bun run dev       → http://localhost:3000"
