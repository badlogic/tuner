import type { FFTImplementation } from "./fft.js";

// Exact parameters from reference implementation
export const SAMPLING_RATE = 48000;
export const CHUNK_SIZE = 1024;
export const BUFFER_TIMES = 50;
export const ZERO_PADDING = 3;
export const NUM_HPS = 3;

// Calculated values
export const BUFFER_SIZE = CHUNK_SIZE * BUFFER_TIMES; // 51,200 samples
const FFT_SIZE_EXACT = BUFFER_SIZE * (1 + ZERO_PADDING); // 204,800 samples
export const FFT_SIZE = 2 ** Math.ceil(Math.log2(FFT_SIZE_EXACT)); // 262,144 samples (next power of 2)
export const FREQUENCY_RESOLUTION = SAMPLING_RATE / FFT_SIZE; // Updated frequency resolution

export interface PitchResult {
   frequency: number;
   confidence: number;
   note: string;
   cents: number;
   debugData?: {
      peaks: { freq: number; magnitude: number; score?: number }[];
      frequencyData: Float32Array;
      hpsData: Float32Array;
      sampleRate: number;
   };
}

export interface PitchDetector {
   readonly sampleRate: number;
   readonly chunkSize: number;
   processAudioChunk(audioChunk: Float32Array): PitchResult | null;
}

// Test utility functions
export function generateTestSignal(
   frequency: number,
   duration: number,
   sampleRate: number = SAMPLING_RATE,
   harmonics: number[] = [1],
): Float32Array {
   const length = Math.floor(sampleRate * duration);
   const signal = new Float32Array(length);

   for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sample = 0;

      for (let h = 0; h < harmonics.length; h++) {
         const harmonic = harmonics[h];
         const amplitude = 1 / harmonic; // Harmonics get quieter
         sample += amplitude * Math.sin(2 * Math.PI * frequency * harmonic * t);
      }

      signal[i] = sample / harmonics.length;
   }

   return signal;
}

export interface PitchDetectorFFTOptions {
   fftImplementation: FFTImplementation;
   debug?: boolean;
   smoothing?: boolean; // Enable frequency smoothing (default: true)
   smoothingFactor?: number; // Smoothing strength 0-1 (default: 0.3)
}

export interface PitchDetectorYINOptions {
   sampleRate: number; // Required: sample rate from AudioContext
   debug?: boolean;
   threshold?: number; // YIN threshold (default: 0.1)
   fMin?: number; // Minimum frequency (default: 82.4)
}

export class PitchDetectorFFT implements PitchDetector {
   readonly sampleRate = SAMPLING_RATE;
   readonly chunkSize = CHUNK_SIZE;

   private buffer: Float32Array;
   private hanningWindow: Float32Array;
   private fftImpl: FFTImplementation;
   private debug: boolean;

   // Frequency smoothing
   private smoothing: boolean;
   private smoothingFactor: number;
   private smoothedFrequency = 0;
   private lastDetectedNote = "";

   // Reusable arrays to avoid allocations
   private windowedBuffer: Float32Array;
   private fftReal: Float32Array;
   private fftImag: Float32Array;
   private magnitudeData: Float32Array;
   private frequencies: Float32Array;

   constructor(options: PitchDetectorFFTOptions) {
      // Initialize exactly like reference implementation
      this.buffer = new Float32Array(BUFFER_SIZE); // 51,200 samples
      this.hanningWindow = new Float32Array(BUFFER_SIZE);
      this.fftImpl = options.fftImplementation;
      this.debug = options.debug || false;
      this.smoothing = options.smoothing !== false; // Default to true
      this.smoothingFactor = options.smoothingFactor || 0.3;

      // Pre-allocate reusable arrays
      this.windowedBuffer = new Float32Array(BUFFER_SIZE); // 51,200
      this.fftReal = this.fftImpl.allocFloats(FFT_SIZE); // 204,800
      this.fftImag = this.fftImpl.allocFloats(FFT_SIZE); // 204,800
      this.magnitudeData = new Float32Array(FFT_SIZE / 2); // 102,400
      this.frequencies = new Float32Array(FFT_SIZE / 2); // 102,400

      // Generate Hanning window exactly like numpy.hanning
      for (let i = 0; i < BUFFER_SIZE; i++) {
         this.hanningWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (BUFFER_SIZE - 1)));
      }

      // Pre-compute frequency array (doesn't change)
      const fullFftSize = FFT_SIZE;
      for (let i = 0; i < this.frequencies.length; i++) {
         this.frequencies[i] = (i * SAMPLING_RATE) / fullFftSize;
      }

      if (this.debug) {
         console.log(`PitchDetector initialized with FFT: ${this.fftImpl.name}`);
         console.log(`FFT Description: ${this.fftImpl.description}`);
      }
   }

   // Process new audio chunk (exactly 1024 samples)
   processAudioChunk(audioChunk: Float32Array): PitchResult | null {
      if (audioChunk.length !== this.chunkSize) {
         throw new Error(`Audio chunk must be exactly ${this.chunkSize} samples`);
      }

      // Shift buffer left by CHUNK_SIZE (circular buffer behavior)
      // self.buffer[:-self.CHUNK_SIZE] = self.buffer[self.CHUNK_SIZE:]
      for (let i = 0; i < BUFFER_SIZE - CHUNK_SIZE; i++) {
         this.buffer[i] = this.buffer[i + CHUNK_SIZE];
      }

      // Add new chunk at the end
      // self.buffer[-self.CHUNK_SIZE:] = data
      for (let i = 0; i < CHUNK_SIZE; i++) {
         this.buffer[BUFFER_SIZE - CHUNK_SIZE + i] = audioChunk[i];
      }

      // Run pitch detection on the buffer
      return this.analyzeBuffer();
   }

   // Exact pitch detection algorithm from reference
   private analyzeBuffer(): PitchResult | null {
      const startTime = performance.now();

      const clearStart = performance.now();
      // Clear reusable arrays (zero them out)
      this.windowedBuffer.fill(0);
      this.fftReal.fill(0);
      this.fftImag.fill(0);
      this.magnitudeData.fill(0);
      const clearTime = performance.now() - clearStart;

      const windowStart = performance.now();
      // Apply Hanning window to buffer
      for (let i = 0; i < BUFFER_SIZE; i++) {
         this.windowedBuffer[i] = this.buffer[i] * this.hanningWindow[i];
      }

      // Copy windowed buffer to FFT arrays (zero padding is already done by fill(0))
      for (let i = 0; i < BUFFER_SIZE; i++) {
         this.fftReal[i] = this.windowedBuffer[i];
         // fftImag[i] is already 0 from fill(0)
      }
      const windowTime = performance.now() - windowStart;

      // Compute FFT using configured implementation
      const fftStart = performance.now();
      this.fftImpl.fft(this.fftReal, this.fftImag);
      const fftTime = performance.now() - fftStart;

      const magnitudeStart = performance.now();
      // Get magnitude spectrum (first half only - positive frequencies)
      for (let i = 0; i < this.magnitudeData.length; i++) {
         this.magnitudeData[i] = Math.sqrt(this.fftReal[i] * this.fftReal[i] + this.fftImag[i] * this.fftImag[i]);
      }
      const magnitudeTime = performance.now() - magnitudeStart;

      const hpsStart = performance.now();
      // Apply HPS exactly like reference (modifies magnitudeData in place)
      this.harmonicProductSpectrum(this.magnitudeData);
      const hpsTime = performance.now() - hpsStart;

      // Apply 60Hz high-pass filter exactly like reference (frequencies are pre-computed)
      // for i, freq in enumerate(frequencies):
      //     if freq > 60:
      //         magnitude_data[:i - 1] = 0
      //         break
      for (let i = 0; i < this.frequencies.length; i++) {
         if (this.frequencies[i] > 60) {
            // Zero out all frequencies below 60Hz
            for (let j = 0; j < i - 1; j++) {
               this.magnitudeData[j] = 0;
            }
            break;
         }
      }

      // Find peak frequency exactly like reference
      // peak_frequency = frequencies[np.argmax(magnitude_data)]
      let maxIndex = 0;
      let maxValue = 0;
      for (let i = 0; i < this.magnitudeData.length; i++) {
         if (this.magnitudeData[i] > maxValue) {
            maxValue = this.magnitudeData[i];
            maxIndex = i;
         }
      }

      if (this.debug) {
         // Show top 5 peaks for debugging
         const peaks = [];
         for (let i = 0; i < this.magnitudeData.length; i++) {
            if (this.magnitudeData[i] > maxValue * 0.1) {
               // Only significant peaks
               peaks.push({ freq: this.frequencies[i], mag: this.magnitudeData[i], index: i });
            }
         }
         peaks.sort((a, b) => b.mag - a.mag);
         console.log(
            "Top 5 peaks after HPS:",
            peaks.slice(0, 5).map((p) => `${p.freq.toFixed(1)}Hz (${p.mag.toFixed(0)})`),
         );
      }

      if (maxValue < 1) return null; // No significant peak found

      const rawFrequency = Math.round(this.frequencies[maxIndex] * 100) / 100; // Round to 2 decimal places like reference

      // Only accept frequencies in reasonable range
      if (rawFrequency < 60 || rawFrequency > 500) return null;

      // Get the raw note to check if it changed
      const rawNoteInfo = this.frequencyToNote(rawFrequency);

      // Apply note-aware frequency smoothing if enabled
      let frequency = rawFrequency;
      if (this.smoothing) {
         if (this.lastDetectedNote === "" || this.lastDetectedNote !== rawNoteInfo.note) {
            // New note detected - reset smoothing immediately
            this.smoothedFrequency = rawFrequency;
            this.lastDetectedNote = rawNoteInfo.note;
         } else {
            // Same note - apply exponential smoothing for stability
            this.smoothedFrequency += this.smoothingFactor * (rawFrequency - this.smoothedFrequency);
         }
         frequency = Math.round(this.smoothedFrequency * 100) / 100;
      }

      const noteInfo = this.frequencyToNote(frequency);

      // Create debug data
      const peaks = [];
      for (let i = 0; i < this.magnitudeData.length; i++) {
         if (this.magnitudeData[i] > 1 && this.frequencies[i] >= 60 && this.frequencies[i] <= 500) {
            peaks.push({
               freq: this.frequencies[i],
               magnitude: this.magnitudeData[i],
               score: this.magnitudeData[i],
            });
         }
      }
      peaks.sort((a, b) => b.magnitude - a.magnitude);

      const totalTime = performance.now() - startTime;

      if (this.debug) {
         console.log(`Timing breakdown (${this.fftImpl.name}):`);
         console.log(`  Clear arrays: ${clearTime.toFixed(2)}ms`);
         console.log(`  Windowing: ${windowTime.toFixed(2)}ms`);
         console.log(`  FFT: ${fftTime.toFixed(2)}ms`);
         console.log(`  Magnitude: ${magnitudeTime.toFixed(2)}ms`);
         console.log(`  HPS: ${hpsTime.toFixed(2)}ms`);
         console.log(`  Total: ${totalTime.toFixed(2)}ms`);
      }

      return {
         frequency,
         confidence: Math.min(1.0, maxValue / 100),
         note: noteInfo.note,
         cents: noteInfo.cents,
         debugData: {
            peaks: peaks.slice(0, 10),
            frequencyData: this.magnitudeData,
            hpsData: this.magnitudeData,
            sampleRate: SAMPLING_RATE,
         },
      };
   }

   // Exact HPS implementation from reference (modifies magnitudeData in place)
   private harmonicProductSpectrum(magnitudeData: Float32Array): void {
      // magnitude_data_orig = copy.deepcopy(magnitude_data)
      const magnitudeOrig = new Float32Array(magnitudeData);

      // for i in range(2, self.NUM_HPS+1, 1):
      for (let i = 2; i <= NUM_HPS; i++) {
         // hps_len = int(np.ceil(len(magnitude_data) / i))
         const hpsLen = Math.ceil(magnitudeData.length / i);

         // magnitude_data[:hps_len] *= magnitude_data_orig[::i]
         // This means: multiply first hps_len elements by every i-th element of original
         for (let j = 0; j < hpsLen; j++) {
            const sourceIndex = j * i; // Every i-th element: 0, i, 2*i, 3*i, ...
            if (sourceIndex < magnitudeOrig.length) {
               magnitudeData[j] *= magnitudeOrig[sourceIndex];
            }
         }
      }
   }

   private frequencyToNote(frequency: number): { note: string; cents: number } {
      const A4 = 440;
      const semitoneRatio = 2 ** (1 / 12);

      // Calculate exact semitones from A4 (don't round yet!)
      const exactSemitonesFromA4 = 12 * Math.log2(frequency / A4);

      // Round to find the closest note
      const closestSemitonesFromA4 = Math.round(exactSemitonesFromA4);

      // Get note index (0=C, 1=C#, 2=D, etc)
      const noteIndex = (closestSemitonesFromA4 + 9) % 12;
      const adjustedIndex = noteIndex < 0 ? noteIndex + 12 : noteIndex;

      // Calculate octave
      // biome-ignore lint/correctness/noUnusedVariables: Maybe neeeded for future adjustments
      const octave = Math.floor((closestSemitonesFromA4 + 9) / 12) + 4;

      const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const noteName = notes[adjustedIndex];

      // Calculate expected frequency for the closest note
      const expectedFreq = A4 * semitoneRatio ** closestSemitonesFromA4;

      // Calculate cents deviation from the closest note
      const cents = Math.round(1200 * Math.log2(frequency / expectedFreq));

      return {
         note: noteName,
         cents,
      };
   }
}

export class PitchDetectorYIN implements PitchDetector {
   readonly sampleRate: number; // Will be set from AudioContext
   readonly chunkSize = 2048; // Match FRAME_SIZE from test.html

   private dataArray: Float32Array;
   private debug: boolean;
   private threshold: number;
   private fMin: number;

   constructor(options: PitchDetectorYINOptions) {
      this.sampleRate = options.sampleRate;
      this.dataArray = new Float32Array(this.chunkSize);
      this.debug = options.debug || false;
      this.threshold = options.threshold || 0.1;
      this.fMin = options.fMin || 82.4;

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

      // Run YIN pitch detection on the current frame
      const rawFrequency = this.yinPitch(this.dataArray, this.sampleRate);

      if (this.debug) {
         console.log(`Raw YIN frequency: ${rawFrequency}`);
      }

      if (rawFrequency <= 0 || Number.isNaN(rawFrequency) || rawFrequency < 40 || rawFrequency > 800) {
         if (this.debug) {
            console.log(`Rejected frequency: ${rawFrequency}`);
         }
         return null;
      }

      // Use raw frequency directly (no smoothing like test.html)
      const frequency = rawFrequency;
      const noteInfo = this.getClosestNote(frequency);

      const totalTime = performance.now() - startTime;

      if (this.debug) {
         console.log(`YIN detection: ${frequency.toFixed(1)}Hz (${noteInfo.note}) in ${totalTime.toFixed(2)}ms`);
      }

      return {
         frequency,
         confidence: 0.8, // YIN doesn't provide confidence, use fixed value
         note: noteInfo.note,
         cents: noteInfo.cents,
         debugData: {
            peaks: [{ freq: frequency, magnitude: 1, score: 1 }],
            frequencyData: new Float32Array(0), // Not available
            hpsData: new Float32Array(0), // Not available
            sampleRate: this.sampleRate,
         },
      };
   }

   // YIN Pitch Detection Algorithm (exact copy from test.html)
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

   // quadratic interpolation of discrete minimum (exact copy from test.html)
   private parabolic(arr: Float32Array, i: number): number {
      const x0 = i > 0 ? arr[i - 1] : arr[i];
      const x1 = arr[i];
      const x2 = i + 1 < arr.length ? arr[i + 1] : arr[i];
      const denom = x0 + x2 - 2 * x1;
      return denom === 0 ? i : i + (x0 - x2) / (2 * denom);
   }

   // Note detection (extended range for baritone guitars and higher notes)
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
