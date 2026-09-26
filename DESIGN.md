# DESIGN.md

Interaction design for the groovebox. Read this before building or changing
anything the user touches. `CLAUDE.md` is the constitution; this file is the
instrument's physics.

Sources: the Deluge official manual (firmware 3.x), the Deluge community
firmware documentation (c1.0–c1.3), and Andreas Roman's *Understanding the
Deluge*. Where this file says "the Deluge does X", that comes from those
sources. Where it says "we do Y", that is a design decision for touch.

---

## Part 1 — What the Deluge actually is

### 1.1 The object model

```
Song
 ├─ Tracks        one sound source each: a Kit, an Instrument, or Audio
 │   └─ Clips     looping sequences; many per track; ONE plays at a time
 │       └─ Rows  kit: one drum per row · instrument: one pitch per row
 │           └─ Notes   position, length, velocity, probability, iterance
 │                (audio clips have no rows or notes: the clip IS the audio)
 ├─ Sections      a colour; every clip has exactly one
 └─ Arrangement   per-track timeline of clip instances
```

**Track.** One sound source. A *kit* is many samples, one per row. An
*instrument* is one sample played at different pitches. An *audio* track
plays one long sample — a loop, a phrase, a stem — and **audio clips are
always time-stretched to stay in sync with the song**: change the tempo and
the audio follows, without changing pitch. A track owns many clips.

**Clip.** A loop belonging to one track. Any length, including odd ones (15
sixteenths is fine). **Only one clip per track plays at a time** — launching a
clip stops its siblings on the same track. This is how you switch basslines on
the Deluge: you don't edit the bassline, you launch the other one.

**Row.** In a kit clip, one drum. In an instrument clip, one pitch. Rows can
have their own length, independent of the clip (polymeter inside a single
clip).

**Note.** Start, length, velocity (1–127), probability (%), iterance ("3 of 4"
— plays only on the 3rd of every 4 loops). Notes at the same position with the
same probability play or skip together (a chord either happens or doesn't).
Probabilities at one position summing to 100 means exactly one of them plays.

**Section.** Not a container — a *colour tag* on each clip. Launching a
section launches every clip of that colour and stops everything else. A
section can be set to repeat N times, then hand off to the section below it.

**Arrangement.** Per-track timeline. Each placed block is an *instance* of a
clip. Instances are either **linked** (edit the clip, every instance changes)
or **unique** (exists only at that point in the arrangement).

### 1.2 The surface

A 16×8 grid of pads plus two sidebar columns. What the grid means depends on
the view; the sidebar's meaning changes with it.

| View | Grid X | Grid Y | Sidebar 1 | Sidebar 2 |
|---|---|---|---|---|
| Clip — kit | time | drum | mute | audition (play drum) |
| Clip — instrument | time | pitch | mute | audition (play note) |
| Clip — audio | time | the waveform, drawn in the clip's colour | mute | — |
| Song | clip content, compressed | one clip per row | launch | section colour |
| Arranger | time | track | mute | audition |
| Keyboard | pitch, semitones | pitch, 4ths per row | — | — |
| Velocity / automation | time | value | mute | audition |

Around it: two navigation encoders (◄► and ▼▲, both pushable), a select
encoder, a tempo encoder, two gold parameter knobs, and buttons (shift, back,
play, record, song, clip, keyboard, kit, synth, scale, load, save, affect
entire, triplets, cross-screen, learn, tap tempo).

### 1.3 The grammar

These verbs mean the same thing in every view. That consistency is the point.

| Gesture | Meaning |
|---|---|
| Tap empty pad | Create (a note, a clip, an arrangement instance) |
| Tap existing | Delete it |
| Hold A, tap B on the same row further right | Extend A to reach B |
| Hold A, tap B elsewhere | Clone A to B |
| Hold A, turn an encoder | Change a property of A |
| Hold A, scroll | Move A |
| Hold A, press delete | Delete A |
| Shift + anything | The alternate: silent, instant (unquantized), finer, or cycle |
| Back / Shift+Back | Undo / redo |
| Turn ◄► or ▼▲ | Scroll |
| Push-and-turn ◄► | Zoom |

"Tap to create" is a note in clip view, a clip in song view, and an instance
in the arranger. "Hold and tap to extend" lengthens a note in clip view and an
instance in the arranger. One vocabulary, every scale.

---

## Part 2 — Why it clicked

A revised thesis, grounded in the research. In rough order of importance.

**1. Quasimodes, not modes.** Every edit is *hold the thing, then act on it*.
The physical hold is the selection. Releasing ends it. There is no selected
state to forget, no tool palette, no mode you can be stranded in. The only
persistent state is which *view* you are in — and the entire grid changes when
that changes, so it is impossible to miss. (Jef Raskin called a mode that only
lasts while physically maintained a *quasimode*.) This is most likely the
biggest reason FL Studio didn't click and the Deluge did: FL is full of
persistent modes — tools, selections, focused windows, open dialogs.

**2. One grammar at every scale.** The verbs in 1.3 never change meaning.
Learn "hold and tap to extend" once; it works on a note and on an arrangement
block.

**3. Zoom is resolution.** Columns are always equal slices of time; zooming
changes the slice size, from 64th notes up to the entire song in a single pad.
Zoom out to quarter notes and tap eight pads: a kick across eight bars. Zoom
to 64ths: glitch edits. No resolution setting, no separate tool. Detail too
fine to show at the current zoom lights near-white, so nothing ever hides
silently.

**4. One surface speaks rhythm and pitch.** What Y means depends on the clip
type. A sample loaded into an instrument clip becomes playable across pitch on
the same grid you drum on — different notes of the same hi-hat, placed higher
or lower. Same gestures, same zoom, same colours.

**5. Alternatives, not edits.** Clips on a track are mutually exclusive, so
variation happens by cloning and launching, not by editing in place. You never
destroy one idea to try another.

**6. Songs are vertical and coloured.** Roman's workflow: build a 1–8 bar loop
in one section; clone it into a new section; mutate the clone without mercy
(the original is safe); place the new section above or below. The song ends up
reading top to bottom — intro at the top, ending at the bottom. Then either
chain sections with repeat counts, or *record yourself launching them* into the
arranger.

**7. Light is the language.** Hue means identity (which clip, which drum,
which section). Brightness means intensity (velocity; a note's head versus its
tail). Dim grey means outside the loop. Near-white means hidden detail.
Blinking means pending. At 16th-note zoom each clip has a recognisable pattern
of colour, and experienced users navigate by recognising shapes, not reading
names.

**8. Undo instead of confirmation.** Nothing asks "are you sure". Everything
reverses with Back. That is what makes fearless editing possible.

**9. Always playing.** Edits land while the music runs, in time.

---

## Part 3 — Translating to the iPad

### 3.1 What transfers

The grid (touch pads). The grammar — multi-touch is a natural fit, because
*hold with one finger, act with another* is exactly the Deluge's two-handed
model. The colour language. Zoom. Undo.

### 3.2 What doesn't

Physical encoders and buttons (replaced on screen, see 3.4–3.5) and the feel
of a pad. iPad touch is not pressure-sensitive and Safari has no haptics. The
Deluge's pads weren't velocity-sensitive either, so nothing is lost there — but
every piece of feedback must be visual or audible.

### 3.3 What touch does better

Drawing values across columns (velocity, automation). A readable text readout
instead of four characters. Short labels on audition pads. Tints and
gradients the LEDs couldn't do. **Rule:** use these only if they read at a
glance and add no mode.

### 3.4 Screen layout (landscape only)

```
┌──────────────────────────────────────────────────────────────┐
│ TOP BAR   view · tempo · swing · song name · save            │
├───┬────────────────────────────────────────────┬─────┬───────┤
│   │ TIME RULER  1 · 2 · 3 · 4 ·                 │     │       │
├───┼────────────────────────────────────────────┼─────┼───────┤
│ R │                                            │ S1  │  S2   │
│ O │                                            │     │       │
│ W │              16 × 8 GRID                   │     │       │
│   │                                            │     │       │
│ R │                                            │     │       │
│ U │                                            │     │       │
│ L │                                            │     │       │
│ E │                                            │     │       │
│ R │                                            │     │       │
├───┴────────────────────────────────────────────┴─────┴───────┤
│ [SHIFT] [BACK]    READOUT    [E1][E2][E3]   [G1][G2]  [REC][▶]│
│ [SONG][CLIP][KBD] [KIT][SYNTH][AUDIO][SCALE] [LOAD][SAVE] [page]│
└──────────────────────────────────────────────────────────────┘
```

Sizing: an 11" iPad Pro in landscape is about 1194×834 points. Eighteen
columns (16 + 2 sidebar) plus a row ruler gives pads of roughly 56–60pt —
comfortably above Apple's 44pt minimum. Eight rows is about 500pt, leaving
room for the bars. On a 12.9" iPad, **make the pads bigger; don't add rows.**
Boundedness is a feature.

Keep every control clear of the bottom ~20pt (the home-indicator edge), where
iPadOS edge swipes will steal touches.

### 3.5 Replacing the encoders

The Deluge's knobs do two different jobs: *navigation* (◄► and ▼▲ scroll and
zoom) and *values* (select, gold, and ◄►/▼▲ when something is held). We split
them by meaning, into one clean rule:

> **Rulers move things in time and space. Knobs change what things are.**

**Rulers — navigation and anything positional.** Every touch on the grid is a
pad press, so gestures live on the rulers instead, with no ambiguity.

- *Time ruler* (above the grid): drag to scroll; pinch to zoom, snapping to
  musical levels (64th → 32nd → 16th → 8th → quarter → bar → 2 bars → …); tap
  to show zoom level and position in the readout; double-tap to fit the whole
  clip.
- *Row ruler* (left edge): drag to scroll rows. In instrument clips it labels
  pitches (C3, D3…).

**Knobs — values.** Three touch encoders (E1–E3) plus two gold knobs. Turn by
dragging vertically (relative; a slower drag is finer). **Their labels change
to show what they'll do given what you're holding**, and the readout shows the
name and value while turning. This is the Deluge's hold-and-turn with honest
labels.

**Gold knobs** always edit sound: the current track, or the selected kit row,
or the whole kit when AFFECT ENTIRE is on. A page button cycles pairs:
VOL/PAN · CUTOFF/RES · ATTACK/RELEASE · PITCH/START (more later).

### 3.6 The translation table

What each Deluge action becomes. Anything not listed follows the same pattern.

| Deluge | Here |
|---|---|
| Turn ◄► | Drag time ruler |
| Push + turn ◄► (zoom) | Pinch time ruler |
| Turn ▼▲ | Drag row ruler |
| Shift + turn ◄► (clip length) | Shift + drag time ruler |
| Shift + push ◄► (multiply clip) | Shift + tap time ruler |
| Hold ▼▲ + turn ◄► (rotate contents) | Hold CLIP + drag time ruler |
| Hold ◄► + play (play from here) | Hold time ruler + PLAY |
| Hold ◄► + back (clear clip) | Hold CLIP + BACK |
| Hold note + turn ◄► (velocity) | Hold note + **E1** |
| Hold note + turn select (probability ← / iterance →) | Hold note + **E2** (left/right) |
| Hold note + push-turn ▼▲ (repeats) | Hold note + **E3** |
| Hold note + push-turn ◄► (nudge) | Hold note + drag time ruler |
| Hold audition + turn ◄► (row length) | Hold audition + drag time ruler |
| Hold audition + turn ▼▲ (move kit row) | Hold audition + drag row ruler |
| Hold audition + push-turn select (sharpen/flatten scale note) | Hold audition + **E2** |
| Push-turn ▼▲ (transpose; shift = semitone) | **E3** with nothing held |
| Shift + turn ▼▲ (clip colour) | Shift + **E3** |
| Hold section pad + turn select (repeats) | Hold section pad + **E1** |
| Hold arranger instance + turn select (which clip) | Hold instance + **E1** |
| Hold tempo + press pad in audio clip (take tempo from clip) | Hold TEMPO + tap any pad |
| ▼▲ + ◄► (set audio clip length to sample length) | Hold CLIP + tap time ruler |

### 3.7 Touch rules (the input system)

- Pointer Events, tracking every `pointerId`. `touch-action: none` across the
  app. Disable text selection, callouts, the magnifier, and double-tap zoom.
- Every pad shows its pressed state on touch-down, instantly, always.
- **Empty pad:** create on touch-down, so it can immediately become a hold.
- **Existing note:** act on touch-up — delete it only if the hold wasn't used
  (no knob turned, no second pad tapped). If the hold was used, release does
  nothing. This is how hold-to-edit and tap-to-delete coexist.
- **A note's tail:** tap to shorten the note so it ends there.
- **A second touch while a pad is held is a combo**, not an independent tap.
- **Audition and keyboard pads sound on touch-down**, immediately, and stop on
  touch-up for samples in CUT or LOOP mode.
- Long-press threshold ~250ms, configurable.
- SHIFT is held by default, with an optional sticky mode (tap to latch).
- No drag-to-move for notes in v1 (see open questions).

### 3.8 Visual language

This section specifies *meaning*. The palette itself is a design job — Jared's.

| State | Rendering |
|---|---|
| Pad off | Near-black; every other 4-column group very slightly lighter (beat grouping) |
| Note head | Clip or row hue; brightness scales with velocity |
| Note tail | Same hue, ~30% brightness |
| Beyond clip or row end | Dark, desaturated, no hue |
| Hidden detail (zoomed out) | Near-white |
| Playhead | White overlay column — **one per row when rows have different lengths**, so polymeter is visible as playheads drifting apart |
| Held / selected | White ring |
| Pending (armed launch, etc.) | Blink at 8th notes, in tempo |
| Muted row | Mute pad yellow, row desaturated (active: green) |
| Launch pad | Green playing · red stopped · blinking armed · blue soloed |
| Instrument clip rows | Root-note rows faintly tinted; in chromatic mode, out-of-scale rows darker (piano black-key logic) |
| Recording | Playhead red |
| Sections | A fixed, ordered palette of 12, distinguishable at a glance and under glare |

### 3.9 The readout

A small display near the knobs. Terse, transient text: `VEL 96`, `16TH`,
`3.2.1`, `PROB 70%`, `3 OF 4`, `LEN 0.3.3`, `C#3`, `ROW 12`. Fades after about
a second. It replaces the Deluge's four-character display: more legible, still
terse.

---

## Part 4 — The views

### 4.1 Clip view — kit

Rows are drums, X is time. Sidebar: mute, audition.

| Action | Result |
|---|---|
| Tap empty pad | Note (sounds if stopped; silent if playing) |
| Tap note | Delete (on release, if the hold wasn't used) |
| Hold note, tap further right on the row | Extend (long samples only; one-shots stay one pad) |
| Hold note + E1 / E2 / E3 | Velocity / probability-iterance / repeats |
| Hold note + drag time ruler | Nudge |
| Hold several notes + knob | Edit them all together |
| Tap audition | Play the drum; select row for gold knobs |
| Shift + audition | Select row silently |
| Hold audition + drag time ruler | Row length (polymeter) |
| Hold audition + drag row ruler | Move the row |
| Hold audition + LOAD | Replace this row's sample (Files picker) |
| Hold empty row's audition + LOAD | Add a new drum |
| Tap mute | Toggle |
| Shift + drag time ruler | Clip length |

New notes default to the velocity of the last note touched in that clip.
Samples under 2 seconds default to ONCE (always play fully); longer ones to
CUT (stop at note end) — the Deluge's rule. A fourth mode, **STRETCH**,
time-stretches the sample to exactly fill the note's length at the current
tempo, pitch unchanged — this is how the Deluge keeps loops inside kits
locked to tempo. Uses the stretch engine (Part 6).

### 4.2 Clip view — instrument

Same as kit, except:

- **Y is pitch.** Scale mode is on by default: rows are scale degrees, so more
  useful notes fit on screen and wrong notes are hard to hit. SCALE toggles
  chromatic. Shift+SCALE cycles modes (major, minor, dorian…). Hold SCALE and
  tap an audition pad to set the root. All clips share one scale (Deluge rule).
- **The audition column is a keyboard.** It plays that row's pitch.
- **Note length is real.** Hold and tap right to extend. CUT, LOOP and
  STRETCH samples honour length; ONCE ignores it.
- **Pitch** is `playbackRate = 2 ^ ((note − root) / 12)` by default —
  varispeed, the classic sampler sound, where higher notes also play shorter.
  An optional per-track setting *unlinks pitch from speed*, so every note
  keeps the sample's original duration at any pitch (via the stretch engine).
  Each track has a root note (the pitch the sample was recorded at, default
  C3/60), adjustable on the PITCH gold knob.
- **E3 with nothing held transposes** the clip (octave; with shift, semitone).

### 4.3 Clip view — audio

One long sample — a loop, a vocal phrase, a stem — that always fills its
clip. The Deluge rule, kept exactly: **audio clips are always stretched to
stay in sync with the song.** Change the tempo and the audio follows. Change
the clip's length and the audio stretches to fill it.

- **The grid shows the waveform** in the clip's colour: columns are time,
  lit height is loudness. Zoom and scroll work exactly as in every other
  view, so zooming in is how you see detail for trimming.
- **Pitch and speed are unlinked by default** — tempo changes never change
  pitch. Linking them gives varispeed instead (the turntable sound: faster
  and higher together).

| Action | Result |
|---|---|
| LOAD in an empty audio clip | Load a file. Initial length: the nearest whole number of bars (1, 2, 4, 8, 16) at the current tempo |
| Shift + drag time ruler | Clip length — the audio stretches to fill it |
| Hold CLIP + tap time ruler | Fit: set the clip length to the sample's natural length at the current tempo, so no stretch is applied |
| Hold TEMPO + tap any pad | Take tempo from the clip: set the song's tempo so this clip plays unstretched |
| Hold the first lit column + drag time ruler | Move the start point (trim) |
| Hold the last lit column + drag time ruler | Move the end point (trim) |
| E3, nothing held | Transpose in semitones, independent of speed |
| Gold knobs | Volume, pan, filter — as for any track |
| Tap mute | Toggle |

"Fit" and "take tempo from clip" come straight from the Deluge. Trimming by
holding an edge and dragging the ruler follows the law: *rulers move things
in time.*

A small helper: if a filename contains a tempo (`break_92bpm.wav`), use it
for the initial length instead of rounding to bars.

### 4.4 Song view

Each row is one clip, from any track. Rows are freely ordered — by
convention, grouped by section colour, top to bottom, in song order.

- **The 16 pads show the clip's content compressed** — its visual fingerprint.
- **Sidebar:** launch pad, section pad.

| Action | Result |
|---|---|
| Tap a clip's pads | Enter its clip view |
| Tap empty row | New clip, same type as last. Long-press: KIT / SYNTH / AUDIO buttons flash; tap one |
| Tap launch pad | Arm (starts at the next loop boundary of the longest playing clip; stops at its own end) |
| Shift + launch pad | Instant launch or stop, jumping to the correct phase |
| Long-press launch pad | Toggle solo |
| Tap section pad | Launch the whole section (stops other sections) |
| Hold section pad + E1 | Repeats: ∞ or N, then hand off to the section below |
| Shift + tap section pad | Cycle the clip's section colour |
| Hold clip, tap another row | Clone (same track, new section, not launched) |
| Hold clip + drag row ruler | Move it |
| Hold clip + DELETE | Delete it |
| Hold clip + gold knobs | Tweak its track's sound without entering |
| REC + SONG | **Record your performance into the arranger** |

Launching a clip always stops any other clip on the same track.

### 4.5 Arranger

Rows are tracks. X is time; default zoom 1 column = 1 bar.

| Action | Result |
|---|---|
| Tap empty pad | Place an instance of the track's most recent clip |
| Instance display | Head pad = section colour, tail dim; a white head = unique |
| Tap a non-head pad | Enter that clip |
| Hold instance, tap further right | Extend (the clip loops) |
| Hold instance + E1 | Cycle which clip — including "new unique clip" |
| Shift + tap instance | Make it unique |
| Hold instance + drag time ruler | Move in time |
| Shift + drag time ruler | Insert or delete time at the current screen |
| Hold a clip in song view + tap SONG | Carry it into the arranger; scroll; release to drop |
| PLAY / hold ruler + PLAY | Play from start / from here |

REC + SONG in song view is the bridge from jamming to arranging: every launch
and stop you make is written here as instances.

### 4.6 Keyboard view (instrument clips)

Isomorphic layout: X ascends in semitones; each row is a 4th above the one
below (guitar-like). Scale notes highlighted, root brightest. Plays on
touch-down. Multi-touch chords work naturally. With REC on and playback
running, notes record into the clip, quantized.

### 4.7 Velocity and automation views (later)

The grid becomes a bar graph: each column's lit height is the value at that
step.

- Tap a pad → set that column to that height.
- Two pads in one column → the midpoint (fine values).
- Two pads in different columns → a linear ramp between them.
- **Touch addition:** drag across columns to draw.
- Bipolar parameters (pan, pitch): top half positive, bottom half negative.

This is the one place touch is plainly better than the hardware.

---

## Part 5 — The golden path

The acceptance test for the whole app. A song, start to finish, without
leaving the grid:

1. Open the app. Empty song view.
2. Long-press row 1 → KIT. Load kick, snare, hat, 808. Program a bar.
3. Hold the hat's audition pad and drag the time ruler: hat row is now 12
   steps. Polymeter.
4. SONG. Long-press row 2 → SYNTH. Load a hi-hat. Y is now pitch, locked to
   the scale. Sequence a melody out of the hi-hat — or import a `.mid` file
   and let it drive the hi-hat.
5. SONG. Long-press row 3 → AUDIO. Load a breakbeat recorded at 92 BPM. It
   locks to the song's tempo without changing pitch. Hold its first lit
   column and drag the ruler to trim off the pickup.
6. All three clips are in section A. Launch A. Play the gold knobs. Drag the
   tempo — the break follows.
7. Hold the kit clip, tap row 4: a clone in section B. Enter it, strip it
   down. Same for the melody.
8. Hold B's clips and drag them above A. The song reads top to bottom: B
   (intro), A (main).
9. Hold B's section pad + E1: 4 repeats. A: 8. Launch B — it plays four times
   and hands off to A.
10. REC + SONG. Perform: launch sections, drop the drums, bring them back. It
    lands in the arranger.
11. Arranger: extend the outro. Make one bar unique and add a fill.
12. Save.

**If any step needs a panel, a dialog, or a menu dive (other than the iOS
file picker), the design has failed.**

---

## Part 6 — Engine implications

The flat 16-step clock cannot support this. The timing *invariants* stay
exactly as they are; the API underneath changes.

- **Tick-based transport at 96 PPQN.** A 64th is 6 ticks, a 16th is 24, a
  16th-triplet is 16 — all integers.
- **Time map:** an anchor of (ctx time, tick, bpm), re-anchored on every tempo
  change so the tick↔time conversion stays exact.
- **The scheduler asks a window question:** "which notes fall in
  [tickA, tickB)?" — across every playing clip, handling loop wrap.
- **Each playing clip has a launch tick.** Clip-local position = (tick −
  launch) mod clip length. Rows with their own length use their own modulus.
- **Iteration count** = floor((tick − launch) / length), per clip or row.
  This drives iterance.
- **Probability** is rolled at schedule time. Notes sharing a position and a
  probability value share one roll.
- **Launch quantization:** an armed clip starts at the next boundary of the
  longest playing clip. Instant launch starts now, at the correct phase.
- **Note-offs:** instrument notes schedule their release at note end
  (envelope release ramp, then stop).
- **Swing** delays even 16ths.
- **Playheads** are computed in `requestAnimationFrame` from `ctx.currentTime`
  through the time map. Never from the scheduler.
- **Voices:** per-track polyphony cap (8), oldest note stolen. Kit rows are
  mono per row by default (a retrigger cuts the previous hit).
- **Undo:** every edit goes through one mutation layer that snapshots the song
  model (it is small JSON). Cap around 100 steps.

All of the above landed in milestone 3 and is verified. The transport is
settled again.

### Time-stretch

Browsers have no pitch-preserving time-stretch. `playbackRate` always moves
pitch and speed together (which is exactly right for varispeed, and exactly
wrong for keeping a 92 BPM break at its own pitch in a 120 BPM song).

- **Engine:** Signalsmith Stretch — MIT licence, an officially supported
  Web Audio release (WASM + AudioWorklet), shipped as a single `.js`/`.mjs`
  file. Vendored in `js/vendor/`, wrapped by `stretch.js`.
- **Strategy: pre-render into a cache.** A stretched version of a sample is
  rendered once, ahead of time, into an ordinary `AudioBuffer`, keyed by
  (sample, trim points, ratio, transpose). Playback then uses a plain
  `AudioBufferSourceNode.start(time)` — so the proven scheduler does not
  change at all, and playback costs nothing extra per voice.
- **On tempo change,** re-render in the background. Until the new render is
  ready, keep playing the previous one at a matching varispeed rate, so
  nothing drops out. A brief pitch wobble during a tempo drag is acceptable;
  silence or a missed beat is not.
- **Renders are a cache, never saved.** They are rebuilt from the sample and
  the song tempo after a reload.
- **Spike first.** Before building audio clips: a throwaway test page, like
  the clock test. Load a loop, stretch it from its native tempo to the
  song's, play it against the metronome, drag the tempo. Measure how long a
  render takes on this iPad and listen for artefacts. If offline rendering
  turns out too slow, the fallback is one live Stretch node per playing
  audio clip — the library supports scheduled start and stop at future
  context times.

---

## Part 7 — What not to copy, and what not to "improve"

**Don't copy:**

- Arbitrary combos that only exist because the hardware had few controls
  (hold LEARN + push ◄► to copy). Use labelled buttons inside the hold grammar.
- The four-character display. Use the readout.
- A file browser driven by an encoder. Use the iOS Files picker, plus an
  in-app shelf of already-loaded samples.
- The Deluge's thin region copy/paste — a known pain point. Planned: hold two
  corner pads + COPY; hold a target corner + PASTE.

**Don't "improve" into a DAW:**

- No separate piano roll. No mixer screen. No inspector panels. No confirm
  dialogs. No drag-to-move notes in v1.

---

## Part 8 — Open questions (prototype before committing)

1. Delete-on-release for existing notes: does it feel right, or laggy?
2. Ruler pinch sensitivity and zoom snapping.
3. Where the knobs sit so one hand can hold the grid while the other turns.
4. Knob drag sensitivity: points per unit, and how fine mode engages.
5. Solo gesture in song view (long-press launch is a guess).
6. Sticky shift on or off by default.
7. Audition latency on touch-down — measure it.
8. 11" versus 12.9" layout.
9. Is drag-to-move notes worth adding later, given it competes with
   hold-and-tap?
10. Stretch render time and quality on this iPad — settled by the Part 6
    spike.
11. ~~Recording into audio clips~~ — resolved: out of scope. Audio clips are
    loaded from files only; no microphone input, no resampling.

---

## Part 9 — Build order

See the roadmap in `CLAUDE.md`. The principle: reach pitched sample
instruments — the thing that made the Deluge click — as early as possible,
then build the full grammar on a foundation that already supports it.