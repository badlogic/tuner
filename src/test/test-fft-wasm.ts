import { FFT_IMPLEMENTATIONS } from "../fft.js";

async function testWasmFFT() {
   console.log("🧪 WASM FFT Smoke Test");

   // Initialize WASM FFT
   console.log("Initializing WASM FFT...");
   await FFT_IMPLEMENTATIONS.wasmBluestein.init?.();
   console.log("✅ WASM FFT initialized");

   // Compare with JS implementation on same input
   console.log("\n📊 Test: Compare WASM vs JS (same input)");
   const inputReal = [1, 0, -1, 0, 1, 0, -1, 0]; // Simple sine pattern
   const inputImag = [0, 0, 0, 0, 0, 0, 0, 0]; // All zeros

   // Allocate arrays using each implementation's allocFloats method
   const real_js = FFT_IMPLEMENTATIONS.bluestein.allocFloats(8);
   const imag_js = FFT_IMPLEMENTATIONS.bluestein.allocFloats(8);
   const real_wasm = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(8);
   const imag_wasm = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(8);

   // Set same input data
   real_js.set(inputReal);
   imag_js.set(inputImag);
   real_wasm.set(inputReal);
   imag_wasm.set(inputImag);

   // Run JS version
   FFT_IMPLEMENTATIONS.bluestein.fft(real_js, imag_js);

   // Run WASM version
   FFT_IMPLEMENTATIONS.wasmBluestein.fft(real_wasm, imag_wasm);

   // Compare results
   let matches = true;
   const tolerance = 1e-5;

   for (let i = 0; i < 8; i++) {
      const realDiff = Math.abs(real_js[i] - real_wasm[i]);
      const imagDiff = Math.abs(imag_js[i] - imag_wasm[i]);

      if (realDiff > tolerance || imagDiff > tolerance) {
         console.log(`❌ Mismatch at index ${i}:`);
         console.log(`  JS:   real=${real_js[i].toFixed(6)}, imag=${imag_js[i].toFixed(6)}`);
         console.log(`  WASM: real=${real_wasm[i].toFixed(6)}, imag=${imag_wasm[i].toFixed(6)}`);
         matches = false;
      }
   }

   if (matches) {
      console.log("✅ WASM and JS outputs match!");
   } else {
      console.log("❌ WASM and JS outputs differ");
   }

   console.log("\n🎯 Smoke test complete");
}

testWasmFFT().catch(console.error);
