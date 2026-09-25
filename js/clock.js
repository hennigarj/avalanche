// clock.js — the timing spine.
//
// The whole idea: JS timers (setTimeout/setInterval) are sloppy and get
// throttled. The Web Audio clock (ctx.currentTime) is sample-accurate.
// So we use a sloppy timer that wakes up often, looks a little way into
// the future, and books events against the accurate clock ahead of time.
//
// Sloppy timer fires every LOOKAHEAD_MS and asks:
//   "any steps due in the next SCHEDULE_AHEAD seconds?"
// If yes, it schedules them with exact timestamps and moves on.

const LOOKAHEAD_MS = 25;      // how often the scheduler wakes up
const SCHEDULE_AHEAD = 0.1;   // how far ahead we book events (seconds)

export class Clock {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 120;
    this.stepsPerBeat = 4;    // 16th notes
    this.totalSteps = 16;

    this.isRunning = false;
    this.currentStep = 0;
    this.nextStepTime = 0;    // when the next step should fire (ctx time)
    this.timerId = null;

    // Callback: (stepIndex, time) => void
    // `time` is an exact ctx.currentTime value in the near future.
    // Schedule your audio AT that time, don't play it immediately.
    this.onStep = null;

    // Queue of upcoming steps so the UI can light up in sync.
    this.visualQueue = [];

    // Diagnostics — the number that tells us if this is working.
    this.worstMargin = Infinity;
  }

  get secondsPerStep() {
    return 60.0 / this.bpm / this.stepsPerBeat;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentStep = 0;
    this.worstMargin = Infinity;
    // Small offset so the first step isn't scheduled in the past.
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this._tick();
  }

  stop() {
    this.isRunning = false;
    clearTimeout(this.timerId);
    this.visualQueue = [];
  }

  _tick() {
    if (!this.isRunning) return;

    // Book every step that falls inside our lookahead window.
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD) {

      // Margin = how far in the future we're booking this step.
      // Positive is good. Negative means we woke up too late and the
      // step's moment has already passed — that's a dropped beat.
      const margin = this.nextStepTime - this.ctx.currentTime;
      if (margin < this.worstMargin) this.worstMargin = margin;

      if (this.onStep) this.onStep(this.currentStep, this.nextStepTime);
      this.visualQueue.push({ step: this.currentStep, time: this.nextStepTime });

      this.nextStepTime += this.secondsPerStep;
      this.currentStep = (this.currentStep + 1) % this.totalSteps;
    }

    this.timerId = setTimeout(() => this._tick(), LOOKAHEAD_MS);
  }

  // Call from a requestAnimationFrame loop. Returns the step that should
  // be lit up right now, or null if nothing has changed.
  stepForDisplay() {
    let step = null;
    while (this.visualQueue.length && this.visualQueue[0].time <= this.ctx.currentTime) {
      step = this.visualQueue.shift().step;
    }
    return step;
  }
}
