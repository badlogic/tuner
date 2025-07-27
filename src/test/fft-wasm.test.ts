import { test } from "node:test";
import assert from "node:assert";
import { FFT_IMPLEMENTATIONS } from "../fft.js";

test("WASM FFT initialization", async () => {
   // Should initialize without throwing
   await FFT_IMPLEMENTATIONS.wasmBluestein.init?.();

   // Should have the expected properties
   assert.strictEqual(FFT_IMPLEMENTATIONS.wasmBluestein.name, "WASM Bluestein");
   assert.strictEqual(FFT_IMPLEMENTATIONS.wasmBluestein.needsPowerOf2, false);
   assert.strictEqual(typeof FFT_IMPLEMENTATIONS.wasmBluestein.fft, "function");
   assert.strictEqual(typeof FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats, "function");
});

test("WASM vs JS FFT comparison", async () => {
   // Initialize WASM FFT
   await FFT_IMPLEMENTATIONS.wasmBluestein.init?.();

   // Test input: simple sine wave pattern
   const inputReal = [1, 0, -1, 0, 1, 0, -1, 0];
   const inputImag = [0, 0, 0, 0, 0, 0, 0, 0];

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

   // Run both implementations
   FFT_IMPLEMENTATIONS.bluestein.fft(real_js, imag_js);
   FFT_IMPLEMENTATIONS.wasmBluestein.fft(real_wasm, imag_wasm);

   // Compare results
   const tolerance = 1e-5;

   for (let i = 0; i < 8; i++) {
      const realDiff = Math.abs(real_js[i] - real_wasm[i]);
      const imagDiff = Math.abs(imag_js[i] - imag_wasm[i]);

      assert.ok(
         realDiff <= tolerance,
         `Real part mismatch at index ${i}: JS=${real_js[i]}, WASM=${real_wasm[i]}, diff=${realDiff}`,
      );

      assert.ok(
         imagDiff <= tolerance,
         `Imaginary part mismatch at index ${i}: JS=${imag_js[i]}, WASM=${imag_wasm[i]}, diff=${imagDiff}`,
      );
   }
});

test("WASM FFT with various input sizes", async () => {
   await FFT_IMPLEMENTATIONS.wasmBluestein.init?.();

   const testSizes = [4, 8, 16, 32, 64, 100, 1024];

   for (const size of testSizes) {
      // Create test input
      const real = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(size);
      const imag = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(size);

      // Fill with simple pattern
      for (let i = 0; i < size; i++) {
         real[i] = Math.sin((2 * Math.PI * i) / size);
         imag[i] = 0;
      }

      // Should not throw
      assert.doesNotThrow(() => {
         FFT_IMPLEMENTATIONS.wasmBluestein.fft(real, imag);
      }, `FFT failed for size ${size}`);

      // Results should be finite numbers
      for (let i = 0; i < size; i++) {
         assert.ok(Number.isFinite(real[i]), `Non-finite real result at index ${i} for size ${size}`);
         assert.ok(Number.isFinite(imag[i]), `Non-finite imaginary result at index ${i} for size ${size}`);
      }
   }
});

test("WASM FFT performance benchmark", async () => {
   await FFT_IMPLEMENTATIONS.wasmBluestein.init?.();

   const size = 1024;
   const iterations = 100;

   // Allocate once, reuse
   const real = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(size);
   const imag = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(size);

   // Fill with test data
   for (let i = 0; i < size; i++) {
      real[i] = Math.sin((2 * Math.PI * i) / size) + Math.cos((4 * Math.PI * i) / size);
      imag[i] = 0;
   }

   // Benchmark
   const start = performance.now();

   for (let i = 0; i < iterations; i++) {
      // Reset data for each iteration
      for (let j = 0; j < size; j++) {
         real[j] = Math.sin((2 * Math.PI * j) / size) + Math.cos((4 * Math.PI * j) / size);
         imag[j] = 0;
      }

      FFT_IMPLEMENTATIONS.wasmBluestein.fft(real, imag);
   }

   const duration = performance.now() - start;
   const avgTime = duration / iterations;

   console.log(`  WASM FFT (${size} samples): ${avgTime.toFixed(2)}ms avg over ${iterations} iterations`);

   // Should be reasonably fast (less than 100ms per FFT)
   assert.ok(avgTime < 100, `WASM FFT too slow: ${avgTime.toFixed(2)}ms per ${size}-point FFT`);
});

test("WASM FFT memory management", async () => {
   await FFT_IMPLEMENTATIONS.wasmBluestein.init?.();

   // Allocate multiple arrays to test memory management
   const arrays = [];

   for (let i = 0; i < 10; i++) {
      const real = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(256);
      const imag = FFT_IMPLEMENTATIONS.wasmBluestein.allocFloats(256);

      // Fill with data
      for (let j = 0; j < 256; j++) {
         real[j] = Math.random();
         imag[j] = Math.random();
      }

      arrays.push({ real, imag });
   }

   // Run FFT on all arrays
   for (const { real, imag } of arrays) {
      assert.doesNotThrow(() => {
         FFT_IMPLEMENTATIONS.wasmBluestein.fft(real, imag);
      }, "FFT should not fail with multiple allocated arrays");
   }

   // Verify data integrity
   for (const { real, imag } of arrays) {
      for (let i = 0; i < 256; i++) {
         assert.ok(Number.isFinite(real[i]), `Non-finite real result in array`);
         assert.ok(Number.isFinite(imag[i]), `Non-finite imaginary result in array`);
      }
   }
});
