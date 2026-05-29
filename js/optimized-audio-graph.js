class OptimizedAudioGraph {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.graph = null;
        this.isInitialized = false;
        this.reverbImpulseCache = null;
    }
    async initialize() {
        if (this.isInitialized) return;
        this.graph = {
            input: this.audioContext.createGain(),
            bassBoost: this.audioContext.createBiquadFilter(),
            lowpass: this.audioContext.createBiquadFilter(),
            convolver: this.audioContext.createConvolver(),
            reverbGain: this.audioContext.createGain(),
            compressor: this.audioContext.createDynamicsCompressor(),
            output: this.audioContext.createGain()
        };
        this.configureNodes();
        this.connectGraph();
        this.isInitialized = true;
    }
    configureNodes() {
        this.graph.bassBoost.type = 'lowshelf';
        this.graph.bassBoost.frequency.setValueAtTime(150, 0);
        this.graph.bassBoost.gain.setValueAtTime(0, 0);
        this.graph.lowpass.type = 'lowpass';
        this.graph.lowpass.frequency.setValueAtTime(22050, 0);
        this.graph.reverbGain.gain.setValueAtTime(0, 0);
        this.graph.convolver.buffer = this.getReverbImpulse();
    }
    connectGraph() {
        this.graph.input.connect(this.graph.bassBoost);
        this.graph.bassBoost.connect(this.graph.lowpass);
        this.graph.lowpass.connect(this.graph.compressor);
        this.graph.lowpass.connect(this.graph.convolver);
        this.graph.convolver.connect(this.graph.reverbGain);
        this.graph.reverbGain.connect(this.graph.compressor);
        this.graph.compressor.connect(this.graph.output);
        this.graph.output.connect(this.audioContext.destination);
    }
    getReverbImpulse() {
        if (this.reverbImpulseCache) return this.reverbImpulseCache;
        const ac = this.audioContext;
        const sr = ac.sampleRate, duration = 2, decay = 2, len = sr * duration;
        const impulse = ac.createBuffer(2, len, sr);
        for (let c = 0; c < 2; c++) {
            const data = impulse.getChannelData(c);
            for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
        this.reverbImpulseCache = impulse;
        return impulse;
    }
    updateEffects(settings, useSmoothing = true) {
        if (!this.isInitialized) return;
        const now = this.audioContext.currentTime;
        const rampTime = useSmoothing ? now + 0.05 : now;
        this.graph.bassBoost.gain.linearRampToValueAtTime(settings.bass * 12, rampTime);
        this.graph.reverbGain.gain.linearRampToValueAtTime(settings.reverb * 2.0, rampTime);
        const cutoffFreq = 20000 - (settings.underwater * 19500);
        this.graph.lowpass.frequency.linearRampToValueAtTime(Math.max(20, cutoffFreq), rampTime);
    }
    connectSource(source) {
        if (!this.isInitialized) throw new Error('AudioGraph не инициализирован');
        source.connect(this.graph.input);
    }
    async renderOffline(audioBuffer, settings) {
        const pitchFactor = Math.pow(2, settings.pitch / 12);
        const rate = settings.speed * pitchFactor;
        const duration = audioBuffer.duration / rate;
        const offlineContext = new OfflineAudioContext(audioBuffer.numberOfChannels, Math.ceil(duration * audioBuffer.sampleRate), audioBuffer.sampleRate);
        const offlineGraph = new OptimizedAudioGraph(offlineContext);
        await offlineGraph.initialize();
        offlineGraph.updateEffects(settings, false);
        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = rate;
        source.connect(offlineGraph.graph.input);
        source.start(0);
        return await offlineContext.startRendering();
    }
}
window.OptimizedAudioGraph = OptimizedAudioGraph;