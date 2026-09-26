// clock.js — the timing spine.
//
// A sloppy JS timer wakes up often, looks a little way into the future,
// and books events against ctx.currentTime, which is sample-accurate.
// Timers drift; the audio clock does not. So the timer never triggers
// anything — it only decides what to book.

const LOOKAHEAD_MS = 25;      // how often the scheduler wakes up
const SCHEDULE_AHEAD = 0.1;   // how far ahead we book events (seconds)
const MAX_LATE = 0.1;         // past this far behind, give up and re-anchor

export class Clock {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 120;
    this.stepsPerBeat = 4;    // 16th notes
    this.totalSteps = 16;

    this.isRunning = false;
    this.currentStep = 0;
    this.nextStepTime = 0;
    this.timerId = null;

    // Callback: (stepIndex, time) => void
    // `time` is an exact ctx.currentTime value slightly in the future.
    // Schedule audio AT that time — never play immediately.
    this.onStep = null;

    // Upcoming steps, so the UI can light up in sync.
    this.visualQueue = [];

    // Diagnostics. worstMargin is the smallest gap we ever managed
    // between booking a step and that step sounding.
    this.worstMargin = Infinity;
    this.resyncCount = 0;
  }

  get secondsPerStep() {
    return 60.0 / this.bpm / this.stepsPerBeat;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentStep = 0;
    this.worstMargin = Infinity;
    this.resyncCount = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this._tick();
  }

  stop() {
    this.isRunning = false;
    clearTimeout(this.timerId);
    this.visualQueue = [];
  }

  // Re-anchor to now. Used when the scheduler has been starved — the app
  // was backgrounded, or the main thread stalled. Without this, the catch-up
  // loop below books every missed step at once and they all fire instantly
  // as a burst.
  resync() {
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.visualQueue = [];
    this.worstMargin = Infinity;  // old value describes a stall, not steady state
    this.resyncCount++;
  }

  _tick() {
    if (!this.isRunning) return;

    // Did we get starved while we weren't running? Bail out rather than
    // trying to replay the past.
    if (this.nextStepTime < this.ctx.currentTime - MAX_LATE) {
      this.resync();
    }

    // Book every step falling inside the lookahead window.
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      const margin = this.nextStepTime - this.ctx.currentTime;
      if (margin < this.worstMargin) this.worstMargin = margin;

      if (this.onStep) this.onStep(this.currentStep, this.nextStepTime);
      this.visualQueue.push({ step: this.currentStep, time: this.nextStepTime });

      this.nextStepTime += this.secondsPerStep;
      this.currentStep = (this.currentStep + 1) % this.totalSteps;
    }

    this.timerId = setTimeout(() => this._tick(), LOOKAHEAD_MS);
  }

  // Call from a requestAnimationFrame loop. Returns the step that should be
  // lit right now, or null if nothing changed.
  stepForDisplay() {
    let step = null;
    while (this.visualQueue.length && this.visualQueue[0].time <= this.ctx.currentTime) {
      step = this.visualQueue.shift().step;
    }
    return step;
  }
}
