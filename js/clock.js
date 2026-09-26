// clock.js — the timing spine, counted in ticks.
//
// A sloppy JS timer wakes up often, looks a little way into the future,
// and books events against ctx.currentTime, which is sample-accurate.
// Timers drift; the audio clock does not. So the timer never triggers
// anything — it only decides what to book.
//
// Musical time is counted in ticks: 96 per quarter note (PPQN). A 16th is
// 24 ticks, a 64th is 6, a 16th-triplet is 16 — all whole numbers, so every
// grid the app will ever need lands exactly on a tick.
//
// The clock knows nothing about notes. Each time it wakes it hands over a
// window of ticks — "book everything from tick A up to (not including)
// tick B" — and the transport decides what falls inside it.

export const PPQN = 96;

const LOOKAHEAD_MS = 25;      // how often the scheduler wakes up
const SCHEDULE_AHEAD = 0.1;   // how far ahead we book events (seconds)
const MAX_LATE = 0.1;         // past this far behind, give up and re-anchor
const START_DELAY = 0.05;     // breathing room before the first tick sounds

export class Clock {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 120;
    this.isRunning = false;
    this.timerId = null;

    // The time map. Each anchor says "at this audio-clock time we were at
    // this tick, going at this tempo". To convert between ticks and time,
    // find the anchor in effect and work forward from it. Every conversion
    // starts from an anchor instead of adding up step lengths one by one,
    // so rounding errors can never pile up into drift.
    // Oldest first. Old anchors are dropped once the music has passed them.
    this.anchors = [];

    // The tick where the last booked window ended. The next window starts
    // exactly here, so windows never overlap (double hits) or leave gaps
    // (missed hits).
    this.frontier = 0;

    // Callback: (fromTick, toTick) => void.
    // Book every event with fromTick <= tick < toTick, at clock.timeAt(tick).
    // Never play anything "now".
    this.onWindow = null;

    // Diagnostics. worstMargin is the smallest gap we ever had between
    // booking a window and the start of that window sounding. It must stay
    // positive; if it goes negative, notes are being booked too late.
    this.worstMargin = Infinity;
    this.resyncCount = 0;
  }

  // --- The time map

  // The audio-clock time (seconds) at which `tick` sounds.
  timeAt(tick) {
    const a = this._anchorForTick(tick);
    return a.time + (tick - a.tick) * 60 / (a.bpm * PPQN);
  }

  // The tick sounding at audio-clock `time`. Usually fractional, and
  // negative during the short lead-in after pressing start.
  tickAt(time) {
    const a = this._anchorForTime(time);
    return a.tick + (time - a.time) * a.bpm * PPQN / 60;
  }

  // Where the music is right now, for drawing playheads. null when stopped.
  // Call this from requestAnimationFrame, never from the scheduler: audio
  // is booked in the future, the screen shows the present.
  positionNow() {
    if (!this.isRunning) return null;
    return this.tickAt(this.ctx.currentTime);
  }

  // The last anchor at or before `tick` (or the first, if tick is earlier).
  _anchorForTick(tick) {
    let found = this.anchors[0];
    for (const a of this.anchors) {
      if (a.tick <= tick) found = a;
      else break;
    }
    return found;
  }

  _anchorForTime(time) {
    let found = this.anchors[0];
    for (const a of this.anchors) {
      if (a.time <= time) found = a;
      else break;
    }
    return found;
  }

  // --- Tempo

  // Change tempo. While playing, notes already booked can't be moved
  // (they're at most SCHEDULE_AHEAD away), so the new tempo starts exactly
  // where the booked notes end: a new anchor at the frontier tick, placed
  // at the time the old tempo gives for it. The old and new tempos join at
  // that point with no jump, no gap and no overlap.
  setBpm(bpm) {
    if (bpm === this.bpm) return;
    this.bpm = bpm;
    if (!this.isRunning) return;

    const last = this.anchors[this.anchors.length - 1];
    if (last.tick === this.frontier) {
      // A slider drag sends many changes between two wake-ups. They all
      // land on the same frontier, so just update that anchor's tempo.
      last.bpm = bpm;
    } else {
      this.anchors.push({ time: this.timeAt(this.frontier), tick: this.frontier, bpm });
    }
  }

  // --- Running

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frontier = 0;
    this.anchors = [{ time: this.ctx.currentTime + START_DELAY, tick: 0, bpm: this.bpm }];
    this.worstMargin = Infinity;
    this.resyncCount = 0;
    this._wake();
  }

  stop() {
    this.isRunning = false;
    clearTimeout(this.timerId);
  }

  // Re-anchor so the music carries on from where it was, a moment from
  // now. Used when the scheduler has been starved — the app was
  // backgrounded, or the main thread stalled. Without this, every missed
  // note would be booked at once and fire instantly as a burst.
  resync(now = this.ctx.currentTime) {
    this.anchors = [{ time: now + START_DELAY, tick: this.frontier, bpm: this.bpm }];
    this.worstMargin = Infinity;  // old value describes a stall, not steady state
    this.resyncCount++;
  }

  _wake() {
    if (!this.isRunning) return;
    const now = this.ctx.currentTime;

    // Did we get starved? Bail out rather than trying to replay the past.
    if (this.timeAt(this.frontier) < now - MAX_LATE) this.resync(now);

    // The window runs from where the last one ended to whatever tick will
    // be sounding SCHEDULE_AHEAD from now.
    const from = this.frontier;
    const to = this.tickAt(now + SCHEDULE_AHEAD);

    if (to > from) {
      const margin = this.timeAt(from) - now;
      if (margin < this.worstMargin) this.worstMargin = margin;

      try {
        if (this.onWindow) this.onWindow(from, to);
      } catch (err) {
        // One bad note must never stop the clock. Log it and carry on.
        console.error(err);
      }
      this.frontier = to;
    }

    // An anchor is no longer needed once the next one has started sounding.
    while (this.anchors.length > 1 && this.anchors[1].time <= now) {
      this.anchors.shift();
    }

    this.timerId = setTimeout(() => this._wake(), LOOKAHEAD_MS);
  }
}
