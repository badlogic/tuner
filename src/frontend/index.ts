import { PitchDetectorYIN, type PitchResult } from "../pitch-detector.js";

// Live reload for development
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
   const ws = new WebSocket(`ws://${window.location.host}/livereload`);
   ws.onmessage = () => location.reload();
}

class GuitarTuner {
   private audioContext: AudioContext | null = null;
   private analyser: AnalyserNode | null = null;
   private microphone: MediaStreamAudioSourceNode | null = null;
   private isActive = false;
   private animationId: number | null = null;
   private dataArray: Float32Array | null = null;

   private pitchDetector?: PitchDetectorYIN;

   private noteDisplay = document.getElementById("note-display") as HTMLDivElement;
   private frequencyDisplay = document.getElementById("frequency-display") as HTMLDivElement;
   private needle = document.getElementById("needle") as unknown as SVGLineElement;
   private startBtn = document.getElementById("start-btn") as HTMLButtonElement;
   private debugBtn = document.getElementById("debug-btn") as HTMLButtonElement;
   private debugSection = document.getElementById("debug-section") as HTMLDivElement;
   private spectrumCanvas = document.getElementById("spectrum-canvas") as HTMLCanvasElement;
   private spectrumCtx = this.spectrumCanvas.getContext("2d") as CanvasRenderingContext2D;

   private debugVisible = false;

   constructor() {
      this.startBtn.addEventListener("click", () => this.toggleTuner());
      this.debugBtn.addEventListener("click", () => this.toggleDebug());
   }

   async initializePitchDetector(sampleRate: number) {
      // Create YIN pitch detector with actual sample rate from AudioContext
      this.pitchDetector = new PitchDetectorYIN({
         sampleRate,
         debug: false,
         threshold: 0.1,
         fMin: 40.0, // Lower minimum for baritone guitars
      });

      console.log(`Pitch detector: ${this.pitchDetector.sampleRate}Hz, ${this.pitchDetector.chunkSize} samples`);
   }

   toggleDebug() {
      this.debugVisible = !this.debugVisible;
      if (this.debugVisible) {
         this.debugSection.classList.remove("hidden");
         this.debugBtn.classList.remove(
            "bg-gray-800",
            "bg-opacity-30",
            "hover:bg-opacity-50",
            "text-gray-600",
            "hover:text-gray-400",
         );
         this.debugBtn.classList.add(
            "bg-yellow-600",
            "bg-opacity-80",
            "hover:bg-opacity-100",
            "text-yellow-100",
            "hover:text-white",
         );
      } else {
         this.debugSection.classList.add("hidden");
         this.debugBtn.classList.remove(
            "bg-yellow-600",
            "bg-opacity-80",
            "hover:bg-opacity-100",
            "text-yellow-100",
            "hover:text-white",
         );
         this.debugBtn.classList.add(
            "bg-gray-800",
            "bg-opacity-30",
            "hover:bg-opacity-50",
            "text-gray-600",
            "hover:text-gray-400",
         );
      }
   }

   async toggleTuner() {
      if (this.isActive) {
         this.stop();
      } else {
         await this.start();
      }
   }

   async start() {
      try {
         // Use default audio setup like test.html
         const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

         // Create AudioContext with default sample rate
         this.audioContext = new AudioContext();

         console.log(`AudioContext sample rate: ${this.audioContext.sampleRate}Hz`);

         // Initialize pitch detector with actual sample rate
         await this.initializePitchDetector(this.audioContext.sampleRate);

         // Create analyser like test.html
         this.analyser = this.audioContext.createAnalyser();
         this.microphone = this.audioContext.createMediaStreamSource(stream);

         // Configure analyser exactly like test.html
         this.analyser.fftSize = (this.pitchDetector?.chunkSize || 2048) * 2; // FRAME_SIZE * 2 = 4096
         this.analyser.smoothingTimeConstant = 0.8; // Built-in smoothing like test.html
         this.dataArray = new Float32Array(this.analyser.fftSize);

         this.microphone.connect(this.analyser);

         this.isActive = true;
         this.startBtn.textContent = "STOP";
         this.startBtn.classList.remove("bg-green-600", "hover:bg-green-700");
         this.startBtn.classList.add("bg-red-600", "hover:bg-red-700");

         // Start processing audio like test.html
         this.processAudio();
      } catch (error) {
         console.error("Error accessing microphone:", error);
      }
   }

   stop() {
      this.isActive = false;

      if (this.animationId) {
         cancelAnimationFrame(this.animationId);
         this.animationId = null;
      }

      if (this.microphone) {
         this.microphone.disconnect();
         this.microphone = null;
      }

      if (this.audioContext) {
         this.audioContext.close();
         this.audioContext = null;
      }

      this.analyser = null;
      this.dataArray = null;

      this.startBtn.textContent = "START";
      this.startBtn.classList.remove("bg-red-600", "hover:bg-red-700");
      this.startBtn.classList.add("bg-green-600", "hover:bg-green-700");
      this.noteDisplay.textContent = "A";
      this.frequencyDisplay.textContent = "440.00 Hz";
      this.needle.setAttribute("transform", "rotate(0, 100, 100)");
   }

   processAudio() {
      if (!this.isActive || !this.analyser || !this.dataArray || !this.pitchDetector) {
         return;
      }

      // Get audio data like test.html
      this.analyser.getFloatTimeDomainData(this.dataArray);

      // Extract frame for YIN (exactly like test.html)
      const frame = this.dataArray.slice(0, this.pitchDetector.chunkSize); // FRAME_SIZE = 2048

      try {
         const result = this.pitchDetector.processAudioChunk(frame);

         if (result) {
            this.updateDisplay(result.note, result.frequency, result.cents);
            if (this.debugVisible) {
               this.drawSpectrum(result);
            }
         }
      } catch (error) {
         console.error("Error processing audio:", error);
      }

      // Continue processing like test.html
      this.animationId = requestAnimationFrame(() => this.processAudio());
   }

   drawSpectrum(result: PitchResult) {
      if (!this.spectrumCtx || !result?.debugData) return;

      const canvas = this.spectrumCanvas;
      const ctx = this.spectrumCtx;
      const { hpsData, sampleRate } = result.debugData;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Check if spectrum data is available
      if (!hpsData || hpsData.length === 0) {
         // Display "not available" message
         ctx.fillStyle = "#9ca3af";
         ctx.font = "20px monospace";
         ctx.textAlign = "center";
         ctx.fillText("Spectrum visualization not available", canvas.width / 2, canvas.height / 2);

         // Still show the detected frequency
         ctx.fillStyle = "#10b981";
         ctx.font = "16px monospace";
         ctx.fillText(
            `Detected: ${result.frequency.toFixed(1)}Hz (${result.note})`,
            canvas.width / 2,
            canvas.height / 2 + 30,
         );
         return;
      }

      // Use exact frequency calculation from reference
      const frequencyStep = sampleRate / (hpsData.length * 2);

      // Frequency range to display (60-500 Hz) - matching reference
      const minFreq = 60;
      const maxFreq = 500;
      const minBin = Math.floor(minFreq / frequencyStep);
      const maxBin = Math.floor(maxFreq / frequencyStep);
      const displayBins = maxBin - minBin;

      // Generate all chromatic notes from C2 to B4
      const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const allNotes = [];

      for (let octave = 2; octave <= 4; octave++) {
         for (let noteIndex = 0; noteIndex < 12; noteIndex++) {
            const noteName = noteNames[noteIndex];
            const frequency = 440 * 2 ** (octave - 4 + (noteIndex - 9) / 12);
            if (frequency >= minFreq && frequency <= maxFreq) {
               allNotes.push({
                  note: `${noteName}${octave}`,
                  freq: frequency,
                  isFlat: noteName.includes("#"),
               });
            }
         }
      }

      // Draw HPS spectrum bars
      const barWidth = canvas.width / displayBins;
      let maxAmplitude = 0;
      for (let i = minBin; i <= maxBin && i < hpsData.length; i++) {
         if (hpsData[i] > maxAmplitude) maxAmplitude = hpsData[i];
      }
      if (maxAmplitude === 0) maxAmplitude = 1;

      // Draw spectrum bars
      for (let i = 0; i < displayBins; i++) {
         const binIndex = minBin + i;
         const amplitude = binIndex < hpsData.length ? hpsData[binIndex] : 0;
         const height = (amplitude / maxAmplitude) * (canvas.height - 50);
         const x = i * barWidth;

         // Color based on amplitude
         if (amplitude > maxAmplitude * 0.5) {
            ctx.fillStyle = "#22c55e"; // Green for strong signals
         } else if (amplitude > maxAmplitude * 0.2) {
            ctx.fillStyle = "#eab308"; // Yellow for medium signals
         } else {
            ctx.fillStyle = "#374151"; // Gray for weak signals
         }

         ctx.fillRect(x, canvas.height - height - 30, barWidth - 1, height);
      }

      // Draw frequency labels
      ctx.fillStyle = "#9ca3af";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";

      for (let freq = 100; freq <= 500; freq += 50) {
         const x = ((freq - minFreq) / (maxFreq - minFreq)) * canvas.width;
         ctx.fillText(`${freq}Hz`, x, canvas.height - 8);
      }

      // Draw vertical note markers
      allNotes.forEach((noteData) => {
         const x = ((noteData.freq - minFreq) / (maxFreq - minFreq)) * canvas.width;

         // Draw vertical line
         ctx.strokeStyle = noteData.isFlat ? "#ef4444" : "#dc2626"; // Red for all notes, darker for sharps/flats
         ctx.lineWidth = noteData.isFlat ? 1 : 2;
         ctx.beginPath();
         ctx.moveTo(x, 0);
         ctx.lineTo(x, canvas.height - 30);
         ctx.stroke();

         // Draw note label
         ctx.fillStyle = noteData.isFlat ? "#ef4444" : "#dc2626";
         ctx.font = noteData.isFlat ? "12px monospace" : "14px monospace";
         ctx.textAlign = "center";
         ctx.save();
         ctx.translate(x, 20);
         ctx.rotate(-Math.PI / 2);
         ctx.fillText(noteData.note, 0, 0);
         ctx.restore();
      });

      // Draw detected peaks
      result.debugData.peaks.forEach((peak: { freq: number; magnitude: number; score?: number }, index: number) => {
         const x = ((peak.freq - minFreq) / (maxFreq - minFreq)) * canvas.width;

         if (x >= 0 && x <= canvas.width) {
            // Draw peak marker
            ctx.fillStyle = index === 0 ? "#10b981" : "#06b6d4";
            ctx.beginPath();
            ctx.arc(x, 35, 6, 0, 2 * Math.PI);
            ctx.fill();

            // Draw score label
            ctx.fillStyle = "#ffffff";
            ctx.font = "12px monospace";
            ctx.textAlign = "center";
            ctx.fillText(`${peak.score?.toFixed(0) || "?"}`, x, 55);
         }
      });

      // Draw detected fundamental frequency
      const detectedX = ((result.frequency - minFreq) / (maxFreq - minFreq)) * canvas.width;
      if (detectedX >= 0 && detectedX <= canvas.width) {
         ctx.strokeStyle = "#10b981";
         ctx.lineWidth = 4;
         ctx.beginPath();
         ctx.moveTo(detectedX, 0);
         ctx.lineTo(detectedX, canvas.height - 35);
         ctx.stroke();

         // Label
         ctx.fillStyle = "#10b981";
         ctx.font = "bold 16px monospace";
         ctx.textAlign = "center";
         ctx.fillText(`${result.frequency.toFixed(1)}Hz`, detectedX, canvas.height - 45);
      }
   }

   updateDisplay(note: string, frequency: number, cents: number) {
      this.noteDisplay.textContent = note;
      this.frequencyDisplay.textContent = `${frequency.toFixed(1)} Hz`;

      // Check for NaN values and default to 0
      if (Number.isNaN(cents) || Number.isNaN(frequency)) {
         console.warn("Invalid frequency or cents:", { frequency, cents });
         cents = 0;
      }

      const maxCents = 50;
      const clampedCents = Math.max(-maxCents, Math.min(maxCents, cents));
      const angle = (clampedCents / maxCents) * 80;

      this.needle.setAttribute("transform", `rotate(${angle}, 100, 100)`);

      if (Math.abs(cents) < 5) {
         this.noteDisplay.className = "text-6xl font-mono font-bold text-green-400 mb-2";
         this.needle.setAttribute("stroke", "#22c55e");
      } else if (Math.abs(cents) < 15) {
         this.noteDisplay.className = "text-6xl font-mono font-bold text-yellow-400 mb-2";
         this.needle.setAttribute("stroke", "#eab308");
      } else {
         this.noteDisplay.className = "text-6xl font-mono font-bold text-red-400 mb-2";
         this.needle.setAttribute("stroke", "#ef4444");
      }
   }
}

new GuitarTuner();
