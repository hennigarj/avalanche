// scale.js — keys, modes and note names. Pure music theory: no song, no
// sound, no screen.
//
// A pitch is a MIDI note number: 60 is C3 (the Deluge's naming, where
// middle C is C3), 61 is C#3, 72 is C4. A scale is the song's
// { root, mode, enabled }: root is a pitch class, 0 = C … 11 = B.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The seven diatonic modes, in the order SHIFT + SCALE steps through them
// (the Deluge's order). Each lists its seven notes as semitones above the
// root, so index = scale degree.
export const MODES = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian'];

const STEPS = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian:    [0, 1, 3, 5, 6, 8, 10],
};

// Wrap any whole number into 0–11. (JavaScript's % keeps the sign, so
// -1 % 12 is -1, not 11.)
export function pitchClass(n) {
  return ((n % 12) + 12) % 12;
}

export function nextMode(mode) {
  const i = MODES.indexOf(mode);
  return MODES[(i + 1) % MODES.length];
}

// Which degree of the scale a pitch is (0 = the root, 6 = the seventh),
// or -1 if it isn't in the scale.
export function degreeOf(pitch, root, mode) {
  return (STEPS[mode] || STEPS.major).indexOf(pitchClass(pitch - root));
}

export function inScale(pitch, scale) {
  return degreeOf(pitch, scale.root, scale.mode) !== -1;
}

// Move a pitch to the same scale degree in another mode, in the same
// octave. In C, major → minor: E (the third) becomes E♭, while C, D, F
// and G don't move. A pitch that isn't in the old scale stays where it is.
export function convertPitch(pitch, root, fromMode, toMode) {
  const degree = degreeOf(pitch, root, fromMode);
  if (degree === -1) return pitch;
  const fromSteps = STEPS[fromMode] || STEPS.major;
  const toSteps = STEPS[toMode] || STEPS.major;
  return pitch - fromSteps[degree] + toSteps[degree];
}

// 60 → 'C3', 61 → 'C#3', 48 → 'C2'.
export function pitchName(pitch) {
  return NOTE_NAMES[pitchClass(pitch)] + (Math.floor(pitch / 12) - 2);
}

// { root: 7, mode: 'dorian' } → 'G dorian'
export function keyName(scale) {
  return NOTE_NAMES[pitchClass(scale.root)] + ' ' + scale.mode;
}
