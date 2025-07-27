import fs from "node:fs";
import wav from "wav";
import { FFT_IMPLEMENTATIONS } from "../fft.js";
import { CHUNK_SIZE, PitchDetector, SAMPLING_RATE } from "../pitch-detector.js";

interface DetectionResult {
   timestamp: number;
   chunkIndex: number;
   frequency: number;
   note?: string;
   cents?: number;
   confidence?: number;
}

function readWavFile(filePath: string): Promise<Float32Array> {
   return new Promise((resolve, reject) => {
      const reader = new wav.Reader();
      const chunks: Buffer[] = [];

      reader.on("format", (format) => {
         console.log("WAV format:", format);
         if (format.sampleRate !== SAMPLING_RATE) {
            console.warn(`Sample rate mismatch: expected ${SAMPLING_RATE}, got ${format.sampleRate}`);
         }
      });

      reader.on("data", (chunk) => {
         chunks.push(chunk);
      });

      reader.on("end", () => {
         // Combine all chunks
         const totalBuffer = Buffer.concat(chunks);

         // Convert 16-bit signed PCM to Float32Array
         const samples = new Float32Array(totalBuffer.length / 2);
         for (let i = 0; i < samples.length; i++) {
            // Read 16-bit signed integer and normalize to [-1, 1]
            const sample = totalBuffer.readInt16LE(i * 2);
            samples[i] = sample / 32768.0;
         }

         console.log(`Read ${samples.length} samples (${(samples.length / SAMPLING_RATE).toFixed(2)}s)`);
         resolve(samples);
      });

      reader.on("error", reject);

      // Read the file
      const stream = fs.createReadStream(filePath);
      stream.pipe(reader);
   });
}

async function testWavFile(fileName: string, expectedNote: string) {
   console.log(`🎵 Testing WAV file: ${fileName} (expected ${expectedNote})...`);

   // Read the WAV file
   const samples = await readWavFile(`src/test/data/${fileName}`);

   // Create detector with Bluestein (accurate) implementation
   const detector = new PitchDetector({
      fftImplementation: FFT_IMPLEMENTATIONS.bluestein,
      debug: false,
   });

   const results: DetectionResult[] = [];
   const logFile = `src/test/data/${fileName.replace(".wav", "_detection_log.txt")}`;

   // Clear previous log
   fs.writeFileSync(logFile, "WAV File Detection Test Results\n");
   fs.appendFileSync(logFile, "=====================================\n");
   fs.appendFileSync(logFile, `File: src/test/data/${fileName}\n`);
   fs.appendFileSync(logFile, `Total samples: ${samples.length}\n`);
   fs.appendFileSync(logFile, `Duration: ${(samples.length / SAMPLING_RATE).toFixed(2)}s\n`);
   fs.appendFileSync(logFile, `Sample rate: ${SAMPLING_RATE}Hz\n\n`);

   // Bootstrap: Feed less samples to speed up testing (10 chunks = ~0.2s)
   const bootstrapChunks = 10;
   console.log(
      `🔧 Bootstrapping with ${bootstrapChunks} chunks (${((bootstrapChunks * CHUNK_SIZE) / SAMPLING_RATE).toFixed(2)}s)...`,
   );

   for (let i = 0; i < bootstrapChunks && i * CHUNK_SIZE < samples.length; i++) {
      const chunkStart = i * CHUNK_SIZE;
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, samples.length);
      const chunk = samples.slice(chunkStart, chunkEnd);

      // Pad chunk if needed
      if (chunk.length < CHUNK_SIZE) {
         const paddedChunk = new Float32Array(CHUNK_SIZE);
         paddedChunk.set(chunk);
         detector.processAudioChunk(paddedChunk);
      } else {
         detector.processAudioChunk(chunk);
      }
   }

   console.log("✅ Bootstrap complete. Starting detection...");
   fs.appendFileSync(logFile, "DETECTION RESULTS:\n");
   fs.appendFileSync(logFile, "Timestamp(s) | Chunk | Frequency | Note | Cents | Confidence\n");
   fs.appendFileSync(logFile, "-------------------------------------------------------\n");

   // Process limited chunks for faster testing (first 50 chunks after bootstrap)
   const totalChunks = Math.min(Math.floor(samples.length / CHUNK_SIZE), bootstrapChunks + 50);

   for (let i = bootstrapChunks; i < totalChunks; i++) {
      const chunkStart = i * CHUNK_SIZE;
      const chunk = samples.slice(chunkStart, chunkStart + CHUNK_SIZE);
      const timestamp = chunkStart / SAMPLING_RATE;

      const result = detector.processAudioChunk(chunk);

      const logEntry: DetectionResult = {
         timestamp,
         chunkIndex: i,
         frequency: result?.frequency ?? 0,
         note: result?.note,
         cents: result?.cents,
         confidence: result?.confidence,
      };

      results.push(logEntry);

      // Log to console every 10 chunks to avoid spam
      if (i % 10 === 0) {
         if (result) {
            console.log(
               `⏱️  ${timestamp.toFixed(2)}s: ${result.frequency.toFixed(1)}Hz → ${result.note}, ${result.cents.toFixed(0)} cents`,
            );
         } else {
            console.log(`⏱️  ${timestamp.toFixed(2)}s: No detection`);
         }
      }

      // Log every result to file
      const logLine = result
         ? `${timestamp.toFixed(3)}s | ${i.toString().padStart(4)} | ${result.frequency.toFixed(1)}Hz | ${result.note} | ${result.cents.toFixed(0)} cents | ${result.confidence.toFixed(2)}\n`
         : `${timestamp.toFixed(3)}s | ${i.toString().padStart(4)} | No detection | - | - | -\n`;

      fs.appendFileSync(logFile, logLine);
   }

   // Summary statistics
   const validResults = results.filter((r) => r.frequency !== undefined);
   const frequencies = validResults.map((r) => r.frequency);
   const notes = validResults.map((r) => r.note);

   console.log("\n📊 SUMMARY:");
   console.log(`Total chunks processed: ${results.length}`);
   console.log(
      `Successful detections: ${validResults.length} (${((validResults.length / results.length) * 100).toFixed(1)}%)`,
   );

   if (frequencies.length > 0) {
      const minFreq = Math.min(...frequencies);
      const maxFreq = Math.max(...frequencies);

      console.log(`Frequency range: ${minFreq.toFixed(1)}Hz - ${maxFreq.toFixed(1)}Hz`);

      // Count note occurrences
      const noteCounts = notes.reduce(
         (acc, note) => {
            if (note) {
               acc[note] = (acc[note] || 0) + 1;
            }
            return acc;
         },
         {} as Record<string, number>,
      );

      console.log("Most detected notes:");
      Object.entries(noteCounts)
         .sort(([, a], [, b]) => b - a)
         .slice(0, 5)
         .forEach(([note, count]) => {
            console.log(`  ${note}: ${count} times (${((count / validResults.length) * 100).toFixed(1)}%)`);
         });
   }

   // Write summary to log file
   fs.appendFileSync(logFile, "\n=== SUMMARY ===\n");
   fs.appendFileSync(logFile, `Total chunks: ${results.length}\n`);
   fs.appendFileSync(
      logFile,
      `Successful detections: ${validResults.length} (${((validResults.length / results.length) * 100).toFixed(1)}%)\n`,
   );

   if (frequencies.length > 0) {
      fs.appendFileSync(
         logFile,
         `Frequency range: ${Math.min(...frequencies).toFixed(1)}Hz - ${Math.max(...frequencies).toFixed(1)}Hz\n`,
      );
   }

   console.log(`\n📝 Detailed log saved to: ${logFile}`);
}

// CLI handling
const args = process.argv.slice(2);

async function main() {
   if (args.length > 0) {
      // Test specific file
      const filePath = args[0];
      const fileName = filePath.includes("/") ? filePath.split("/").pop() : filePath;
      if (!fileName) {
         throw new Error("No file specified");
      }
      const expectedNote = `${fileName.replace(".wav", "").toUpperCase()}2`; // Simple guess
      await testWavFile(fileName, expectedNote);
   } else {
      // Test all WAV files
      const fs = await import("node:fs");
      const files = fs
         .readdirSync("src/test/data")
         .filter((file) => file.endsWith(".wav"))
         .sort();

      console.log(`Found ${files.length} WAV files: ${files.join(", ")}`);

      for (const file of files) {
         const expectedNote = `${file.replace(".wav", "").toUpperCase()}2`;
         console.log(`\n${"=".repeat(60)}`);
         await testWavFile(file, expectedNote);
         console.log("=".repeat(60));
      }
   }
}

main().catch(console.error);
