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
//   Track  id, type 'kit', name, hue, drums[], clips[], activeClipId, arrangement[]
//   Drum   id, sampleId, name, hue, voice, mute
//   Clip   id, name, section, lengthTicks, launch, rows{}, notes[]
//   Note   row, tick, length, velocity, probability, iterance, repeats

import { PPQN } from './clock.js';
import * as history from './history.js';

// A 16th note: one grid column at the kit's zoom, and a new note's length.
export const STEP_TICKS = PPQN / 4;

// Bump when the saved shape changes, so an old save can be upgraded
// instead of misread.
const SONG_VERSION = 1;

const KIT_ROWS = 8;
const CLIP_STEPS = 16;
const SECTION_COUNT = 12;
const MIN_BPM = 20;
const MAX_BPM = 300;

// Colour as memory: each drum keeps its hue everywhere it appears.
// Degrees on the colour wheel: red, orange, yellow, green, teal, blue,
// violet, pink — the prototype's pad colours.
const DRUM_HUES = [9, 29, 46, 99, 173, 210, 259, 327];

// --- Making things

// Short unique ids. Readable in saved JSON, and never reused.
export function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// How a sample is shaped when it plays. Stored now so the shape of the
// data is settled; voice.js starts applying these at milestone 4.
function defaultVoice() {
  return {
    volume: 0.8,       // 0–1
    pan: 0,            // -1 left … 1 right
    attack: 0,         // seconds
    decay: 0,          // seconds
    sustain: 1,        // 0–1
    release: 0,        // seconds
    cutoff: 20000,     // Hz — fully open
    resonance: 0,      // 0–1
    start: 0,          // 0–1, where in the sample playback begins
    mode: 'once',      // 'once' | 'cut' | 'loop'
    reverse: false,
  };
}

// Velocity, probability, iterance and repeats are stored with neutral
// values; nothing reads them yet (milestone 11).
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
    rows,                                  // rowKey → { lengthTicks?, mute }
    notes: [],
  };
}

function makeKitTrack(name) {
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
    hue: DRUM_HUES[0],
    drums,
    clips: [clip],
    activeClipId: clip.id,   // one clip per track plays
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
    scale: { root: 0, mode: 'major', enabled: true },
    // Index = section colour. repeats: null means "loop until told".
    sections: Array.from({ length: SECTION_COUNT }, () => ({ repeats: null })),
    tracks: [makeKitTrack('Kit')],
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

// The kit track and the clip it's playing. Until song view exists there's
// exactly one of each. Returns null if the song doesn't have them.
export function currentKitClip(s = song) {
  const track = s.tracks.find((t) => t && t.type === 'kit');
  const clip = track && Array.isArray(track.clips)
    && track.clips.find((c) => c && c.id === track.activeClipId);
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

// Turn one grid cell on or off. A cell covers `span` ticks from `tick`.
// If any note in the row starts inside it, the cell is on, and this removes
// them; otherwise it places a new note at the start of the cell.
export function toggleNote(trackId, clipId, rowKey, tick, span) {
  return edit((s) => {
    const clip = findClip(s, trackId, clipId);
    if (!clip) return false;
    const inCell = (n) => n.row === rowKey && n.tick >= tick && n.tick < tick + span;
    if (clip.notes.some(inCell)) {
      clip.notes = clip.notes.filter((n) => !inCell(n));
    } else {
      clip.notes.push(makeNote(rowKey, tick, span));
    }
  });
}

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

// Tempo. A whole drag of the slider is one undo step: the edits merge
// until endGesture() is called.
export function setBpm(bpm) {
  bpm = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)));
  return edit((s) => {
    if (s.bpm === bpm) return false;
    s.bpm = bpm;
  }, 'tempo');
}

// Give one row its own loop length, or pass null to make it follow the
// clip again. Notes past the end aren't deleted — they just don't play,
// and come back if the row is lengthened.
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
  if (!isUsable(saved)) return false;
  song = saved;
  history.clear();
  emit('load');
  return true;
}

function isUsable(s) {
  if (!s || s.version !== SONG_VERSION || !Array.isArray(s.tracks)) return false;
  const kit = currentKitClip(s);
  return !!kit
    && Array.isArray(kit.track.drums)
    && Array.isArray(kit.clip.notes)
    && !!kit.clip.rows;
}
