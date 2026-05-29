document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const CONSTANTS = {
        PERFORMANCE: { CHUNK_SIZE: 32 * 1024, MAX_WORKERS: 16 },
        DEFAULT_SETTINGS: { speed: 1.0, pitch: 0, reverb: 0, bass: 0, underwater: 0 },
        PRESETS: {
            slowed: { speed: 0.8, pitch: -1, reverb: 0.3, bass: 0.1, underwater: 0 },
            nightcore: { speed: 1.3, pitch: 3, reverb: 0.1, bass: 0.2, underwater: 0 }
        }
    };

    const State = {
        audioFile: null, coverFile: null, audioBuffer: null,
        isPlaying: false, isSeeking: false, isProcessing: false,
        playbackStartTime: 0, playbackStartOffset: 0, currentPlaybackRate: 1,
        processingStartTime: 0, processingTimerInterval: null,
        currentSettings: { ...CONSTANTS.DEFAULT_SETTINGS }
    };

    const UI = {
        elements: {
            uploadSection: document.getElementById('upload-section'), editorSection: document.getElementById('editor-section'),
            dropZone: document.getElementById('dropZone'), fileInput: document.getElementById('fileInput'),
            fileName: document.getElementById('fileName'), playPauseBtn: document.getElementById('playPauseBtn'),
            playIcon: document.querySelector('.play-icon'), pauseIcon: document.querySelector('.pause-icon'),
            seekBar: document.getElementById('seekBar'), timeDisplay: document.getElementById('timeDisplay'),
            presetsContainer: document.querySelector('.presets'), resetControlsBtn: document.getElementById('resetControlsBtn'),
            changeFileBtn: document.getElementById('changeFileBtn'), processBtn: document.getElementById('processBtn'),
            progressBarContainer: document.getElementById('progressBarContainer'), progressBarFill: document.getElementById('progressBarFill'),
            processingStatus: document.getElementById('processingStatus'), processingTimer: document.getElementById('processingTimer'),
            exportMp3: document.getElementById('exportMp3'), exportWav: document.getElementById('exportWav'),
            meta: {
                title: document.getElementById('metaTitle'), artist: document.getElementById('metaArtist'),
                cover: document.getElementById('metaCover'), preview: document.getElementById('coverPreview')
            },
            controls: {
                speed: document.getElementById('speed'), pitch: document.getElementById('pitch'), reverb: document.getElementById('reverb'),
                bass: document.getElementById('bass'), underwater: document.getElementById('underwater'),
            },
            valueDisplays: {
                speed: document.getElementById('speedVal'), pitch: document.getElementById('pitchVal'), reverb: document.getElementById('reverbVal'),
                bass: document.getElementById('bassVal'), underwater: document.getElementById('underwaterVal'),
            }
        },
        showEditor: (v) => { UI.elements.uploadSection.classList.toggle('hidden', v); UI.elements.editorSection.classList.toggle('hidden', !v); },
        updatePlayPauseButton: (p) => { UI.elements.playIcon.classList.toggle('hidden', p); UI.elements.pauseIcon.classList.toggle('hidden', !p); },
        updateTimeDisplay: (c, d) => { const f = s => s ? `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` : '0:00'; UI.elements.timeDisplay.textContent = `${f(c)} / ${f(d)}`; },
        updateSeekBar: (p) => { UI.elements.seekBar.value = p; },
        updateControlValues: (s) => { for (const k in s) { if (UI.elements.controls[k]) { UI.elements.controls[k].value = s[k]; UI.updateValueDisplay(k, s[k]); } } },
        updateValueDisplay: (k, v) => {
            let d; switch (k) { case 'speed': d = v.toFixed(2); break; case 'reverb': case 'underwater': case 'bass': d = Math.round(v * 100); break; default: d = v.toFixed(1); }
            if (UI.elements.valueDisplays[k]) UI.elements.valueDisplays[k].textContent = d;
        },
        setProcessingState(isProcessing, message = '', progress = 0) {
            State.isProcessing = isProcessing;
            UI.elements.processBtn.disabled = isProcessing;
            UI.elements.changeFileBtn.disabled = isProcessing;
            UI.elements.progressBarContainer.classList.toggle('hidden', !isProcessing && progress === 0);

            if (isProcessing) {
                UI.elements.processingStatus.textContent = message;
                UI.elements.progressBarFill.style.width = `${progress}%`;
                if (!State.processingTimerInterval) {
                    State.processingStartTime = performance.now();
                    State.processingTimerInterval = setInterval(UI.updateProcessingTimer, 1000);
                }
            } else {
                clearInterval(State.processingTimerInterval);
                State.processingTimerInterval = null;
                if (message) { // Handle final status message
                    UI.elements.processingStatus.textContent = message;
                    UI.elements.progressBarFill.style.width = `${progress}%`;
                }
            }
        },
        updateProcessingTimer() {
            const elapsed = (performance.now() - State.processingStartTime) / 1000;
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
            UI.elements.processingTimer.textContent = `${minutes}:${seconds}`;
        },
        resetUI: () => {
            UI.showEditor(false); UI.elements.fileInput.value = ''; UI.elements.meta.preview.classList.add('hidden');
            UI.setProcessingState(false, '', 0); UI.updateControlValues(CONSTANTS.DEFAULT_SETTINGS);
        }
    };

    const AudioEngine = {
        audioContext: null, sourceNode: null,
        streamingDecoder: null, optimizedGraph: null,
        async initContext() {
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.streamingDecoder = new StreamingAudioDecoder(this.audioContext);
                this.optimizedGraph = new OptimizedAudioGraph(this.audioContext);
                await this.optimizedGraph.initialize();
            }
        },
        async decodeAudio(file) {
            await this.initContext();
            if (this.streamingDecoder && file.size > 1024 * 1024 * 2) {
                return await this.streamingDecoder.decodeAudioStreaming(file);
            }
            const arrayBuffer = await file.arrayBuffer();
            return await this.audioContext.decodeAudioData(arrayBuffer);
        },
        updateEffectParameters(settings) {
            this.optimizedGraph.updateEffects(settings, true);
            const pitchFactor = Math.pow(2, settings.pitch / 12);
            const newRate = settings.speed * pitchFactor;
            if (this.sourceNode && State.isPlaying) {
                // Учитываем уже пройденную в текущем темпе позицию
                const oldRate = State.currentPlaybackRate || 1;
                const realElapsed = this.audioContext.currentTime - State.playbackStartTime;
                State.playbackStartOffset = State.playbackStartOffset + realElapsed * oldRate;
                State.playbackStartTime = this.audioContext.currentTime;
                this.sourceNode.playbackRate.linearRampToValueAtTime(newRate, this.audioContext.currentTime + 0.05);
            }
            State.currentPlaybackRate = newRate;
        },
        play() {
            if (!State.audioBuffer || State.isPlaying) return;
            this.initContext().then(() => {
                if (this.sourceNode) { try { this.sourceNode.onended = null; this.sourceNode.disconnect(); } catch(e){} }
                if (this.audioContext.state === 'suspended') this.audioContext.resume();

                this.sourceNode = this.audioContext.createBufferSource();
                this.sourceNode.buffer = State.audioBuffer;
                this.optimizedGraph.connectSource(this.sourceNode);

                const pitchFactor = Math.pow(2, State.currentSettings.pitch / 12);
                const rate = State.currentSettings.speed * pitchFactor;
                this.sourceNode.playbackRate.value = rate;
                State.currentPlaybackRate = rate;

                State.playbackStartTime = this.audioContext.currentTime;
                const offset = Math.min(State.playbackStartOffset, State.audioBuffer.duration);
                State.playbackStartOffset = offset;
                this.sourceNode.start(0, offset);

                State.isPlaying = true; UI.updatePlayPauseButton(true);
                this.sourceNode.onended = () => { if (State.isPlaying) this.stop(true); };
                App.tick();
            });
        },
        stop(finished = false) {
            if (!this.sourceNode || !State.isPlaying) return;
            try { this.sourceNode.onended = null; this.sourceNode.stop(); } catch (e) {}
            State.isPlaying = false;
            if (finished) {
                State.playbackStartOffset = 0;
                UI.updateSeekBar(0);
                UI.updateTimeDisplay(0, State.audioBuffer ? State.audioBuffer.duration : 0);
            } else {
                const rate = State.currentPlaybackRate || 1;
                const realElapsed = this.audioContext.currentTime - State.playbackStartTime;
                State.playbackStartOffset = Math.min(
                    State.playbackStartOffset + realElapsed * rate,
                    State.audioBuffer ? State.audioBuffer.duration : Infinity
                );
            }
            UI.updatePlayPauseButton(false);
        },
        seek(percentage) {
            if (!State.audioBuffer) return;
            const wasPlaying = State.isPlaying;
            if (wasPlaying) {
                try { this.sourceNode.onended = null; this.sourceNode.stop(); } catch(e) {}
                State.isPlaying = false;
                UI.updatePlayPauseButton(false);
            }
            State.playbackStartOffset = State.audioBuffer.duration * (percentage / 100);
            UI.updateTimeDisplay(State.playbackStartOffset, State.audioBuffer.duration);
            if (wasPlaying) this.play();
        },
        async renderOffline(settings) {
            return await this.optimizedGraph.renderOffline(State.audioBuffer, settings);
        }
    };

    const App = {
        async init() {
            window.workerPool = new WorkerPoolManager('worker.js', CONSTANTS.PERFORMANCE.MAX_WORKERS);
            await window.workerPool.initialize();
            this.setupEventListeners();
            UI.updateControlValues(State.currentSettings);
        },
        setupEventListeners() {
            const { elements } = UI;
            elements.dropZone.onclick = () => elements.fileInput.click();
            elements.fileInput.onchange = e => this.loadFile(e.target.files[0]);
            ['dragover', 'dragenter'].forEach(evt => elements.dropZone.addEventListener(evt, e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--primary-color)'; }));
            elements.dropZone.addEventListener('dragleave', e => { e.currentTarget.style.borderColor = 'var(--glass-border)'; });
            elements.dropZone.addEventListener('drop', e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = 'var(--glass-border)';
                if (e.dataTransfer.files && e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
            });
            elements.playPauseBtn.onclick = () => State.isPlaying ? AudioEngine.stop() : AudioEngine.play();
            elements.seekBar.addEventListener('mousedown', () => { State.isSeeking = true; });
            elements.seekBar.addEventListener('touchstart', () => { State.isSeeking = true; });
            elements.seekBar.addEventListener('input', e => { if(State.audioBuffer) { const ct = State.audioBuffer.duration * (e.target.value / 100); UI.updateTimeDisplay(ct, State.audioBuffer.duration); } });
            elements.seekBar.addEventListener('change', e => { AudioEngine.seek(parseFloat(e.target.value)); State.isSeeking = false; });
            Object.keys(elements.controls).forEach(key => { elements.controls[key].oninput = e => this.handleControlChange(key, parseFloat(e.target.value)); });
            elements.presetsContainer.onclick = e => { if (e.target.dataset.preset) this.applyPreset(e.target.dataset.preset); };
            elements.resetControlsBtn.onclick = () => this.applySettings(CONSTANTS.DEFAULT_SETTINGS);
            elements.processBtn.onclick = () => this.processAndDownload();
            elements.changeFileBtn.onclick = () => this.resetToUpload();
            elements.meta.cover.onchange = e => this.handleCoverArt(e.target.files[0]);
        },
        async loadFile(file) {
            if (!file || (!file.type.startsWith('audio') && !file.type.startsWith('video'))) return;
            UI.showEditor(true); UI.elements.fileName.textContent = 'Декодирование файла...';
            this.resetState(); State.audioFile = file;
            try {
                State.audioBuffer = await AudioEngine.decodeAudio(file);
                UI.elements.fileName.textContent = file.name;
                UI.elements.meta.title.value = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                UI.updateTimeDisplay(0, State.audioBuffer.duration);
            } catch (e) { alert(`Ошибка декодирования: ${e.message}`); this.resetToUpload(); }
        },
        resetState() { if (State.isPlaying) AudioEngine.stop(); State.audioFile = null; State.coverFile = null; State.audioBuffer = null; State.playbackStartOffset = 0; },
        resetToUpload() { this.resetState(); UI.resetUI(); },
        handleControlChange(key, value) { State.currentSettings[key] = value; UI.updateValueDisplay(key, value); AudioEngine.updateEffectParameters(State.currentSettings); },
        applyPreset(name) { if (CONSTANTS.PRESETS[name]) this.applySettings({ ...State.currentSettings, ...CONSTANTS.PRESETS[name] }); },
        applySettings(settings) { State.currentSettings = { ...settings }; UI.updateControlValues(State.currentSettings); AudioEngine.updateEffectParameters(State.currentSettings); },
        async handleCoverArt(file) {
            State.coverFile = file;
            UI.elements.meta.preview.classList.toggle('hidden', !file);
            if (file) UI.elements.meta.preview.src = URL.createObjectURL(file);
        },
        tick() {
            if (!State.isPlaying || !AudioEngine.audioContext) return;
            if (!State.isSeeking) {
                const rate = State.currentPlaybackRate || 1;
                const realElapsed = AudioEngine.audioContext.currentTime - State.playbackStartTime;
                const elapsed = State.playbackStartOffset + realElapsed * rate;
                const duration = State.audioBuffer.duration;
                if (elapsed < duration) {
                    UI.updateTimeDisplay(elapsed, duration);
                    UI.updateSeekBar((elapsed / duration) * 100);
                } else {
                    UI.updateTimeDisplay(duration, duration);
                    UI.updateSeekBar(100);
                }
            }
            requestAnimationFrame(() => this.tick());
        },
        async processAndDownload() {
            if (!State.audioBuffer || State.isProcessing) return;
            if (!UI.elements.exportWav.checked && !UI.elements.exportMp3.checked) return alert('Выберите формат для экспорта.');

            UI.setProcessingState(true, 'Применение эффектов...', 0);
            try {
                const settings = { ...State.currentSettings, fileName: State.audioFile.name };
                const processedBuffer = await AudioEngine.renderOffline(settings);

                UI.setProcessingState(true, 'Подготовка данных...', 30);
                const channelBuffers = [];
                const transferList = [];
                for (let i = 0; i < processedBuffer.numberOfChannels; i++) {
                    const channelData = processedBuffer.getChannelData(i);
                    channelBuffers.push(channelData.buffer);
                    transferList.push(channelData.buffer);
                }

                const bufferData = {
                    sampleRate: processedBuffer.sampleRate, length: processedBuffer.length,
                    numberOfChannels: processedBuffer.numberOfChannels,
                    channelBuffers: channelBuffers
                };

                let coverBuffer = null;
                if(State.coverFile) {
                    coverBuffer = await State.coverFile.arrayBuffer();
                    transferList.push(coverBuffer);
                }
                const metadata = { title: UI.elements.meta.title.value, artist: UI.elements.meta.artist.value, cover: coverBuffer };
                const exportOptions = { wav: UI.elements.exportWav.checked, mp3: UI.elements.exportMp3.checked };

                UI.setProcessingState(true, 'Отправка в кодировщик...', 50);

                const results = await window.workerPool.executeTask({ bufferData, item: settings, exportOptions, metadata }, transferList);
                if(results.error) throw new Error(results.error);

                UI.setProcessingState(true, 'Сохранение файлов...', 90);
                results.forEach(res => this.downloadFile(res.blob, res.filename));

                UI.setProcessingState(false, 'Готово!', 100);
                setTimeout(() => UI.elements.progressBarContainer.classList.add('hidden'), 2000);

            } catch (e) {
                console.error("Ошибка обработки:", e);
                alert(`Ошибка обработки: ${e.message}`);
                UI.setProcessingState(false, 'Ошибка', 100);
            }
        },
        downloadFile(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none'; a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
        }
    };
    App.init();
});