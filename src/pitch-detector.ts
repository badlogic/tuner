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
   a4Frequency?: number; // A4 reference frequency (default: 440.0)
}

export class PitchDetector {
   readonly sampleRate: number; // Will be set from AudioContext
   readonly chunkSize = 2048;

   private dataArray: Float32Array;
   private debug: boolean;
   private threshold: number;
   private fMin: number;
   private a4Frequency: number;
   
   // Frequency smoothing
   private frequencyHistory: number[] = [];
   private readonly maxHistorySize = 4;

   constructor(options: PitchDetectorOptions) {
      this.sampleRate = options.sampleRate;
      this.dataArray = new Float32Array(this.chunkSize);
      this.debug = options.debug || false;
      this.threshold = options.threshold || 0.1;
      this.fMin = options.fMin || 40.0;
      this.a4Frequency = options.a4Frequency || 440.0;

      if (this.debug) {
         console.log(
            `PitchDetectorYIN initialized: ${this.sampleRate}Hz, ${this.chunkSize} samples, threshold: ${this.threshold}, A4: ${this.a4Frequency}Hz`,
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
      
      // Apply frequency smoothing
      const smoothedFrequency = this.smoothFrequency(frequency);
      const noteInfo = this.getClosestNote(smoothedFrequency);
      const totalTime = performance.now() - startTime;

      if (this.debug) {
         console.log(`YIN detection: ${frequency.toFixed(2)}Hz → ${smoothedFrequency.toFixed(2)}Hz (${noteInfo.note}) in ${totalTime.toFixed(2)}ms`);
      }

      return {
         frequency: smoothedFrequency,
         note: noteInfo.note,
         cents: noteInfo.cents,
      };
   }

   private smoothFrequency(newFrequency: number): number {
      // Add new frequency to history
      this.frequencyHistory.push(newFrequency);
      
      // Limit history size
      if (this.frequencyHistory.length > this.maxHistorySize) {
         this.frequencyHistory.shift();
      }
      
      // Calculate weighted average - newer values have more weight
      // Weights: [1, 2, 3, 4] for a 4-sample history
      let weightedSum = 0;
      let totalWeight = 0;
      
      for (let i = 0; i < this.frequencyHistory.length; i++) {
         const weight = i + 1; // Weight increases with recency
         weightedSum += this.frequencyHistory[i] * weight;
         totalWeight += weight;
      }
      
      return weightedSum / totalWeight;
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

   private generateNoteFrequencies(): Array<{ note: string; freq: number }> {
      const noteFrequencies: Array<{ note: string; freq: number }> = [];
      const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

      // Generate frequencies for octaves 1-5 (C1 to G5)
      // A4 is the 9th note (index 9) in octave 4
      for (let octave = 1; octave <= 5; octave++) {
         for (let noteIndex = 0; noteIndex < 12; noteIndex++) {
            const noteName = noteNames[noteIndex];

            // Calculate semitone offset from A4
            // A4 is at octave 4, note index 9
            const semitonesFromA4 = (octave - 4) * 12 + (noteIndex - 9);

            // Calculate frequency using equal temperament: f = A4 * 2^(n/12)
            const frequency = this.a4Frequency * 2 ** (semitonesFromA4 / 12);

            // Only include frequencies in our detection range (32Hz - 800Hz)
            if (frequency >= 30 && frequency <= 800) {
               noteFrequencies.push({ note: noteName, freq: frequency });
            }
         }
      }

      return noteFrequencies;
   }

   private getClosestNote(frequency: number): { note: string; cents: number } {
      const noteFrequencies = this.generateNoteFrequencies();

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
