// model.js — the song, and every way it can change.
//
// The song is plain JSON: no classes, and no references between objects,
// only ids. That's what lets it be saved as-is, and lets undo work by
// snapshotting the whole thing (it's small).
//
// The rule: nothing outside this file changes the song. Read it with
// getSong(); change it by calling one of the edit functions below. Each
// edit records an undo step, then tells everyone listening — the screen
// redraws, the autosave schedules a save. The transport needs no telling:
// it reads the song fresh for every window it books.
//
// And: never hold on to an object from the song across an edit. Undo swaps
// in a whole new copy, so hold ids and look things up again.
//
// Shape (see CLAUDE.md):
//
//   Song   id, name, bpm, swing, scale, sections[], tracks[]
//   Track  id, type, name, hue, clips[], activeClipId, arrangement[]
//            kit:        drums[]
//            instrument: sampleId, rootNote, voice, pitchSpeedLinked
//   Drum   id, sampleId, name, hue, voice, mute
//   Clip   id, name, section, lengthTicks, launch, rows{}, notes[]
//   Note   row, tick, length, velocity, probability, iterance, repeats
//
// A note's `row` is a drum id in a kit clip, and a MIDI pitch (a number)
// in an instrument clip. Notes always store their real pitch; which rows
// are on screen is the view's business.

import { PPQN } from './clock.js';
import * as history from './history.js';
import { nextMode, convertPitch, pitchClass } from './scale.js';

// A 16th note: one grid column at the kit's zoom, and a new note's length.
export const STEP_TICKS = PPQN / 4;

// The sample root a new instrument starts with: C3. The pitch a sample
// plays at its own, recorded speed.
export const DEFAULT_ROOT_NOTE = 60;

// MIDI's range of pitches.
export const LOWEST_PITCH = 0;
export const HIGHEST_PITCH = 127;

// Bump when the saved shape changes, so an old save can be upgraded
// instead of misread. See upgrade() at the bottom.
const SONG_VERSION = 2;

const KIT_ROWS = 8;
const CLIP_STEPS = 16;
const SECTION_COUNT = 12;
const MIN_BPM = 20;
const MAX_BPM = 300;
const VOICE_MODES = ['once', 'cut', 'loop'];

// Colour as memory: each drum keeps its hue everywhere it appears.
// Degrees on the colour wheel: red, orange, yellow, green, teal, blue,
// violet, pink — the prototype's pad colours.
const DRUM_HUES = [9, 29, 46, 99, 173, 210, 259, 327];

// Each new track takes the next of these, so tracks can be told apart by
// colour. The first is the kit's red, which the first track already has.
const TRACK_HUES = [9, 190, 46, 280, 130, 330, 220, 80];

// --- Making things

// Short unique ids. Readable in saved JSON, and never reused.
export function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// How a sample is shaped when it plays (see voice.js).
function defaultVoice() {
  return {
    volume: 0.8,       // 0–1
    pan: 0,            // -1 left … 1 right
    attack: 0,         // seconds
    decay: 0,          // seconds
    sustain: 1,        // 0–1
    release: 0,        // seconds
    cutoff: 20000,     // Hz — 20000 means fully open
    resonance: 0,      // 0–1
    start: 0,          // 0–1, where in the sample playback begins
    mode: 'once',      // 'once' | 'cut' | 'loop'
    reverse: false,
  };
}

// An instrument's notes have real length, so its sample follows it: CUT
// stops the sample when the note ends. A short release so notes end
// smoothly rather than abruptly.
function defaultInstrumentVoice() {
  return { ...defaultVoice(), mode: 'cut', release: 0.05 };
}

// Velocity, probability, iterance and repeats are stored with neutral
// values; nothing reads them yet (milestone 12).
function makeNote(row, tick, length) {
  return {
    row,               // drum id (kit) or MIDI pitch (instrument)
    tick,              // start, in ticks from the start of the clip
    length,            // in ticks
    velocity: 100,     // 1–127
    probability: 100,  // percent
    iterance: null,    // null = every loop
    repeats: 0,
  };
}

function makeClip(rowKeys) {
  const rows = {};
  for (const key of rowKeys) rows[key] = { mute: false };
  return {
    id: newId('clip'),
    name: null,
    section: 0,                            // 0–11, the section's colour
    lengthTicks: CLIP_STEPS * STEP_TICKS,  // one bar of 16ths
    launch: 'infinite',
    // rowKey → { lengthTicks?, mute }. Kit clips list every drum.
    // Instrument clips start empty: a missing row means "normal".
    rows,
    notes: [],
  };
}

function makeKitTrack(name, hue) {
  const drums = [];
  for (let i = 0; i < KIT_ROWS; i++) {
    drums.push({
      id: newId('drum'),
      sampleId: null,        // key into the samples store and audio cache
      name: 'Pad ' + (i + 1),
      hue: DRUM_HUES[i % DRUM_HUES.length],
      voice: defaultVoice(),
      mute: false,
    });
  }
  const clip = makeClip(drums.map((d) => d.id));
  return {
    id: newId('track'),
    type: 'kit',
    name,
    hue,
    drums,
    clips: [clip],
    activeClipId: clip.id,   // one clip per track plays
    arrangement: [],
  };
}

function makeInstrumentTrack(name, hue) {
  const clip = makeClip([]);
  return {
    id: newId('track'),
    type: 'instrument',
    name,
    hue,
    sampleId: null,
    rootNote: DEFAULT_ROOT_NOTE,
    voice: defaultInstrumentVoice(),
    pitchSpeedLinked: true,  // false (via the stretch engine) arrives at milestone 6
    clips: [clip],
    activeClipId: clip.id,
    arrangement: [],
  };
}

export function createSong() {
  return {
    version: SONG_VERSION,
    id: newId('song'),
    name: 'Untitled',
    bpm: 120,
    swing: 50,               // percent; 50 = straight. Not applied yet.
    // The key, shared by every instrument clip. root is a pitch class,
    // 0 = C … 11 = B. enabled: scale mode on (rows are the key's notes)
    // or off (chromatic: rows are every semitone).
    scale: { root: 0, mode: 'major', enabled: true },
    // Index = section colour. repeats: null means "loop until told".
    sections: Array.from({ length: SECTION_COUNT }, () => ({ repeats: null })),
    tracks: [makeKitTrack('Kit', TRACK_HUES[0])],
  };
}

// --- Reading

let song = createSong();
const listeners = [];

export function getSong() {
  return song;
}

// fn(reason) is called after every change. reason is 'edit', 'undo',
// 'redo' or 'load'.
export function onChange(fn) {
  listeners.push(fn);
}

function emit(reason) {
  for (const fn of listeners) fn(reason);
}

// A track and the clip it's playing, or null if there's no such track.
// Until song view exists, each track has exactly one clip.
export function trackAndClip(trackId, s = song) {
  const track = s.tracks.find((t) => t.id === trackId);
  const clip = track && track.clips.find((c) => c.id === track.activeClipId);
  return clip ? { track, clip } : null;
}

// How long one row of a clip loops for. A row can have its own length
// (polymeter); otherwise it follows the clip.
export function rowLengthTicks(clip, rowKey) {
  const row = clip.rows[rowKey];
  return (row && row.lengthTicks) || clip.lengthTicks;
}

// Every sample a song uses. Written defensively, because it's also used
// on saved songs that might be damaged or from an older version.
export function sampleIdsIn(s) {
  const ids = new Set();
  const tracks = (s && Array.isArray(s.tracks)) ? s.tracks : [];
  for (const t of tracks) {
    if (t && t.sampleId) ids.add(t.sampleId);
    for (const d of (t && Array.isArray(t.drums)) ? t.drums : []) {
      if (d && d.sampleId) ids.add(d.sampleId);
    }
  }
  return ids;
}

function findTrack(s, trackId) {
  return s.tracks.find((t) => t.id === trackId);
}

function findClip(s, trackId, clipId) {
  const track = findTrack(s, trackId);
  return track && track.clips.find((c) => c.id === clipId);
}

function findInstrument(s, trackId) {
  const track = findTrack(s, trackId);
  return track && track.type === 'instrument' ? track : null;
}

function instrumentClips(s) {
  const clips = [];
  for (const t of s.tracks) {
    if (t.type === 'instrument') clips.push(...t.clips);
  }
  return clips;
}

// After notes change pitch (a mode change can move two notes onto the
// same row), make each row sensible again: no two notes starting on the
// same tick, and no note ringing on past the start of the next one.
function tidyNotes(clip) {
  const byRow = new Map();
  for (const n of clip.notes) {
    if (!byRow.has(n.row)) byRow.set(n.row, []);
    byRow.get(n.row).push(n);
  }
  const kept = [];
  for (const notes of byRow.values()) {
    notes.sort((a, b) => a.tick - b.tick);
    notes.forEach((n, i) => {
      const prev = kept[kept.length - 1];
      if (i > 0 && prev.tick === n.tick) return;   // a duplicate: drop it
      kept.push(n);
    });
  }
  // Now clip each note at the next one on its row.
  for (let i = 0; i < kept.length - 1; i++) {
    const n = kept[i];
    const next = kept[i + 1];
    if (next.row === n.row && n.tick + n.length > next.tick) n.length = next.tick - n.tick;
  }
  clip.notes = kept;
}

// Rows are keyed by pitch in instrument clips, so their settings (mute,
// own length) move when their notes move.
function moveRows(clip, newPitchFor) {
  const moved = {};
  for (const key of Object.keys(clip.rows)) {
    const to = newPitchFor(Number(key));
    if (!(to in moved)) moved[to] = clip.rows[key];
  }
  clip.rows = moved;
}

// --- Changing things
//
// Every edit goes through edit(). `change` modifies the song in place; if
// it returns false, nothing changed and no undo step is recorded.

function edit(change, mergeKey = null) {
  const before = JSON.stringify(song);
  if (change(song) === false) return false;
  history.record(before, mergeKey);
  emit('edit');
  return true;
}

// --- Tracks

// Add an empty kit or instrument track. Returns its id.
export function addTrack(type) {
  let id = null;
  edit((s) => {
    const count = s.tracks.filter((t) => t.type === type).length;
    const hue = TRACK_HUES[s.tracks.length % TRACK_HUES.length];
    const track = type === 'instrument'
      ? makeInstrumentTrack('Inst ' + (count + 1), hue)
      : makeKitTrack('Kit ' + (count + 1), hue);
    s.tracks.push(track);
    id = track.id;
  });
  return id;
}

// --- Notes

// Place a note. Returns false if one already starts there.
export function placeNote(trackId, clipId, rowKey, tick, length) {
  return edit((s) => {
    const clip = findClip(s, trackId, clipId);
    if (!clip) return false;
    if (clip.notes.some((n) => n.row === rowKey && n.tick === tick)) return false;
    clip.notes.push(makeNote(rowKey, tick, length));
  });
}

export function deleteNote(trackId, clipId, rowKey, tick) {
  return edit((s) => {
    const clip = findClip(s, trackId, clipId);
    if (!clip) return false;
    const before = clip.notes.length;
    clip.notes = clip.notes.filter((n) => !(n.row === rowKey && n.tick === tick));
    if (clip.notes.length === before) return false;
  });
}

// Make the note starting at `noteTick` end at `endTick` — longer or
// shorter. It can't run past the end of its row. Any notes it now covers
// are removed (undo brings them back).
export function setNoteEnd(trackId, clipId, rowKey, noteTick, endTick) {
  return edit((s) => {
    const clip = findClip(s, trackId, clipId);
    if (!clip) return false;
    const note = clip.notes.find((n) => n.row === rowKey && n.tick === noteTick);
    if (!note) return false;

    const end = Math.min(endTick, rowLengthTicks(clip, rowKey));
    const length = Math.max(1, end - noteTick);
    const covered = (n) => n.row === rowKey && n.tick > noteTick && n.tick < noteTick + length;
    if (note.length === length && !clip.notes.some(covered)) return false;

    clip.notes = clip.notes.filter((n) => !covered(n));
    note.length = length;
  });
}

// --- Samples

// Point a drum at a newly loaded sample. The old sample isn't deleted:
// undo may want it back.
export function setDrumSample(trackId, drumId, sampleId, name) {
  return edit((s) => {
    const track = findTrack(s, trackId);
    const drum = track && track.drums.find((d) => d.id === drumId);
    if (!drum) return false;
    drum.sampleId = sampleId;
    drum.name = name;
  });
}

// An instrument plays one sample; the track takes the sample's name.
export function setInstrumentSample(trackId, sampleId, name) {
  return edit((s) => {
    const track = findInstrument(s, trackId);
    if (!track) return false;
    track.sampleId = sampleId;
    track.name = name;
  });
}

// The pitch the sample was recorded at, so every other pitch is worked
// out from it. Not the song's key.
export function setSampleRoot(trackId, rootNote) {
  rootNote = Math.round(Math.min(HIGHEST_PITCH, Math.max(LOWEST_PITCH, rootNote)));
  return edit((s) => {
    const track = findInstrument(s, trackId);
    if (!track || track.rootNote === rootNote) return false;
    track.rootNote = rootNote;
  });
}

// --- Sound (the voice settings: envelope, filter…)

// One setting of an instrument's voice. A whole drag of a control is one
// undo step: the edits merge until endGesture() is called.
export function setVoice(trackId, param, value) {
  return edit((s) => {
    const track = findInstrument(s, trackId);
    if (!track || track.voice[param] === value) return false;
    track.voice[param] = value;
  }, 'voice:' + trackId + ':' + param);
}

// ONCE → CUT → LOOP → ONCE.
export function cycleVoiceMode(trackId) {
  return edit((s) => {
    const track = findInstrument(s, trackId);
    if (!track) return false;
    const i = VOICE_MODES.indexOf(track.voice.mode);
    track.voice.mode = VOICE_MODES[(i + 1) % VOICE_MODES.length];
  });
}

// --- The key (shared by every instrument clip)

// SCALE: scale mode ↔ chromatic. Only changes which rows are shown.
export function toggleScale() {
  return edit((s) => {
    s.scale.enabled = !s.scale.enabled;
  });
}

// SHIFT + SCALE: the next mode. Every note in the key moves to the same
// degree of the new mode — major → minor lowers the 3rd, 6th and 7th —
// in every instrument clip, as one undo step. Notes outside the key
// stay where they are.
export function cycleMode() {
  return edit((s) => {
    const from = s.scale.mode;
    const to = nextMode(from);
    const move = (pitch) => convertPitch(pitch, s.scale.root, from, to);
    s.scale.mode = to;
    for (const clip of instrumentClips(s)) {
      for (const n of clip.notes) n.row = move(n.row);
      moveRows(clip, move);
      tidyNotes(clip);
    }
  });
}

// Hold SCALE + tap an audition pad: that pitch becomes the key's root.
// Only the labelling changes — notes stay where they are, and any that
// fall outside the new key show as extra, darker rows. This corrects the
// key; transpose() changes it.
export function setScaleRoot(pitch) {
  const root = pitchClass(pitch);
  return edit((s) => {
    if (s.scale.root === root) return false;
    s.scale.root = root;
  });
}

// Move notes up or down by `semitones`. In scale mode this changes the
// key: every note in every instrument clip moves, and the root moves with
// them, so everything stays in key. In chromatic mode only this clip
// moves. Refused if any note would go out of range.
export function transpose(trackId, clipId, semitones) {
  return edit((s) => {
    const clips = s.scale.enabled
      ? instrumentClips(s)
      : [findClip(s, trackId, clipId)].filter(Boolean);
    if (!clips.length || !semitones) return false;

    for (const clip of clips) {
      for (const n of clip.notes) {
        const to = n.row + semitones;
        if (to < LOWEST_PITCH || to > HIGHEST_PITCH) return false;
      }
    }
    for (const clip of clips) {
      for (const n of clip.notes) n.row += semitones;
      moveRows(clip, (pitch) => pitch + semitones);
    }
    if (s.scale.enabled) s.scale.root = pitchClass(s.scale.root + semitones);
  });
}

// --- Tempo

// A whole drag of the slider is one undo step: the edits merge until
// endGesture() is called.
export function setBpm(bpm) {
  bpm = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)));
  return edit((s) => {
    if (s.bpm === bpm) return false;
    s.bpm = bpm;
  }, 'tempo');
}

// --- Rows

// Give one row its own loop length, or pass null to make it follow the
// clip again. Notes past the end aren't deleted — they just don't play,
// and come back if the row is lengthened. Nothing calls this until
// milestone 8 gives row length its real control.
export function setRowLength(trackId, clipId, rowKey, lengthTicks) {
  return edit((s) => {
    const clip = findClip(s, trackId, clipId);
    if (!clip) return false;
    const row = clip.rows[rowKey] || (clip.rows[rowKey] = { mute: false });
    const current = row.lengthTicks || null;
    const wanted = lengthTicks || null;
    if (current === wanted) return false;
    if (wanted) row.lengthTicks = wanted;
    else delete row.lengthTicks;
  });
}

// A drag (or any held gesture) has ended: the next edit is its own step.
export function endGesture() {
  history.closeMerge();
}

// --- Undo / redo

export function undo() {
  const before = history.undo(JSON.stringify(song));
  if (before === null) return false;
  song = JSON.parse(before);
  emit('undo');
  return true;
}

export function redo() {
  const after = history.redo(JSON.stringify(song));
  if (after === null) return false;
  song = JSON.parse(after);
  emit('redo');
  return true;
}

// --- Loading

// Replace the song with one read back from storage. Returns false (and
// changes nothing) if it isn't a song this version can use.
export function load(saved) {
  const upgraded = upgrade(saved);
  if (!isUsable(upgraded)) return false;
  song = upgraded;
  history.clear();
  emit('load');
  return true;
}

// Bring a song saved by an older version up to date.
function upgrade(s) {
  if (!s || typeof s !== 'object') return s;
  if (s.version === 1) {
    // Version 1 is milestone 3. Its temporary debug button was the only
    // way a row could get its own length, so any row length in it is the
    // debug button's. Clear them, or that row would be stuck until row
    // length gets its real control at milestone 8.
    for (const t of Array.isArray(s.tracks) ? s.tracks : []) {
      for (const c of (t && Array.isArray(t.clips)) ? t.clips : []) {
        for (const row of Object.values((c && c.rows) || {})) {
          if (row) delete row.lengthTicks;
        }
      }
    }
    if (!s.scale) s.scale = { root: 0, mode: 'major', enabled: true };
    s.version = 2;
  }
  return s;
}

function isUsable(s) {
  if (!s || s.version !== SONG_VERSION || !Array.isArray(s.tracks) || !s.tracks.length) return false;
  if (!s.scale || typeof s.scale.root !== 'number') return false;
  return s.tracks.every((t) => {
    if (!t || !Array.isArray(t.clips)) return false;
    if (t.type === 'kit' && !Array.isArray(t.drums)) return false;
    if (t.type === 'instrument' && !t.voice) return false;
    if (t.type !== 'kit' && t.type !== 'instrument') return false;
    const found = trackAndClip(t.id, s);
    return !!found && Array.isArray(found.clip.notes) && !!found.clip.rows;
  });
}
