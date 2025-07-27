// AudioWorklet processor for real-time pitch detection
// Runs on the audio thread (real-time safe)

class PitchProcessor extends AudioWorkletProcessor {
   constructor() {
      super();
      this.bufferSize = 1024; // Match CHUNK_SIZE
      this.buffer = [];
   }

   process(inputs) {
      const input = inputs[0];

      if (input.length > 0) {
         const inputChannel = input[0]; // Mono channel

         // Accumulate samples into buffer
         for (let i = 0; i < inputChannel.length; i++) {
            this.buffer.push(inputChannel[i]);

            // When we have enough samples, send to main thread
            if (this.buffer.length >= this.bufferSize) {
               // Send exactly 1024 samples
               const chunk = new Float32Array(this.buffer.slice(0, this.bufferSize));
               this.port.postMessage({
                  type: "audioChunk",
                  data: chunk,
               });

               // Remove processed samples from buffer
               this.buffer = this.buffer.slice(this.bufferSize);
            }
         }
      }

      // Keep processor alive
      return true;
   }
}

registerProcessor("pitch-processor", PitchProcessor);
