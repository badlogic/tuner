#ifndef MEMORY_H
#define MEMORY_H

// WASM uses 32-bit pointers
typedef unsigned int size_t;

// Memory allocator functions imported from TypeScript
// These are provided by the WasmAllocator class

__attribute__((import_module("allocator"), import_name("malloc")))
void* malloc(size_t bytes);

__attribute__((import_module("allocator"), import_name("free")))
void free(void* ptr);

__attribute__((import_module("allocator"), import_name("realloc")))
void* realloc(void* ptr, size_t newSize);

__attribute__((import_module("allocator"), import_name("calloc")))
void* calloc(size_t count, size_t size);

#endif // MEMORY_H