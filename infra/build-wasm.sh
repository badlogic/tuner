#!/bin/bash

set -e

echo "🔧 Building WASM FFT module..."

# Create output directory
mkdir -p src/wasm

# Compile with clang + link with wasm-ld
echo "Building with clang + wasm-ld..."

# Compile to object file
/opt/homebrew/opt/llvm/bin/clang \
    --target=wasm32 \
    -O3 \
    -c \
    -nostdlib \
    -ffreestanding \
    src/wasm/fft.c \
    -o src/wasm/fft.o

# Link with wasm-ld  
wasm-ld \
    --no-entry \
    --export=wasm_fft \
    --import-memory \
    --allow-undefined \
    src/wasm/fft.o \
    -o src/frontend/fft.wasm

# Clean up
rm src/wasm/fft.o

echo "✅ WASM build complete"

# Check result
if [ -f "src/frontend/fft.wasm" ]; then
    SIZE=$(wc -c < src/frontend/fft.wasm)
    echo "📦 Size: ${SIZE} bytes"
    echo "📁 Output: src/frontend/fft.wasm"
else
    echo "❌ Build failed!"
    exit 1
fi