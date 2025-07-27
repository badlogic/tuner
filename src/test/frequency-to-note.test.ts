import assert from "node:assert";
import { test } from "node:test";
import { FFT_IMPLEMENTATIONS, type FFTImplementation } from "../fft.js";
import { generateTestSignal, PitchDetectorFFT, SAMPLING_RATE } from "../pitch-detector.js";

async function testFFTImplementation(fftImpl: FFTImplementation) {
   // Initialize FFT if it has an init function
   if (fftImpl.init) {
      await fftImpl.init();
   }

   const detector = new PitchDetectorFFT({
      fftImplementation: fftImpl,
      debug: false,
   });

   const testCases = [
      { freq: 82.41, expectedNote: "E2" },
      { freq: 110.0, expectedNote: "A2" },
      { freq: 146.83, expectedNote: "D3" },
      { freq: 196.0, expectedNote: "G3" },
      { freq: 246.94, expectedNote: "B3" },
   ];

   let passed = 0;
   const durations: number[] = [];

   for (const testCase of testCases) {
      const signal = generateTestSignal(testCase.freq, 2.0, SAMPLING_RATE, [1, 2, 3, 4]);

      let result = null;
      const testDurations: number[] = [];

      // Process chunks and time each call
      for (let i = 0; i < 60; i++) {
         const chunkStart = i * 1024;
         const chunk = signal.slice(chunkStart, chunkStart + 1024);

         const start = performance.now();
         result = detector.processAudioChunk(chunk);
         const end = performance.now();

         testDurations.push((end - start) / 1000);
      }

      // Average duration across all calls
      const avgDuration = testDurations.reduce((sum, d) => sum + d, 0) / testDurations.length;
      durations.push(avgDuration);

      if (result) {
         const noteCorrect = result.note === testCase.expectedNote;
         const freqError = Math.abs(result.frequency - testCase.freq);
         const freqCorrect = freqError < 1.0; // Within 1Hz
         const centsReasonable = Math.abs(result.cents) < 50; // Within 50 cents

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

test("bluestein FFT implementation", async () => {
   const { avgDuration, passed, total } = await testFFTImplementation(FFT_IMPLEMENTATIONS.bluestein);

   // Should pass all tests
   assert.strictEqual(passed, total, `Only ${passed}/${total} tests passed`);

   console.log(`  Bluestein: ${(avgDuration * 1000).toFixed(1)}ms avg, ${passed}/${total} passed`);
});

test("Cooley-Tukey FFT implementation", async () => {
   const { avgDuration, passed, total } = await testFFTImplementation(FFT_IMPLEMENTATIONS.cooleyTukey);

   // Should pass all tests
   assert.strictEqual(passed, total, `Only ${passed}/${total} tests passed`);

   console.log(`  Cooley-Tukey: ${(avgDuration * 1000).toFixed(1)}ms avg, ${passed}/${total} passed`);
});

test("WASM FFT implementation", async () => {
   const { avgDuration, passed, total } = await testFFTImplementation(FFT_IMPLEMENTATIONS.wasmBluestein);

   // Should pass all tests
   assert.strictEqual(passed, total, `Only ${passed}/${total} tests passed`);

   console.log(`  WASM: ${(avgDuration * 1000).toFixed(1)}ms avg, ${passed}/${total} passed`);
});

test("performance comparison", async () => {
   const implementations = [
      FFT_IMPLEMENTATIONS.cooleyTukey,
      FFT_IMPLEMENTATIONS.bluestein,
      FFT_IMPLEMENTATIONS.wasmBluestein,
   ];

   const results = [];

   for (const impl of implementations) {
      try {
         const { avgDuration, passed, total } = await testFFTImplementation(impl);
         results.push({
            name: impl.name,
            avgDuration,
            passed,
            total,
            success: passed === total,
         });
         // biome-ignore lint/suspicious/noExplicitAny: we know it's an Error
      } catch (error: any) {
         console.log(`  ${impl.name}: Failed (${error.message})`);
      }
   }

   // Sort by speed
   results.sort((a, b) => a.avgDuration - b.avgDuration);

   console.log("\n  Performance ranking:");
   const realTimeLimit = 1024 / 48000; // 21.33ms for real-time

   results.forEach((result, index) => {
      const isRealTime = result.avgDuration < realTimeLimit;
      const status = isRealTime ? "✅" : "❌";
      const accuracy = result.success ? "✅" : "❌";

      console.log(
         `  ${index + 1}. ${result.name}: ${(result.avgDuration * 1000).toFixed(1)}ms ${status} accuracy ${accuracy}`,
      );
   });

   // At least one implementation should work
   assert.ok(
      results.some((r) => r.success),
      "No FFT implementation passed all tests",
   );
});
