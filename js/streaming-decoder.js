class StreamingAudioDecoder {
    constructor(audioContext) {
        this.audioContext = audioContext;
    }
    async decodeAudioStreaming(file) {
        // Нарезка сжатого аудио (MP3/AAC/OGG) на произвольные куски и независимое
        // декодирование каждого куска не работает корректно: фреймы не выровнены
        // по границам, заголовок только в начале, артефакты на стыках. Поэтому
        // используем стандартный путь decodeAudioData (он сам обрабатывает поток).
        return await this.decodeFileStandard(file);
    }
    async decodeFileStandard(file) {
        const arrayBuffer = await file.arrayBuffer();
        return this.audioContext.decodeAudioData(arrayBuffer);
    }
}
window.StreamingAudioDecoder = StreamingAudioDecoder;