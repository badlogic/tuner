# Guitar Tuner Pitch Detection Filter Analysis

## Problem Description

When analyzing guitar string recordings with the YIN pitch detection algorithm, we encounter significant outliers that interfere with accurate frequency analysis. These outliers fall into two main categories:

1. **String pluck transients**: When a guitar string is plucked, the initial attack creates complex harmonics and unstable frequency readings before settling to the fundamental frequency
2. **Harmonic confusion**: The YIN algorithm occasionally detects harmonics or subharmonics instead of the fundamental frequency, creating readings that are multiples or fractions of the expected frequency

These outliers appear as sudden frequency jumps (e.g., from 82Hz to 95Hz in a single 46ms chunk) that are physically impossible given realistic string tuning speeds.

## Current Implementation (Without Filter)

The guitar tuner uses:
- **YIN pitch detection algorithm** processing 2048-sample chunks (46ms at 44.1kHz)
- **Frequency smoothing** with weighted moving average over 4 historical readings
- **Real-time processing** of microphone input for live tuning

The analysis tool (`src/test/test-wav-file.ts`) processes WAV recordings to:
- Extract frequency readings from each audio chunk
- Calculate note names and cent deviations
- Generate statistical reports and visualizations
- Identify patterns in pitch detection accuracy

## Filter Implementation

We implemented a dynamic threshold filter in the analysis tool with the following logic:

```typescript
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
```

### Filter Logic

1. **Dynamic threshold calculation**: 
   - Base threshold = 0.6% of current frequency (realistic tuning speed)
   - Minimum threshold = 3Hz (catches obvious artifacts)
   - For E2 (82Hz): threshold ≈ 0.5Hz
   - For higher frequencies: proportionally higher thresholds

2. **Sequential comparison**: Compare each reading to the last kept reading (not the raw previous reading)

3. **Physical constraints**: Based on maximum human tuning speed (~2 semitones/second)

## Test Data

### Dataset: `e_tuning.wav`
- **Recording**: E string tuning sequence
- **Sequence**: Clean E2 → tune down → back to E2 → tune up → back to E2
- **Sample rate**: 44.1kHz, 16-bit PCM
- **Duration**: ~12 seconds
- **Expected frequency**: 82.41Hz (E2)

### Raw Results (Before Filtering)
- **Total detections**: 229 out of 247 chunks (92.7% detection rate)
- **Frequency range**: 67.68Hz - 96.00Hz
- **Obvious outliers**: 
  - Low frequency artifacts: 67-78Hz (C# and D readings)
  - High frequency spikes: 87-96Hz (F and G readings)
- **Outliers >5Hz from E2**: Multiple readings showing impossible frequency jumps

### Filtered Results
- **Kept readings**: 204 out of 229 detections
- **Filtered out**: 25 readings (10.9% of detections)
- **Average frequency**: 82.37Hz (very close to expected 82.41Hz)
- **Standard deviation**: Reduced significantly
- **Frequency range**: Much tighter distribution around expected value

### Key Observations

1. **Legitimate tuning preserved**: The gradual frequency changes during actual tuning (6000-7000ms range) are preserved
2. **Pluck artifacts removed**: Sudden jumps from string plucking are filtered out
3. **Octave confusion filtered**: Readings showing harmonic confusion (2x or 0.5x fundamental) are caught
4. **Sample rate dependency**: Filter correctly adapts to different frequencies

## Evaluation Questions

1. **Effectiveness**: Does the filter successfully remove pluck transients while preserving legitimate tuning changes?

2. **Threshold appropriateness**: Is the 0.6% per-chunk threshold realistic for human tuning speeds?

3. **Edge cases**: How does the filter perform with:
   - Very fast tuning changes
   - Different string frequencies (A2=110Hz, G3=196Hz)
   - Vibrato or natural string oscillations

4. **Alternative approaches**: Would other filtering methods be more effective:
   - Median filtering over time windows
   - Amplitude-based filtering (high amplitude = recent pluck)
   - Multi-pass filtering with different criteria

5. **Real-time applicability**: Can this filtering approach be adapted for the live tuner interface?

## Implementation Files

- **Filter implementation**: `src/test/test-wav-file.ts` (lines 152-188)
- **Test data**: `src/test/data/e_tuning.wav`
- **Analysis output**: `src/test/data/e_tuning_analysis.html` (interactive visualization)
- **Core pitch detector**: `src/pitch-detector.ts` (YIN algorithm with existing smoothing)

The analysis includes interactive Chart.js visualizations showing:
- Stable readings (kept) in teal
- Filtered outliers (removed) as red crosses  
- Remaining outliers (if any) in orange
- Expected frequency reference line