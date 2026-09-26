# CLAUDE.md

Project context and working agreements. Read this first, then read
`DESIGN.md` before touching anything the user sees or touches.

---

## What this is

A pattern-grid groovebox that runs in the browser on an iPad Pro M1,
installed to the home screen as a web app. A sequencer and sample-based
instrument for building **whole songs**, not loops.

The reference is the Synthstrom Deluge. The goal is not to clone its feature
list but to reproduce how it *works*: one grid, one gesture grammar, every
scale from a single note to a finished arrangement. `DESIGN.md` documents the
Deluge's model in detail and how each part translates to touch. It is the
authority on interaction.

This is a standalone instrument — a groovebox that lives entirely on the
iPad. No external hardware required, no companion device to sync with.

---

## The four pillars

A proposed feature must serve one of these or it waits.

1. **One surface, one grammar.** Every edit is *hold the thing, then act on
   it*. No persistent modes, no panels, no dialogs. The same gesture means the
   same thing in every view.
2. **Pitched sample instruments.** A sample loaded as a voice played across
   pitch on the grid — different notes of the same hi-hat, higher rows higher.
3. **Polymeter.** Clips of any length; rows within a clip of their own length.
4. **Sections and the arranger.** Clips grouped by colour into sections,
   launched and chained, then recorded or placed into a linear arrangement.

## Design laws

Short form. Full reasoning in `DESIGN.md`.

- If a feature needs a panel, a dialog, or its own screen, the design is wrong.
- **Rulers move things in time and space. Knobs change what things are.**
- Zoom is a gesture, never a setting.
- Nothing asks "are you sure". Everything is undoable.
- Never stop the music to change something.
- Touch is the primary input. Use Pointer Events, not mouse events. Every
  interaction must be verified with a finger, not a trackpad.

---

## Non-goals

- **Not a synthesiser.** No oscillators, FM, or wavetables. Samples are always
  the source. Envelopes and filters *shaping* a sample are in scope.
- **Not a DAW.** No piano roll, mixer screen, plugin hosting, or inspector
  panels.
- **No real-time MIDI hardware I/O.** Safari has no Web MIDI and every iOS
  browser must use WebKit. MIDI *files* are different — see below.
- **No MIDI, CV, or audio clips.** Kit and instrument clips only.
- Not multi-user, not cloud-synced, no accounts, not cross-platform, not
  shipping to anyone.

## MIDI — two different things

**Web MIDI API** (real-time hardware): out of scope permanently.
**MIDI files (`.mid`)**: ordinary byte parsing. **Required.** Import into
instrument clips is a core feature, not a nice-to-have — sequencing a
sample-based instrument to a `.mid` file is a workflow this project must
support. Export (clips or the arrangement, back to `.mid`) is in scope too,
lower priority. Vendored as one ES module, no npm. See roadmap milestone 5.

## Constraints

- iPad only. No Mac, no laptop, no compiler.
- No money. Every tool free.
- **No build step.** Plain ES modules. No npm, bundler, transpiler, or
  framework.
- GitHub Pages, HTTPS, installed as a PWA, landscape only.

---

## Git workflow

Solo project, no collaborators, no CI. **Commit and push directly to `main`.**
Do not create a feature branch or open a pull request unless explicitly asked.
GitHub Pages deploys from `main`, so the loop is: push → Pages redeploys → the
user reloads on the iPad.

Claude Code's default is to create `claude/*` branches. Override that: at the
start of a session, `git checkout main`. If you find yourself on a `claude/*`
branch mid-session, switch back.

When changing a file, **output the whole file**, not a diff.

---

## Architecture

```
index.html
manifest.json
css/style.css

js/clock.js        lookahead scheduler + tick↔time map
js/transport.js    song position, launch quantization, which clips play
js/audio.js        AudioContext, sample loading and decoding
js/voice.js        kit and instrument voices: pitch, envelope, filter
js/model.js        Song/Track/Clip data; ALL edits go through here
js/history.js      undo/redo (snapshots of the model)
js/store.js        IndexedDB persistence (song JSON + sample blobs)
js/input.js        pointer tracking, holds, combos — the grammar
js/views/clip.js   clip view (kit + instrument)
js/views/song.js   song view
js/views/arranger.js
js/ui/grid.js      renders the 16×8 grid + sidebar from cell descriptors
js/ui/ruler.js     time ruler + row ruler
js/ui/knobs.js     context knobs, gold knobs, readout
js/main.js         wiring
```

Views produce *cell descriptors* (hue, brightness, state); `grid.js` renders
them. `input.js` produces gestures; the active view handles them. Views never
touch audio directly; they call the model, and the transport reads the model.

---

## Timing rules — non-negotiable

- **Never trigger a musical event from `setInterval` or `setTimeout`.**
- **The lookahead scheduler is the only correct pattern.** A timer wakes every
  ~25ms, looks ~100ms ahead, books events against `ctx.currentTime`.
- **Audio is scheduled in the future; visuals render in the present.**
  Playheads come from `requestAnimationFrame` reading the time map, never from
  the scheduler.
- **Watch `clock.worstMargin`.** Measured steady-state on the target iPad:
  ~50ms. Must stay positive under load.
- Audition and keyboard pads are the one exception: they play immediately on
  touch-down.

**Milestone 3 changes the clock's API** (step-based → tick-window-based, 96
PPQN). The rule "the clock is settled, don't refactor it" is lifted for that
milestone only. Every invariant above still holds. See `DESIGN.md` Part 6.

## iOS specifics

1. `AudioContext` starts suspended; resume only inside a real tap handler.
2. Ringer switch can mute Web Audio: set `navigator.audioSession.type =
   'playback'` where available.
3. Audio suspends on lock/app-switch: on `visibilitychange` → hidden, stop the
   transport cleanly; on return, resume the context.
4. Safari can evict storage: call `navigator.storage.persist()`.
5. No haptics in Safari. All feedback is visual or audible.
6. Keep controls out of the bottom ~20pt (home-indicator edge swipes).

---

## Data model

```
Song
  id, name, bpm, swing
  scale        { root, mode, enabled }       shared by all instrument clips
  sections[]   { repeats }                    index = section colour
  tracks[]

Track
  id, type: 'kit' | 'instrument', name, hue
  kit:         drums[] { id, sampleId, name, hue, voice, mute }
  instrument:  sampleId, rootNote, voice
  clips[]
  activeClipId                                one clip per track plays
  arrangement[] { startTick, lengthTicks, clipId | uniqueClip }

Clip
  id, name?, section (0–11), lengthTicks, launch: 'infinite' | 'once' | 'fill'
  rows         { [rowKey]: { lengthTicks?, mute } }
               rowKey = drum id (kit) or MIDI pitch (instrument)
  notes[]      { row, tick, length, velocity, probability, iterance, repeats }

Voice          { volume, pan, attack, decay, sustain, release,
                 cutoff, resonance, start, mode: once|cut|loop, reverse }
```

Plain JSON. Sections are a colour index on each clip, not a container. Notes
store absolute pitch; which rows are visible depends on scale mode. Song JSON
and sample blobs live separately in IndexedDB.

---

## Roadmap

Each milestone is done when **a real musical idea has been made with it**,
not when the code works.

1. ~~**Clock**~~ — done. Margin ~50ms, stable under load.
2. ~~**Kit prototype**~~ — done. Flat 8-pad grid, samples from Files.
3. **Foundation.** Tick transport (96 PPQN), the data model above, one
   mutation layer with undo, IndexedDB persistence. Rebuild the kit clip on
   it. No new features — parity, plus nothing is ever lost. ← next
4. **Instrument clips.** Pitched sample, Y = pitch, scale mode by default,
   audition column as keyboard, note length, root note, envelope and filter on
   the gold knobs. Minimal controls. *This is the milestone where it should
   start to click.*
5. **MIDI file import.** Required, not optional. Parse a `.mid` file (vendored
   parser, no dependency) and populate an instrument clip's notes from it.
   Single track/channel only for now — a file with multiple instrument parts
   just imports as one. The point is playing a sample-based synth against a
   sequence written elsewhere, which is how this was used before this project
   existed.
6. **The surface.** Final layout, rulers (scroll and zoom), context knobs and
   readout, the full hold grammar in `input.js`.
7. **Polymeter.** Clip length, row length, multiply, rotate.
8. **Song view.** Clip rows, launch and arm, one clip per track, sections,
   repeat counts, clone and move.
9. **Arranger.** Instances, linked and unique, record performance from song
   view.
10. **Keyboard view** and live recording.
11. **Velocity and automation views**, probability and iterance, MIDI export.
12. **Refinement.**

Acceptance test for the whole app: the golden path in `DESIGN.md` Part 5.

---

## Working agreements

- Ship something playable at every stage.
- Prefer boring, readable code. The author is a designer with HTML/CSS and
  light JS experience — clarity beats cleverness. Comment *why*, not *what*.
- No new dependencies without discussion. Default answer is no.
- Feature ideas mid-milestone go to GitHub Issues, not the current branch.
- Check every proposal against the four pillars and the design laws.
- When `DESIGN.md` and a request conflict, raise it rather than guessing.

## Status

Milestones 1–2 complete. Design research done (`DESIGN.md`). Next: milestone
3, foundation.