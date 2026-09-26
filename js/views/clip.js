// views/clip.js — the kit clip view.
//
// Turns the song into what the grid should show (cell descriptors), and
// turns touches on the grid into edits. It never draws anything itself
// (that's ui/grid.js) and never books sound on the clock (that's the
// transport). The one exception is auditioning a row: that sounds the
// moment it's touched.
//
// X is time, one column per 16th. Y is drums, one row each.

import * as model from '../model.js';
import { STEP_TICKS } from '../model.js';
import { createGrid } from '../ui/grid.js';

const COLUMNS = 16;

// deps: {
//   transport,                 for playhead positions
//   audition(drumId, sampleId) play a sample now
//   importSample(file)         decode + store a file; resolves to its sample id
//   hasSample(sampleId)        is it decoded and ready to play?
// }
export function createClipView(container, deps) {
  const { transport, audition, importSample, hasSample } = deps;

  // Screen-only state. Not part of the song, so not saved or undone.
  const busy = new Set();        // drum ids and sample ids being loaded
  const messages = new Map();    // drum id → short text shown instead of its name

  const grid = createGrid(container, model.currentKitClip().track.drums.length, COLUMNS, {
    onCellDown(row, col) {
      const { track, clip } = model.currentKitClip();
      const drum = track.drums[row];
      if (!drum) return;
      const tick = col * STEP_TICKS;
      // Past the end of this row's loop there's nothing to place.
      if (tick >= model.rowLengthTicks(clip, drum.id)) return;
      model.toggleNote(track.id, clip.id, drum.id, tick, STEP_TICKS);
    },

    onAudition(row) {
      const drum = model.currentKitClip().track.drums[row];
      if (drum && drum.sampleId) audition(drum.id, drum.sampleId);
    },

    async onFile(row, file) {
      // Hold ids, not objects: the song may be swapped by undo while the
      // file is decoding.
      const track = model.currentKitClip().track;
      const trackId = track.id;
      const drumId = track.drums[row].id;

      busy.add(drumId);
      render();
      try {
        const sampleId = await importSample(file);
        const name = file.name.replace(/\.[^.]+$/, '');   // drop the extension
        model.setDrumSample(trackId, drumId, sampleId, name);
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

  // --- What the grid should show right now.
  function describe() {
    const { track, clip } = model.currentKitClip();
    const songTick = transport.songTick();

    // For each row, the columns that have a note starting in them.
    const noteCols = new Map();
    for (const note of clip.notes) {
      if (!noteCols.has(note.row)) noteCols.set(note.row, new Set());
      noteCols.get(note.row).add(Math.floor(note.tick / STEP_TICKS));
    }

    return track.drums.map((drum) => {
      const length = model.rowLengthTicks(clip, drum.id);
      const cols = noteCols.get(drum.id) || new Set();

      // Each row has its own playhead, so rows of different lengths can be
      // seen drifting apart and meeting again.
      const pos = transport.rowPosition(track.id, clip, drum.id, songTick);
      const playCol = pos === null ? -1 : Math.floor(pos / STEP_TICKS);

      const cells = [];
      for (let col = 0; col < COLUMNS; col++) {
        let state = cols.has(col) ? 'on' : 'off';
        if (col * STEP_TICKS >= length) state = 'beyond';
        cells.push({
          hue: drum.hue,
          state,
          beat: col % 4 === 0,
          playhead: col === playCol,
        });
      }

      const restoring = drum.sampleId !== null && busy.has(drum.sampleId);
      return {
        label: {
          name: messages.get(drum.id) || drum.name,
          hue: drum.hue,
          loaded: !!drum.sampleId && (hasSample(drum.sampleId) || restoring),
          busy: busy.has(drum.id) || restoring,
        },
        cells,
      };
    });
  }

  function render() {
    grid.update(describe());
  }

  // Mark a drum id or sample id as loading (the row dims while it is).
  function setBusy(key, on) {
    if (on) busy.add(key);
    else busy.delete(key);
    render();
  }

  return { render, setBusy };
}
