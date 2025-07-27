import fs from "node:fs";
import wav from "wav";
import { PitchDetector } from "../pitch-detector.js";

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
         console.log(`WAV format: ${format.channels} channels, ${format.sampleRate}Hz, ${format.bitDepth}-bit`);
      });

      reader.on("data", (chunk) => {
         chunks.push(chunk);
      });

      reader.on("end", () => {
         const buffer = Buffer.concat(chunks);
         const samples = new Float32Array(buffer.length / 4); // 32-bit float

         for (let i = 0; i < samples.length; i++) {
            samples[i] = buffer.readFloatLE(i * 4);
         }

         resolve(samples);
      });

      reader.on("error", reject);

      fs.createReadStream(filePath).pipe(reader);
   });
}

async function analyzeWavFile(filePath: string) {
   console.log(`Analyzing WAV file: ${filePath}`);

   try {
      const audioData = await readWavFile(filePath);
      console.log(`Loaded ${audioData.length} samples`);

      // Create YIN detector (sample rate will be overridden based on WAV file)
      const detector = new PitchDetector({
         sampleRate: 48000, // Default, should match WAV file
         debug: false,
         threshold: 0.1,
         fMin: 40.0,
      });

      const chunkSize = detector.chunkSize;
      const numChunks = Math.floor(audioData.length / chunkSize);
      const results: DetectionResult[] = [];

      console.log(`Processing ${numChunks} chunks of ${chunkSize} samples each...`);

      for (let i = 0; i < numChunks; i++) {
         const chunkStart = i * chunkSize;
         const chunk = audioData.slice(chunkStart, chunkStart + chunkSize);

         const result = detector.processAudioChunk(chunk);
         const timestamp = (chunkStart / detector.sampleRate) * 1000; // ms

         if (result) {
            results.push({
               timestamp,
               chunkIndex: i,
               frequency: result.frequency,
               note: result.note,
               cents: result.cents,
            });

            console.log(
               `Chunk ${i.toString().padStart(3)}: ${timestamp.toFixed(0).padStart(4)}ms - ` +
                  `${result.frequency.toFixed(1)}Hz ${result.note} (${result.cents.toFixed(0)} cents)`,
            );
         }
      }

      // Summary
      if (results.length > 0) {
         const avgFreq = results.reduce((sum, r) => sum + r.frequency, 0) / results.length;
         const mostCommonNote = results.reduce(
            (acc, r) => {
               if (r.note) {
                  acc[r.note] = (acc[r.note] || 0) + 1;
               }
               return acc;
            },
            {} as Record<string, number>,
         );

         const dominantNote = Object.entries(mostCommonNote).sort(([, a], [, b]) => b - a)[0][0];

         console.log(`\nSummary:`);
         console.log(
            `  Detections: ${results.length}/${numChunks} chunks (${((results.length / numChunks) * 100).toFixed(1)}%)`,
         );
         console.log(`  Average frequency: ${avgFreq.toFixed(1)}Hz`);
         console.log(`  Dominant note: ${dominantNote}`);
         console.log(
            `  Detection rate: ${(results.length / (audioData.length / detector.sampleRate)).toFixed(1)} detections/second`,
         );
      } else {
         console.log("No pitch detected in any chunk");
      }
   } catch (error) {
      console.error("Error analyzing WAV file:", error);
      process.exit(1);
   }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
   console.log("Usage: node test-wav-file.ts <wav-file-path>");
   console.log("Example: node test-wav-file.ts src/test/data/e.wav");
   process.exit(1);
}

const wavFilePath = args[0];

if (!fs.existsSync(wavFilePath)) {
   console.error(`File not found: ${wavFilePath}`);
   process.exit(1);
}

analyzeWavFile(wavFilePath);
