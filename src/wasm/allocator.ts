interface FreeBlock {
   offset: number;
   size: number;
}

export class WasmAllocator {
   private memory!: WebAssembly.Memory;
   private nextFree = 0;
   private allocatedBlocks = 0;
   private freeBlocks: FreeBlock[] = [];
   private allowGrow = false;

   init(memory: WebAssembly.Memory, allowGrow = false) {
      this.memory = memory;
      this.allowGrow = allowGrow;
   }

   // Get imports object for WASM module
   getImports() {
      return {
         allocator: {
            malloc: (bytes: number) => this.malloc(bytes),
            free: (offset: number) => this.free(offset),
            realloc: (offset: number, newSize: number) => this.realloc(offset, newSize),
            calloc: (count: number, size: number) => this.calloc(count, size),
         },
      };
   }

   malloc(bytes: number): number {
      if (bytes <= 0) throw new Error("Invalid allocation size");

      // Align to 8 bytes + 8-byte header (4 bytes size + 4 bytes padding)
      const alignedBytes = (bytes + 7) & ~7;
      const totalSize = alignedBytes + 8;

      // Try free list first
      for (let i = 0; i < this.freeBlocks.length; i++) {
         const block = this.freeBlocks[i];
         if (block.size >= totalSize) {
            // Remove from free list
            this.freeBlocks.splice(i, 1);

            // Split block if too big
            if (block.size > totalSize) {
               this.freeBlocks.push({
                  offset: block.offset + totalSize,
                  size: block.size - totalSize,
               });
            }

            // Write size header (4 bytes size + 4 bytes padding)
            new DataView(this.memory.buffer).setUint32(block.offset, alignedBytes, true);
            this.allocatedBlocks++;
            return block.offset + 8;
         }
      }

      // Bump allocate
      this.ensureMemory(this.nextFree + totalSize);
      const blockOffset = this.nextFree;
      this.nextFree += totalSize;

      // Write size header (4 bytes size + 4 bytes padding)
      new DataView(this.memory.buffer).setUint32(blockOffset, alignedBytes, true);
      this.allocatedBlocks++;
      return blockOffset + 8;
   }

   free(offset: number): void {
      // Read size from header
      const blockOffset = offset - 8;
      const size = new DataView(this.memory.buffer).getUint32(blockOffset, true);
      const totalSize = size + 8;

      const newBlock = { offset: blockOffset, size: totalSize };

      // Insert and coalesce
      this.freeBlocks.push(newBlock);
      this.coalesce();
      this.allocatedBlocks--;
   }

   realloc(offset: number, newSize: number): number {
      if (newSize <= 0) {
         this.free(offset);
         return 0;
      }

      // Read current size from header
      const oldSize = new DataView(this.memory.buffer).getUint32(offset - 8, true);
      const alignedNewSize = (newSize + 7) & ~7;

      // If shrinking or same size, reuse current block
      if (alignedNewSize <= oldSize) {
         // Update header with new size
         new DataView(this.memory.buffer).setUint32(offset - 8, alignedNewSize, true);
         return offset;
      }

      // Growing - allocate new block and copy data
      const newOffset = this.malloc(newSize);
      const oldData = new Uint8Array(this.memory.buffer, offset, oldSize);
      const newData = new Uint8Array(this.memory.buffer, newOffset, newSize);
      newData.set(oldData);

      this.free(offset);
      return newOffset;
   }

   calloc(count: number, size: number): number {
      const totalSize = count * size;
      const offset = this.malloc(totalSize);

      // Zero the memory
      const view = new Uint8Array(this.memory.buffer, offset, totalSize);
      view.fill(0);

      return offset;
   }

   private coalesce(): void {
      this.freeBlocks.sort((a, b) => a.offset - b.offset);

      for (let i = 0; i < this.freeBlocks.length - 1; i++) {
         const curr = this.freeBlocks[i];
         const next = this.freeBlocks[i + 1];

         if (curr.offset + curr.size === next.offset) {
            curr.size += next.size;
            this.freeBlocks.splice(i + 1, 1);
            i--; // Check again
         }
      }
   }

   private ensureMemory(requiredBytes: number): void {
      const currentSize = this.memory.buffer.byteLength;
      if (requiredBytes <= currentSize) return;

      if (!this.allowGrow) {
         throw new Error(`Out of memory: required ${requiredBytes} bytes, but only ${currentSize} bytes available`);
      }

      const neededBytes = requiredBytes - currentSize;
      const pagesNeeded = Math.ceil(neededBytes / 65536);

      try {
         this.memory.grow(pagesNeeded);
      } catch (error) {
         throw new Error(`Out of memory: failed to grow by ${pagesNeeded} pages: ${error}`);
      }
   }

   allocInt8Array(count: number): Int8Array {
      return new Int8Array(this.memory.buffer, this.malloc(count * 1), count);
   }
   allocUint8Array(count: number): Uint8Array {
      return new Uint8Array(this.memory.buffer, this.malloc(count * 1), count);
   }
   allocInt16Array(count: number): Int16Array {
      return new Int16Array(this.memory.buffer, this.malloc(count * 2), count);
   }
   allocUint16Array(count: number): Uint16Array {
      return new Uint16Array(this.memory.buffer, this.malloc(count * 2), count);
   }
   allocInt32Array(count: number): Int32Array {
      return new Int32Array(this.memory.buffer, this.malloc(count * 4), count);
   }
   allocUint32Array(count: number): Uint32Array {
      return new Uint32Array(this.memory.buffer, this.malloc(count * 4), count);
   }
   allocFloat32Array(count: number): Float32Array {
      return new Float32Array(this.memory.buffer, this.malloc(count * 4), count);
   }
   allocFloat64Array(count: number): Float64Array {
      return new Float64Array(this.memory.buffer, this.malloc(count * 8), count);
   }

   freeArray(
      array: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array,
   ): void {
      this.free(array.byteOffset);
   }

   getStats() {
      return {
         nextFree: this.nextFree,
         memorySize: this.memory.buffer.byteLength,
         allocatedBlocks: this.allocatedBlocks,
         freeBlocks: this.freeBlocks.length,
         freeBytes: this.freeBlocks.reduce((sum, block) => sum + block.size, 0),
      };
   }
}
