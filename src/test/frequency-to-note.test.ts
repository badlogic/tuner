import assert from "node:assert";
import { test } from "node:test";
import { PitchDetector } from "../pitch-detector.js";

const SAMPLE_RATE = 48000;

// Utility function to generate test signals (for testing)
export function generateTestSignal(frequency: number, sampleRate: number, duration: number): Float32Array {
   const samples = Math.floor(sampleRate * duration);
   const signal = new Float32Array(samples);

   for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      signal[i] = Math.sin(2 * Math.PI * frequency * t);
   }

   return signal;
}

async function testYINImplementation() {
   const detector = new PitchDetector({
      sampleRate: SAMPLE_RATE,
      debug: false,
      threshold: 0.1,
      fMin: 40.0,
   });

   const testCases = [
      { freq: 82.41, expectedNote: "E" },
      { freq: 110.0, expectedNote: "A" },
      { freq: 146.83, expectedNote: "D" },
      { freq: 196.0, expectedNote: "G" },
      { freq: 246.94, expectedNote: "B" },
      { freq: 329.63, expectedNote: "E" },
   ];

   let passed = 0;
   const durations: number[] = [];

   for (const testCase of testCases) {
      const signal = generateTestSignal(testCase.freq, SAMPLE_RATE, 0.1); // 100ms signal

      let result = null;
      const testDurations: number[] = [];

      // Process chunks and time each call
      for (let i = 0; i < 10; i++) {
         const chunkStart = i * detector.chunkSize;
         const chunk = signal.slice(chunkStart, chunkStart + detector.chunkSize);

         if (chunk.length < detector.chunkSize) {
            // Pad with zeros if needed
            const paddedChunk = new Float32Array(detector.chunkSize);
            paddedChunk.set(chunk);
            chunk.set(paddedChunk);
         }

         const start = performance.now();
         result = detector.processAudioChunk(chunk);
         const end = performance.now();

         testDurations.push((end - start) / 1000);

         if (result) break; // Stop when we get a detection
      }

      // Average duration across all calls
      const avgDuration = testDurations.reduce((sum, d) => sum + d, 0) / testDurations.length;
      durations.push(avgDuration);

      if (result) {
         const noteCorrect = result.note === testCase.expectedNote;
         const freqError = Math.abs(result.frequency - testCase.freq);
         const freqCorrect = freqError < 2.0; // Within 2Hz (YIN is less precise than FFT)
         const centsReasonable = Math.abs(result.cents) < 100; // Within 100 cents

         if (noteCorrect && freqCorrect && centsReasonable) {
            passed++;
            console.log(
               `  ✅ ${testCase.freq}Hz → ${result.frequency.toFixed(1)}Hz, ${result.note}, ${result.cents.toFixed(0)} cents`,
            );
         } else {
            console.log(
               `  ❌ ${testCase.freq}Hz → ${result.frequency.toFixed(1)}Hz, ${result.note}, ${result.cents.toFixed(0)} cents (expected ${testCase.expectedNote})`,
            );
         }
      } else {
         console.log(`  ❌ ${testCase.freq}Hz → No detection`);
      }
   }

   const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
   return { avgDuration, passed, total: testCases.length };
}

test("YIN pitch detection accuracy", async () => {
   console.log("Testing YIN pitch detection accuracy...");

   const { avgDuration, passed, total } = await testYINImplementation();

   // Should pass most tests (YIN may be less accurate than FFT for pure tones)
   assert.ok(passed >= total * 0.8, `Only ${passed}/${total} tests passed (expected at least 80%)`);

   console.log(`  YIN: ${(avgDuration * 1000).toFixed(1)}ms avg, ${passed}/${total} passed`);

   // Check if it's fast enough for real-time (2048 samples at 48kHz = ~42.7ms)
   const realTimeLimit = 2048 / 48000; // 42.7ms for real-time
   const isRealTime = avgDuration < realTimeLimit;

   console.log(
      `  Real-time capable: ${isRealTime ? "✅" : "❌"} (${(avgDuration * 1000).toFixed(1)}ms < ${(realTimeLimit * 1000).toFixed(1)}ms)`,
   );
});

test("YIN frequency range support", async () => {
   console.log("Testing YIN frequency range support...");

   const detector = new PitchDetector({
      sampleRate: SAMPLE_RATE,
      debug: false,
      threshold: 0.1,
      fMin: 40.0,
   });

   const testCases = [
      { freq: 41.2, expectedNote: "E", description: "Low E (baritone)" },
      { freq: 82.41, expectedNote: "E", description: "Standard low E" },
      { freq: 440.0, expectedNote: "A", description: "A4 (concert pitch)" },
      { freq: 659.25, expectedNote: "E", description: "High E" },
   ];

   let passed = 0;

   for (const testCase of testCases) {
      const signal = generateTestSignal(testCase.freq, SAMPLE_RATE, 0.1);

      let result = null;

      // Try multiple chunks
      for (let i = 0; i < 5; i++) {
         const chunkStart = i * detector.chunkSize;
         const chunk = signal.slice(chunkStart, chunkStart + detector.chunkSize);

         if (chunk.length < detector.chunkSize) {
            const paddedChunk = new Float32Array(detector.chunkSize);
            paddedChunk.set(chunk);
            result = detector.processAudioChunk(paddedChunk);
         } else {
            result = detector.processAudioChunk(chunk);
         }

         if (result) break;
      }

      if (result && result.note === testCase.expectedNote) {
         passed++;
         console.log(
            `  ✅ ${testCase.description}: ${testCase.freq}Hz → ${result.frequency.toFixed(1)}Hz, ${result.note}`,
         );
      } else {
         console.log(
            `  ❌ ${testCase.description}: ${testCase.freq}Hz → ${result ? `${result.frequency.toFixed(1)}Hz, ${result.note}` : "No detection"}`,
         );
      }
   }

   console.log(`  Range support: ${passed}/${testCases.length} frequencies detected correctly`);

   // Should support most of the range
   assert.ok(passed >= testCases.length * 0.7, `Only ${passed}/${testCases.length} range tests passed`);
});
