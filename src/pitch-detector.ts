export const FFT_SIZE = 8192;

export interface PitchResult {
   frequency: number;
   confidence: number;
   note: string;
   cents: number;
   debugData?: {
      peaks: { freq: number; magnitude: number; score?: number }[];
      frequencyData: Uint8Array;
      sampleRate: number;
   };
}

// Test utility functions
export function generateTestSignal(frequency: number, duration: number, sampleRate: number = 44100, harmonics: number[] = [1]): Float32Array {
   const length = Math.floor(sampleRate * duration);
   const signal = new Float32Array(length);

   for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sample = 0;

      for (let h = 0; h < harmonics.length; h++) {
         const harmonic = harmonics[h];
         const amplitude = 1 / harmonic; // Harmonics get quieter
         // Remove frequency variation for test accuracy
         sample += amplitude * Math.sin(2 * Math.PI * frequency * harmonic * t);
      }

      signal[i] = sample / harmonics.length;
   }

   return signal;
}

// Proper FFT implementation (Cooley-Tukey algorithm)
function fft(real: number[], imag: number[]): void {
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
      const wlen = -2 * Math.PI / len;
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

// Convert time-domain signal to frequency spectrum using proper FFT
export function signalToFrequencySpectrum(signal: Float32Array): Uint8Array {
   const spectrum = new Uint8Array(FFT_SIZE / 2);

   // Take a window from the signal
   const windowStart = Math.max(0, Math.floor((signal.length - FFT_SIZE) / 2));
   const real = new Array(FFT_SIZE);
   const imag = new Array(FFT_SIZE);
   
   // Copy signal to real array, initialize imaginary to zero
   for (let i = 0; i < FFT_SIZE; i++) {
      if (windowStart + i < signal.length) {
         // Apply Hanning window to reduce spectral leakage
         const hanningWeight = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
         real[i] = signal[windowStart + i] * hanningWeight;
      } else {
         real[i] = 0; // Zero padding
      }
      imag[i] = 0;
   }

   // Perform FFT
   fft(real, imag);

   // Convert to magnitude spectrum
   for (let i = 0; i < FFT_SIZE / 2; i++) {
      const magnitude = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      
      // Scale to 0-255 range with proper normalization
      spectrum[i] = Math.min(255, Math.floor(magnitude * 2 / FFT_SIZE * 255));
   }

   return spectrum;
}

export class PitchDetector {
   private sampleRate: number;

   constructor(sampleRate: number = 44100) {
      this.sampleRate = sampleRate;
   }

   detectPitch(frequencyData: Uint8Array): PitchResult | null {
      const nyquist = this.sampleRate / 2;
      const frequencyStep = nyquist / frequencyData.length;

      // Find all peaks in the spectrum
      const peaks: { bin: number; freq: number; magnitude: number }[] = [];

      // Find significant frequency bins - use plateau detection instead of strict peaks
      for (let i = 1; i < frequencyData.length - 1; i++) {
         const freq = i * frequencyStep;
         if (freq < 80 || freq > 500) continue; // Only look in guitar fundamental range

         const current = frequencyData[i];
         const prev = frequencyData[i - 1];
         const next = frequencyData[i + 1];

         // Accept if current bin is significantly strong AND either:
         // 1. It's a local peak (current > prev AND current > next)
         // 2. It's a plateau (current >= prev AND current >= next and current > threshold)
         if (
            current > 5 &&
            ((current > prev && current > next) || (current >= prev && current >= next && current > 15))
         ) {
            // Use parabolic interpolation for sub-bin frequency accuracy
            const interpolatedFreq = this.interpolateFrequency(i, prev, current, next, frequencyStep);
            
            peaks.push({
               bin: i,
               freq: interpolatedFreq,
               magnitude: current,
            });
         }
      }

      if (peaks.length === 0) return null;

      // Sort peaks by magnitude (strongest first)
      peaks.sort((a, b) => b.magnitude - a.magnitude);

      // Try each peak as a potential fundamental and store scores
      let bestFundamental = -1;
      let bestScore = 0;
      const peaksWithScores = [];

      for (const peak of peaks.slice(0, 5)) {
         // Check top 5 peaks
         const fundamental = peak.freq;
         let score = 0;

         // Check if harmonics exist at 2x, 3x, 4x this frequency
         for (let harmonic = 1; harmonic <= 4; harmonic++) {
            const harmonicFreq = fundamental * harmonic;
            if (harmonicFreq > 1000) break; // Outside our range

            const harmonicBin = Math.round(harmonicFreq / frequencyStep);
            if (harmonicBin < frequencyData.length) {
               const harmonicStrength = frequencyData[harmonicBin];
               const weight = harmonic === 1 ? 3 : 1 / harmonic; // Weight fundamental heavily
               score += harmonicStrength * weight;
            }
         }

         // Prefer lower frequencies (more likely to be fundamentals)
         const frequencyPenalty = Math.log(fundamental / 82.41) * 0.1;
         score -= frequencyPenalty * score;

         peaksWithScores.push({ freq: fundamental, magnitude: peak.magnitude, score });

         if (score > bestScore) {
            bestScore = score;
            bestFundamental = fundamental;
         }
      }

      if (bestFundamental === -1) return null;

      const noteInfo = this.frequencyToNote(bestFundamental);

      return {
         frequency: bestFundamental,
         confidence: Math.min(1.0, bestScore / 500), // Normalize confidence
         note: noteInfo.note,
         cents: noteInfo.cents,
         debugData: {
            peaks: peaksWithScores,
            frequencyData: frequencyData,
            sampleRate: this.sampleRate,
         },
      };
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

   // Parabolic interpolation for sub-bin frequency accuracy
   private interpolateFrequency(binIndex: number, leftMag: number, centerMag: number, rightMag: number, frequencyStep: number): number {
      // Parabolic interpolation to find the true peak between bins
      // Formula: offset = (leftMag - rightMag) / (2 * (leftMag - 2*centerMag + rightMag))
      
      const denominator = 2 * (leftMag - 2 * centerMag + rightMag);
      
      // If denominator is too small, just use the bin center
      if (Math.abs(denominator) < 1e-10) {
         return binIndex * frequencyStep;
      }
      
      const offset = (leftMag - rightMag) / denominator;
      
      // Clamp offset to reasonable range (-0.5 to 0.5)
      const clampedOffset = Math.max(-0.5, Math.min(0.5, offset));
      
      return (binIndex + clampedOffset) * frequencyStep;
   }

}
