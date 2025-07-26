// Exact parameters from reference implementation
export const SAMPLING_RATE = 48000;
export const CHUNK_SIZE = 1024;
export const BUFFER_TIMES = 50;
export const ZERO_PADDING = 3;
export const NUM_HPS = 3;

// Calculated values
export const BUFFER_SIZE = CHUNK_SIZE * BUFFER_TIMES; // 51,200 samples
export const FFT_SIZE = BUFFER_SIZE * (1 + ZERO_PADDING); // 204,800 samples
export const FREQUENCY_RESOLUTION = SAMPLING_RATE / FFT_SIZE; // 0.234375 Hz per bin

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

// Bluestein's algorithm for arbitrary-length FFT (to match NumPy exactly)
function bluesteinFFT(real: number[], imag: number[]): void {
   const n = real.length;

   // Find next power of 2 that's >= 2*n-1
   const m = 2 ** Math.ceil(Math.log2(2 * n - 1));

   // Precompute twiddle factors
   const cosTable = new Array(n);
   const sinTable = new Array(n);

   for (let i = 0; i < n; i++) {
      const angle = (-Math.PI * i * i) / n;
      cosTable[i] = Math.cos(angle);
      sinTable[i] = Math.sin(angle);
   }

   // Temporary arrays for convolution
   const aReal = new Array(m).fill(0);
   const aImag = new Array(m).fill(0);
   const bReal = new Array(m).fill(0);
   const bImag = new Array(m).fill(0);

   // Fill a with input * twiddle
   for (let i = 0; i < n; i++) {
      aReal[i] = real[i] * cosTable[i] - imag[i] * sinTable[i];
      aImag[i] = real[i] * sinTable[i] + imag[i] * cosTable[i];
   }

   // Fill b with conjugated twiddle factors
   bReal[0] = cosTable[0];
   bImag[0] = -sinTable[0];
   for (let i = 1; i < n; i++) {
      bReal[i] = bReal[m - i] = cosTable[i];
      bImag[i] = bImag[m - i] = -sinTable[i];
   }

   // Convolution via FFT (using power-of-2 FFT)
   cooleyTukeyFFT(aReal, aImag);
   cooleyTukeyFFT(bReal, bImag);

   // Multiply
   for (let i = 0; i < m; i++) {
      const tempReal = aReal[i] * bReal[i] - aImag[i] * bImag[i];
      const tempImag = aReal[i] * bImag[i] + aImag[i] * bReal[i];
      aReal[i] = tempReal;
      aImag[i] = tempImag;
   }

   // Inverse FFT
   for (let i = 0; i < m; i++) {
      aImag[i] = -aImag[i];
   }
   cooleyTukeyFFT(aReal, aImag);
   for (let i = 0; i < m; i++) {
      aImag[i] = -aImag[i];
      aReal[i] /= m;
      aImag[i] /= m;
   }

   // Extract result and multiply by twiddle factors
   for (let i = 0; i < n; i++) {
      const outputReal = aReal[i] * cosTable[i] - aImag[i] * sinTable[i];
      const outputImag = aReal[i] * sinTable[i] + aImag[i] * cosTable[i];
      real[i] = outputReal;
      imag[i] = outputImag;
   }
}

// Cooley-Tukey FFT for power-of-2 sizes (used by Bluestein)
function cooleyTukeyFFT(real: number[], imag: number[]): void {
   const n = real.length;

   // Bit-reversal permutation
   for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
         j ^= bit;
      }
      j ^= bit;

      if (i < j) {
         [real[i], real[j]] = [real[j], real[i]];
         [imag[i], imag[j]] = [imag[j], imag[i]];
      }
   }

   // FFT computation
   for (let len = 2; len <= n; len <<= 1) {
      const wlen = (-2 * Math.PI) / len;
      const wlenReal = Math.cos(wlen);
      const wlenImag = Math.sin(wlen);

      for (let i = 0; i < n; i += len) {
         let wReal = 1;
         let wImag = 0;

         for (let j = 0; j < len / 2; j++) {
            const u = i + j;
            const v = i + j + len / 2;

            const vReal = real[v] * wReal - imag[v] * wImag;
            const vImag = real[v] * wImag + imag[v] * wReal;

            real[v] = real[u] - vReal;
            imag[v] = imag[u] - vImag;
            real[u] += vReal;
            imag[u] += vImag;

            const nextWReal = wReal * wlenReal - wImag * wlenImag;
            const nextWImag = wReal * wlenImag + wImag * wlenReal;
            wReal = nextWReal;
            wImag = nextWImag;
         }
      }
   }
}

// For backwards compatibility with tests - will be removed
export function signalToFrequencySpectrum(_signal: Float32Array): Uint8Array {
   // This is a stub - the new implementation uses the proper pipeline
   return new Uint8Array(4096);
}

export class PitchDetector {
   private buffer: Float32Array;
   private hanningWindow: Float32Array;

   constructor() {
      // Initialize exactly like reference implementation
      this.buffer = new Float32Array(BUFFER_SIZE); // 51,200 samples
      this.hanningWindow = new Float32Array(BUFFER_SIZE);

      // Generate Hanning window exactly like numpy.hanning
      for (let i = 0; i < BUFFER_SIZE; i++) {
         this.hanningWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (BUFFER_SIZE - 1)));
      }
   }

   // Process new audio chunk (exactly 1024 samples)
   processAudioChunk(audioChunk: Float32Array): PitchResult | null {
      if (audioChunk.length !== CHUNK_SIZE) {
         throw new Error(`Audio chunk must be exactly ${CHUNK_SIZE} samples`);
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
      // Apply Hanning window to buffer
      const windowedBuffer = new Float32Array(BUFFER_SIZE);
      for (let i = 0; i < BUFFER_SIZE; i++) {
         windowedBuffer[i] = this.buffer[i] * this.hanningWindow[i];
      }

      // Zero pad exactly like reference: np.pad(buffer * hanning, (0, len(buffer) * ZERO_PADDING), "constant")
      // Reference size: 51,200 + (51,200 * 3) = 204,800 samples
      const paddedSize = BUFFER_SIZE + BUFFER_SIZE * ZERO_PADDING; // 204,800

      const real = new Array(paddedSize);
      const imag = new Array(paddedSize);

      // Copy windowed buffer
      for (let i = 0; i < BUFFER_SIZE; i++) {
         real[i] = windowedBuffer[i];
         imag[i] = 0;
      }
      // Zero padding (add zeros at the end)
      for (let i = BUFFER_SIZE; i < paddedSize; i++) {
         real[i] = 0;
         imag[i] = 0;
      }

      // Compute FFT using Bluestein algorithm (works with any size)
      bluesteinFFT(real, imag);

      // Get magnitude spectrum (first half only - positive frequencies)
      const magnitudeData = new Float32Array(paddedSize / 2); // 102,400 samples
      for (let i = 0; i < paddedSize / 2; i++) {
         magnitudeData[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      }

      // Apply HPS exactly like reference
      const hpsResult = this.harmonicProductSpectrum(magnitudeData);

      // Generate frequency array exactly like reference
      // frequencies = np.fft.fftfreq(int((len(magnitude_data) * 2) / 1), 1. / self.SAMPLING_RATE)
      // This means: fftfreq for the full FFT size (magnitudeData.length * 2 = 204,800)
      const fullFftSize = magnitudeData.length * 2; // 204,800 (what Python uses)
      const frequencies = new Float32Array(magnitudeData.length);

      // Generate frequencies: [0, 1, 2, ..., n/2-1] * (sample_rate / n)
      for (let i = 0; i < magnitudeData.length; i++) {
         frequencies[i] = (i * SAMPLING_RATE) / fullFftSize;
      }

      // Apply 60Hz high-pass filter exactly like reference
      // for i, freq in enumerate(frequencies):
      //     if freq > 60:
      //         magnitude_data[:i - 1] = 0
      //         break
      for (let i = 0; i < frequencies.length; i++) {
         if (frequencies[i] > 60) {
            // Zero out all frequencies below 60Hz
            for (let j = 0; j < i - 1; j++) {
               hpsResult[j] = 0;
            }
            break;
         }
      }

      // Find peak frequency exactly like reference
      // peak_frequency = frequencies[np.argmax(magnitude_data)]
      let maxIndex = 0;
      let maxValue = 0;
      for (let i = 0; i < hpsResult.length; i++) {
         if (hpsResult[i] > maxValue) {
            maxValue = hpsResult[i];
            maxIndex = i;
         }
      }

      if (maxValue < 1) return null; // No significant peak found

      const frequency = Math.round(frequencies[maxIndex] * 100) / 100; // Round to 2 decimal places like reference

      // Only accept frequencies in reasonable range
      if (frequency < 60 || frequency > 500) return null;

      const noteInfo = this.frequencyToNote(frequency);

      // Create debug data
      const peaks = [];
      for (let i = 0; i < Math.min(hpsResult.length, frequencies.length); i++) {
         if (hpsResult[i] > 1 && frequencies[i] >= 60 && frequencies[i] <= 500) {
            peaks.push({
               freq: frequencies[i],
               magnitude: hpsResult[i],
               score: hpsResult[i],
            });
         }
      }
      peaks.sort((a, b) => b.magnitude - a.magnitude);

      return {
         frequency,
         confidence: Math.min(1.0, maxValue / 100),
         note: noteInfo.note,
         cents: noteInfo.cents,
         debugData: {
            peaks: peaks.slice(0, 10),
            frequencyData: magnitudeData,
            hpsData: hpsResult,
            sampleRate: SAMPLING_RATE,
         },
      };
   }

   // Exact HPS implementation from reference
   private harmonicProductSpectrum(magnitudeData: Float32Array): Float32Array {
      // magnitude_data_orig = copy.deepcopy(magnitude_data)
      const magnitudeOrig = new Float32Array(magnitudeData);

      // Start with a copy of the original data
      const result = new Float32Array(magnitudeData);

      // for i in range(2, self.NUM_HPS+1, 1):
      for (let i = 2; i <= NUM_HPS; i++) {
         // hps_len = int(np.ceil(len(magnitude_data) / i))
         const hpsLen = Math.ceil(magnitudeData.length / i);

         // magnitude_data[:hps_len] *= magnitude_data_orig[::i]
         // This means: multiply first hps_len elements by every i-th element of original
         for (let j = 0; j < hpsLen; j++) {
            const sourceIndex = j * i; // Every i-th element: 0, i, 2*i, 3*i, ...
            if (sourceIndex < magnitudeOrig.length) {
               result[j] *= magnitudeOrig[sourceIndex];
            }
         }
      }

      return result;
   }

   // Legacy method for backwards compatibility
   detectPitch(_frequencyData: Uint8Array): PitchResult | null {
      // This should not be used in the new implementation
      throw new Error("Use processAudioChunk() instead of detectPitch() with new implementation");
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
      const octave = Math.floor((closestSemitonesFromA4 + 9) / 12) + 4;

      const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const noteName = notes[adjustedIndex];

      // Calculate expected frequency for the closest note
      const expectedFreq = A4 * semitoneRatio ** closestSemitonesFromA4;

      // Calculate cents deviation from the closest note
      const cents = Math.round(1200 * Math.log2(frequency / expectedFreq));

      return {
         note: `${noteName}${octave}`,
         cents,
      };
   }
}
