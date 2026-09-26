// pattern.js — the data model.
//
// Plain objects only, so this can be saved as JSON later (milestone 3)
// without any conversion. Nothing in here knows about audio or the screen.

export const PADS = 8;
export const STEPS = 16;

// A step is either null (off) or an object. It's an object rather than
// `true` so velocity, probability and microtiming can be added later
// without changing the shape of the data.
function makeStep() {
  return { velocity: 1 };
}

function makeTrack(index) {
  return {
    type: 'kit',
    name: 'Pad ' + (index + 1),
    sampleId: null,               // key into the buffer cache in audio.js
    steps: new Array(STEPS).fill(null),
  };
}

export function createKit() {
  const tracks = [];
  for (let i = 0; i < PADS; i++) tracks.push(makeTrack(i));
  return { tracks };
}

// Flip a step on or off. Returns true if the step is now on.
export function toggleStep(track, index) {
  track.steps[index] = track.steps[index] ? null : makeStep();
  return track.steps[index] !== null;
}
