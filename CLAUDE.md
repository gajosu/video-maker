# video-kit

Punchy vertical videos (Reels/TikTok/Shorts) from a script: ElevenLabs voice → HTML scenes → Playwright frames → ffmpeg.
**Everything runs in the terminal** (`bun vk …` + skills). The TanStack Start app in `src/` is a preview, plus a voice browser (`/voices`) and a "Nuevo video" page (`/studio`) that drives Claude Code headless.

## Layout
- `engine/`: page runtime (`primitives.js`, `timeline.js`, `base.css`, `styles/{motion,story,vox,dev,anthem}.js`). Scene/asset/audio API reference: `engine/README.md`.
- `cli/`: `bun vk <cmd>` (`cli/index.ts`), libs in `cli/lib/` (page builder, render, audio mix + music presets, cues, ElevenLabs, assets manifest, stock search, generators incl. Google Flow video via a local flowkit agent in `flow.ts`, styles registry). Must stay Node-compatible (the web app imports `cli/lib/project.ts` and `page.ts`).
- `projects/<slug>/`: `project.json` (`fontFiles` loads brand fonts from `assets/`), `knowledge/*.md`, `scenes/*.js` (shared), `assets/` (manifest.json + files by kind), `videos/<v>/{script.md, scenes.js, cues.json, vo.mp3, out/, stills/, build/}`.
  Only `projects/_example` is committed; all other projects are gitignored (private). `VK_PROJECTS_DIR` moves them elsewhere.
- `src/`: preview UI. `src/server/vk.ts` (server fns), `src/server/static.ts` (file serving, also used by the Vite dev middleware in `vite.config.ts`).
- `src/routes/api/upload.$project.$name.ts`: fulfils open asset requests.
- Assets tab: "Crear con Google Flow" panel (`src/components/flow-panel.tsx`, `src/server/flow.ts`) generates images/videos, edits and upscales through flowkit, with card actions (animar, editar, 2K, referencia).
- `/voices` (`src/server/voices.ts`): browse the public ElevenLabs library (Latin American Spanish), previews, test a voice with your text (paid plans only).
- `/studio` (`src/server/studio.ts`, `studio-runner.ts`): "Nuevo video" form that runs Claude Code headless (`claude -p`, stream-json, restricted `--allowedTools`) through vk-make with two checkpoints (script approval + voice) and a change-request chat. Job state/log in `projects/<p>/jobs/<video>/`. One job at a time; localhost only. The video preview page has a Chat tab (`src/components/studio-chat.tsx`) that edits any video the same way (terminal-made videos get a job record on first message).
- `tools/flowkit/`: flowkit clone + venv (gitignored, pinned in `scripts/setup.sh`); `tools/start-flowkit.sh` reads `FLOW_PROJECT_ID` from `.env`.
- `.claude/skills/`: `vk-project`, `vk-learn`, `vk-script`, `vk-assets`, `vk-scenes`, `vk-make`.

## Commands
- `bun vk help`, then `list`, `init`, `new`, `kb`, `voices`, `voice`, `cues`, `tighten`, `check`, `styles`, `asset …`, `music` (Sonic Pi), `mix`, `stills`, `render`
- `bun run setup` (new machine: tools check, deps, Chromium, .env, flowkit in `tools/flowkit/`), `bun run flowkit` (start the Google Flow agent)
- `bun run dev` (preview on :3000, hot-reloads on project changes), `bunx tsc --noEmit`, `bun run check` (Biome)

## Rules
- Scripts only state facts from the project's knowledge base.
- `script.md` `## Lines` count == `LINES.length` == `cues.L.length`. Run `bun vk check` after edits.
- Look at stills before calling a scene done.
- Assets are referenced by name and must carry source + license in the manifest; prefer real user assets (request them) over fakes.
- Never commit `.env`, project data or media.
