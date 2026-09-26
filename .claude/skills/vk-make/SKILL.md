---
name: vk-make
description: Make a complete vertical video end to end with video-kit in any style (punchy, motion graphics, storytelling, Vox-style explainer, dev tools): idea → script → ElevenLabs voice → assets → animated scenes → visual review → final MP4, for a given project ("make a video for Fonealo about the loyalty cards", "new Hyppe reel about X", "render it"). Orchestrates the vk-script, vk-assets, vk-scenes and vk-learn skills.
---

# vk-make: idea to MP4

Everything runs from the terminal. The web app (`bun run dev`, http://localhost:3000) is only a preview.

## 0. Preconditions
- `bun vk list`: pick the project. If it doesn't exist, run the **vk-project** skill first.
- `ffmpeg` installed and Playwright Chromium present (`bunx playwright install chromium`).
- `ELEVENLABS_API_KEY` in `.env` and `voice.voiceId` set in project.json (`bun vk voices`). Without a key you can still voice externally and use `bun vk cues <p> <v> --audio file.mp3`.

## 1. Script
`bun vk new <p> <slug> --title "..."`, then follow the **vk-script** skill. Show the user the lines and wait for an OK before spending TTS credits.

## 2. Voice
**Always let the user pick the voice for each video before spending TTS credits.** Show a shortlist of 6–8 voices from the public library in the project's language and accent, mixing genders and styles that fit the script (for Latin American Spanish: `bun vk voices --latam --use advertisement|conversational|social_media [--accent mexican|colombian|…] [--gender …]`), with each voice's name, accent, gender, one-line description and preview link, plus the project's current voice as the default. Ask which one (AskUserQuestion). Then `bun vk voices add <owner>/<voiceId>` and set `voice: <id>` in the video's script.md front matter (project.json `voice.voiceId` stays the default).
The user can also browse and listen at `http://localhost:3000/voices`. **Free ElevenLabs plans can't use library voices through the API** (402 `paid_plan_required`; `bun vk voices add` checks the tier first). On a free plan, say so, offer the account's own voices (`bun vk voices`), and let the user decide whether to upgrade.
`bun vk voice <p> <v>` → `vo.mp3` + `cues.json` (per-line timing from ElevenLabs character timestamps, `{#marks}` → `kw`).
Check the printed timings: lines should be in order with short gaps. If the pacing is slow, `bun vk tighten <p> <v> --max-gap 0.25` (keeps line timings and `{#marks}`; run it once per voicing).
If a word is mispronounced, respell it in script.md (e.g. "énfo" → "info") and voice again.

## 3. Assets
Make the shot list and source everything with the **vk-assets** skill: request real screenshots/recordings from the user early (they can upload while you work), render mock screens from HTML, search/pick stock, add sound effects. Placeholders keep the pipeline moving.

## 4. Scenes
Follow the **vk-scenes** skill in the video's style: write scenes.js, `bun vk check`, render stills, look at them, fix.
Music: a style preset, a music asset, or Sonic Pi code composed to the edit (`music: sonicpi`, `bun vk music <p> <v>`; see `engine/README.md` Audio). Write the Sonic Pi file after the scenes, since it reads their SFX events.
`bun vk mix <p> <v>` renders just the audio (music + SFX + voice) so the preview player can play the full mix before the final render.

## 5. Render
`bun vk render <p> <v>` (add `--dark` / `--light` to override the theme) → `projects/<p>/videos/<v>/out/<v>.mp4`
(1080×1920, 30 fps, H.264 + AAC, loudness-normalized to the project's LUFS). About 1–2 s per second of video.
Verify with `ffprobe`, then give the user the path and the preview URL `http://localhost:3000/p/<p>/v/<v>` (Render tab).
If licensed stock was used, include `bun vk asset credits <p> <v>` output for the post caption.

## 6. Learn
Ask the user what they think (or later, how it performed). Save lessons with the **vk-learn** skill into `learnings.md`.
