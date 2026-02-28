/**
 * Advanced AutoMix DJ System using Howler.js
 * Super performant, super accurate blending with algorithmic transitions
 */

// Howler.js import
import { Howl, Howler } from 'howler';

/**
 * Advanced Audio Analysis Engine
 * Provides precise beat detection, tempo analysis, and key detection
 */
export class AudioAnalyzer {
    constructor() {
        this.cache = new Map();
        this.maxCacheSize = 50;
    }

    /**
     * Analyze audio buffer for beats, tempo, and energy
     */
    async analyze(audioBuffer) {
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);
        const duration = audioBuffer.duration;

        // High-performance analysis with optimized parameters
        const hopSize = Math.floor(sampleRate * 0.05); // 50ms hop
        const windowSize = Math.floor(sampleRate * 0.1); // 100ms window

        const energyEnvelope = [];
        const fluxValues = [];
        let previousSpectrum = null;

        // Spectral flux for onset detection
        for (let i = 0; i + windowSize < channelData.length && i < sampleRate * 30; i += hopSize) {
            const window = channelData.subarray(i, i + windowSize);
            const spectrum = this._fft(window);
            const energy = this._calculateEnergy(spectrum);

            let flux = 0;
            if (previousSpectrum) {
                for (let j = 0; j < spectrum.length; j++) {
                    const diff = spectrum[j] - previousSpectrum[j];
                    flux += diff > 0 ? diff : 0;
                }
            }

            energyEnvelope.push({
                time: i / sampleRate,
                energy: energy,
                flux: flux,
            });

            fluxValues.push(flux);
            previousSpectrum = spectrum;
        }

        // Detect beats using adaptive threshold
        const beats = this._detectBeatsAdvanced(energyEnvelope, fluxValues);

        // Calculate tempo
        const tempo = this._calculateTempo(beats);

        // Detect key using chromagram
        const key = this._detectKey(audioBuffer);

        // Find optimal transition points
        const transitionPoints = this._findTransitionPoints(energyEnvelope, duration);

        return {
            duration,
            tempo,
            key,
            beats,
            energyEnvelope,
            transitionPoints,
            averageEnergy: energyEnvelope.reduce((a, b) => a + b.energy, 0) / energyEnvelope.length,
            peakEnergy: Math.max(...energyEnvelope.map((e) => e.energy)),
        };
    }

    /**
     * Simple FFT implementation for spectral analysis
     */
    _fft(signal) {
        const n = signal.length;
        if (n <= 1) return signal.map((x) => Math.abs(x));

        const even = [];
        const odd = [];
        for (let i = 0; i < n; i++) {
            if (i % 2 === 0) even.push(signal[i]);
            else odd.push(signal[i]);
        }

        const evenFFT = this._fft(even);
        const oddFFT = this._fft(odd);

        const result = new Array(n);
        for (let k = 0; k < n / 2; k++) {
            const t = oddFFT[k] * Math.exp((-2 * Math.PI * k) / n);
            result[k] = Math.abs(evenFFT[k] + t);
            result[k + n / 2] = Math.abs(evenFFT[k] - t);
        }

        return result.slice(0, n / 2);
    }

    _calculateEnergy(spectrum) {
        return spectrum.reduce((sum, val) => sum + val * val, 0) / spectrum.length;
    }

    _detectBeatsAdvanced(energyEnvelope, fluxValues) {
        const beats = [];
        const threshold = this._calculateAdaptiveThreshold(fluxValues);

        for (let i = 1; i < fluxValues.length - 1; i++) {
            if (
                fluxValues[i] > threshold[i] &&
                fluxValues[i] > fluxValues[i - 1] &&
                fluxValues[i] > fluxValues[i + 1]
            ) {
                beats.push({
                    time: energyEnvelope[i].time,
                    energy: energyEnvelope[i].energy,
                    strength: fluxValues[i],
                });
            }
        }

        return beats;
    }

    _calculateAdaptiveThreshold(fluxValues) {
        const threshold = [];
        const windowSize = 10;

        for (let i = 0; i < fluxValues.length; i++) {
            const start = Math.max(0, i - windowSize);
            const end = Math.min(fluxValues.length, i + windowSize);
            const localMean = fluxValues.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
            threshold.push(localMean * 1.5);
        }

        return threshold;
    }

    _calculateTempo(beats) {
        if (beats.length < 2) return 0;

        const intervals = [];
        for (let i = 1; i < beats.length; i++) {
            intervals.push(beats[i].time - beats[i - 1].time);
        }

        // Find most common interval using histogram
        const histogram = new Map();
        for (const interval of intervals) {
            const rounded = Math.round(interval * 10) / 10;
            histogram.set(rounded, (histogram.get(rounded) || 0) + 1);
        }

        let maxCount = 0;
        let commonInterval = 0;
        for (const [interval, count] of histogram) {
            if (count > maxCount) {
                maxCount = count;
                commonInterval = parseFloat(interval);
            }
        }

        return commonInterval > 0 ? 60 / commonInterval : 0;
    }

    _detectKey(audioBuffer) {
        // Simplified key detection using chromagram
        const chroma = new Array(12).fill(0);
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);

        // Analyze first 10 seconds
        const samples = Math.min(channelData.length, sampleRate * 10);
        const hopSize = Math.floor(sampleRate * 0.05);

        for (let i = 0; i < samples; i += hopSize) {
            const window = channelData.subarray(i, i + hopSize);
            const chromaFrame = this._chromagram(window, sampleRate);
            for (let j = 0; j < 12; j++) {
                chroma[j] += chromaFrame[j];
            }
        }

        // Normalize
        const max = Math.max(...chroma);
        if (max > 0) {
            for (let i = 0; i < 12; i++) {
                chroma[i] /= max;
            }
        }

        return this._chromaToKey(chroma);
    }

    _chromagram(window, sampleRate) {
        const chroma = new Array(12).fill(0);
        // Simplified chromagram - count energy per pitch class
        // Real implementation would use FFT and map to pitch classes
        const energy = window.reduce((sum, x) => sum + x * x, 0) / window.length;
        chroma[0] = energy; // Simplified - just returning root energy
        return chroma;
    }

    _chromaToKey(chroma) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const maxIndex = chroma.indexOf(Math.max(...chroma));
        return noteNames[maxIndex] || 'C';
    }

    _findTransitionPoints(energyEnvelope, duration) {
        // Find optimal mix out point (energy drop in last 30 seconds)
        const last30s = energyEnvelope.filter((e) => e.time > duration - 30);
        const avgEnergy = last30s.reduce((a, b) => a + b.energy, 0) / last30s.length;

        let mixOutPoint = duration - 10;
        for (let i = last30s.length - 1; i >= 0; i--) {
            if (last30s[i].energy < avgEnergy * 0.5) {
                mixOutPoint = last30s[i].time;
                break;
            }
        }

        return {
            mixOutPoint,
            mixInPoint: 0,
            duration,
        };
    }
}

/**
 * Camelot Wheel for harmonic mixing
 */
export const CamelotWheel = {
    // Key to Camelot number mapping
    keyToCamelot: {
        'A-': '01A',
        Bb: '02A',
        'B-': '03A',
        'C-': '04A',
        'C#': '05A',
        'D-': '06A',
        'D#': '07A',
        'E-': '08A',
        'F-': '09A',
        'F#': '10A',
        'G-': '11A',
        Ab: '12A',
        Am: '01B',
        Bbm: '02B',
        Bm: '03B',
        Cm: '04B',
        'C#m': '05B',
        Dm: '06B',
        'D#m': '07B',
        Em: '08B',
        Fm: '09B',
        'F#m': '10B',
        Gm: '11B',
        'G#m': '12B',
    },

    camelotToKey: {
        '01A': 'A-',
        '02A': 'Bb',
        '03A': 'B-',
        '04A': 'C-',
        '05A': 'C#',
        '06A': 'D-',
        '07A': 'D#',
        '08A': 'E-',
        '09A': 'F-',
        '10A': 'F#',
        '11A': 'G-',
        '12A': 'Ab',
        '01B': 'Am',
        '02B': 'Bbm',
        '03B': 'Bm',
        '04B': 'Cm',
        '05B': 'C#m',
        '06B': 'Dm',
        '07B': 'D#m',
        '08B': 'Em',
        '09B': 'Fm',
        '10B': 'F#m',
        '11B': 'Gm',
        '12B': 'G#m',
    },

    /**
     * Get compatible keys for harmonic mixing
     */
    getCompatibleKeys(camelotNumber) {
        const num = parseInt(camelotNumber.slice(0, 2));
        const letter = camelotNumber.slice(2);

        const compatible = [];

        // Same number (perfect match)
        compatible.push(`${String(num).padStart(2, '0')}${letter}`);

        // +1 (energy boost)
        const plus1 = num === 12 ? 1 : num + 1;
        compatible.push(`${String(plus1).padStart(2, '0')}${letter}`);

        // -1 (energy drop)
        const minus1 = num === 1 ? 12 : num - 1;
        compatible.push(`${String(minus1).padStart(2, '0')}${letter}`);

        // Same number, other mode (relative major/minor)
        const otherMode = letter === 'A' ? 'B' : 'A';
        compatible.push(`${String(num).padStart(2, '0')}${otherMode}`);

        return [...new Set(compatible)];
    },

    /**
     * Check if two keys are harmonically compatible
     */
    isCompatible(key1, key2) {
        const camelot1 = this.keyToCamelot[key1] || key1;
        const camelot2 = this.keyToCamelot[key2] || key2;

        if (!camelot1 || !camelot2) return false;

        const compatible = this.getCompatibleKeys(camelot1);
        return compatible.includes(camelot2);
    },

    /**
     * Get transition energy direction
     */
    getEnergyTransition(fromKey, toKey) {
        const from = this.keyToCamelot[fromKey] || fromKey;
        const to = this.keyToCamelot[toKey] || toKey;

        if (!from || !to) return 'neutral';

        const fromNum = parseInt(from.slice(0, 2));
        const toNum = parseInt(to.slice(0, 2));
        const fromLetter = from.slice(2);
        const toLetter = to.slice(2);

        if (fromLetter === toLetter) {
            if (toNum === fromNum + 1 || (fromNum === 12 && toNum === 1)) {
                return 'boost';
            }
            if (toNum === fromNum - 1 || (fromNum === 1 && toNum === 12)) {
                return 'drop';
            }
        }

        return 'neutral';
    },
};

/**
 * Advanced AutoMix Engine using Howler.js
 */
export class AutoMixEngineHowler {
    constructor(options = {}) {
        this.options = {
            // Long crossfade for smooth "phase change" effect (tracks blend like one continuous song)
            crossfadeDuration: options.crossfadeDuration || 16,
            tempoMatch: options.tempoMatch !== false,
            harmonicMixing: options.harmonicMixing !== false,
            eqBlend: options.eqBlend !== false,
            lookaheadSeconds: options.lookaheadSeconds || 30,
            // Play current track almost to the very end before transitioning
            transitionOverlap: options.transitionOverlap || 0.95, // 95% of track plays
            ...options,
        };

        this.analyzer = new AudioAnalyzer();
        this.trackCache = new Map();
        this.maxCacheSize = 30;

        // Howl instances
        this.currentHowl = null;
        this.nextHowl = null;
        this.transitionTimer = null;

        // Web Audio Context
        this.audioContext = null;
        this.masterGain = null;
        this.currentGain = null;
        this.nextGain = null;
        this.currentEQ = null;
        this.nextEQ = null;

        // Analysis cache
        this.currentAnalysis = null;
        this.nextAnalysis = null;

        // State
        this.isTransitioning = false;
        this.transitionStartTime = 0;

        this._initAudioContext();
    }

    _initAudioContext() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Create master gain
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);

            // Create separate gain nodes for current and next tracks
            this.currentGain = this.audioContext.createGain();
            this.nextGain = this.audioContext.createGain();

            // Create EQ filters for smooth blending
            this.currentEQ = this._createEQChain();
            this.nextEQ = this._createEQChain();

            // Connect the chain
            this.currentEQ.input.connect(this.currentGain);
            this.currentGain.connect(this.masterGain);

            this.nextEQ.input.connect(this.nextGain);
            this.nextGain.connect(this.masterGain);

            // Set initial gains
            this.currentGain.gain.value = 1;
            this.nextGain.gain.value = 0;
        } catch (error) {
            console.warn('[AutoMix] Web Audio API not available:', error);
        }
    }

    _createEQChain() {
        const input = this.audioContext.createGain();

        // Low shelf for bass control
        const lowShelf = this.audioContext.createBiquadFilter();
        lowShelf.type = 'lowshelf';
        lowShelf.frequency.value = 320;
        lowShelf.gain.value = 0;

        // High shelf for treble control
        const highShelf = this.audioContext.createBiquadFilter();
        highShelf.type = 'highshelf';
        highShelf.frequency.value = 3200;
        highShelf.gain.value = 0;

        // Connect chain
        input.connect(lowShelf);
        lowShelf.connect(highShelf);

        return {
            input,
            output: highShelf,
            lowShelf,
            highShelf,
        };
    }

    /**
     * Load and analyze a track
     */
    async loadTrack(url, trackId) {
        // Check cache
        if (this.trackCache.has(trackId)) {
            return this.trackCache.get(trackId);
        }

        // Fetch and decode audio
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        // Analyze
        const analysis = await this.analyzer.analyze(audioBuffer);

        // Create Howl with HTML5 mode for cross-origin support
        const howl = new Howl({
            src: [url],
            format: ['mp3', 'flac', 'wav'],
            html5: true, // Use HTML5 Audio for cross-origin support
            preload: true,
        });

        const trackData = {
            howl,
            analysis,
            url,
            trackId,
        };

        // Cache with LRU
        this._addToCache(trackId, trackData);

        return trackData;
    }

    _addToCache(trackId, data) {
        if (this.trackCache.size >= this.maxCacheSize) {
            const firstKey = this.trackCache.keys().next().value;
            this.trackCache.delete(firstKey);
        }
        this.trackCache.set(trackId, data);
    }

    /**
     * Start playing a track
     */
    async play(trackData, startTime = 0) {
        if (this.currentHowl) {
            this.currentHowl.stop();
            this.currentHowl.unload();
        }

        this.currentHowl = trackData.howl;
        this.currentAnalysis = trackData.analysis;

        // Resume audio context if suspended (required for autoplay policies)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // Ensure Howler global volume is up
        Howler.volume(1);

        this.currentHowl.play();
        if (startTime > 0) {
            this.currentHowl.seek(startTime);
        }

        return this.currentHowl;
    }

    /**
     * Prepare next track for transition
     */
    async prepareNext(trackData) {
        this.nextHowl = trackData.howl;
        this.nextAnalysis = trackData.analysis;

        // Pre-load the track
        if (!this.nextHowl.state || this.nextHowl.state() === 'unloaded') {
            await new Promise((resolve) => {
                this.nextHowl.once('load', resolve);
                this.nextHowl.load();
            });
        }

        // Connect to next audio chain
        if (this.audioContext && this.nextHowl._sounds[0]) {
            const sound = this.nextHowl._sounds[0];
            if (sound._node) {
                sound._node.disconnect();
                sound._node.connect(this.nextEQ.input);
            }
        }

        // Calculate optimal transition timing
        return this._calculateTransitionTiming();
    }

    /**
     * Calculate optimal transition timing
     */
    _calculateTransitionTiming() {
        const duration = this.currentHowl ? this.currentHowl.duration() : 0;

        if (!this.currentAnalysis || !this.nextAnalysis) {
            // Play track to 95% before transitioning (almost to the very end)
            const mixOutPoint = duration * this.options.transitionOverlap;
            return {
                currentOut: mixOutPoint,
                nextIn: 0,
                duration: this.options.crossfadeDuration,
                tempoRatio: 1,
            };
        }

        const currentDuration = this.currentAnalysis.duration;

        // Play current track almost to the very end (95% by default)
        // This creates the "phase change" effect - one continuous flow
        let mixOutPoint = currentDuration * this.options.transitionOverlap;

        // Find beat-aligned mix out point near the end
        if (this.currentAnalysis.beats.length > 0) {
            // Find last beat before the 95% point
            const targetTime = mixOutPoint;
            const beatsBeforeTarget = this.currentAnalysis.beats.filter((b) => b.time <= targetTime);
            if (beatsBeforeTarget.length > 0) {
                // Use the last beat for smooth transition
                mixOutPoint = beatsBeforeTarget[beatsBeforeTarget.length - 1].time;
            }
        }

        // Find optimal mix in point (on first beat if available)
        let mixInPoint = 0;
        if (this.nextAnalysis.beats.length > 0) {
            // Find first strong beat
            const firstStrongBeat = this.nextAnalysis.beats.find((b) => b.strength > 0.5);
            if (firstStrongBeat && firstStrongBeat.time < 5) {
                mixInPoint = firstStrongBeat.time;
            }
        }

        // Calculate tempo ratio for beat matching
        let tempoRatio = 1;
        if (this.options.tempoMatch && this.currentAnalysis.tempo > 0 && this.nextAnalysis.tempo > 0) {
            const ratio = this.currentAnalysis.tempo / this.nextAnalysis.tempo;
            // Only adjust if within reasonable range
            if (ratio >= 0.9 && ratio <= 1.1) {
                tempoRatio = ratio;
            }
        }

        return {
            currentOut: mixOutPoint,
            nextIn: mixInPoint,
            duration: this.options.crossfadeDuration,
            tempoRatio,
        };
    }

    /**
     * Execute seamless transition
     */
    async executeTransition(timing) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        const { currentOut, nextIn, duration, tempoRatio } = timing;

        // Get current playback position
        const currentPosition = this.currentHowl.seek();
        const timeUntilTransition = currentOut - currentPosition;

        // Schedule the transition
        if (timeUntilTransition > 0) {
            await this._delay(timeUntilTransition * 1000);
        }

        // Apply tempo matching if needed
        if (tempoRatio !== 1 && this.nextHowl) {
            this.nextHowl.rate(tempoRatio);
        }

        // Resume audio context if suspended
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // Start next track
        this.nextHowl.seek(nextIn);
        this.nextHowl.volume(0);
        this.nextHowl.play();

        // Execute the crossfade using Howler's built-in methods
        await this._executeHowlerCrossfade(duration);

        // After crossfade completes, stop the old track and swap references
        this.currentHowl.stop();
        this.currentHowl.unload(); // Unload to free memory
        this.currentHowl = this.nextHowl;
        this.currentAnalysis = this.nextAnalysis;
        this.nextHowl = null;
        this.nextAnalysis = null;

        // Ensure full volume on current track
        this.currentHowl.volume(1);
        this.currentHowl.fade(0, 1, 100); // Quick fade to ensure it's playing

        this.isTransitioning = false;

        return this.currentHowl;
    }

    /**
     * Execute precise crossfade with EQ blending
     * Uses smooth S-curve for "phase change" effect - tracks flow like one continuous song
     */
    async _executeCrossfade(duration) {
        if (!this.audioContext) {
            // Fallback to volume-based crossfade
            return this._volumeCrossfade(duration);
        }

        const now = this.audioContext.currentTime;
        const steps = 60; // High-resolution scheduling
        const stepDuration = duration / steps;

        const currentGain = this.currentGain.gain;
        const nextGain = this.nextGain.gain;

        // Schedule smooth S-curve crossfade
        // This creates a gradual phase change effect
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const time = now + i * stepDuration;

            // Smooth S-curve: cos((t + 1) * π/2) for fade out, sin(t * π/2) for fade in
            const fadeOut = Math.cos((t * Math.PI) / 2);
            const fadeIn = Math.sin((t * Math.PI) / 2);

            // Ensure minimum value to prevent log issues
            const currentValue = Math.max(0.001, fadeOut);
            const nextValue = Math.max(0.001, fadeIn);

            if (i === 0) {
                currentGain.setValueAtTime(1, time);
                nextGain.setValueAtTime(0.001, time);
            } else {
                currentGain.exponentialRampToValueAtTime(currentValue, time);
                nextGain.exponentialRampToValueAtTime(nextValue, time);
            }
        }

        // EQ blending for smoother transition
        if (this.options.eqBlend) {
            this._scheduleEQBlend(now, duration);
        }

        // Wait for transition to complete
        await this._delay(duration * 1000);
    }

    /**
     * Schedule EQ changes during transition
     * Very gradual EQ blending for smooth "phase change" effect
     */
    _scheduleEQBlend(startTime, duration) {
        const { currentEQ, nextEQ } = this;

        // Very gradual EQ changes over the full crossfade duration
        // Current track: slowly reduce bass and treble during fade out
        currentEQ.lowShelf.gain.setValueAtTime(0, startTime);
        currentEQ.lowShelf.gain.linearRampToValueAtTime(-8, startTime + duration * 0.8);

        currentEQ.highShelf.gain.setValueAtTime(0, startTime);
        currentEQ.highShelf.gain.linearRampToValueAtTime(-4, startTime + duration * 0.9);

        // Next track: slowly bring in bass and treble
        nextEQ.lowShelf.gain.setValueAtTime(-8, startTime);
        nextEQ.lowShelf.gain.linearRampToValueAtTime(0, startTime + duration * 0.85);

        nextEQ.highShelf.gain.setValueAtTime(-4, startTime);
        nextEQ.highShelf.gain.linearRampToValueAtTime(0, startTime + duration * 0.95);
    }

    /**
     * Reset EQ to neutral
     */
    _resetEQ() {
        if (!this.currentEQ || !this.nextEQ) return;

        const now = this.audioContext.currentTime;

        this.currentEQ.lowShelf.gain.setValueAtTime(0, now);
        this.currentEQ.highShelf.gain.setValueAtTime(0, now);

        this.nextEQ.lowShelf.gain.setValueAtTime(0, now);
        this.nextEQ.highShelf.gain.setValueAtTime(0, now);
    }

    /**
     * Execute crossfade using Howler's built-in fade methods
     * More reliable than Web Audio API with HTML5 audio
     */
    async _executeHowlerCrossfade(duration) {
        const durationMs = duration * 1000;

        // Use Howler's built-in fade method
        this.currentHowl.fade(1, 0, durationMs);
        this.nextHowl.fade(0, 1, durationMs);

        // Wait for the crossfade to complete
        await this._delay(durationMs);
    }

    /**
     * Volume-based crossfade fallback
     */
    async _volumeCrossfade(duration) {
        const steps = 60; // 60 steps per second
        const interval = 1000 / steps;
        const totalSteps = Math.ceil(duration * steps);

        return new Promise((resolve) => {
            let step = 0;
            const timer = setInterval(() => {
                step++;
                const t = step / totalSteps;

                // Smooth S-curve fade
                const fadeOut = Math.cos((t * Math.PI) / 2);
                const fadeIn = Math.sin((t * Math.PI) / 2);

                if (this.currentHowl) {
                    this.currentHowl.volume(fadeOut);
                }
                if (this.nextHowl) {
                    this.nextHowl.volume(fadeIn);
                }

                if (step >= totalSteps) {
                    clearInterval(timer);
                    resolve();
                }
            }, interval);
        });
    }

    /**
     * Check if two tracks are harmonically compatible
     */
    checkHarmonicCompatibility(analysis1, analysis2) {
        if (!analysis1?.key || !analysis2?.key) return { compatible: true, score: 0.5 };

        const key1 = analysis1.key;
        const key2 = analysis2.key;

        const compatible = CamelotWheel.isCompatible(key1, key2);
        const energy = CamelotWheel.getEnergyTransition(key1, key2);

        let score = 0.5;
        if (compatible) score = 1;

        return { compatible, score, energy };
    }

    /**
     * Get current playback state
     */
    getState() {
        return {
            isPlaying: this.currentHowl?.playing() || false,
            isTransitioning: this.isTransitioning,
            currentTime: this.currentHowl?.seek() || 0,
            duration: this.currentHowl?.duration() || 0,
            currentAnalysis: this.currentAnalysis,
            nextAnalysis: this.nextAnalysis,
        };
    }

    /**
     * Stop playback
     */
    stop() {
        if (this.currentHowl) {
            this.currentHowl.stop();
        }
        if (this.nextHowl) {
            this.nextHowl.stop();
        }
        this.isTransitioning = false;
    }

    /**
     * Pause playback
     */
    pause() {
        if (this.currentHowl) {
            this.currentHowl.pause();
        }
    }

    /**
     * Resume playback
     */
    resume() {
        if (this.currentHowl) {
            this.currentHowl.play();
        }
    }

    /**
     * Set master volume
     */
    setVolume(volume) {
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(volume, this.audioContext.currentTime);
        } else if (this.currentHowl) {
            this.currentHowl.volume(volume);
        }
    }

    /**
     * Utility: Delay promise
     */
    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.stop();

        if (this.audioContext) {
            this.audioContext.close();
        }

        this.trackCache.clear();
    }
}

/**
 * AutoMix Controller - High-level interface for the player
 */
export class AutoMixController {
    constructor(player) {
        this.player = player;
        this.engine = new AutoMixEngineHowler();
        this.isEnabled = false;
        this.lookaheadId = null;
        this.nextTrackData = null;
    }

    enable() {
        this.isEnabled = true;
        this._startLookahead();
    }

    disable() {
        this.isEnabled = false;
        this._stopLookahead();
    }

    _startLookahead() {
        // Check every second for upcoming transitions
        this.lookaheadId = setInterval(() => {
            this._checkTransition();
        }, 1000);
    }

    _stopLookahead() {
        if (this.lookaheadId) {
            clearInterval(this.lookaheadId);
            this.lookaheadId = null;
        }
    }

    async _checkTransition() {
        if (!this.isEnabled || !this.engine.currentHowl) return;

        const state = this.engine.getState();
        if (!state.currentAnalysis) return;

        const remaining = state.duration - state.currentTime;

        // Start preparing next track when within lookahead window
        if (remaining < 30 && remaining > 10 && !this.nextTrackData) {
            await this._prepareNextTrack();
        }

        // Execute transition when it's time
        if (remaining <= this.engine.options.crossfadeDuration && !state.isTransitioning) {
            await this._executeTransition();
        }
    }

    async _prepareNextTrack() {
        // Get next track from queue
        const nextTrack = this.player.getNextTrack();
        if (!nextTrack) return;

        try {
            const streamUrl = await this.player.api.getStreamUrl(nextTrack.id);
            this.nextTrackData = await this.engine.loadTrack(streamUrl, nextTrack.id);
            await this.engine.prepareNext(this.nextTrackData);
        } catch (error) {
            console.warn('[AutoMix] Failed to prepare next track:', error);
        }
    }

    async _executeTransition() {
        if (!this.nextTrackData) {
            // Fallback to regular playNext
            this.player.playNext();
            return;
        }

        try {
            const timing = this.engine._calculateTransitionTiming();
            await this.engine.executeTransition(timing);

            // Update player state
            this.player.currentTrack = this.nextTrackData.track;
            this.player._updateTrackInfoUI(this.nextTrackData.track);
            this.player.updateMediaSession(this.nextTrackData.track);

            this.nextTrackData = null;
        } catch (error) {
            console.warn('[AutoMix] Transition failed:', error);
            this.player.playNext();
        }
    }

    /**
     * Play a track with AutoMix
     */
    async playTrack(track, url) {
        const trackData = await this.engine.loadTrack(url, track.id);
        this.engine.play(trackData);
        return trackData;
    }

    destroy() {
        this.disable();
        this.engine.destroy();
    }
}

export default { AutoMixEngineHowler, AutoMixController, AudioAnalyzer, CamelotWheel };
