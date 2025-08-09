import fs from "node:fs";
import wav from "wav";
import ExcelJS from "exceljs";
import { PitchDetector } from "../pitch-detector.js";

interface DetectionResult {
   timestamp: number;
   chunkIndex: number;
   frequency: number;
   note?: string;
   cents?: number;
   confidence?: number;
   amplitude?: number;
}

interface AnalysisConfig {
   enableDebug: boolean;
   smoothingAnalysis: boolean;
}

function readWavFile(filePath: string): Promise<{ audioData: Float32Array; sampleRate: number }> {
   return new Promise((resolve, reject) => {
      const reader = new wav.Reader();
      const chunks: Buffer[] = [];
      let wavSampleRate = 44100; // Default fallback

      reader.on("format", (format) => {
         console.log(`WAV format: ${format.channels} channels, ${format.sampleRate}Hz, ${format.bitDepth}-bit`);
         wavSampleRate = format.sampleRate;
      });

      reader.on("data", (chunk) => {
         chunks.push(chunk);
      });

      reader.on("end", () => {
         const buffer = Buffer.concat(chunks);

         // Handle 16-bit PCM (most common format)
         const samples = new Float32Array(buffer.length / 2);
         for (let i = 0; i < samples.length; i++) {
            // Convert 16-bit signed integer to float (-1.0 to 1.0)
            const int16 = buffer.readInt16LE(i * 2);
            samples[i] = int16 / 32768.0;
         }

         resolve({ audioData: samples, sampleRate: wavSampleRate });
      });

      reader.on("error", reject);

      fs.createReadStream(filePath).pipe(reader);
   });
}

async function analyzeWavFile(filePath: string, config: AnalysisConfig) {
   try {
      const { audioData, sampleRate } = await readWavFile(filePath);

      // Create YIN detector with correct sample rate from WAV file
      const detector = new PitchDetector({
         sampleRate: sampleRate,
         debug: config.enableDebug,
         threshold: 0.1,
         fMin: 40.0,
      });

      const chunkSize = detector.chunkSize;
      const numChunks = Math.floor(audioData.length / chunkSize);
      const results: DetectionResult[] = [];

      for (let i = 0; i < numChunks; i++) {
         const chunkStart = i * chunkSize;
         const chunk = audioData.slice(chunkStart, chunkStart + chunkSize);

         const result = detector.processAudioChunk(chunk);
         const timestamp = (chunkStart / detector.sampleRate) * 1000; // ms

         if (result) {
            // Calculate RMS amplitude for this chunk
            const rms = Math.sqrt(chunk.reduce((sum, sample) => sum + sample * sample, 0) / chunk.length);
            
            results.push({
               timestamp,
               chunkIndex: i,
               frequency: result.frequency,
               note: result.note,
               cents: result.cents,
               amplitude: rms,
            });
         }
      }

      // Filter out pluck transients
      const filteredResults = filterPluckTransients(results);
      const removedResults = results.filter(r => !filteredResults.some(f => f.timestamp === r.timestamp));

      await createHtmlReport(filteredResults, wavFilePath, numChunks, results.length, removedResults);

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

function getExpectedFrequency(filePath: string): { note: string; frequency: number } {
   const filename = filePath.toLowerCase();

   if (filename.includes("e.wav") || filename.includes("e_")) {
      return { note: "E2", frequency: 82.41 };
   } else if (filename.includes("a.wav") || filename.includes("a_")) {
      return { note: "A2", frequency: 110.0 };
   } else if (filename.includes("g.wav") || filename.includes("g_")) {
      return { note: "G3", frequency: 196.0 };
   } else if (filename.includes("d.wav") || filename.includes("d_")) {
      return { note: "D3", frequency: 146.83 };
   } else if (filename.includes("b.wav") || filename.includes("b_")) {
      return { note: "B2", frequency: 123.47 };
   } else {
      // Default to E2 if can't determine
      return { note: "E2", frequency: 82.41 };
   }
}

function filterPluckTransients(results: DetectionResult[]): DetectionResult[] {
   if (results.length < 2) return results;
   
   const filtered: DetectionResult[] = [];
   
   for (let i = 0; i < results.length; i++) {
      const current = results[i];
      
      // Always keep the first reading
      if (i === 0) {
         filtered.push(current);
         continue;
      }
      
      const prev = filtered[filtered.length - 1]; // Compare to last kept reading
      
      // Calculate dynamic threshold based on frequency
      // Maximum realistic tuning speed: ~2 semitones/second
      // One chunk = 46ms, so max change ≈ 0.1 semitones ≈ 0.6% of frequency
      const maxRealisticChange = prev.frequency * 0.006; // 0.6% per chunk
      
      // But also set absolute minimum threshold to catch obvious pluck artifacts
      const minThreshold = 3; // 3Hz absolute minimum
      const threshold = Math.max(maxRealisticChange, minThreshold);
      
      const frequencyJump = Math.abs(current.frequency - prev.frequency);
      
      // Reject jumps that exceed realistic tuning speed
      if (frequencyJump > threshold) {
         continue;
      }
      
      filtered.push(current);
   }
   
   return filtered;
}

async function createHtmlReport(results: DetectionResult[], wavFilePath: string, numChunks: number, originalCount?: number, removedResults?: DetectionResult[]) {
   const expected = getExpectedFrequency(wavFilePath);
   const expectedFreq = expected.frequency;
   const expectedNote = expected.note;

   // Calculate statistics
   const frequencies = results.map((r) => r.frequency);
   const avg = frequencies.length > 0 ? frequencies.reduce((sum, f) => sum + f, 0) / frequencies.length : 0;
   const min = frequencies.length > 0 ? Math.min(...frequencies) : 0;
   const max = frequencies.length > 0 ? Math.max(...frequencies) : 0;
   const stdDev =
      frequencies.length > 0
         ? Math.sqrt(frequencies.reduce((sum, f) => sum + Math.pow(f - avg, 2), 0) / frequencies.length)
         : 0;

   // Identify outliers
   const outliers = results.filter((r) => Math.abs(r.frequency - expectedFreq) > 5);

   // Prepare chart data
   const chartData = results.map((r) => ({
      x: r.timestamp,
      y: r.frequency,
      isOutlier: Math.abs(r.frequency - expectedFreq) > 5,
      note: r.note,
      cents: r.cents,
   }));
   
   const removedChartData = removedResults ? removedResults.map(r => ({
      x: r.timestamp,
      y: r.frequency,
      note: r.note,
      cents: r.cents
   })) : [];

   const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Frequency Analysis: ${wavFilePath}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff; }
        .stat-value { font-size: 24px; font-weight: bold; color: #007bff; }
        .stat-label { color: #6c757d; font-size: 14px; }
        .chart-container { margin: 30px 0; }
        .outliers { margin-top: 30px; }
        .outlier-item { background: #fff3cd; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 4px solid #ffc107; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .outlier-row { background: #fff3cd; }
        .good-row { background: #d4edda; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Frequency Analysis Report</h1>
            <h2>${wavFilePath}</h2>
            <p>Analysis of ${results.length} stable detections from ${originalCount || results.length} total detections (${numChunks} chunks)</p>
            ${originalCount && originalCount > results.length ? `<p style="color: #dc3545;"><strong>Filtered out ${originalCount - results.length} pluck transients and unstable readings</strong></p>` : ''}
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">${avg.toFixed(2)} Hz</div>
                <div class="stat-label">Average Frequency</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stdDev.toFixed(2)} Hz</div>
                <div class="stat-label">Standard Deviation</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${((stdDev / avg) * 100).toFixed(2)}%</div>
                <div class="stat-label">Coefficient of Variation</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${outliers.length}</div>
                <div class="stat-label">Outliers (>5Hz from E2)</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${min.toFixed(2)} - ${max.toFixed(2)} Hz</div>
                <div class="stat-label">Range</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${expectedFreq.toFixed(2)} Hz</div>
                <div class="stat-label">Expected ${expectedNote} Frequency</div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="frequencyChart" width="800" height="400"></canvas>
        </div>

        <div class="outliers">
            <h3>Outlier Analysis (${outliers.length} outliers)</h3>
            ${outliers
               .slice(0, 10)
               .map(
                  (o) => `
                <div class="outlier-item">
                    <strong>${o.timestamp.toFixed(0)}ms:</strong> ${o.frequency.toFixed(1)}Hz (${o.note})
                    - ${o.frequency - expectedFreq > 0 ? "+" : ""}${(o.frequency - expectedFreq).toFixed(1)}Hz from ${expectedNote}
                </div>
            `,
               )
               .join("")}
            ${outliers.length > 10 ? `<p><em>... and ${outliers.length - 10} more outliers</em></p>` : ""}
        </div>

        <h3>Detection Data</h3>
        <table>
            <thead>
                <tr>
                    <th>Time (ms)</th>
                    <th>Frequency (Hz)</th>
                    <th>Note</th>
                    <th>Cents</th>
                    <th>Deviation from ${expectedNote}</th>
                </tr>
            </thead>
            <tbody>
                ${results
                   .map((r) => {
                      const deviation = r.frequency - expectedFreq;
                      const isOutlier = Math.abs(deviation) > 5;
                      const rowClass = isOutlier ? "outlier-row" : Math.abs(deviation) < 2 ? "good-row" : "";
                      return `
                        <tr class="${rowClass}">
                            <td>${r.timestamp.toFixed(1)}</td>
                            <td>${r.frequency.toFixed(2)}</td>
                            <td>${r.note}</td>
                            <td>${r.cents?.toFixed(1) || ""}</td>
                            <td>${deviation > 0 ? "+" : ""}${deviation.toFixed(1)}Hz</td>
                        </tr>
                    `;
                   })
                   .join("")}
            </tbody>
        </table>
        <p><em>Showing all ${results.length} detections</em></p>
    </div>

    <script>
        const ctx = document.getElementById('frequencyChart').getContext('2d');
        const data = ${JSON.stringify(chartData)};
        const removedData = ${JSON.stringify(removedChartData)};
        const expectedFreq = ${expectedFreq};
        const expectedNote = '${expectedNote}';

        new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Stable Readings (Kept)',
                    data: data.filter(d => !d.isOutlier).map(d => ({x: d.x, y: d.y})),
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    pointRadius: 3
                }, {
                    label: 'Filtered Outliers (Removed)',
                    data: removedData.map(d => ({x: d.x, y: d.y})),
                    backgroundColor: 'rgba(255, 99, 132, 0.4)',
                    borderColor: 'rgba(255, 99, 132, 0.8)',
                    pointRadius: 4,
                    pointStyle: 'cross'
                }, {
                    label: 'Remaining Outliers (>5Hz from ' + expectedNote + ')',
                    data: data.filter(d => d.isOutlier).map(d => ({x: d.x, y: d.y})),
                    backgroundColor: 'rgba(255, 159, 64, 0.8)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    pointRadius: 5
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Frequency Detection Over Time'
                    },
                    legend: {
                        display: true
                    }
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Time (ms)'
                        }
                    },
                    y: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Frequency (Hz)'
                        },
                        min: Math.min(${min} - 5, expectedFreq - 10),
                        max: Math.max(${max} + 5, expectedFreq + 10)
                    }
                },
                annotation: {
                    annotations: {
                        expectedLine: {
                            type: 'line',
                            yMin: expectedFreq,
                            yMax: expectedFreq,
                            borderColor: 'rgb(255, 205, 86)',
                            borderWidth: 2,
                            label: {
                                content: 'Expected ' + expectedNote + ' (' + expectedFreq.toFixed(2) + ' Hz)',
                                enabled: true
                            }
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;

   const outputFile = wavFilePath.replace(/\.[^/.]+$/, "_analysis.html");
   await fs.promises.writeFile(outputFile, html);
   console.log(`HTML report saved to: ${outputFile}`);

   // Open the file automatically
   const { spawn } = await import("child_process");
   spawn("open", [outputFile], { detached: true, stdio: "ignore" });
   console.log(`Opening HTML report...`);
}

function analyzeResults(results: DetectionResult[], numChunks: number, totalSamples: number, sampleRate: number) {
   if (results.length === 0) {
      return {
         file_stats: { numChunks, totalSamples, sampleRate },
         detection_rate: 0,
         detections: 0,
         stability: null,
         note_changes: 0,
         frequency_stats: null,
      };
   }

   const frequencies = results.map((r) => r.frequency);
   const notes = results.map((r) => r.note).filter(Boolean) as string[];

   // Calculate frequency stability metrics
   const avgFreq = frequencies.reduce((sum, f) => sum + f, 0) / frequencies.length;
   const freqVariance = frequencies.reduce((sum, f) => sum + Math.pow(f - avgFreq, 2), 0) / frequencies.length;
   const freqStdDev = Math.sqrt(freqVariance);
   const freqRange = Math.max(...frequencies) - Math.min(...frequencies);

   // Count note changes
   let noteChanges = 0;
   for (let i = 1; i < notes.length; i++) {
      if (notes[i] !== notes[i - 1]) noteChanges++;
   }

   // Note distribution
   const noteDistribution: Record<string, number> = {};
   notes.forEach((note) => {
      noteDistribution[note] = (noteDistribution[note] || 0) + 1;
   });
   const dominantNote = Object.entries(noteDistribution).sort(([, a], [, b]) => b - a)[0]?.[0];

   return {
      file_stats: {
         numChunks,
         totalSamples,
         sampleRate,
         duration_ms: (totalSamples / sampleRate) * 1000,
      },
      detection_rate: results.length / numChunks,
      detections: results.length,
      frequency_stats: {
         avg: parseFloat(avgFreq.toFixed(2)),
         std_dev: parseFloat(freqStdDev.toFixed(2)),
         range: parseFloat(freqRange.toFixed(2)),
         min: Math.min(...frequencies),
         max: Math.max(...frequencies),
      },
      stability: {
         frequency_cv: parseFloat(((freqStdDev / avgFreq) * 100).toFixed(2)), // coefficient of variation
         note_changes: noteChanges,
         note_stability: parseFloat((((notes.length - noteChanges) / notes.length) * 100).toFixed(1)),
      },
      note_analysis: {
         dominant_note: dominantNote,
         note_distribution: noteDistribution,
         unique_notes: Object.keys(noteDistribution).length,
      },
      raw_detections: results.slice(0, 20), // First 20 for inspection
   };
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
   console.log("Usage: node test-wav-file.ts <wav-file-path> [--debug]");
   console.log("Examples:");
   console.log("  node test-wav-file.ts e.wav --debug  # HTML with debug logging");
   process.exit(1);
}

const wavFilePath = args[0];
const enableDebug = args.includes("--debug");

const config: AnalysisConfig = {
   enableDebug,
   smoothingAnalysis: true,
};

if (!fs.existsSync(wavFilePath)) {
   console.error(`File not found: ${wavFilePath}`);
   process.exit(1);
}

analyzeWavFile(wavFilePath, config);
