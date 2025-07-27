export interface PitchResult {
   frequency: number;
   note: string;
   cents: number;
}

export interface PitchDetectorOptions {
   sampleRate: number; // Required: sample rate from AudioContext
   debug?: boolean;
   threshold?: number; // YIN threshold (default: 0.1)
   fMin?: number; // Minimum frequency (default: 40.0)
}

export class PitchDetector {
   readonly sampleRate: number; // Will be set from AudioContext
   readonly chunkSize = 2048;

   private dataArray: Float32Array;
   private debug: boolean;
   private threshold: number;
   private fMin: number;

   constructor(options: PitchDetectorOptions) {
      this.sampleRate = options.sampleRate;
      this.dataArray = new Float32Array(this.chunkSize);
      this.debug = options.debug || false;
      this.threshold = options.threshold || 0.1;
      this.fMin = options.fMin || 40.0;

      if (this.debug) {
         console.log(
            `PitchDetectorYIN initialized: ${this.sampleRate}Hz, ${this.chunkSize} samples, threshold: ${this.threshold}`,
         );
      }
   }

   processAudioChunk(audioChunk: Float32Array): PitchResult | null {
      if (audioChunk.length !== this.chunkSize) {
         throw new Error(`Audio chunk must be exactly ${this.chunkSize} samples`);
      }

      // Copy the audio chunk directly (YIN processes each chunk independently)
      this.dataArray.set(audioChunk);

      return this.analyzeBuffer();
   }

   private analyzeBuffer(): PitchResult | null {
      const startTime = performance.now();
      const frequency = this.yinPitch(this.dataArray, this.sampleRate);
      if (this.debug) {
         console.log(`Raw YIN frequency: ${frequency}`);
      }
      if (frequency <= 0 || Number.isNaN(frequency) || frequency < 40 || frequency > 800) {
         if (this.debug) {
            console.log(`Rejected frequency: ${frequency}`);
         }
         return null;
      }
      const noteInfo = this.getClosestNote(frequency);
      const totalTime = performance.now() - startTime;

      if (this.debug) {
         console.log(`YIN detection: ${frequency.toFixed(2)}Hz (${noteInfo.note}) in ${totalTime.toFixed(2)}ms`);
      }

      return {
         frequency,
         note: noteInfo.note,
         cents: noteInfo.cents,
      };
   }

   // YIN Pitch Detection Algorithm
   private yinPitch(frame: Float32Array, fs: number): number {
      const fMin = this.fMin;
      const threshold = this.threshold;
      const n = frame.length;
      const maxTau = Math.floor(fs / fMin);
      const diff = new Float32Array(maxTau);
      const cmndf = new Float32Array(maxTau);

      // difference function
      for (let tau = 1; tau < maxTau; tau++) {
         let sum = 0;
         for (let i = 0; i < n - tau; i++) {
            const d = frame[i] - frame[i + tau];
            sum += d * d;
         }
         diff[tau] = sum;
      }

      // cumulative mean normalized difference
      cmndf[0] = 1;
      let runningSum = 0;
      for (let tau = 1; tau < maxTau; tau++) {
         runningSum += diff[tau];
         cmndf[tau] = (diff[tau] * tau) / runningSum;
      }

      // absolute threshold
      let tau = 2;
      while (tau < maxTau && cmndf[tau] > threshold) tau++;
      if (tau === maxTau) return -1;

      // refine: take first local minimum below threshold
      while (tau + 1 < maxTau && cmndf[tau + 1] < cmndf[tau]) tau++;

      // parabolic interpolation around tau
      const betterTau = this.parabolic(cmndf, tau);
      return fs / betterTau;
   }

   // quadratic interpolation of discrete minimum
   private parabolic(arr: Float32Array, i: number): number {
      const x0 = i > 0 ? arr[i - 1] : arr[i];
      const x1 = arr[i];
      const x2 = i + 1 < arr.length ? arr[i + 1] : arr[i];
      const denom = x0 + x2 - 2 * x1;
      return denom === 0 ? i : i + (x0 - x2) / (2 * denom);
   }

   private getClosestNote(frequency: number): { note: string; cents: number } {
      const noteFrequencies = [
         // Lower octaves for baritone guitars (C1-B1)
         { note: "C", freq: 32.7 },
         { note: "C#", freq: 34.65 },
         { note: "D", freq: 36.71 },
         { note: "D#", freq: 38.89 },
         { note: "E", freq: 41.2 },
         { note: "F", freq: 43.65 },
         { note: "F#", freq: 46.25 },
         { note: "G", freq: 49.0 },
         { note: "G#", freq: 51.91 },
         { note: "A", freq: 55.0 },
         { note: "A#", freq: 58.27 },
         { note: "B", freq: 61.74 },

         // C2-B2
         { note: "C", freq: 65.41 },
         { note: "C#", freq: 69.3 },
         { note: "D", freq: 73.42 },
         { note: "D#", freq: 77.78 },
         { note: "E", freq: 82.41 },
         { note: "F", freq: 87.31 },
         { note: "F#", freq: 92.5 },
         { note: "G", freq: 98.0 },
         { note: "G#", freq: 103.83 },
         { note: "A", freq: 110.0 },
         { note: "A#", freq: 116.54 },
         { note: "B", freq: 123.47 },

         // C3-B3
         { note: "C", freq: 130.81 },
         { note: "C#", freq: 138.59 },
         { note: "D", freq: 146.83 },
         { note: "D#", freq: 155.56 },
         { note: "E", freq: 164.81 },
         { note: "F", freq: 174.61 },
         { note: "F#", freq: 185.0 },
         { note: "G", freq: 196.0 },
         { note: "G#", freq: 207.65 },
         { note: "A", freq: 220.0 },
         { note: "A#", freq: 233.08 },
         { note: "B", freq: 246.94 },

         // C4-B4
         { note: "C", freq: 261.63 },
         { note: "C#", freq: 277.18 },
         { note: "D", freq: 293.66 },
         { note: "D#", freq: 311.13 },
         { note: "E", freq: 329.63 },
         { note: "F", freq: 349.23 },
         { note: "F#", freq: 369.99 },
         { note: "G", freq: 392.0 },
         { note: "G#", freq: 415.3 },
         { note: "A", freq: 440.0 },
         { note: "A#", freq: 466.16 },
         { note: "B", freq: 493.88 },

         // C5-B5 (higher octave for lead guitars)
         { note: "C", freq: 523.25 },
         { note: "C#", freq: 554.37 },
         { note: "D", freq: 587.33 },
         { note: "D#", freq: 622.25 },
         { note: "E", freq: 659.25 },
         { note: "F", freq: 698.46 },
         { note: "F#", freq: 739.99 },
         { note: "G", freq: 783.99 },
      ];

      let closest = noteFrequencies[0];
      let minDiff = Math.abs(frequency - closest.freq);

      for (const note of noteFrequencies) {
         const diff = Math.abs(frequency - note.freq);
         if (diff < minDiff) {
            minDiff = diff;
            closest = note;
         }
      }

      const cents = 1200 * Math.log2(frequency / closest.freq);

      if (Number.isNaN(cents)) {
         console.warn(
            `NaN cents calculation: freq=${frequency}, closest=${closest.freq}, log2=${Math.log2(frequency / closest.freq)}`,
         );
         return { note: closest.note, cents: 0 };
      }

      return { note: closest.note, cents };
   }
}
