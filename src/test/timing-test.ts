import { FFT_IMPLEMENTATIONS, type FFTImplementation } from "../fft.js";
import { generateTestSignal, PitchDetectorFFT } from "../pitch-detector.js";

async function testImplementation(name: string, impl: FFTImplementation) {
   console.log(`\n=== Testing ${name} ===`);

   if (impl.init) {
      await impl.init();
   }

   const detector = new PitchDetectorFFT({
      fftImplementation: impl,
      debug: true,
   });

   const signal = generateTestSignal(110, 2.0, 48000, [1, 2, 3]);

   // Run a few chunks to stabilize timing
   for (let i = 0; i < 5; i++) {
      const chunk = signal.slice(i * 1024, (i + 1) * 1024);
      detector.processAudioChunk(chunk);
   }

   // Get timing for the final chunk
   const chunk = signal.slice(5 * 1024, 6 * 1024);
   const result = detector.processAudioChunk(chunk);

   if (result) {
      console.log(`Result: ${result.frequency}Hz`);
   }
}

async function testTiming() {
   await testImplementation("Cooley-Tukey (JS)", FFT_IMPLEMENTATIONS.cooleyTukey);
   await testImplementation("WASM Cooley-Tukey", FFT_IMPLEMENTATIONS.wasmCooleyTukey);
   await testImplementation("Bluestein (JS)", FFT_IMPLEMENTATIONS.bluestein);
   await testImplementation("WASM Bluestein", FFT_IMPLEMENTATIONS.wasmBluestein);
}

testTiming().catch(console.error);
