self.importScripts('js/lib/lame.min.js', 'js/lib/browser-id3-writer.min.js');

self.onmessage = async e => {
    // Данные теперь приходят в другом формате
    const { bufferData, item, exportOptions, metadata } = e.data;
    const results = [];

    // Восстанавливаем Float32Array из переданных ArrayBuffer
    const channels = bufferData.channelBuffers.map(buffer => new Float32Array(buffer));
    const reconstructedBufferData = { ...bufferData, channels };

    try {
        if (exportOptions.wav) {
            const blob = bufferToWaveChunked(reconstructedBufferData);
            results.push({ blob, filename: generateFileName(item, 'wav') });
        }
        if (exportOptions.mp3) {
            const mp3Blob = encodeToMp3Chunked(reconstructedBufferData);
            const taggedBlob = await addId3Tags(mp3Blob, metadata);
            results.push({ blob: taggedBlob, filename: generateFileName(item, 'mp3') });
        }
        self.postMessage(results);
    } catch(err) {
        console.error("Ошибка в воркере:", err);
        self.postMessage({ error: err.message });
    }
};

function generateFileName(settings, ext) {
    const baseName = settings.fileName.substring(0, settings.fileName.lastIndexOf('.')) || settings.fileName;
    const effects = `s${settings.speed.toFixed(2)}_p${settings.pitch.toFixed(1)}_r${Math.round(settings.reverb*100)}`;
    return `${baseName}_${effects}.${ext}`;
}

async function addId3Tags(blob, metadata) {
    if (!metadata || (!metadata.title && !metadata.artist && !metadata.cover)) return blob;
    const songBuffer = await blob.arrayBuffer();
    const writer = new self.ID3Writer(songBuffer);
    if (metadata.title) writer.setFrame('TIT2', metadata.title);
    if (metadata.artist) writer.setFrame('TPE1', [metadata.artist]);
    if (metadata.cover) writer.setFrame('APIC', { type: 3, data: metadata.cover, description: 'Cover' });
    writer.addTag();
    return writer.getBlob();
}

function encodeToMp3Chunked(bufferData) {
    const encoder = new lamejs.Mp3Encoder(bufferData.numberOfChannels, bufferData.sampleRate, 320);
    const floatTo16BitPCM = (input) => {
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return output;
    };

    const isMono = bufferData.numberOfChannels === 1;
    const pcmLeft = floatTo16BitPCM(bufferData.channels[0]);
    const pcmRight = !isMono ? floatTo16BitPCM(bufferData.channels[1]) : null;

    const data = [];
    const optimalBlockSize = 1152 * 256;

    for (let i = 0; i < pcmLeft.length; i += optimalBlockSize) {
        const leftChunk = pcmLeft.subarray(i, i + optimalBlockSize);
        const encoded = isMono
            ? encoder.encodeBuffer(leftChunk)
            : encoder.encodeBuffer(leftChunk, pcmRight.subarray(i, i + optimalBlockSize));
        if (encoded.length > 0) data.push(encoded);
    }
    const flushed = encoder.flush();
    if (flushed.length > 0) data.push(flushed);
    return new Blob(data, { type: 'audio/mpeg' });
}

function bufferToWaveChunked(audioBuffer) {
    const [numChannels, sampleRate, numFrames] = [audioBuffer.numberOfChannels, audioBuffer.sampleRate, audioBuffer.length];
    const bitsPerSample = 32, formatCode = 3;
    const dataSize = numChannels * numFrames * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeString = (s, o) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeString('RIFF', 0); view.setUint32(4, 36 + dataSize, true); writeString('WAVE', 8);
    writeString('fmt ', 12); view.setUint32(16, 16, true); view.setUint16(20, formatCode, true);
    view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true); view.setUint16(34, bitsPerSample, true);
    writeString('data', 36); view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
        for (let c = 0; c < numChannels; c++) {
            view.setFloat32(offset, audioBuffer.channels[c][i], true);
            offset += 4;
        }
    }
    return new Blob([view], { type: 'audio/wav' });
}