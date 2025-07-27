#include "memory.h"

// Convenience function for allocating floats
float* alloc_floats(int count) {
    void* ptr = malloc(count * sizeof(float));
    return (float*)ptr;
}

// Import JavaScript Math functions
__attribute__((import_module("Math"), import_name("sin")))
double js_sin(double x);

__attribute__((import_module("Math"), import_name("cos")))
double js_cos(double x);

// Fast math functions using JS imports
float cosf_approx(float x) {
    return (float)js_cos((double)x);
}

float sinf_approx(float x) {
    return (float)js_sin((double)x);
}

// Cooley-Tukey FFT (power-of-2 only)
void cooley_tukey_fft(float* real, float* imag, int n) {
    // Bit-reversal permutation
    for (int i = 1, j = 0; i < n; i++) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;

        if (i < j) {
            float temp = real[i]; real[i] = real[j]; real[j] = temp;
            temp = imag[i]; imag[i] = imag[j]; imag[j] = temp;
        }
    }

    // FFT computation
    for (int len = 2; len <= n; len *= 2) {
        float angle = -2.0f * 3.14159265359f / len;
        float wr = cosf_approx(angle);
        float wi = sinf_approx(angle);

        for (int i = 0; i < n; i += len) {
            float ur = 1.0f, ui = 0.0f;

            for (int j = 0; j < len / 2; j++) {
                int u = i + j;
                int v = i + j + len / 2;

                float tr = real[v] * ur - imag[v] * ui;
                float ti = real[v] * ui + imag[v] * ur;

                real[v] = real[u] - tr;
                imag[v] = imag[u] - ti;
                real[u] += tr;
                imag[u] += ti;

                float temp_ur = ur * wr - ui * wi;
                ui = ur * wi + ui * wr;
                ur = temp_ur;
            }
        }
    }
}

// Cooley-Tukey IFFT (power-of-2 only)
void cooley_tukey_ifft(float* real, float* imag, int n) {
    // Conjugate input
    for (int i = 0; i < n; i++) {
        imag[i] = -imag[i];
    }

    // Forward FFT
    cooley_tukey_fft(real, imag, n);

    // Conjugate output and scale
    float scale = 1.0f / n;
    for (int i = 0; i < n; i++) {
        real[i] *= scale;
        imag[i] *= -scale;
    }
}

// Bluestein FFT implementation
void bluestein_fft(float* real, float* imag, int n) {
    // Find next power of 2 >= 2*n-1
    int m = 2 * n - 1;
    int pow2 = 1;
    while (pow2 < m) {
        pow2 *= 2;
    }

    // Allocate arrays from static pool
    float* a_real = alloc_floats(pow2);
    float* a_imag = alloc_floats(pow2);
    float* b_real = alloc_floats(pow2);
    float* b_imag = alloc_floats(pow2);

    // Zero arrays
    for (int i = 0; i < pow2; i++) {
        a_real[i] = 0.0f; a_imag[i] = 0.0f;
        b_real[i] = 0.0f; b_imag[i] = 0.0f;
    }

    // a[k] = x[k] * exp(-i * pi * k^2 / n)
    for (int k = 0; k < n; k++) {
        float theta = -3.14159265359f * k * k / n;
        float wr = cosf_approx(theta);
        float wi = sinf_approx(theta);
        a_real[k] = real[k] * wr - imag[k] * wi;
        a_imag[k] = real[k] * wi + imag[k] * wr;
    }

    // b[k] = exp(i * pi * k^2 / n)
    for (int k = 0; k < n; k++) {
        float theta = 3.14159265359f * k * k / n;
        float wr = cosf_approx(theta);
        float wi = sinf_approx(theta);
        b_real[k] = wr;
        b_imag[k] = wi;
        if (k > 0 && k < n) {
            b_real[pow2 - k] = wr;
            b_imag[pow2 - k] = wi;
        }
    }

    // Apply Cooley-Tukey FFT to a and b arrays
    cooley_tukey_fft(a_real, a_imag, pow2);
    cooley_tukey_fft(b_real, b_imag, pow2);

    // Pointwise multiplication: c = a * b
    float* c_real = alloc_floats(pow2);
    float* c_imag = alloc_floats(pow2);

    for (int i = 0; i < pow2; i++) {
        c_real[i] = a_real[i] * b_real[i] - a_imag[i] * b_imag[i];
        c_imag[i] = a_real[i] * b_imag[i] + a_imag[i] * b_real[i];
    }

    // Inverse FFT on c
    cooley_tukey_ifft(c_real, c_imag, pow2);

    // Extract final result: y[k] = c[k] * exp(-i * pi * k^2 / n)
    for (int k = 0; k < n; k++) {
        float theta = -3.14159265359f * k * k / n;
        float wr = cosf_approx(theta);
        float wi = sinf_approx(theta);
        real[k] = c_real[k] * wr - c_imag[k] * wi;
        imag[k] = c_real[k] * wi + c_imag[k] * wr;
    }
}

// Export functions for WASM
void wasm_fft(int real_offset, int imag_offset, int size) {
    // Convert offsets to pointers
    float* real = (float*)((char*)0 + real_offset);
    float* imag = (float*)((char*)0 + imag_offset);
    bluestein_fft(real, imag, size);
}