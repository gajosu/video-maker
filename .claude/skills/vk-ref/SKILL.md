---
name: vk-ref
description: Download a reference video (TikTok, Reels, Shorts, YouTube, X… with yt-dlp or cobalt, or a local file), study it and recreate it as closely as possible for the brand, shot by shot: same format (UGC talking head, b-roll + captions, motion graphics, screen demo…), look-alike avatars and locations generated with Google Flow, matching voice cadence, pacing, cuts, hook, captions, animations and graphic style, without reusing its footage, audio or words. Use when the user shares a video link or file as inspiration ("make it like this one", "copy the style of this Reel", "this voice pace", "analyze this TikTok"), or when a style decision would be easier to judge against a real example.
---

# vk-ref: recreate a reference video for the brand

When the user gives a reference, **the goal is a video that feels like the same format made for this brand**: someone
who saw the reference should recognize the type of person, place, framing, rhythm, caption style and energy.
Match it as closely as the tools allow, shot by shot. What never carries over: its footage, audio, music, the real
person's face or voice, logos, and its words (the script comes from the knowledge base, in the reference's shape).

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

## 3. Classify the format
Name it from the pictures, because the recipe depends on it:
- **UGC / talking head**: a person talking to camera (selfie or tripod), maybe with cutaways and big captions.
- **Creator + b-roll**: voiceover over stock-like clips, often framed (title on top, clip in the middle, handle below).
- **Motion graphics / kinetic type**: flat or gradient backgrounds, animated text, icons, counters.
- **Screen demo**: phone or desktop UI being used, cursor or finger taps, zooms.
- **Skit / story**: several shots of people acting a situation.
- Mixed: list the format per shot.

## 4. Write the brief + shot plan
Write `projects/<p>/references/<name>/brief.md` (concrete, in the user's language):
- **Format** (from step 3) and the closest `style:` (`ugc`, `punchy`, `motion`, `story`, …).
- **Hook**: first line and first visual, time to first word, how it grabs attention.
- **Structure**: beats with times (hook → problem → proof → CTA…), how it ends.
- **People**: for each on-screen person: apparent age range, gender presentation, look (hair, clothes, accessories), energy, framing (selfie arm's length, chest-up tripod, walking), eye line, gestures. Describe a *look-alike type*, never the identity.
- **Places**: each location (bedroom, car, salon front desk, kitchen, street…), time of day, light (window light, ring light, neon), camera (handheld shake, static, slow push).
- **Voice**: tone, energy, gender/age impression, words/min and pauses → how to match it.
- **Captions and graphics**: position, font weight/case, words per caption, highlight color and logic, stickers, emojis, progress bars, frames, lower thirds; palette → brand mapping.
- **Pacing and transitions**: shot lengths, cut types, zoom punches, whooshes, where it slows down.
- **Shot plan**: one row per reference shot (from the report's "Shots" list): `# | time | what it shows | our version | how we make it`. "How" is one of: Flow image/video (with the exact prompt), user asset, stock (query), HTML screen, scene code.

## 5. Make it (as close as possible)
- **Script** (vk-script): same beat structure, number of phrases for the duration, phrase length (`avgPhraseWords`), hook shape and CTA placement, written from the knowledge base.
- **People and places: look-alikes with Google Flow** (vk-assets, flowkit; respect the job's Flow budget and ask for more if the reference needs it):
  1. Avatar: `bun vk asset gen <p> avatar-<x> "<age range, look, clothes, expression, framing, location, light, phone-camera realism, vertical>" --via flow --shape portrait --count 4`, pick the best, reuse it for every shot of that person so they stay consistent. Never prompt a real person's name or likeness.
  2. Places: one still per location in the same light and lens feel (`--via flow`), or `edit` the avatar image into the new place.
  3. Motion: animate with `--kind video --from avatar-<x>` and a prompt with the reference's camera and gestures ("handheld selfie, talks to camera, nods, points down at the caption").
  4. **Talking to camera, two routes**: (a) default: ElevenLabs voice + avatar clips where the mouth is not the focus (gesturing, reacting, looking at the phone), cut to b-roll or caption cards on key lines, like most UGC edits; (b) real lip sync: Veo clips speak their line (`"… she says: \"<line>\""`, one clip per 1–2 lines, 8 s max, same avatar via `--from`); their audio becomes the voice: extract and join it with ffmpeg into the video's `vo.mp3`, then `bun vk cues <p> <v> --audio vo.mp3 --lines <N>`. Route (b) costs one clip per line and the voice may drift between clips; say so and let the user choose when it matters.
  5. Without Flow (not running, no budget): closest stock people and places (`bun vk asset search … --kind video`), or ask the user to film the talking shots; say what is missing.
- **Voice** (vk-make step 2): shortlist voices whose age, energy and accent match the reference. After voicing, measure yours with `bun vk ref add <p> projects/<p>/videos/<v>/vo.mp3 --name <v>-vo` and compare words/min and pauses. Too slow: `bun vk tighten`, fewer words, or a higher `speed` in project.json `voice.settings` (0.7–1.2; ask before changing the project default). A reference voice is never cloned: `bun vk voices clone` is only for voices the user has the rights to.
- **Scenes** (vk-scenes): follow the shot plan: same shot count and lengths, same framing and layout (full-bleed vs framed), the same caption system (position, size, words per caption, highlight logic) in the brand's fonts and colors, the same transition types and zoom punches, the same recurring elements (progress bar, handle, frame).
- **Check it**: render, then `bun vk ref add <p> projects/<p>/videos/<v>/out/<v>.mp4 --name <v>-check --no-transcribe`, read both `shots.jpg` side by side, and fix the biggest differences (framing, shot length, caption size, energy) before calling it done. In the summary, list what matches and what could not be matched.

`bun vk ref list <p>` lists references; `bun vk ref rm <p> <name>` deletes one. Reference files stay local (projects are gitignored); only analyze videos the user gave you or asked you to find.
