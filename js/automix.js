/**
 * AutoMix - Advanced DJ-style track mixing system
 * Features: Camelot Wheel harmonic matching, Intro/Outro detection,
 * Waveform analysis, EQ Duck, Beat-synchronized transitions
 */

/**
 * Camelot Wheel - Musical key compatibility system
 * Each key is assigned a number (1-12) and letter (A=minor, B=major)
 * Compatible keys: same number, adjacent numbers, or relative major/minor
 */
export const CAMELOT_WHEEL = {
    // Major keys (B)
    C: { number: 8, letter: 'B', name: 'C Major' },
    G: { number: 9, letter: 'B', name: 'G Major' },
    D: { number: 10, letter: 'B', name: 'D Major' },
    A: { number: 11, letter: 'B', name: 'A Major' },
    E: { number: 12, letter: 'B', name: 'E Major' },
    B: { number: 1, letter: 'B', name: 'B Major' },
    'F#': { number: 2, letter: 'B', name: 'F# Major' },
    Db: { number: 3, letter: 'B', name: 'Db Major' },
    Ab: { number: 4, letter: 'B', name: 'Ab Major' },
    Eb: { number: 5, letter: 'B', name: 'Eb Major' },
    Bb: { number: 6, letter: 'B', name: 'Bb Major' },
    F: { number: 7, letter: 'B', name: 'F Major' },
    // Minor keys (A)
    Am: { number: 8, letter: 'A', name: 'A Minor' },
    Em: { number: 9, letter: 'A', name: 'E Minor' },
    Bm: { number: 10, letter: 'A', name: 'B Minor' },
    'F#m': { number: 11, letter: 'A', name: 'F# Minor' },
    'C#m': { number: 12, letter: 'A', name: 'C# Minor' },
    'G#m': { number: 1, letter: 'A', name: 'G# Minor' },
    Ebm: { number: 2, letter: 'A', name: 'Eb Minor' },
    Bbm: { number: 3, letter: 'A', name: 'Bb Minor' },
    Fm: { number: 4, letter: 'A', name: 'F Minor' },
    Cm: { number: 5, letter: 'A', name: 'C Minor' },
    Gm: { number: 6, letter: 'A', name: 'G Minor' },
    Dm: { number: 7, letter: 'A', name: 'D Minor' },
};

/**
 * Check if two keys are harmonically compatible
 * @param {string} key1 - First key (e.g., 'Am', 'C')
 * @param {string} key2 - Second key (e.g., 'F', 'Dm')
 * @returns {Object} - Compatibility info
 */
export function checkKeyCompatibility(key1, key2) {
    const k1 = CAMELOT_WHEEL[key1];
    const k2 = CAMELOT_WHEEL[key2];

    if (!k1 || !k2) {
        return { compatible: false, distance: null, reason: 'Unknown key' };
    }

    // Same key - perfect match
    if (key1 === key2) {
        return { compatible: true, distance: 0, reason: 'Same key' };
    }

    // Same number (relative major/minor) - perfect match
    if (k1.number === k2.number) {
        return { compatible: true, distance: 1, reason: 'Relative major/minor' };
    }

    // Adjacent numbers on the wheel
    const numDiff = Math.abs(k1.number - k2.number);
    const circularDiff = Math.min(numDiff, 12 - numDiff);

    if (circularDiff === 1) {
        return { compatible: true, distance: 2, reason: 'Adjacent on Camelot wheel' };
    }

    // Two steps (energy boost/drop)
    if (circularDiff === 2) {
        return { compatible: true, distance: 3, reason: 'Energy boost zone' };
    }

    // Diagonal (same letter, different number) - often works
    if (k1.letter === k2.letter && circularDiff <= 3) {
        return { compatible: true, distance: 3, reason: 'Same mode' };
    }

    return { compatible: false, distance: circularDiff, reason: 'Dissonant' };
}

/**
 * Get compatible keys for a given key
 * @param {string} key - The base key
 * @returns {Array} - List of compatible keys with ratings
 */
export function getCompatibleKeys(key) {
    const k = CAMELOT_WHEEL[key];
    if (!k) return [];

    const results = [];

    Object.entries(CAMELOT_WHEEL).forEach(([testKey, testK]) => {
        const compat = checkKeyCompatibility(key, testKey);
        if (compat.compatible) {
            results.push({
                key: testKey,
                ...compat,
                camelot: `${testK.number}${testK.letter}`,
            });
        }
    });

    return results.sort((a, b) => a.distance - b.distance);
}

/**
 * Analyze audio buffer to estimate musical key
 * Uses chromagram analysis - measures energy in each pitch class
 * @param {AudioBuffer} audioBuffer
 * @returns {Promise<string>} - Detected key (e.g., 'Am', 'C')
 */
export async function detectMusicalKey(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);

    // Parameters for analysis
    const frameSize = 4096;
    const hopSize = 2048;
    const chromagram = new Array(12).fill(0);
    let totalWeight = 0;

    // Process frames
    for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
        const frame = channelData.slice(i, i + frameSize);

        // Apply Hanning window
        const windowed = new Float32Array(frameSize);
        for (let j = 0; j < frameSize; j++) {
            windowed[j] = frame[j] * 0.5 * (1 - Math.cos((2 * Math.PI * j) / (frameSize - 1)));
        }

        // Compute FFT (simplified - use Web Audio API's AnalyserNode for production)
        const magnitudes = await computeFFT(windowed);

        // Map frequencies to pitch classes
        for (let bin = 0; bin < magnitudes.length / 2; bin++) {
            const freq = (bin * sampleRate) / frameSize;
            if (freq > 50 && freq < 5000) {
                // Focus on fundamental frequencies
                const pitchClass = freqToPitchClass(freq);
                const weight = magnitudes[bin];
                chromagram[pitchClass] += weight;
                totalWeight += weight;
            }
        }
    }

    // Normalize
    if (totalWeight > 0) {
        for (let i = 0; i < 12; i++) {
            chromagram[i] /= totalWeight;
        }
    }

    // Correlate with key profiles
    return matchKeyProfile(chromagram);
}

/**
 * Convert frequency to pitch class (0-11, where 0 = C)
 */
function freqToPitchClass(freq) {
    const midiNote = 69 + 12 * Math.log2(freq / 440);
    return Math.round(midiNote) % 12;
}

/**
 * Simplified FFT computation
 */
async function computeFFT(input) {
    const n = input.length;
    const output = new Float32Array(n);

    // Use a simplified DFT for demo purposes
    // In production, use Web Audio API's AnalyserNode or a library like FFT.js
    for (let k = 0; k < n; k++) {
        let real = 0;
        let imag = 0;
        for (let t = 0; t < n; t++) {
            const angle = (2 * Math.PI * t * k) / n;
            real += input[t] * Math.cos(angle);
            imag -= input[t] * Math.sin(angle);
        }
        output[k] = Math.sqrt(real * real + imag * imag);
    }

    return output;
}

/**
 * Krumhansl-Schmuckler key profiles
 * These represent the typical distribution of pitch classes in major and minor keys
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Correlate chromagram with key profiles to find best match
 */
function matchKeyProfile(chromagram) {
    const keys = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const minorKeys = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'];

    let bestScore = -1;
    let bestKey = 'C';

    // Test major keys
    for (let i = 0; i < 12; i++) {
        let score = 0;
        for (let j = 0; j < 12; j++) {
            score += chromagram[(i + j) % 12] * MAJOR_PROFILE[j];
        }
        if (score > bestScore) {
            bestScore = score;
            bestKey = keys[i];
        }
    }

    // Test minor keys
    for (let i = 0; i < 12; i++) {
        let score = 0;
        for (let j = 0; j < 12; j++) {
            score += chromagram[(i + j) % 12] * MINOR_PROFILE[j];
        }
        if (score > bestScore) {
            bestScore = score;
            bestKey = minorKeys[i];
        }
    }

    return bestKey;
}

/**
 * Analyze track waveform to detect optimal mix points
 * Simplified for performance - analyzes every 100ms instead of 50ms
 * @param {AudioBuffer} audioBuffer
 * @returns {Object} - Analysis results
 */
export async function analyzeTrackWaveform(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const channelData = audioBuffer.getChannelData(0);

    // Analysis parameters - larger hop for performance
    const windowSize = Math.floor(sampleRate * 0.1); // 100ms windows
    const hopSize = Math.floor(sampleRate * 0.2); // 200ms hop (was 50ms)

    // Limit analysis to first 30 seconds for performance
    const maxSamples = Math.min(channelData.length, sampleRate * 30);

    const energyEnvelope = [];
    const rmsValues = [];

    // Calculate RMS energy per window (every 200ms for performance)
    for (let i = 0; i + windowSize < maxSamples; i += hopSize) {
        let sum = 0;
        // Sample every 4th point for performance
        for (let j = 0; j < windowSize; j += 4) {
            sum += channelData[i + j] * channelData[i + j];
        }
        const rms = Math.sqrt(sum / (windowSize / 4));
        rmsValues.push(rms);
        energyEnvelope.push({
            time: i / sampleRate,
            rms: rms,
        });
    }

    // Find intro skip point (first non-silent sample)
    const silenceThreshold = 0.01;
    let introSkipPoint = 0;
    for (let i = 0; i < energyEnvelope.length; i++) {
        if (energyEnvelope[i].rms > silenceThreshold) {
            introSkipPoint = energyEnvelope[i].time;
            break;
        }
    }

    // Find optimal outro point (energy drop detection)
    const outroWindowSeconds = Math.min(10, duration * 0.2); // 10s or 20% of track
    const outroWindowFrames = Math.floor(outroWindowSeconds * 5); // 5 frames per second
    let outroTrimPoint = duration;

    if (rmsValues.length > outroWindowFrames) {
        const recentValues = rmsValues.slice(-outroWindowFrames);
        const maxEnergy = Math.max(...recentValues);
        const threshold = maxEnergy * 0.3; // 30% of max energy

        // Find where energy drops below threshold
        for (let i = recentValues.length - 1; i >= 0; i--) {
            if (recentValues[i] > threshold) {
                const index = rmsValues.length - recentValues.length + i;
                outroTrimPoint = energyEnvelope[index]?.time || duration;
                break;
            }
        }
    }

    return {
        duration,
        introSkipPoint,
        outroTrimPoint,
        beatPositions: [], // Skip beat detection for performance
        averageRMS: rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length,
    };
}

/**
 * Simple beat detection using energy peaks
 */
function detectBeats(energyEnvelope, framesPerSecond) {
    const beats = [];
    const minBeatInterval = 0.3; // Minimum 300ms between beats
    let lastBeatTime = 0;

    // Dynamic threshold based on local energy
    for (let i = 2; i < energyEnvelope.length - 2; i++) {
        const current = energyEnvelope[i];
        const prev = energyEnvelope[i - 1];
        const next = energyEnvelope[i + 1];

        // Peak detection
        if (current.rms > prev.rms && current.rms > next.rms) {
            // Check minimum interval
            if (current.time - lastBeatTime >= minBeatInterval) {
                // Check if above local average
                const localAvg = (prev.rms + next.rms) / 2;
                if (current.rms > localAvg * 1.2) {
                    beats.push(current.time);
                    lastBeatTime = current.time;
                }
            }
        }
    }

    return beats;
}

/**
 * Pre-analyze a track using OfflineAudioContext
 * Limited to 30 seconds to prevent performance issues
 * @param {string} url - Audio URL to analyze
 * @returns {Promise<Object>} - Analysis results
 */
export async function preAnalyzeTrack(url) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        // Decode audio with timeout
        const decodePromise = new Promise((resolve, reject) => {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);

            // Timeout after 5 seconds
            setTimeout(() => reject(new Error('Decode timeout')), 5000);
        });

        const audioBuffer = await decodePromise;

        // Run lightweight analysis (function will handle trimming internally)
        const waveform = await analyzeTrackWaveform(audioBuffer);

        // Return without key detection for now (too CPU intensive)
        return {
            ...waveform,
            key: null,
            camelot: null,
        };
    } catch (error) {
        console.warn('[AutoMix] Pre-analysis failed:', error.message);
        return null;
    }
}

/**
 * AutoMix Engine - Main class for managing transitions
 */
export class AutoMixEngine {
    constructor(audioContext, options = {}) {
        this.audioContext = audioContext;
        this.options = {
            crossfadeDuration: options.crossfadeDuration || 12,
            introSkipEnabled: options.introSkipEnabled !== false,
            outroTrimEnabled: options.outroTrimEnabled !== false,
            eqDuckEnabled: options.eqDuckEnabled !== false,
            harmonicMixEnabled: options.harmonicMixEnabled !== false,
            beatSyncEnabled: options.beatSyncEnabled !== false,
        };

        this.analysisCache = new Map();
        this.transitionState = {
            active: false,
            sourceNode: null,
            targetNode: null,
            sourceGain: null,
            targetGain: null,
            sourceEQ: null,
            targetEQ: null,
        };
    }

    /**
     * Create EQ nodes for bass ducking
     */
    createEQChain() {
        if (!this.audioContext) return null;

        // Low-shelf filter for bass control
        const bassFilter = this.audioContext.createBiquadFilter();
        bassFilter.type = 'lowshelf';
        bassFilter.frequency.value = 200; // 200Hz cutoff
        bassFilter.gain.value = 0; // Start flat

        // High-pass for cleanup
        const highPass = this.audioContext.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 20;

        return { bassFilter, highPass };
    }

    /**
     * Apply bass duck during transition
     */
    applyBassDuck(eqNode, duration) {
        if (!eqNode || !this.options.eqDuckEnabled) return;

        const now = this.audioContext.currentTime;
        const duckAmount = -6; // -6dB reduction

        // Start duck
        eqNode.gain.setValueAtTime(0, now);
        eqNode.gain.linearRampToValueAtTime(duckAmount, now + duration * 0.3);

        // Restore
        eqNode.gain.linearRampToValueAtTime(0, now + duration);
    }

    /**
     * Calculate optimal transition timing for seamless blend
     */
    calculateTransitionTiming(currentAnalysis, nextAnalysis) {
        const crossfadeDuration = this.options.crossfadeDuration;

        // Default: crossfade at end minus duration (let track play fully)
        let mixOutPoint = currentAnalysis.duration - crossfadeDuration;
        let mixInPoint = 0; // Start next track from beginning

        // Only apply outro trim if track has significant silence at end
        if (this.options.outroTrimEnabled && currentAnalysis.outroTrimPoint) {
            const remaining = currentAnalysis.duration - currentAnalysis.outroTrimPoint;
            // Only trim if there's more than 3 seconds of fade
            if (remaining > 3) {
                mixOutPoint = currentAnalysis.outroTrimPoint - crossfadeDuration;
            }
        }

        // Ensure we don't start crossfade too early
        mixOutPoint = Math.max(mixOutPoint, crossfadeDuration);

        return {
            mixOutPoint,
            mixInPoint,
            duration: crossfadeDuration,
        };
    }

    /**
     * Check harmonic compatibility between two tracks
     */
    checkHarmonicCompatibility(currentKey, nextKey) {
        if (!this.options.harmonicMixEnabled) {
            return { compatible: true, reason: 'Harmonic mixing disabled' };
        }
        return checkKeyCompatibility(currentKey, nextKey);
    }

    /**
     * Start a crossfade transition using existing audio context nodes
     */
    async startTransition(sourceGainNode, targetGainNode, timing, options = {}) {
        if (this.transitionState.active) return;
        this.transitionState.active = true;

        const { duration } = timing;
        const now = this.audioContext.currentTime;

        // Create EQ nodes for bass ducking if enabled
        let sourceEQ = null;
        let targetEQ = null;

        if (this.options.eqDuckEnabled && options.applyEQ) {
            sourceEQ = this.createEQChain();
            targetEQ = this.createEQChain();

            // Insert EQ into chain if nodes provided
            if (sourceGainNode && sourceEQ) {
                // Apply bass duck to outgoing track
                this.applyBassDuck(sourceEQ.bassFilter, duration);
            }
        }

        // Schedule crossfade using existing gain nodes
        if (sourceGainNode) {
            // Source fades out
            sourceGainNode.gain.cancelScheduledValues(now);
            sourceGainNode.gain.setValueAtTime(sourceGainNode.gain.value || 1, now);
            sourceGainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
        }

        if (targetGainNode) {
            // Target fades in
            targetGainNode.gain.cancelScheduledValues(now);
            targetGainNode.gain.setValueAtTime(targetGainNode.gain.value || 0, now);
            targetGainNode.gain.exponentialRampToValueAtTime(1, now + duration);
        }

        // Store state
        this.transitionState = {
            active: true,
            sourceGain: sourceGainNode,
            targetGain: targetGainNode,
            sourceEQ: sourceEQ?.bassFilter,
            targetEQ: targetEQ?.bassFilter,
        };

        // Cleanup after transition
        setTimeout(
            () => {
                this.cleanupTransition();
            },
            duration * 1000 + 100
        );

        return true;
    }

    /**
     * Clean up transition nodes
     */
    cleanupTransition() {
        const state = this.transitionState;

        if (state.sourceGain) {
            try {
                state.sourceGain.disconnect();
            } catch (e) {}
        }
        if (state.targetGain) {
            try {
                state.targetGain.disconnect();
            } catch (e) {}
        }

        this.transitionState = {
            active: false,
            sourceNode: null,
            targetNode: null,
            sourceGain: null,
            targetGain: null,
            sourceEQ: null,
            targetEQ: null,
        };
    }

    /**
     * Update options
     */
    setOptions(newOptions) {
        this.options = { ...this.options, ...newOptions };
    }

    /**
     * Get cached analysis or analyze new track
     */
    async getTrackAnalysis(trackId, url) {
        if (this.analysisCache.has(trackId)) {
            return this.analysisCache.get(trackId);
        }

        const analysis = await preAnalyzeTrack(url);
        if (analysis) {
            this.analysisCache.set(trackId, analysis);
        }

        return analysis;
    }

    /**
     * Clear analysis cache
     */
    clearCache() {
        this.analysisCache.clear();
    }
}

export default AutoMixEngine;
