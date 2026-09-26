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
2. **Samples that bend to the song.** A sample can be played across pitch on
   the grid — different notes of the same hi-hat, higher rows higher. And any
   sample or loop can be time-stretched to the song's tempo without changing
   its pitch, so material recorded at any BPM locks to the beat.
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

## Clip types

Three, mirroring the Deluge.

- **Kit** — many samples, one per row. Drums and one-shots.
- **Instrument** — one sample played across pitch. Y is pitch.
- **Audio** — one long sample (a loop, a phrase, a stem) that always fills
  its clip, time-stretched to stay locked to the song's tempo. The grid shows
  its waveform. **Required.**

## Time-stretch

**Required.** Browsers have no pitch-preserving time-stretch of their own:
`playbackRate` always moves pitch and speed together. So stretching uses
**Signalsmith Stretch** (MIT licence, official WASM + AudioWorklet web
release), vendored as a single file in `js/vendor/`.

Where it's used, in priority order:
1. Audio clips — always stretched to the song tempo.
2. A `stretch` playback mode for kit and instrument samples — the sample
   fills the note's length at the current tempo, pitch unchanged.
3. An optional per-track "unlink pitch and speed" for instrument clips.

Strategy and the verification spike are in `DESIGN.md` Part 6.

## MIDI — two different things

**Web MIDI API** (real-time hardware): out of scope permanently.
**MIDI files (`.mid`)**: ordinary byte parsing. **Required.** Import into
instrument clips is a core feature — sequencing a sample-based instrument to
a `.mid` file is a workflow this project must support. Export (back to
`.mid`) is in scope, lower priority. Vendored parser, no npm.

---

## Non-goals

- **Not a synthesiser.** No oscillators, FM, or wavetables. Samples are always
  the source. Envelopes, filters, and stretching *shaping* a sample are in
  scope.
- **Not a DAW.** No piano roll, mixer screen, plugin hosting, or inspector
  panels.
- **No real-time MIDI hardware I/O.** Safari has no Web MIDI and every iOS
  browser must use WebKit.
- **No MIDI or CV clips.**
- **No audio recording.** Audio clips are loaded from files only — no
  microphone input, no resampling the app's own output.
- Not multi-user, not cloud-synced, no accounts, not cross-platform, not
  shipping to anyone.

## Constraints

- iPad only. No Mac, no laptop, no compiler.
- No money. Every tool free.
- **No build step.** Plain ES modules. No npm, bundler, transpiler, or
  framework.
- **Approved vendored files** (single files in `js/vendor/`, committed to the
  repo, no package manager): a MIDI file parser; Signalsmith Stretch. Anything
  else needs discussion first.
- GitHub Pages, HTTPS, installed as a PWA, landscape only.

---

## Git workflow

Solo project, no collaborators, no CI. **Commit and push directly to `main`.**
Do not create a feature branch or open a pull request unless explicitly asked.
GitHub Pages deploys from `main`, so the loop is: push → Pages redeploys → the
user reloads on the iPad.

Claude Code's default is to create `claude/*` branches. Override that: at the
start of a session, `git checkout main`. If a push to `main` is refused, push
wherever it lands and say so — the user will merge by hand.

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
js/stretch.js      time-stretch engine: render + cache stretched buffers
js/model.js        Song/Track/Clip data; ALL edits go through here
js/history.js      undo/redo (snapshots of the model)
js/store.js        IndexedDB persistence (song JSON + sample blobs)
js/input.js        pointer tracking, holds, combos — the grammar
js/views/clip.js   clip view (kit, instrument, audio)
js/views/song.js   song view
js/views/arranger.js
js/ui/grid.js      renders the 16×8 grid + sidebar from cell descriptors
js/ui/ruler.js     time ruler + row ruler
js/ui/knobs.js     context knobs, gold knobs, readout
js/main.js         wiring
js/vendor/         approved single-file libraries (see Constraints)
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
- **Stretched audio obeys the same rules.** It is rendered ahead of time into
  an ordinary buffer, then scheduled with `start(time)` like any other sample.
  Stretching never happens inside the scheduler.

The tick transport (96 PPQN) landed in milestone 3 and is verified. It is
settled again: don't refactor it without raising it first.

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
  id, type: 'kit' | 'instrument' | 'audio', name, hue
  kit:         drums[] { id, sampleId, name, hue, voice, mute }
  instrument:  sampleId, rootNote, voice, pitchSpeedLinked (default true)
  audio:       voice
  clips[]
  activeClipId                                one clip per track plays
  arrangement[] { startTick, lengthTicks, clipId | uniqueClip }

Clip
  id, name?, section (0–11), lengthTicks, launch: 'infinite' | 'once' | 'fill'
  kit / instrument:
    rows       { [rowKey]: { lengthTicks?, mute } }
               rowKey = drum id (kit) or MIDI pitch (instrument)
    notes[]    { row, tick, length, velocity, probability, iterance, repeats }
  audio:
    sampleId, sampleStart, sampleEnd          trim points, in seconds
    pitchSpeedLinked (default false)          false = stretch, true = varispeed
    transpose                                 semitones

Voice          { volume, pan, attack, decay, sustain, release,
                 cutoff, resonance, start,
                 mode: once | cut | loop | stretch, reverse }
```

Plain JSON. Sections are a colour index on each clip, not a container. Notes
store absolute pitch; which rows are visible depends on scale mode. An audio
clip's stretch ratio is never stored — it is derived from the clip's length,
the trim points, and the song tempo. Song JSON and sample blobs live
separately in IndexedDB; stretched renders are a cache, never persisted.

---

## Roadmap

Each milestone is done when **a real musical idea has been made with it**,
not when the code works.

1. ~~**Clock**~~ — done. Margin ~50ms, stable under load.
2. ~~**Kit prototype**~~ — done.
3. ~~**Foundation**~~ — done. Tick transport, data model, undo/redo,
   persistence, polymeter verified with a debug row.
4. **Instrument clips.** Remove the temporary 12-step debug toggle first.
   Pitched sample, Y = pitch, scale mode by default, audition column as
   keyboard, note length, root note, envelope and filter on the gold knobs.
   Minimal controls. *This is the milestone where it should start to click.*
   ← next
5. **MIDI file import.** Required. Parse a `.mid` file and populate an
   instrument clip's notes from it. Single track/channel only for now.
6. **Time-stretch and audio clips.** Required. Start with a spike (a
   throwaway test page, like the clock test) to verify Signalsmith Stretch
   on this iPad. Then: the stretch engine and cache, audio clips with
   waveform display and tempo lock, and the `stretch` sample mode.
7. **The surface.** Final layout, rulers (scroll and zoom), context knobs and
   readout, the full hold grammar in `input.js`.
8. **Polymeter.** Clip length, row length, multiply, rotate.
9. **Song view.** Clip rows, launch and arm, one clip per track, sections,
   repeat counts, clone and move.
10. **Arranger.** Instances, linked and unique, record performance from song
    view.
11. **Keyboard view** and live recording.
12. **Velocity and automation views**, probability and iterance, MIDI export.
13. **Refinement.**

Acceptance test for the whole app: the golden path in `DESIGN.md` Part 5.

---

## Working agreements

- Ship something playable at every stage.
- Prefer boring, readable code. The author is a designer with HTML/CSS and
  light JS experience — clarity beats cleverness. Comment *why*, not *what*.
- No new dependencies beyond the approved vendored files without discussion.
- Feature ideas mid-milestone go to GitHub Issues, not the current work.
- Check every proposal against the four pillars and the design laws.
- When `DESIGN.md` and a request conflict, raise it rather than guessing.

## Status

Milestones 1–3 complete. Next: milestone 4, instrument clips.