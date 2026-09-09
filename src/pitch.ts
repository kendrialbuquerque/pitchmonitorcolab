export type PitchSample = {
  frequency: number;
  midi: number;
  note: string;
  cents: number;
  clarity: number;
  rms: number;
};

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function midiToNote(midi: number) {
  const rounded = Math.round(midi);
  const index = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[index]}${octave}`;
}

export function frequencyToPitch(frequency: number) {
  const rawMidi = 69 + 12 * Math.log2(frequency / 440);
  const rounded = Math.round(rawMidi);
  return {
    midi: rawMidi,
    note: midiToNote(rounded),
    cents: Math.round((rawMidi - rounded) * 100),
  };
}

export function detectPitch(buffer: Float32Array, sampleRate: number): PitchSample | null {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.008) return null;

  const minFreq = 70;
  const maxFreq = 1200;
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buffer.length / 2));

  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let normA = 0;
    let normB = 0;
    const len = buffer.length - lag;

    for (let i = 0; i < len; i++) {
      const a = buffer[i];
      const b = buffer[i + lag];
      sum += a * b;
      normA += a * a;
      normB += b * b;
    }

    const correlation = sum / Math.sqrt(normA * normB + 1e-12);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation < 0.72) return null;

  const corrAt = (lag: number) => {
    let sum = 0;
    let normA = 0;
    let normB = 0;
    const len = buffer.length - lag;
    for (let i = 0; i < len; i++) {
      const a = buffer[i];
      const b = buffer[i + lag];
      sum += a * b;
      normA += a * a;
      normB += b * b;
    }
    return sum / Math.sqrt(normA * normB + 1e-12);
  };

  const left = bestLag > minLag ? corrAt(bestLag - 1) : bestCorrelation;
  const center = bestCorrelation;
  const right = bestLag < maxLag ? corrAt(bestLag + 1) : bestCorrelation;
  const denominator = left - 2 * center + right;
  const shift = Math.abs(denominator) > 1e-8 ? 0.5 * (left - right) / denominator : 0;
  const refinedLag = bestLag + Math.max(-1, Math.min(1, shift));
  const frequency = sampleRate / refinedLag;
  const pitch = frequencyToPitch(frequency);

  return {
    frequency,
    midi: pitch.midi,
    note: pitch.note,
    cents: pitch.cents,
    clarity: bestCorrelation,
    rms,
  };
}
