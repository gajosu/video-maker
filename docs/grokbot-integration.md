# Grokbot → video-maker integration

A non-interactive CLI path for handing a finished content **package** (narration script +
background-music link + cover headlines + visual prompts/images) to video-kit and getting a
rendered vertical MP4 back, with no human in the loop until the final review. Built for
Atlas Misterioso Bot, running on a separate machine that can only reach this repo through
shell commands (e.g. `wsl -e bash -lc "cd ~/projects/video-maker && bun vk package …"`).

## What it does

`bun vk package <project> <path>`:

1. **Ingests** the package (fast, synchronous, no network beyond copying local files you already
   supplied): writes `script.md` (narration split into lines, verbatim — facts are never rewritten)
   and `scenes.js`, archives the narration/headlines/music link into `knowledge/videos/<slug>.md`,
   copies any images you already supplied, and files an open asset **request** for every visual
   prompt that still needs an image.

   For a project configured for the house "story" layout (`format.style: "story"` plus a
   `scenes/shared.js` — this is already `atlas-misterioso`'s setup, detected generically rather than
   by project name), `scenes.js` mirrors the channel's hand-made videos: one scene per beat from
   your **"## 5. Escenas"** section (real on-screen captions, a channel-tag hook, a subscribe outro
   with a title/place card, varied Ken Burns, sfx — see **Package format** below). Any other
   project/style still gets the previous simple layout: a single cinematic photo-slideshow scene
   where every visual prompt gets an even slice of the whole runtime.
2. **Starts a background job** and returns immediately, printing the job's status JSON (see
   below). The job then, in order: generates the missing images (OpenAI `gpt-image-2` by default,
   override with `VK_IMAGE_MODEL`; up to `VK_IMAGE_CONCURRENCY` in parallel, default 5, each with
   a 180 s timeout and up to 2 retries on timeout/5xx/429 — see **Image generation** below), tries
   to download the given music link, runs the project's configured ElevenLabs voice, validates the
   result (the same checks `bun vk check` runs), grabs a couple of preview stills, and renders the
   final MP4.

`bun vk package status <project> <video>` prints the current job state as JSON — poll this
instead of waiting on the first command (renders take minutes; a shell with a short timeout can
disconnect right after the job starts and the render keeps going in the background).

`bun vk package resume <project> <video>` re-runs the job for a video that already exists —
safe to call after a failure: it skips whatever already succeeded (images already generated,
music already downloaded, voice already recorded) and retries from there. This is also how you
recover from a crashed worker (see `state: "error"` below).

## Exact commands

```bash
# 1) hand over a package (a directory or a single file), get a job back immediately
bun vk package atlas-misterioso /path/to/package-dir
bun vk package atlas-misterioso /path/to/package-dir --images /path/to/images-dir   # if not package-dir/images/
bun vk package atlas-misterioso /path/to/guion.md                                  # a lone markdown file also works
bun vk package atlas-misterioso /path/to/package.json --video my-custom-slug        # JSON package, explicit slug

# 2) poll status until state is "done" or "error"
bun vk package status atlas-misterioso solnitsata-sal-cerveza-y-una-ciudad-amur

# 3) if it errored, fix the cause (see job.error) and resume — already-done steps are skipped
bun vk package resume atlas-misterioso solnitsata-sal-cerveza-y-una-ciudad-amur

# ingest only, no spend, no background job — inspect script.md/scenes.js before committing to a render
bun vk package atlas-misterioso /path/to/package-dir --dry-run
```

Flags: `--video <slug>` (default: slugified from the package title), `--images <dir>` (default:
`<package dir>/images` if it exists), `--voice <elevenlabs id>` (default: the project's configured
voice), `--style <name>` (default: the project's configured `format.style` — already `story` for
`atlas-misterioso`, a good fit for mystery/documentary content), `--dry-run` (ingest only).

Output path on success: `projects/<project>/videos/<video>/out/<video>.mp4` (also given as
`job.output`, a path relative to the repo root). A couple of preview stills land in
`projects/<project>/videos/<video>/stills/`.

## Package format

### Markdown (the format Grokbot already produces — see `ejemplo-guion-solnitsata.md`)

Always the same four `##` sections, in order, under one `# <channel> — <title>` heading:

```md
# Atlas Misteriosos — <Title>

## 1. Guión narrativo
<the narration, one or more paragraphs, used as-is>

## 2. Música de fondo
Música de fondo: [<label>](<https://pixabay.com/or/mixkit link>) — <description, ignored>

## 3. Titulares de portada
1. <headline>
2. <headline>
...

## 4. <N> prompts visuales
01 — <Spanish title, ignored>
<English image-generation prompt>

02 — <Spanish title, ignored>
<English image-generation prompt>
...
```

- The title is taken from the part of the `#` heading after the first `—` (falls back to the
  whole heading if there's no `—`).
- Section 2's music link is optional; if present but not a direct audio URL, the job falls back
  to the style's default music preset (see **Known limitations**).
- Section 3's headlines: only numbered lines are read; headline #1 is used as an optional on-screen
  hook/title card at the very start of the video.
- Section 4 needs at least one `NN — title` block followed by its prompt text; the count doesn't
  have to be exactly 20 — whatever's there is used.
- If you already generated the images (e.g. with `gpt-image-2`), drop them in a sibling `images/`
  folder next to the markdown file (or pass `--images <dir>`), named so the leading number matches
  the prompt: `01.png`, `01-la-colina-de-la-sal.png`, `1_whatever.jpg` all match prompt `01`.

### Section 5: `## 5. Escenas` (optional, but always send it — it's what drives the house layout)

Without this section the pipeline falls back to an auto-generated scene plan (see **Fallback
without section 5** below), which is fine but not as sharp as a hand-planned one. When you do send
it, put it right after section 4:

```md
## 5. Escenas

Lugar: PROVADIA, BULGARIA
Título final: SOLNITSATA

1. img 02 | Dos cuencos boca abajo en su *casa* | sfx pop
   Cerca de Provadia, en el noreste de Bulgaria, hace unos seis mil quinientos años, alguien deja
   dos cuencos boca abajo en el suelo de su casa.
2. img 03 | La casa *ardió*
   La casa arde antes de que nadie vuelva a levantarlos.
3. img 01 | *Solnitsata*: la ciudad más antigua de Europa
   Es Solnitsata, "la salinera", que sus excavadores consideran el centro urbano más antiguo de Europa.
...
14. img 19,20 | La ciudad de la sal, en *silencio*
   Los terremotos derriban las murallas, los manantiales se secan… y la ciudad de la sal queda en
   silencio bajo su propia colina.
```

- `Lugar:` (optional) → the small line under the final title card. `Título final:` (optional,
  defaults to the package title before its first `:`) → the big uppercase final title.
- Each beat becomes exactly one scene: `N. img <ids, comma-separated> | <on-screen caption> [| sfx <name>]`,
  then one or more indented lines = the *exact voiced text* for that beat (numbers already spelled
  out as words, same as section 1).
  - `*word*` / `*two words*` in the caption = the highlighted word(s) (rendered boxed in brand
    yellow); the asterisks are stripped from the on-screen text.
  - Several image ids in one beat (`img 04,05`) = those images crossfade inside that one scene
    (like a multi-shot beat in the reference videos), instead of one scene per image.
  - `| sfx <name>` is optional. Use whatever the engine already supports (`pop`, `impact`, `ok`,
    `camera`, `cta`, …, or the name of any `sfx`-kind asset in the project); an unrecognized name is
    dropped with a warning in `job.warnings`, not an error.
  - The **first** beat becomes the hook scene (channel-tag badge + centered caption over a
    vignette); the **last** beat becomes the finale (subscribe outro + the title/place card).
  - The voiced script used for `## Lines` is exactly the beats' voiced lines, in order — section 1
    is not used for the voice-over when section 5 is present (it still goes into the knowledge doc
    as the reviewed narration). The spoken subscribe line
    (`{#suscribe}Suscríbete para descubrir más misterios del mundo.`) is appended automatically to
    the last beat unless one of your beats already includes a `{#suscribe}` marker.
- The equivalent JSON (see below) is accepted too.

### Fallback without section 5

If a package has no section 5, the house layout is still used (for a house-style project), but the
scene plan is auto-generated: one beat per narration sentence, images distributed across beats in
order (a beat with no image of its own reuses the previous one), a deterministic best-effort caption
shortening (a sentence ≤8 words is used as-is; longer ones are cut at the longest comma/colon break
that still keeps 3–8 words, otherwise the full sentence is kept — never an arbitrary truncation),
the final title = the package title before its first `:` with no place line, and the spoken subscribe
line appended automatically. `job.warnings` gets an entry flagging that the scenes were
auto-generated, so review `scenes.js` before publishing.

### JSON (equivalent, if you'd rather send structured data)

```json
{
  "title": "Solnitsata: sal, cerveza y una ciudad amurallada de hace 6.500 años",
  "narration": "Cerca de Provadia, en el noreste de Bulgaria… (full text, \n\n between paragraphs)",
  "music": { "url": "https://cdn.example.com/track.mp3", "label": "Ancient Civ (The_Mountain, Pixabay)" },
  "headlines": ["Cerveza hace 6.500 años: el hallazgo en la ciudad de la sal", "..."],
  "visuals": [
    { "id": "01", "title": "La colina de la sal", "prompt": "Ultra-realistic cinematic vertical 9:16 …", "image": "images/01.png" },
    { "id": "02", "title": "…", "prompt": "…" }
  ],
  "place": "PROVADIA, BULGARIA",
  "finalTitle": "SOLNITSATA",
  "scenes": [
    { "images": ["02"], "caption": "Dos cuencos boca abajo en su *casa*", "sfx": "pop", "voice": "Cerca de Provadia, en el noreste de Bulgaria, hace unos seis mil quinientos años, alguien deja dos cuencos boca abajo en el suelo de su casa." },
    { "images": ["03"], "caption": "La casa *ardió*", "voice": "La casa arde antes de que nadie vuelva a levantarlos." },
    { "images": [4, 5], "caption": "Agua *salada* que brota de la tierra", "voice": ["Aquí brota agua salada de la tierra, y sus habitantes la hierven en vasijas de barro hasta convertirla en sal."] }
  ]
}
```

`music` and each visual's `image` are optional. `image` paths are resolved relative to the
package's own directory (or you can still pass `--images <dir>` for visuals without an inline
`image`). `place`, `finalTitle` and `scenes` are the JSON equivalent of markdown section 5 (same
optionality and rules — `caption` accepts the same `*word*` markup, `images` accepts numbers or
strings, `voice` accepts a single string or an array of strings for beats with more than one
narration line). Save this as `package.json` inside a directory you hand to `bun vk package`, or as
a standalone `.json` file.

## Job status JSON

```jsonc
{
  "project": "atlas-misterioso",
  "video": "solnitsata-sal-cerveza-y-una-ciudad-amur",
  "source": "grokbot-package",
  "state": "queued" | "running" | "done" | "error",
  "step": "queued" | "images" | "music" | "voice" | "check" | "stills" | "render" | "done",
  "progress": 0.85,               // 0..1, coarse (per pipeline step, not per-frame)
  "pid": 12345,                   // worker process id (used to detect a crashed job on the next status read)
  "error": null,                  // set + state:"error" if a step failed; message is the underlying command's output
  "warnings": [                   // non-fatal: job still finishes, but check these
    "music download failed (…); using the style's default music preset instead.",
    "OPENAI_API_KEY not set: 20 image(s) left as open requests (the render uses placeholders for them)."
  ],
  "output": "projects/atlas-misterioso/videos/solnitsata-sal-cerveza-y-una-ciudad-amur/out/solnitsata-sal-cerveza-y-una-ciudad-amur.mp4",
  "stills": ["projects/atlas-misterioso/videos/solnitsata-sal-cerveza-y-una-ciudad-amur/stills/t1.jpg", "…"],
  "package": {
    "sourcePath": "/path/given/to/bun-vk-package", "title": "…", "visuals": 20,
    "imagesProvided": 0, "imagesToGenerate": 20,
    "imagesDone": 7   // advances during the "images" step (ok, retried or given-up-on — see below)
  },
  "startedAt": 1790614346510,
  "updatedAt": 1790616640935
}
```

State lives at `projects/<project>/jobs/<video>/pkg.json` (+ `pkg-log.jsonl` for a step-by-step
log) — a different filename from the web Studio's own `jobs/<video>/job.json`, so the two job
runners never read or clobber each other's records. A job whose `state` is `"running"` but whose
`pid` is no longer alive (crash, machine restart) flips to `"error"` the next time it's read, with
a message pointing at `package resume`.

## Image generation

Images generate **in parallel**, up to `VK_IMAGE_CONCURRENCY` at a time (default **5**), each
using OpenAI **`gpt-image-2`** by default for this pipeline specifically (override with
`VK_IMAGE_MODEL`; other `bun vk` commands, e.g. `asset gen`, keep defaulting to `gpt-image-1`
unless you set the same env var). Each request has a **180 s timeout** (`AbortSignal`) and gets
**up to 2 retries with backoff** (~1.5 s, ~3 s) on a timeout, a `429`, or a `5xx` — this is what
fixes the original failure mode: one slow/hung request no longer stalls the whole job indefinitely.
Every attempt is logged to `pkg-log.jsonl` (`image <video>-imgNN: ok`, `retry N of 2 (…)`, or
`failed (…)` — asset names are scoped to the video, `<video>-img01`.., so two packages in the same
project never overwrite each other's images),
and `job.package.imagesDone` / `imagesToGenerate` (plus `job.progress`) advance per image, not just
per pipeline step. An image that still fails after its retries becomes a `job.warnings` entry and
is left as an **open asset request** (the render uses a placeholder for it) — the job still
finishes. Only if **more than half** of the requested images fail does the whole step (and job)
throw, on the theory that a mostly-broken video isn't worth finishing unattended.

## Watching a job in the web preview

You (Grokbot) never touch the web app — this is for Gabriel, who was otherwise "blind" while a
package job ran in the background. No new command or flag on your side; it just reads the same
`pkg.json`/`pkg-log.jsonl` you already produce:

- **Video list** (`/p/<project>`, "Videos" tab): every video with a `jobs/<video>/pkg.json` gets a
  small badge next to its normal file-status badge — **"En cola"**, **"En proceso"** (hover for
  the exact step), **"Listo"**, or **"Error"** — plus the current step in plain Spanish at the
  bottom of the thumbnail while it's running, e.g. *"Generando imágenes 7/20"*, *"Buscando
  música"*, *"Generando la voz"*, *"Renderizando"*.
- **Video page** (`/p/<project>/v/<video>`, "Chat" tab, the default): the same badge next to the
  title, and the chat panel shows the whole `pkg-log.jsonl` translated into readable Spanish
  messages (step started, each image generated/retried/failed, music downloaded or its fallback,
  voice done, check result, render done, warnings, errors), updating every 2 s while the job is
  queued/running. When it finishes, the same panel appends the preview stills grid and the
  playable final MP4, inline. The panel is clearly labeled **"Pipeline automático de Grokbot"** so
  it reads distinctly from the web Studio's own chat. Once the job is `done`/`error`, the normal
  Studio chat right below it works exactly as before — Gabriel can ask for changes there and
  they're applied to the video you produced, same as any terminal-made video.
- This is display-only: it's read straight from your job files (nothing is written back), so it
  can't interfere with a running job, and there's nothing extra for you to do.

## Known limitations (read before relying on this for a real drop)

- **Pixabay/Mixkit page links usually won't download.** Both sites serve their *music page* behind
  a Cloudflare/JS challenge (verified while building this: a plain fetch gets an HTML challenge
  page, not audio, `403`). A **direct CDN file URL** (ending in `.mp3`, no page chrome) downloads
  fine. When the link doesn't resolve to real audio, the job logs a warning and falls back to the
  project's/style's default music preset (`ambient` for `story`) rather than failing the whole
  video — but if you want the *exact* supplied track, download it yourself and either host it
  somewhere fetchable, or add it locally first (`bun vk asset add <project> <file> --name bgmusic
  --kind music`) before running `bun vk package`.
- **Image generation needs `OPENAI_API_KEY`.** If it's not set, every visual prompt without a
  supplied image is left as an open request; the render still completes, using the engine's
  built-in "missing asset" placeholder for those beats (a clearly-labeled striped frame, not a
  silent failure) — check `job.warnings` and `bun vk asset requests <project>`. There's no
  automatic stock-photo fallback for AI-image prompts (English, often fictional/historical
  reconstructions) — stock search wouldn't reliably match, so it's not wired in. See **Image
  generation** above for the model/concurrency/retry/timeout knobs.
- **`bun vk voice` needs `ELEVENLABS_API_KEY`** and the project's `project.json` `voice.voiceId`
  set — this is a hard requirement, the job fails clearly if either is missing.
- **One package = one video**, rendered with the project's already-configured brand/voice/style.
  There's no per-request override of the ElevenLabs voice beyond `--voice <id>`, and no editing
  pass afterwards — for changes, either edit `script.md`/`scenes.js` by hand and `bun vk package
  resume`, or use the existing web Studio chat (`/p/<project>/v/<video>`, any terminal-made video
  gets a job record on first message there too).
