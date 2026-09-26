// transport.js — what's playing, and which notes fall in each window.
//
// The clock hands us windows of ticks: "book everything from tick A up to
// tick B". For every clip that's playing, we find the notes inside that
// window and book each one at the exact time the clock's time map gives.
// The song is read fresh for every window, so edits are heard on the next
// pass without stopping.
//
// Finding the notes (the "window query"):
//
//   A playing clip remembers the tick it was launched on. Each of its rows
//   loops with its own length — the row's own, if it has one (polymeter),
//   otherwise the clip's. So a note comes round again and again:
//
//       launch + note.tick,   + 1 × loop,   + 2 × loop,   …
//
//   For each note we jump straight to the first of those at or after the
//   window's start, book it if it's before the window's end, then add one
//   loop and check again. Loop wrap needs no special case: the note on
//   step 1 is simply "the next time round". Rows of different lengths
//   never interfere, because each uses its own loop length.

import { PPQN } from './clock.js';
import { playSample, playClick } from './audio.js';
import { getSong, rowLengthTicks, STEP_TICKS } from './model.js';

const BAR_TICKS = PPQN * 4;   // 4/4, for the metronome's accents

export class Transport {
  constructor(clock) {
    this.clock = clock;
    this.metronome = false;

    // trackId → { clipId, launchTick }. One clip per track plays. Its
    // position is always counted from the tick it was launched on.
    this.playing = new Map();

    clock.onWindow = (from, to) => this._fill(from, to);
  }

  get isRunning() {
    return this.clock.isRunning;
  }

  // Every track starts its active clip at tick 0. Launching clips while
  // playing (quantized to the longest clip) arrives with song view.
  start() {
    this.playing.clear();
    for (const track of getSong().tracks) {
      if (track.activeClipId) {
        this.playing.set(track.id, { clipId: track.activeClipId, launchTick: 0 });
      }
    }
    this.clock.start();
  }

  stop() {
    this.clock.stop();
    this.playing.clear();
  }

  // --- For the screen (read from requestAnimationFrame, never the scheduler)

  // The tick sounding right now, or null when stopped.
  songTick() {
    return this.clock.positionNow();
  }

  // How far one row of a clip is through its loop right now, in ticks.
  // null if that clip isn't playing, or the music hasn't reached it yet.
  rowPosition(trackId, clip, rowKey, songTick) {
    const p = this.playing.get(trackId);
    if (!p || p.clipId !== clip.id || songTick === null || songTick < p.launchTick) return null;
    return (songTick - p.launchTick) % rowLengthTicks(clip, rowKey);
  }

  // --- The window query

  _fill(from, to) {
    for (const track of getSong().tracks) {
      const p = this.playing.get(track.id);
      if (!p) continue;
      const clip = track.clips.find((c) => c.id === p.clipId);
      if (!clip) continue;
      if (track.type === 'kit') this._fillKit(track, clip, p.launchTick, from, to);
    }

    if (this.metronome) {
      eachTime(0, STEP_TICKS, from, to, (tick) => {
        const accent = tick % BAR_TICKS === 0 ? 2 : (tick % PPQN === 0 ? 1 : 0);
        playClick(accent, this.clock.timeAt(tick));
      });
    }
  }

  _fillKit(track, clip, launchTick, from, to) {
    for (const note of clip.notes) {
      const drum = track.drums.find((d) => d.id === note.row);
      if (!drum || !drum.sampleId || drum.mute) continue;
      const row = clip.rows[note.row];
      if (row && row.mute) continue;

      // Notes past the end of a shortened row are kept, but don't play.
      const loop = rowLengthTicks(clip, note.row);
      if (note.tick >= loop) continue;

      eachTime(launchTick + note.tick, loop, from, to, (tick) => {
        playSample(drum.id, drum.sampleId, this.clock.timeAt(tick));
      });
    }
  }
}

// Something that first happens at tick `first` and comes round every
// `loop` ticks. Calls fn(tick, lap) for each time it happens with
// from <= tick < to. `lap` counts loops since launch — 0 the first time
// through, 1 the second — which is what iterance will read later
// ("play only on the 3rd of every 4").
//
// The window's edges are compared directly (tick < from, tick < to), and
// each window starts at exactly the number the last one ended on, so a
// note on the boundary lands in exactly one window.
function eachTime(first, loop, from, to, fn) {
  let lap = Math.max(0, Math.floor((from - first) / loop));
  let tick = first + lap * loop;
  while (tick < from) {
    tick += loop;
    lap++;
  }
  for (; tick < to; tick += loop, lap++) fn(tick, lap);
}
