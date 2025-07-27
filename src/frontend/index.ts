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
   private a4Frequency: number; // Current A4 reference frequency

   // Auto-repeat state for frequency buttons
   private autoRepeatTimeout: number | null = null;
   private autoRepeatInterval: number | null = null;

   private noteDisplay = document.getElementById("note-display") as HTMLDivElement;
   private frequencyDisplay = document.getElementById("frequency-display") as HTMLDivElement;
   private needle = document.getElementById("needle") as unknown as SVGLineElement;
   private startBtn = document.getElementById("start-btn") as HTMLButtonElement;
   private tuningControls = document.getElementById("tuning-controls") as HTMLDivElement;
   private freqDisplay = document.getElementById("freq-display") as HTMLDivElement;
   private freqUpBtn = document.getElementById("freq-up") as HTMLButtonElement;
   private freqDownBtn = document.getElementById("freq-down") as HTMLButtonElement;

   constructor() {
      // Load saved A4 frequency from localStorage, default to 440Hz
      this.a4Frequency = this.loadA4Frequency();
      this.freqDisplay.textContent = `${this.a4Frequency} Hz`;

      this.startBtn.addEventListener("click", () => this.toggleTuner());

      // Set up press-and-hold for frequency buttons
      this.setupPressAndHold(this.freqUpBtn, 1);
      this.setupPressAndHold(this.freqDownBtn, -1);
   }

   private loadA4Frequency(): number {
      try {
         const saved = localStorage.getItem("tuner-a4-frequency");
         if (saved) {
            const frequency = parseInt(saved, 10);
            // Validate the frequency is in acceptable range
            if (frequency >= 400 && frequency <= 480) {
               return frequency;
            }
         }
      } catch (error) {
         console.warn("Failed to load A4 frequency from localStorage:", error);
      }
      return 440; // Default fallback
   }

   private saveA4Frequency(): void {
      try {
         localStorage.setItem("tuner-a4-frequency", this.a4Frequency.toString());
      } catch (error) {
         console.warn("Failed to save A4 frequency to localStorage:", error);
      }
   }

   private setupPressAndHold(button: HTMLButtonElement, direction: number): void {
      const startAutoRepeat = () => {
         // Clear any existing timers
         this.clearAutoRepeat();

         // Initial adjustment (immediate)
         this.adjustFrequency(direction);

         // Set up auto-repeat after 750ms delay
         this.autoRepeatTimeout = window.setTimeout(() => {
            // Start repeating every 100ms
            this.autoRepeatInterval = window.setInterval(() => {
               this.adjustFrequency(direction);
            }, 100);
         }, 750);
      };

      const stopAutoRepeat = () => {
         this.clearAutoRepeat();
      };

      // Mouse events
      button.addEventListener("mousedown", startAutoRepeat);
      button.addEventListener("mouseup", stopAutoRepeat);
      button.addEventListener("mouseleave", stopAutoRepeat);

      // Touch events for mobile
      button.addEventListener(
         "touchstart",
         (e) => {
            if (e.cancelable) {
               e.preventDefault(); // Only prevent if allowed
            }
            startAutoRepeat();
         },
         { passive: false },
      );
      button.addEventListener("touchend", stopAutoRepeat);
      button.addEventListener("touchcancel", stopAutoRepeat);
   }

   private clearAutoRepeat(): void {
      if (this.autoRepeatTimeout) {
         clearTimeout(this.autoRepeatTimeout);
         this.autoRepeatTimeout = null;
      }
      if (this.autoRepeatInterval) {
         clearInterval(this.autoRepeatInterval);
         this.autoRepeatInterval = null;
      }
   }

   private adjustFrequency(direction: number) {
      // Adjust by 1Hz increments, common range 400-480Hz
      this.a4Frequency = Math.max(400, Math.min(480, this.a4Frequency + direction));
      this.freqDisplay.textContent = `${this.a4Frequency} Hz`;
      this.saveA4Frequency(); // Persist to localStorage
   }

   async initializePitchDetector(sampleRate: number) {
      // Create YIN pitch detector with actual sample rate from AudioContext
      this.pitchDetector = new PitchDetector({
         sampleRate,
         debug: false,
         threshold: 0.1,
         fMin: 40.0, // Lower minimum for baritone guitars
         a4Frequency: this.a4Frequency, // Use current A4 setting
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
         // Check if getUserMedia is available
         if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("getUserMedia is not supported in this browser");
         }

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
         this.tuningControls.style.display = "none"; // Hide tuning controls when active
         this.clearAutoRepeat(); // Stop any ongoing auto-repeat

         // Start processing audio like test.html
         this.processAudio();
      } catch (error) {
         console.error("Error accessing microphone:", error);

         // Show user-friendly error message
         let errorMessage = "Failed to access microphone";
         if (error instanceof Error) {
            if (error.message.includes("not supported")) {
               errorMessage = "Microphone access not supported in this browser";
            } else if (error.name === "NotAllowedError") {
               errorMessage = "Microphone access denied. Please allow microphone access and try again.";
            } else if (error.name === "NotFoundError") {
               errorMessage = "No microphone found";
            } else if (error.name === "NotReadableError") {
               errorMessage = "Microphone is already in use";
            }
         }

         alert(errorMessage);
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
      this.tuningControls.style.display = "block"; // Show tuning controls when stopped
      this.noteDisplay.textContent = "A";
      this.frequencyDisplay.textContent = `${this.a4Frequency}.00 Hz`;
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
