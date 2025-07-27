// FFT implementations for different use cases
import { WasmAllocator } from "./wasm/allocator";

export interface FFTImplementation {
   name: string;
   description: string;
   needsPowerOf2: boolean; // If true, requires input size to be power of 2
   // Function to perform FFT on real and imaginary parts
   fft(real: Float32Array, imag: Float32Array): void;
   allocFloats(count: number): Float32Array; // Allocate floats using the implementation's allocator
   // Optional async initialization
   init?(): Promise<void>;
}

// Cooley-Tukey FFT - Fast but requires power-of-2 sizes
function cooleyTukeyFFT(real: Float32Array, imag: Float32Array): void {
   const n = real.length;

   // Check if n is power of 2
   if ((n & (n - 1)) !== 0) {
      throw new Error(`Cooley-Tukey FFT requires power-of-2 size, got ${n}`);
   }

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

// Bluestein's algorithm - Accurate for any size but slower
function bluesteinFFT(real: Float32Array, imag: Float32Array): void {
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
   const aReal = new Float32Array(m);
   const aImag = new Float32Array(m);
   const bReal = new Float32Array(m);
   const bImag = new Float32Array(m);

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

// WASM FFT implementation
let wasmModule: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;
let wasmAllocator: WasmAllocator | null = null;

async function loadWasmFFT(): Promise<void> {
   if (wasmModule) return;

   try {
      let wasmBytes: ArrayBuffer;

      // Check if we're in Node.js or browser
      if (typeof window === "undefined") {
         // Node.js environment
         // ts-ignore
         const fs = await import("node:fs");
         // ts-ignore
         const path = await import("node:path");
         const wasmPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "frontend/fft.wasm");
         const buffer = fs.readFileSync(wasmPath);
         wasmBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else {
         // Browser environment (WASM file copied to dist during build)
         const wasmResponse = await fetch("./fft.wasm");
         wasmBytes = await wasmResponse.arrayBuffer();
      }

      // Create memory with 32MB initial size (512 pages * 64KB = 32MB)
      const memory = new WebAssembly.Memory({ initial: 512 });

      // Provide Math and allocator imports for WASM
      wasmAllocator = new WasmAllocator();
      const wasmImports = {
         Math: {
            sin: Math.sin,
            cos: Math.cos,
         },
         ...wasmAllocator.getImports(),
         env: {
            memory: memory,
         },
      };
      const wasmResult = await WebAssembly.instantiate(wasmBytes, wasmImports);
      wasmModule = wasmResult.instance;

      // Use our pre-allocated memory and init allocator (no growing needed)
      wasmMemory = memory;
      wasmAllocator.init(wasmMemory, false);
   } catch (error) {
      console.warn("❌ WASM FFT failed:", error);
   }
}

function wasmBluesteinFFT(real: Float32Array, imag: Float32Array): void {
   if (!wasmModule || !wasmMemory || !wasmAllocator) {
      throw new Error("WASM FFT not loaded - use bluestein implementation instead");
   }

   const size = real.length;
   const realPtr = real.byteOffset;
   const imagPtr = imag.byteOffset;
   (wasmModule.exports.bluestein_fft as (realPtr: number, imagPtr: number, size: number) => void)(
      realPtr,
      imagPtr,
      size,
   );
}

function wasmCooleyTukeyFFT(real: Float32Array, imag: Float32Array): void {
   if (!wasmModule || !wasmMemory || !wasmAllocator) {
      throw new Error("WASM FFT not loaded - use cooley-tukey implementation instead");
   }

   const size = real.length;
   const realPtr = real.byteOffset;
   const imagPtr = imag.byteOffset;
   (wasmModule.exports.cooley_tukey_fft as (realPtr: number, imagPtr: number, size: number) => void)(
      realPtr,
      imagPtr,
      size,
   );
}

// Helper function to get next power of 2
export function nextPowerOf2(n: number): number {
   return 2 ** Math.ceil(Math.log2(n));
}

// Helper to check if number is power of 2
export function isPowerOf2(n: number): boolean {
   return (n & (n - 1)) === 0 && n > 0;
}

// Available FFT implementations for CLI/Node.js environment
export const FFT_IMPLEMENTATIONS: Record<string, FFTImplementation> = {
   // WASM accelerated versions
   wasmBluestein: {
      name: "WASM Bluestein",
      description: "Fast WASM Bluestein FFT. Requires WASM to be loaded.",
      needsPowerOf2: false,
      fft: wasmBluesteinFFT,
      allocFloats: (count: number) => {
         if (!wasmAllocator) {
            throw new Error("WASM allocator not initialized");
         }
         return wasmAllocator.allocFloat32Array(count);
      },
      init: loadWasmFFT,
   },

   wasmCooleyTukey: {
      name: "WASM Cooley-Tukey",
      description: "Fastest WASM FFT. Requires power-of-2 input size.",
      needsPowerOf2: true,
      fft: wasmCooleyTukeyFFT,
      allocFloats: (count: number) => {
         if (!wasmAllocator) {
            throw new Error("WASM allocator not initialized");
         }
         return wasmAllocator.allocFloat32Array(count);
      },
      init: loadWasmFFT,
   },

   // JavaScript implementations
   bluestein: {
      name: "Bluestein (Exact)",
      description: "Most accurate, matches NumPy exactly. Very slow (~8s).",
      needsPowerOf2: false,
      allocFloats: (count: number) => new Float32Array(count),
      fft: bluesteinFFT,
   },

   cooleyTukey: {
      name: "Cooley-Tukey",
      description: "Fastest JS FFT, but requires power-of-2 input size.",
      needsPowerOf2: true,
      allocFloats: (count: number) => new Float32Array(count),
      fft: cooleyTukeyFFT,
   },
};
