// Test the frequencyToNote functionality with proper FFT of time domain signals
import { PitchDetector, generateTestSignal, signalToFrequencySpectrum } from "../pitch-detector.js";

interface FrequencyToNoteTest {
   inputFrequency: number;
   expectedNote: string;
   expectedCentsRange: [number, number];
   description: string;
}

const tests: FrequencyToNoteTest[] = [
   // E2 string variations (82.41Hz fundamental)
   {
      inputFrequency: 82.41,
      expectedNote: "E2",
      expectedCentsRange: [-5, 5],
      description: "Perfect E2 (low E string)"
   },
   {
      inputFrequency: 82.0,
      expectedNote: "E2",
      expectedCentsRange: [-10, -5],
      description: "E2 slightly flat"
   },
   {
      inputFrequency: 83.0,
      expectedNote: "E2",
      expectedCentsRange: [10, 20],
      description: "E2 slightly sharp"
   },
   
   // A2 string variations (110.0Hz fundamental)
   {
      inputFrequency: 110.0,
      expectedNote: "A2",
      expectedCentsRange: [-5, 5],
      description: "Perfect A2"
   },
   {
      inputFrequency: 109.0,
      expectedNote: "A2",
      expectedCentsRange: [-20, -10],
      description: "A2 flat"
   },
   {
      inputFrequency: 111.5,
      expectedNote: "A2",
      expectedCentsRange: [20, 30],
      description: "A2 sharp"
   },
   
   // Test note boundaries - frequencies that are closer to one note than another
   {
      inputFrequency: 87.5, // Halfway between E2 (82.41) and F2 (87.31)
      expectedNote: "F2",
      expectedCentsRange: [0, 10],
      description: "Boundary test: closer to F2 than E2"
   },
   {
      inputFrequency: 84.5, // Actually closer to E2 (82.41) than F2 (87.31)
      expectedNote: "E2",
      expectedCentsRange: [40, 50],
      description: "Boundary test: closer to E2 than F2"
   },
   
   // Higher frequency tests
   {
      inputFrequency: 440.0,
      expectedNote: "A4",
      expectedCentsRange: [-5, 5],
      description: "Perfect A4 (concert pitch)"
   },
   {
      inputFrequency: 329.63,
      expectedNote: "E4",
      expectedCentsRange: [-5, 5],
      description: "Perfect E4 (high E string)"
   }
];

function runFrequencyToNoteTests() {
   console.log("🎵 FrequencyToNote Test Suite");
   console.log("=============================");
   
   const detector = new PitchDetector(44100);
   let passCount = 0;
   let failCount = 0;
   
   for (const test of tests) {
      console.log(`\n📝 ${test.description}`);
      console.log(`   Input: ${test.inputFrequency}Hz`);
      
      // Generate time domain signal and convert with proper FFT
      const signal = generateTestSignal(test.inputFrequency, 1.0, 44100, [1, 2, 3, 4]);
      const spectrum = signalToFrequencySpectrum(signal);
      const result = detector.detectPitch(spectrum);
      
      if (!result) {
         console.log("   ❌ FAIL: No pitch detected");
         failCount++;
         continue;
      }
      
      console.log(`   Detected: ${result.frequency.toFixed(1)}Hz → ${result.note} (${result.cents} cents)`);
      console.log(`   Expected: ${test.expectedNote} (${test.expectedCentsRange[0]} to ${test.expectedCentsRange[1]} cents)`);
      
      // Check if the detected note matches expected note
      const noteCorrect = result.note === test.expectedNote;
      
      // Check if cents are in reasonable range for the detected frequency
      // Calculate what the cents SHOULD be for the input frequency relative to the detected note
      const expectedCentsForInput = Math.round(1200 * Math.log2(test.inputFrequency / getFrequencyForNote(test.expectedNote)));
      const centsReasonable = Math.abs(result.cents - expectedCentsForInput) < 20; // Allow 20 cent tolerance for FFT quantization
      
      if (noteCorrect && centsReasonable) {
         console.log("   ✅ PASS");
         passCount++;
      } else {
         console.log("   ❌ FAIL");
         if (!noteCorrect) {
            console.log(`      Note mismatch: got ${result.note}, expected ${test.expectedNote}`);
         }
         if (!centsReasonable) {
            console.log(`      Cents unreasonable: got ${result.cents}, expected ~${expectedCentsForInput} (±20)`);
         }
         failCount++;
      }
   }
   
   console.log(`\n🏆 Results: ${passCount}/${tests.length} tests passed`);
   console.log(`Success rate: ${((passCount / tests.length) * 100).toFixed(1)}%`);
   
   if (failCount === 0) {
      console.log("🎉 All tests passed! FrequencyToNote is working correctly.");
   } else {
      console.log(`💥 ${failCount} tests failed. FrequencyToNote needs fixing.`);
   }
}

// Helper function to get frequency for a note
function getFrequencyForNote(note: string): number {
   const noteMap: { [key: string]: number } = {
      "E2": 82.41,
      "F2": 87.31,
      "F#2": 92.50,
      "G2": 98.00,
      "G#2": 103.83,
      "A2": 110.00,
      "A#2": 116.54,
      "B2": 123.47,
      "C3": 130.81,
      "C#3": 138.59,
      "D3": 146.83,
      "D#3": 155.56,
      "E3": 164.81,
      "F3": 174.61,
      "F#3": 185.00,
      "G3": 196.00,
      "G#3": 207.65,
      "A3": 220.00,
      "A#3": 233.08,
      "B3": 246.94,
      "C4": 261.63,
      "C#4": 277.18,
      "D4": 293.66,
      "D#4": 311.13,
      "E4": 329.63,
      "F4": 349.23,
      "F#4": 369.99,
      "G4": 392.00,
      "G#4": 415.30,
      "A4": 440.00,
      "A#4": 466.16,
      "B4": 493.88,
   };
   
   return noteMap[note] || 440.0;
}


// Run the tests
runFrequencyToNoteTests();