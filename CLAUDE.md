# CLAUDE.md

Project context and working agreements. Read this before doing anything else.

---

## What this is

A pattern-grid groovebox that runs in the browser on an iPad Pro M1, installed
to the home screen as a web app. A sequencer and sample-based instrument for
building **whole songs**, not loops.

The reference point is the Synthstrom Deluge. The goal is not to clone its
feature list. It is to reproduce the specific thing the Deluge does that almost
nothing else does: let you hold an entire song in your hands, at any level of
detail, without ever leaving the surface you started on.

An SP-404 MK2 sits alongside it. The 404 is excellent as a sampler and for its
FX, and unusable for song construction. This app fills that gap. It does not
need to replace the 404 and should not try to.

---

## Why the Deluge worked — the design thesis

This is the most important section in this file. Every feature decision resolves
against it.

Plenty of software has a grid. FL Studio has a grid, and it never clicked. The
Deluge did. The difference is mechanical, not aesthetic:

**1. One metaphor, all the way up.**
A DAW gives you a step sequencer, a piano roll, and a playlist — three surfaces,
three interaction models, constant context-switching. The Deluge uses one grid
for steps, notes, clips, and arrangement. You learn one gesture vocabulary and
it scales from a hi-hat pattern to a finished song.

**2. Zoom replaces modes.**
The grid is a viewport onto a timeline at arbitrary magnification. Zoomed fully
out, the whole song occupies a single cell. Deluge users describe zoom not as an
overview convenience but as the primary editing tool. In a DAW you switch
*tools* to work at different scales; here you change *magnification*. Same
surface, same gestures, closer or further away.

**3. No pointer.**
A mouse is one contact point doing one thing at a time. The Deluge is ten
fingers on lit pads. An iPad's multi-touch is the closest available analogue and
must be treated as the primary input, not as a mouse substitute.

**4. No menus.**
The Deluge exposes near-instant access to most parameters with effectively zero
menu diving. Every dialog that opens is an idea that evaporates.

**5. Colour as memory.**
Experienced users navigate by recognition — *that's the one with all the
greens* — rather than by reading labels. Visual identity beats text.

**6. Boundedness.**
Eight visible tracks, sixteen columns. An infinite canvas produces paralysis. A
bounded grid produces decisions.

**7. Always playing.**
No stop-edit-play cycle. Changes take effect live, in time, while the music
runs.

### The laws that follow

- **If a feature needs a panel, a dialog, or its own screen, the design is
  wrong.** Everything happens on the grid, or on a held-modifier overlay on the
  grid.
- **Zoom is a gesture, never a setting.** No resolution dropdowns.
- **Never require pointer precision.** Touch targets are finger-sized. Assume
  the user is not looking closely.
- **Never stop the music to change something.**
- Two things genuinely cannot be reproduced here: physical pads and real knobs.
  Do not pretend otherwise; compensate with directness everywhere else.

---

## The four pillars

A proposed feature must serve one of these or it waits.

**1. Grid immediacy.** Every step visible and touchable. One surface. No modes
you can get lost in.

**2. Pitched sample instruments.** A sample loaded as a playable voice across
the keyboard, not just a one-shot in a drum slot. Different notes of the same
sampled hi-hat is a first-class use case, not an edge case.

**3. Per-track pattern lengths.** A 16-step kick against a 7-step hat. Polymeter
is native on the Deluge, impossible on the SP-404, and cheap in software.

**4. The arranger.** Sections that can be launched, chained, and built into a
linear song, with a direct path from jamming to arrangement. This is the layer
that turns loops into music, and the hardest thing to find anywhere else. Treat
it as a headline feature, not a final step.

---

## Instrument model

Two types, mirroring the Deluge's kit/synth split.

**Kit** — a set of pads, one sample each, unpitched. Step grid: X is time, Y is
pad. Drums and one-shots.

**Instrument** — a single sample mapped chromatically. Note grid: X is time, Y
is pitch. Pitch via `AudioBufferSourceNode.playbackRate` (varispeed: pitch and
duration move together — this is the classic sampler behaviour and is the
intended sound, not a limitation to engineer around).

Both types, per voice:
- amplitude envelope (attack / decay / sustain / release) via `GainNode`
- low-pass filter, cutoff + resonance, via `BiquadFilterNode`
- sample start offset, loop points, reverse

Roughly forty lines of Web Audio, and the difference between a drum machine and
an instrument. In scope.

---

## Non-goals

Stated explicitly so they don't creep in:

- **Not a synthesiser.** No oscillators, no FM, no wavetables. Samples are
  always the sound source. (Envelopes and filters *shaping* a sample are not
  synthesis and are in scope — see above.)
- **Not a DAW.** No mixdown automation, no plugin hosting, no destructive audio
  editing beyond trimming and loop points.
- **No real-time MIDI hardware I/O.** Narrower than it sounds — see below.
- **Not multi-user, not cloud-synced, no accounts.**
- **Not cross-platform.** One target: this iPad, Safari, installed to the home
  screen. Do not add compatibility code for other browsers.
- **Not shipping to anyone.** This is an instrument for one person to play.

---

## MIDI — two different things, don't conflate them

**Web MIDI API** — real-time communication with physical MIDI hardware. Not
supported in Safari or on iOS, and every iOS browser must use WebKit, so there
is no browser-side workaround. Out of scope permanently, unless the project ever
ports to native Swift (where CoreMIDI makes it trivial).

**MIDI files (`.mid`)** — a byte format in a file. Parsing and writing one is
ordinary JavaScript with zero platform dependencies. **In scope and planned.**

- **Import**: load a `.mid`, populate a pitched Instrument track with its notes.
  Lets ideas written elsewhere come in.
- **Export**: write patterns or the full arrangement out as `.mid`.

A minimal parser/writer is a few hundred lines, vendored as a single ES module.
No npm, no build step.

---

## Constraints

- **iPad only.** No Mac, no laptop, no local compiler.
- **No money.** Every tool must be free. No paid services, no API keys.
- **No build step.** Plain ES modules loaded natively. No npm, no bundler, no
  transpiler, no framework. Deliberate: keeps the project editable from
  github.dev on a tablet and debuggable in Safari without source maps.
- **GitHub Pages**, HTTPS, installed as a PWA.

---

## Architecture

```
index.html
manifest.json
css/style.css
js/clock.js        timing spine — lookahead scheduler
js/audio.js        AudioContext, sample loading, voice allocation
js/instrument.js   kit and pitched-instrument playback
js/pattern.js      data model — tracks, clips, sections, arrangement
js/grid.js         the grid surface: render, hit-testing, zoom
js/ui.js           transport and overlays
js/midifile.js     .mid import/export (vendored)
js/main.js         wiring
samples/
```

Small files, one responsibility each. When changing a file, **output the whole
file** rather than a diff — it is being merged on a tablet.

---

## Timing rules — non-negotiable

- **Never use `setInterval` or `setTimeout` to trigger a musical event.** They
  drift and WebKit throttles them.
- **The lookahead scheduler is the only correct pattern.** A sloppy timer wakes
  every ~25ms, looks ~100ms ahead, books events against `ctx.currentTime`, which
  is sample-accurate. Implemented in `clock.js`.
- **Audio is scheduled in the future; visuals render in the present.** Never
  drive the UI from the audio scheduler. The clock exposes a visual queue; a
  `requestAnimationFrame` loop reads it.
- **Watch `clock.worstMargin`** — how far ahead events are being booked. Should
  hold near 70–100ms. Negative means a beat was overdue when the scheduler
  reached it.

---

## iOS specifics

Four things that will look like bugs and are not:

1. `AudioContext` starts suspended and can only be resumed inside a real user
   gesture. No sound before the user taps something.
2. The ringer/silent switch can mute Web Audio. Mitigate with
   `navigator.audioSession.type = 'playback'` where available.
3. Audio suspends on lock and app-switch. Handle `visibilitychange`, resume.
4. Safari can evict stored data from sites not opened recently. Call
   `navigator.storage.persist()`. Samples live in IndexedDB.

---

## Data model

```
Song
  bpm, swing
  tracks[]           8 visible, scrollable beyond
    type             'kit' | 'instrument'
    sampleId(s)
    voice            envelope, filter, start offset, loop, reverse
    clips[]          named step/note snapshots for this track
      steps[]        Step or null
      length         INDEPENDENT per clip — the polymeter feature
  sections[]         launchable groups of clips (the jam layer)
  arrangement[]      ordered section references over time (the song layer)

Step
  pitch (instrument only), velocity, probability, microtiming offset
```

Plain JSON, serializable. Save state is one object in IndexedDB; samples stored
separately as blobs, referenced by id.

---

## Roadmap

Each milestone is done when **a real musical idea has been made with it**, not
when the code works. This is a gate, not a motto.

1. **Clock** — rock-solid metronome, verified under load. ← current
2. **Kit track** — 8 pads, tap steps, load your own samples from Files.
3. **Persistence** — IndexedDB save/load. Early, so nothing is ever lost.
4. **Pitched instrument** — chromatic sample playback, envelope, filter.
5. **Zoom + per-track lengths** — the two Deluge mechanics that matter most.
6. **Clips and sections** — the jam layer.
7. **Arranger** — the song layer.
8. **MIDI file import/export.**
9. **Refinement** — swing, velocity, probability, microtiming, trimming.

---

## Working agreements

- Ship something playable at every stage. A half-finished sequencer that gets
  jammed on nightly beats a complete one that sits unplayed.
- Prefer boring, readable code. The author is a designer with light JS
  experience, not a software engineer — clarity beats cleverness. Comment *why*,
  not *what*.
- No new dependencies without discussion. Default answer is no.
- Feature ideas mid-milestone go to GitHub Issues, not into the current branch.
- Check every proposal against the four pillars and the design laws.

---

## Open questions

- Can the iPad send audio *into* the SP-404 over USB-C so the 404's FX process
  the app's output? Untested, potentially significant, costs nothing to try.
- Does `navigator.audioSession` actually defeat the ringer switch on this
  device? Pending the clock test.
- How should zoom be expressed on a touchscreen — pinch, or a two-finger
  modifier? Prototype before committing.

---

## Status

Repo live, Pages deploying, installed to home screen. Clock implemented and
under test.

## Git workflow

Solo project, no collaborators, no CI. Commit and push directly to
main — do not create a feature branch or open a pull request unless
I explicitly ask for one. GitHub Pages deploys straight from main, so
this is the entire loop: you push, Pages redeploys, I reload on the
iPad.

  ## Critical: branch enforcement

  Claude Code's default is to create claude/* branches. Override that:
  1. Immediately check out main: `git checkout main`
  2. All commits go directly to main
  3. If you find yourself on a claude/* branch mid-session, switch back
  4. Do NOT create feature branches unless explicitly asked
