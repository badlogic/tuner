import { PitchDetector } from "../pitch-detector.js";

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

   private pitchDetector?: PitchDetector;

   private noteDisplay = document.getElementById("note-display") as HTMLDivElement;
   private frequencyDisplay = document.getElementById("frequency-display") as HTMLDivElement;
   private needle = document.getElementById("needle") as unknown as SVGLineElement;
   private startBtn = document.getElementById("start-btn") as HTMLButtonElement;

   constructor() {
      this.startBtn.addEventListener("click", () => this.toggleTuner());
   }

   async initializePitchDetector(sampleRate: number) {
      // Create YIN pitch detector with actual sample rate from AudioContext
      this.pitchDetector = new PitchDetector({
         sampleRate,
         debug: false,
         threshold: 0.1,
         fMin: 40.0, // Lower minimum for baritone guitars
      });

      console.log(`Pitch detector: ${this.pitchDetector.sampleRate}Hz, ${this.pitchDetector.chunkSize} samples`);
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

      // Get smoothed audio data and extract PCM chunk
      this.analyser.getFloatTimeDomainData(this.dataArray);
      const chunk = this.dataArray.slice(0, this.pitchDetector.chunkSize); // FRAME_SIZE = 2048
      try {
         const result = this.pitchDetector.processAudioChunk(chunk);
         if (result) {
            this.updateDisplay(result.note, result.frequency, result.cents);
         }
      } catch (error) {
         console.error("Error processing audio:", error);
      }
      this.animationId = requestAnimationFrame(() => this.processAudio());
   }

   updateDisplay(note: string, frequency: number, cents: number) {
      this.noteDisplay.textContent = note;
      this.frequencyDisplay.textContent = `${frequency.toFixed(2)} Hz`;

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
