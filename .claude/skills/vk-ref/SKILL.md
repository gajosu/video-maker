---
name: vk-ref
description: Download a reference video (TikTok, Reels, Shorts, YouTube, X… with yt-dlp or cobalt, or a local file) and study it so a video-kit video can match its voice cadence, pacing, cut rhythm, hook, animations and graphic style, without copying it. Use when the user shares a video link or file as inspiration ("make it like this one", "copy the style of this Reel", "this voice pace", "analyze this TikTok"), or when a style decision would be easier to judge against a real example.
---

# vk-ref: learn from a reference video

A reference is **study material, never a source**: its footage, audio, music, voice and script never go into a
video. Take the rhythm, the structure and the visual language; write your own words from the knowledge base.

## 1. Get it
`bun vk ref add <p> <url|file> [--name short-name]` downloads (or copies a local video/audio file) into `projects/<p>/references/<name>/` and analyzes it.
- yt-dlp (`tools/bin/yt-dlp`, installed by `bun run setup`) covers TikTok, Instagram, YouTube/Shorts, X, Facebook, Vimeo and ~1800 sites. If a site needs a login (private or age-restricted posts, some Instagram links), the user can export cookies and set `VK_YTDLP_ARGS="--cookies /path/cookies.txt"` in `.env`.
- cobalt is the fallback when `COBALT_API_URL` (+ `COBALT_API_KEY`) is set (a self-hosted instance; the public cobalt.tools API needs a key). Force one with `--via yt-dlp|cobalt`.
- Longer than 15 min is refused (`--max-seconds` to change). Transcription is billed by ElevenLabs per minute: use `--no-transcribe` when only the look matters.
- If the download fails, ask the user to upload the file and run `bun vk ref add <p> <file>`.

## 2. Read the analysis
`bun vk ref show <p> <name>` prints `report.md`:
- **Format**: duration, size, orientation, fps.
- **Editing rhythm**: shot count, average/shortest/longest shot, change times (`~` = dissolve or big move, plain = hard cut), cuts in the first 3 s.
- **Palette**: dominant colors with screen share, plus saturated accents.
- **Audio**: loudness, level between words (music bed vs dry voice).
- **Voice and cadence** (ElevenLabs Scribe): language, first-word time, words/min, words/s while talking, pauses, phrases with times and word counts.

Then **look at the pictures** with Read (they are the point of the exercise):
- `hook.jpg`: first 3 s at 4 fps. How the hook enters: what is on screen at 0 s, what moves, when text lands.
- `shots.jpg`: one frame per shot in order: layout, framing, text treatment, recurring elements (progress bar, logo, frame).
- `timeline.jpg`: 24 evenly spaced frames, the whole arc (best for motion graphics, where cuts are not detected).
- `frames/*.jpg`: single frames when you need detail (a font, a sticker, a caption style).

Numbers are estimates: trust the pictures when they disagree (a big camera move can read as a cut).

## 3. Write a brief
Write `projects/<p>/references/<name>/brief.md` (short, concrete, in the user's language):
- **Hook**: first line and first visual, time to first word, how it grabs attention.
- **Structure**: beats with times (hook → problem → proof → CTA…), how it ends.
- **Voice**: tone, energy, gender/age impression, words/min → how to match it (see below).
- **Pacing**: average shot length, cuts per line, where it slows down.
- **Graphic style**: layout (full-bleed, framed b-roll, split), caption style (position, case, weight, highlight color, words per caption), typography, palette → brand mapping, recurring elements, transitions, animation feel (snappy pops, smooth pans, kinetic type, stickers).
- **Take / leave**: what fits this brand and what doesn't (brand colors and fonts always win over the reference's).

## 4. Apply it
- **Script** (vk-script): match the phrase length (`avgPhraseWords`), line count for the duration, hook shape and arc. Pick the `style:` closest to the reference.
- **Voice** (vk-make step 2): shortlist voices whose tone matches the reference. After voicing, measure yours with `bun vk ref add <p> projects/<p>/videos/<v>/vo.mp3 --name <v>-vo` (audio files work too) and compare words/min and pauses. Too slow: `bun vk tighten`, fewer words, or a higher `speed` in project.json `voice.settings` (0.7–1.2; ask before changing the project default). A reference voice is never cloned: `bun vk voices clone` is only for voices the user has the rights to.
- **Scenes** (vk-scenes): aim for the reference's shot length (one scene per 1–2 lines if it cuts every ~2 s), reuse its layout and caption logic in the brand's colors and fonts, and its transition types. After rendering, `bun vk ref add <p> projects/<p>/videos/<v>/out/<v>.mp4 --name <v>-check --no-transcribe` and compare the two reports side by side.

`bun vk ref list <p>` lists references; `bun vk ref rm <p> <name>` deletes one. Reference files stay local (projects are gitignored); only analyze videos the user gave you or asked you to find.
