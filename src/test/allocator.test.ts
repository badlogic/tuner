import assert from "node:assert";
import { test } from "node:test";
import { WasmAllocator } from "../wasm/allocator.js";

function createMemory(pages = 1): WebAssembly.Memory {
   return new WebAssembly.Memory({ initial: pages, maximum: 100 });
}

test("basic malloc/free", () => {
   console.log("Running: basic malloc/free");
   const memory = createMemory();
   const allocator = new WasmAllocator();
   allocator.init(memory);

   // Test malloc
   const ptr1 = allocator.malloc(64);
   const ptr2 = allocator.malloc(128);
   const ptr3 = allocator.malloc(256);

   // Verify alignment (should be 8-byte aligned)
   assert.strictEqual(ptr1 % 8, 0);
   assert.strictEqual(ptr2 % 8, 0);
   assert.strictEqual(ptr3 % 8, 0);

   // Test free
   allocator.free(ptr1);
   allocator.free(ptr2);
   allocator.free(ptr3);
});

test("typed array allocation", () => {
   const memory = createMemory();
   const allocator = new WasmAllocator();
   allocator.init(memory);

   // Test different array types
   const floats = allocator.allocFloat32Array(256);
   const doubles = allocator.allocFloat64Array(128);
   const ints = allocator.allocInt32Array(512);

   // Verify they work
   floats.fill(Math.PI);
   doubles.fill(Math.E);
   ints.fill(42);

   const epsilon = 1e-6;
   assert.ok(Math.abs(floats[0] - Math.PI) < epsilon);
   assert.ok(Math.abs(doubles[0] - Math.E) < epsilon);
   assert.strictEqual(ints[0], 42);

   // Test freeArray
   allocator.freeArray(floats);
   allocator.freeArray(doubles);
   allocator.freeArray(ints);
});

test("realloc functionality", () => {
   const memory = createMemory();
   const allocator = new WasmAllocator();
   allocator.init(memory);

   // Allocate and fill with data
   let ptr = allocator.malloc(100);
   const view = new Uint8Array(memory.buffer, ptr, 100);
   for (let i = 0; i < 100; i++) {
      view[i] = i;
   }

   // Shrink
   ptr = allocator.realloc(ptr, 50);
   const newView = new Uint8Array(memory.buffer, ptr, 50);
   for (let i = 0; i < 50; i++) {
      assert.strictEqual(newView[i], i, "Data corrupted during shrink");
   }

   // Grow
   ptr = allocator.realloc(ptr, 200);
   const grownView = new Uint8Array(memory.buffer, ptr, 200);
   for (let i = 0; i < 50; i++) {
      assert.strictEqual(grownView[i], i, "Data corrupted during grow");
   }

   allocator.free(ptr);
});

test("calloc zero initialization", () => {
   const memory = createMemory();
   const allocator = new WasmAllocator();
   allocator.init(memory);

   const ptr = allocator.calloc(100, 4); // 100 * 4 = 400 bytes
   const view = new Uint8Array(memory.buffer, ptr, 400);

   // Should be all zeros
   for (let i = 0; i < 400; i++) {
      assert.strictEqual(view[i], 0, "calloc didn't zero memory");
   }

   allocator.free(ptr);
});

test("free list coalescing", () => {
   const memory = createMemory();
   const allocator = new WasmAllocator();
   allocator.init(memory);

   // Allocate several blocks
   const ptrs = [];
   for (let i = 0; i < 10; i++) {
      ptrs.push(allocator.malloc(64));
   }

   // Free every other block (create fragmentation)
   for (let i = 0; i < ptrs.length; i += 2) {
      allocator.free(ptrs[i]);
   }

   const stats1 = allocator.getStats();

   // Free remaining blocks (should coalesce)
   for (let i = 1; i < ptrs.length; i += 2) {
      allocator.free(ptrs[i]);
   }

   const stats2 = allocator.getStats();

   // Should have fewer blocks after coalescing
   assert.ok(stats2.freeBlocks <= stats1.freeBlocks);
});

test("memory growth", () => {
   const memory = createMemory(1); // Start with 64KB
   const allocator = new WasmAllocator();
   allocator.init(memory, true);

   const initialSize = memory.buffer.byteLength;

   // Allocate more than initial memory
   const largePtr = allocator.malloc(100000); // 100KB

   const newSize = memory.buffer.byteLength;
   assert.ok(newSize > initialSize, "Memory should have grown");

   // Verify we can use the memory
   const view = new Uint8Array(memory.buffer, largePtr, 1000);
   view.fill(0xaa);

   allocator.free(largePtr);
});

test("error handling", () => {
   const memory = createMemory();
   const allocator = new WasmAllocator();
   allocator.init(memory);

   // Test invalid malloc size
   assert.throws(() => {
      allocator.malloc(0);
   }, /Invalid allocation size/);

   // Test double free (should not crash)
   const ptr = allocator.malloc(100);
   allocator.free(ptr);

   // Second free might throw or be silently ignored - either is ok
   // Just make sure it doesn't crash the process
   try {
      allocator.free(ptr);
   } catch (_error) {
      // Expected - double free detected
   }
});

test("stats tracking", () => {
   const memory = createMemory();
   const allocator = new WasmAllocator();
   allocator.init(memory);

   const initialStats = allocator.getStats();
   assert.strictEqual(initialStats.allocatedBlocks, 0);

   // Allocate some memory
   const ptr1 = allocator.malloc(100);
   const ptr2 = allocator.malloc(200);

   const afterAllocStats = allocator.getStats();
   assert.strictEqual(afterAllocStats.allocatedBlocks, 2);

   // Free one
   allocator.free(ptr1);

   const afterFreeStats = allocator.getStats();
   assert.strictEqual(afterFreeStats.allocatedBlocks, 1);
   assert.ok(afterFreeStats.freeBlocks > 0);

   // Clean up
   allocator.free(ptr2);

   const finalStats = allocator.getStats();
   assert.strictEqual(finalStats.allocatedBlocks, 0);
});

test("performance benchmark", () => {
   const memory = createMemory(4); // More memory for performance test
   const allocator = new WasmAllocator();
   allocator.init(memory);

   const iterations = 1000;
   const sizes = [32, 64, 128, 256, 512];

   // Allocation benchmark
   const allocStart = performance.now();
   const pointers = [];

   for (let i = 0; i < iterations; i++) {
      const size = sizes[i % sizes.length];
      pointers.push(allocator.malloc(size));
   }

   const allocTime = performance.now() - allocStart;

   // Deallocation benchmark
   const freeStart = performance.now();
   for (const ptr of pointers) {
      allocator.free(ptr);
   }
   const freeTime = performance.now() - freeStart;

   const totalTime = allocTime + freeTime;

   // Should be reasonably fast (less than 100ms for 2000 operations)
   assert.ok(totalTime < 100, `Performance too slow: ${totalTime.toFixed(2)}ms`);

   console.log(`  ${iterations} alloc/free: ${totalTime.toFixed(2)}ms`);
});
