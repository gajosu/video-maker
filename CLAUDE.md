# video-kit

Punchy vertical videos (Reels/TikTok/Shorts) from a script: ElevenLabs voice → HTML scenes → Playwright frames → ffmpeg.
**Everything runs in the terminal** (`bun vk …` + skills). The TanStack Start app in `src/` is a preview, plus a voice browser (`/voices`) and a "Nuevo video" page (`/studio`) that drives Claude Code headless.

## Layout
- `engine/`: page runtime (`primitives.js`, `timeline.js`, `base.css`, `styles/{motion,story,vox,dev,anthem}.js`). Scene/asset/audio API reference: `engine/README.md`.
- `cli/`: `bun vk <cmd>` (`cli/index.ts`), libs in `cli/lib/` (page builder, render, audio mix + music presets, cues, ElevenLabs, assets manifest, stock search, generators incl. Google Flow video via a local flowkit agent in `flow.ts`, styles registry). Must stay Node-compatible (the web app imports `cli/lib/project.ts` and `page.ts`).
- `projects/<slug>/`: `project.json` (`fontFiles` loads brand fonts from `assets/`), `knowledge/*.md`, `scenes/*.js` (shared), `assets/` (manifest.json + files by kind), `references/<name>/` (reference videos + analysis from `bun vk ref`, `cli/lib/refs.ts`), `videos/<v>/{script.md, scenes.js, cues.json, vo.mp3, out/, stills/, build/}`.
  Only `projects/_example` is committed; all other projects are gitignored (private). `VK_PROJECTS_DIR` moves them elsewhere.
- `src/`: preview UI. `src/server/vk.ts` (server fns), `src/server/static.ts` (file serving, also used by the Vite dev middleware in `vite.config.ts`).
- `src/routes/api/upload.$project.$name.ts`: fulfils open asset requests.
- Assets tab: "Crear con Google Flow" panel (`src/components/flow-panel.tsx`, `src/server/flow.ts`) generates images/videos, edits and upscales through flowkit, with card actions (animar, editar, 2K, referencia).
- `/voices` (`src/server/voices.ts`): browse the public ElevenLabs library (Latin American Spanish), previews, test a voice with your text (paid plans only).
- `/studio` (`src/server/studio.ts`, `studio-runner.ts`): "Nuevo video" form that runs Claude Code headless (`claude -p`, stream-json, restricted `--allowedTools`) through vk-make with two checkpoints (script approval + voice) and a change-request chat. Job state/log in `projects/<p>/jobs/<video>/`. Up to `VK_STUDIO_MAX_JOBS` (default 3) videos build in parallel, each its own session on `VK_CLAUDE_MODEL` (default `claude-opus-5-5`); Google Flow generations and manifest writes are serialized across processes (`cli/lib/lock.ts`). Chat messages sent while a job works are queued in `inbox.jsonl` and delivered mid-turn by the `cli/hooks/studio-inbox.ts` hook (PostToolUse + Stop, passed with `--settings`). Localhost only. The video preview page has a Chat tab (`src/components/studio-chat.tsx`) that edits any video the same way (terminal-made videos get a job record on first message).
- Global chat (`src/components/global-chat.tsx`): on a video page it talks to that video's job; elsewhere to the project session (`src/server/project-setup.ts`), the "director" that edits brand/knowledge and plans **batches** (skill `vk-batch`, `bun vk batch`, `cli/lib/batch.ts`, `projects/<p>/batches/<id>/batch.json`). Tabs Chat | Trabajos, badge with videos in progress. Batch panel: `/studio/batch/$project/$batch` (`src/routes/studio.batch.$project.$batch.tsx`, `src/server/batch.ts`): edit a draft, launch, approve scripts one by one or all, cancel. Every video of a batch is its own job and stops at its script.
- Sessions: `src/server/session.ts` runs every headless Claude (video jobs in `studio-runner.ts`, project chats in `project-setup.ts`); chat log + mid-turn queue in `cli/lib/inbox.ts`; inline media (assets, references, batches, stills, render) in `src/server/media.ts`. `studio-runner.ts` also holds the scheduler (`pump`, `queued` status); server-only studio logic lives in `src/server/studio-core.ts` (never export plain functions from server-function files: the client loads them as RPC stubs and would pull node code in).
- `tools/bin/yt-dlp`: downloader for `bun vk ref` (gitignored, installed/updated by `bun run setup`); cobalt (`COBALT_API_URL`) is the fallback.
- `tools/flowkit/`: flowkit clone + venv (gitignored, pinned in `scripts/setup.sh`); `tools/start-flowkit.sh` reads `FLOW_PROJECT_ID` from `.env`.
- `.claude/skills/`: `vk-project`, `vk-learn`, `vk-script`, `vk-assets`, `vk-ref`, `vk-batch`, `vk-scenes`, `vk-make`.

## Commands
- `bun vk help`, then `list`, `init`, `new`, `kb`, `voices`, `voice`, `cues`, `tighten`, `check`, `styles`, `asset …`, `ref …` (reference videos), `batch …` (batches for the web studio), `music` (Sonic Pi), `mix`, `stills`, `render`
- `bun run setup` (new machine: tools check, deps, Chromium, .env, yt-dlp in `tools/bin/`, flowkit in `tools/flowkit/`), `bun run flowkit` (start the Google Flow agent)
- `bun run dev` (preview on :3000, hot-reloads on project changes), `bunx tsc --noEmit`, `bun run check` (Biome)

## Rules
- Scripts only state facts from the project's knowledge base.
- `script.md` `## Lines` count == `LINES.length` == `cues.L.length`. Run `bun vk check` after edits.
- Look at stills before calling a scene done.
- Reference videos are study material only: never put their footage, audio, music or script in a video, never clone their voice.
- Assets are referenced by name and must carry source + license in the manifest; prefer real user assets (request them) over fakes.
- Never commit `.env`, project data or media.
