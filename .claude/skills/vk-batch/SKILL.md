---
name: vk-batch
description: Plan several video-kit videos at once as a batch that the web studio builds in parallel (each video in its own Claude session, stopping at its script for approval in the batch panel), then follow the batch and send changes to its videos. Use when the user asks for more than one video ("haz 5 videos sobre…", "una serie de reels", "3 variantes de este hook", "un video por cada función"), or from the global chat whenever new videos are requested.
---

# vk-batch: many videos, in parallel

You are the director: you plan, the studio builds. **Never write scripts, voice or scenes for batch videos yourself**;
each video gets its own session (vk-make) once the batch is launched. The user reviews every script in the batch
panel (`http://localhost:3000/studio/batch/<p>/<id>`), picks the voices and approves them, one by one or all at once.

## 1. Plan
1. Read the knowledge base (`bun vk kb <p>`), `learnings.md` above all, and `bun vk batch list <p>` (don't repeat a batch that already exists).
2. Split the request into videos that are **different from each other**: one idea, angle, feature, audience or hook per video. If the user asked for variants of the same message, change the hook and format, not just words. 3–6 videos is the sweet spot; at most 12.
3. For each video write a `title` (short, it becomes the slug) and an `idea`: the angle, the hook to try, the key facts from the knowledge base to use (only facts that are there), the CTA and, if useful, the format ("UGC selfie", "motion graphics with counters"). The idea is what the video's session starts from, so be concrete.
4. Shared settings go in `defaults`: `style` (`bun vk styles`), `duration` (s), `music` (preset), `flow` budget per video (`{"clips": n, "images": n}`, 0 unless the user wants AI-generated clips or a reference needs look-alike people and places), `videoRefs` (reference links every video should recreate, see vk-ref). Per-video overrides go in the item (`style`, `duration`, `videoRefs`, `assets` from `bun vk asset list <p>`).
5. Voice: leave it out (the project's voice) unless the user named one; the user picks voices in the panel before anything is recorded.

## 2. Create it
Write the plan to a temporary JSON file (e.g. `projects/<p>/batches/plan-<topic>.json`) and run:
```bash
bun vk batch create <p> --file projects/<p>/batches/plan-<topic>.json          # draft: the user edits and launches it
bun vk batch create <p> --file … --launch                                        # only if the user asked to start right away
```
If the user changes the plan while it is still a draft (another angle, a style, one video more or less), **edit that
draft** instead of creating a new one: update the JSON and run `bun vk batch update <p> <id> --file …` (the id is
printed by `create`; `bun vk batch list <p>` lists them). A draft costs nothing. It appears in the chat as a card with a «Lanzar lote» button, and in the panel, where the user
can edit or remove videos before launching. After creating it, summarize the videos (title + one line each) and say
where to review them.

## 3. Follow it
- `bun vk batch status <p> [id]`: each video's status (en cola, trabajando + phase, esperando aprobación, listo, error) and cost. Up to `VK_STUDIO_MAX_JOBS` (default 3) videos work at the same time; the rest wait in the queue.
- A change for one video: `bun vk batch msg <p> <video> "…"`. If it is working it gets the message after its next step; if it is waiting for approval, the change goes to its script; if it is done, it re-edits and re-renders.
- Approving scripts is the user's call in the panel; don't approve them yourself.
- When a batch finishes, point out the strongest and weakest videos if you can tell (hook, pacing), and offer a follow-up batch based on what worked. Save durable lessons with vk-learn.
