// views/clip.js — clip view, for kit and instrument clips.
//
// Turns the song into what the grid should show (cell descriptors), and
// turns touches on the grid into edits. It never draws anything itself
// (that's ui/grid.js) and never books sound on the clock (that's the
// transport). The one exception is playing a pad by hand: that sounds the
// moment it's touched.
//
// X is time, one column per 16th. Y depends on the track:
//   kit         one drum per row
//   instrument  one pitch per row, lowest at the bottom
//
// Which pitches get rows (instrument clips):
//   Scale mode   only the notes of the song's key, so C major gives
//                C D E F G A B C — an octave on 8 rows, no wrong notes.
//   Chromatic    every semitone; notes outside the key are drawn darker,
//                like the black keys of a piano.
//   Either way, a pitch that has a note on it always gets a row, even if
//   it's outside the key (drawn darker), so nothing heard is ever hidden.
//   The screen shows 8 of these at a time; ▲▼ move up and down the list.
//
// Touches (DESIGN.md 3.7):
//   empty pad            create a note, on touch-down, so it can at once
//                        become a hold. Sounds when stopped.
//   a note's head        on release, delete it — unless the hold was used
//   hold a note, tap     further right on its row: the note now reaches
//                        and includes that pad (instrument clips)
//   a note's tail        the note now ends where that pad begins
//   audition pad         plays the row now; lifting ends a CUT/LOOP note
//   hold SCALE + audition  that pitch becomes the key's root

import * as model from '../model.js';
import { STEP_TICKS, LOWEST_PITCH, HIGHEST_PITCH } from '../model.js';
import { inScale, pitchClass, pitchName } from '../scale.js';
import { createGrid } from '../ui/grid.js';

const ROWS = 8;
const COLUMNS = 16;

// deps: {
//   transport              for playhead positions, and "is it playing?"
//   mods                   { shift, scale, scaleUsed } — held buttons
//   playNow(track, rowKey) sound one row now; returns a voice or null
//   stopNow(voice)         release that voice now
//   importSample(file)     decode + store a file; resolves to its sample id
//   hasSample(sampleId)    is it decoded and ready to play?
//   onViewChange()         which track, or which rows, are on screen changed
// }
export function createClipView(container, deps) {
  const { transport, mods, playNow, stopNow, importSample, hasSample, onViewChange } = deps;

  // Screen-only state. Not part of the song, so not saved with it or undone.
  let trackId = null;            // the track on screen
  const bottoms = new Map();     // instrument track id → pitch on the bottom row
  const holds = new Map();       // pointerId → what that finger is holding
  const sounding = new Map();    // pointerId → voice it started (audition, preview)
  const busy = new Set();        // drum, track and sample ids being loaded
  const messages = new Map();    // drum id → short text shown instead of its name

  // The track on screen and its clip. Falls back to the first track if
  // ours has gone (undo can remove a track that was just added).
  function current() {
    const song = model.getSong();
    const found = model.trackAndClip(trackId, song) || model.trackAndClip(song.tracks[0].id, song);
    return { song, track: found.track, clip: found.clip };
  }

  // --- Rows

  // Every pitch that gets a row, lowest first.
  function pitchList(scale, clip) {
    const used = new Set(clip.notes.map((n) => n.row));
    const list = [];
    for (let p = LOWEST_PITCH; p <= HIGHEST_PITCH; p++) {
      if (!scale.enabled || inScale(p, scale) || used.has(p)) list.push(p);
    }
    return list;
  }

  // Where the list starts on screen: the first pitch at or above the one
  // remembered for the bottom row. Remembering a pitch rather than a
  // position keeps the view steady when rows come and go (toggling
  // chromatic, a mode change).
  function bottomIndex(list, song, track, clip) {
    const want = bottoms.has(track.id) ? bottoms.get(track.id) : startingBottom(song, track, clip);
    let i = list.findIndex((p) => p >= want);
    if (i === -1) i = list.length - 1;
    return Math.max(0, Math.min(i, list.length - ROWS));
  }

  // First visit to an instrument: start at its lowest note, or, if it has
  // none, at the key's root nearest C3.
  function startingBottom(song, track, clip) {
    if (clip.notes.length) return Math.min(...clip.notes.map((n) => n.row));
    return 60 + pitchClass(song.scale.root + 6) - 6;
  }

  // The row keys on screen, top row first: drum ids, or pitches.
  function rowKeys({ song, track, clip }) {
    if (track.type === 'kit') return track.drums.slice(0, ROWS).map((d) => d.id);
    const list = pitchList(song.scale, clip);
    const start = bottomIndex(list, song, track, clip);
    return list.slice(start, start + ROWS).reverse();
  }

  // The note starting in a column, or the note whose tail covers it.
  function noteAt(clip, rowKey, col) {
    const from = col * STEP_TICKS;
    const to = from + STEP_TICKS;
    const head = clip.notes.find((n) => n.row === rowKey && n.tick >= from && n.tick < to);
    if (head) return { note: head, part: 'head' };
    const tail = clip.notes.find((n) => n.row === rowKey && n.tick < from && n.tick + n.length > from);
    if (tail) return { note: tail, part: 'tail' };
    return null;
  }

  // Only notes whose sample follows note length can be longer than one
  // pad. Kit drums are one-shots, so kit notes stay one pad.
  function hasLength(track) {
    return track.type === 'instrument';
  }

  // --- Touches

  const grid = createGrid(container, ROWS, COLUMNS, {
    onCellDown(row, col, pointerId) {
      const c = current();
      const { track, clip } = c;
      const rowKey = rowKeys(c)[row];
      if (rowKey === undefined) return;
      const tick = col * STEP_TICKS;
      // Past the end of this row's loop there's nothing to place.
      if (tick >= model.rowLengthTicks(clip, rowKey)) return;

      // A second finger while a note on this row is held further left:
      // a combo. The held note stretches to reach this pad.
      if (hasLength(track)) {
        const holder = heldNoteLeftOf(track.id, clip.id, rowKey, col);
        if (holder) {
          holder.used = true;
          model.setNoteEnd(track.id, clip.id, rowKey, holder.noteTick, tick + STEP_TICKS);
          holds.set(pointerId, { kind: 'combo' });
          return;
        }
      }

      const found = noteAt(clip, rowKey, col);

      if (!found) {
        model.placeNote(track.id, clip.id, rowKey, tick, STEP_TICKS);
        holds.set(pointerId, {
          kind: 'note', trackId: track.id, clipId: clip.id, rowKey, col,
          noteTick: tick, created: true, used: false,
        });
        // Placing a note while stopped lets you hear it.
        if (!transport.isRunning) startSound(pointerId, track, rowKey);
        return;
      }

      if (found.part === 'tail') {
        model.setNoteEnd(track.id, clip.id, rowKey, found.note.tick, tick);
        holds.set(pointerId, { kind: 'combo' });
        return;
      }

      // The head of an existing note: hold it. What happens next is
      // decided when the finger lifts.
      holds.set(pointerId, {
        kind: 'note', trackId: track.id, clipId: clip.id, rowKey,
        col: Math.floor(found.note.tick / STEP_TICKS),
        noteTick: found.note.tick, created: false, used: false,
      });
    },

    onCellUp(pointerId, cancelled) {
      stopSound(pointerId);
      const hold = holds.get(pointerId);
      holds.delete(pointerId);
      if (!hold || hold.kind !== 'note') return;
      // Tap-to-delete, but only a plain tap: not a note that was just
      // made, not a hold that was used for something, not a touch iOS
      // took away.
      if (hold.created || hold.used || cancelled) return;
      model.deleteNote(hold.trackId, hold.clipId, hold.rowKey, hold.noteTick);
    },

    onLabelDown(row, pointerId) {
      const c = current();
      const rowKey = rowKeys(c)[row];
      if (rowKey === undefined) return;
      if (c.track.type === 'instrument' && mods.scale) {
        mods.scaleUsed = true;
        model.setScaleRoot(rowKey);
      }
      startSound(pointerId, c.track, rowKey);
    },

    onLabelUp(pointerId) {
      stopSound(pointerId);
    },

    async onFile(row, file) {
      // Hold ids, not objects: the song may be swapped by undo while the
      // file is decoding.
      const { track } = current();
      if (track.type !== 'kit') return;
      const trackId = track.id;
      const drumId = track.drums[row].id;

      busy.add(drumId);
      render();
      try {
        const sampleId = await importSample(file);
        model.setDrumSample(trackId, drumId, sampleId, baseName(file.name));
      } catch (err) {
        // Usually a format Safari can't decode. The old sample stays.
        console.error('Could not load', file.name, err);
        messages.set(drumId, "can't read file");
        // This timer only changes text on screen.
        setTimeout(() => { messages.delete(drumId); render(); }, 2000);
      } finally {
        busy.delete(drumId);
        render();
      }
    },
  });

  // A note held by another finger on the same row, to the left of `col`.
  function heldNoteLeftOf(tId, cId, rowKey, col) {
    for (const h of holds.values()) {
      if (h.kind === 'note' && h.trackId === tId && h.clipId === cId
          && h.rowKey === rowKey && h.col < col) return h;
    }
    return null;
  }

  // Sound a row by hand. A CUT or LOOP sample keeps going until the
  // finger lifts.
  function startSound(pointerId, track, rowKey) {
    const voice = playNow(track, rowKey);
    if (voice) sounding.set(pointerId, voice);
  }

  function stopSound(pointerId) {
    const voice = sounding.get(pointerId);
    sounding.delete(pointerId);
    if (voice && voice.sustains) stopNow(voice);
  }

  // --- What the grid should show right now.

  function describe() {
    const c = current();
    const { song, track, clip } = c;
    const songTick = transport.songTick();

    const notesByRow = new Map();
    for (const note of clip.notes) {
      if (!notesByRow.has(note.row)) notesByRow.set(note.row, []);
      notesByRow.get(note.row).push(note);
    }

    return rowKeys(c).map((rowKey) => {
      const length = model.rowLengthTicks(clip, rowKey);

      // Tails first, then heads on top, so a head always shows.
      const states = new Array(COLUMNS).fill('off');
      const notes = notesByRow.get(rowKey) || [];
      for (const n of notes) {
        const head = Math.floor(n.tick / STEP_TICKS);
        const end = Math.ceil((n.tick + n.length) / STEP_TICKS);
        for (let col = head + 1; col < end && col < COLUMNS; col++) states[col] = 'tail';
      }
      for (const n of notes) {
        const head = Math.floor(n.tick / STEP_TICKS);
        if (head < COLUMNS) states[head] = 'head';
      }

      // Each row has its own playhead, so rows of different lengths can be
      // seen drifting apart and meeting again.
      const pos = transport.rowPosition(track.id, clip, rowKey, songTick);
      const playCol = pos === null ? -1 : Math.floor(pos / STEP_TICKS);

      let label;
      let hue;
      let tint = null;
      if (track.type === 'kit') {
        const drum = track.drums.find((d) => d.id === rowKey);
        hue = drum.hue;
        const restoring = drum.sampleId !== null && busy.has(drum.sampleId);
        label = {
          name: messages.get(drum.id) || drum.name,
          loaded: !!drum.sampleId && (hasSample(drum.sampleId) || restoring),
          busy: busy.has(drum.id) || restoring,
          loadable: true,
        };
      } else {
        hue = track.hue;
        if (pitchClass(rowKey) === song.scale.root) tint = 'root';
        else if (!inScale(rowKey, song.scale)) tint = 'outside';
        const restoring = track.sampleId !== null && busy.has(track.sampleId);
        label = {
          name: pitchName(rowKey),
          loaded: !!track.sampleId && (hasSample(track.sampleId) || restoring),
          busy: busy.has(track.id) || restoring,
          loadable: false,   // holding a keyboard pad holds the note
        };
      }
      label.hue = hue;
      label.tint = tint;

      const cells = [];
      for (let col = 0; col < COLUMNS; col++) {
        cells.push({
          hue,
          state: col * STEP_TICKS >= length ? 'beyond' : states[col],
          beat: col % 4 === 0,
          playhead: col === playCol,
          tint,
        });
      }
      return { label, cells };
    });
  }

  function render() {
    grid.update(describe());
  }

  // --- For the controls around the grid

  function showTrack(id) {
    if (id === trackId) return;
    trackId = id;
    render();
    onViewChange();
  }

  // Move the rows up or down: one row, or with `octave`, twelve semitones.
  function scroll(direction, octave) {
    const { song, track, clip } = current();
    if (track.type !== 'instrument') return;
    const list = pitchList(song.scale, clip);
    const i = bottomIndex(list, song, track, clip);
    let j = i + direction;
    if (octave) {
      // Step through the list until we've moved at least 12 semitones.
      const target = list[i] + 12 * direction;
      j = i;
      while (j >= 0 && j < list.length && (direction > 0 ? list[j] < target : list[j] > target)) {
        j += direction;
      }
    }
    j = Math.max(0, Math.min(j, list.length - ROWS));
    bottoms.set(track.id, list[j]);
    render();
    onViewChange();
  }

  // Mark a drum, track or sample id as loading (it dims while it is).
  function setBusy(key, on) {
    if (on) busy.add(key);
    else busy.delete(key);
    render();
  }

  // Which track and rows are on screen, to remember across restarts.
  function getState() {
    return { trackId: current().track.id, bottoms: Object.fromEntries(bottoms) };
  }

  function setState(state) {
    if (!state) return;
    if (state.bottoms) {
      for (const [id, pitch] of Object.entries(state.bottoms)) {
        if (typeof pitch === 'number') bottoms.set(id, pitch);
      }
    }
    if (state.trackId) trackId = state.trackId;
    render();
  }

  return {
    render,
    setBusy,
    isBusy: (key) => busy.has(key),
    showTrack,
    currentTrack: () => current().track,
    scroll,
    getState,
    setState,
  };
}

// 'kick.wav' → 'kick'
export function baseName(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}
