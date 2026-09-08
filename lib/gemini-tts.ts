let currentSource: AudioBufferSourceNode | null = null;
let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

function pcmToAudioBuffer(
  pcmData: Uint8Array,
  sampleRate: number,
  channels: number
): AudioBuffer {
  const context = getAudioContext();

  const bytesPerSample = 2;
  const frameCount =
    pcmData.byteLength / (bytesPerSample * channels);

  const audioBuffer = context.createBuffer(
    channels,
    frameCount,
    sampleRate
  );

  const dataView = new DataView(
    pcmData.buffer,
    pcmData.byteOffset,
    pcmData.byteLength
  );

  for (let channel = 0; channel < channels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);

    for (let i = 0; i < frameCount; i++) {
      const offset =
        (i * channels + channel) * bytesPerSample;

      const sample = dataView.getInt16(offset, true);

      channelData[i] = sample / 32768;
    }
  }

  return audioBuffer;
}

export async function speakWithGemini(
  text: string
): Promise<void> {
  if (!text.trim()) {
    return;
  }

  // Stop any currently playing Aanya voice.
  stopGeminiSpeech();

  const response = await fetch("/api/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
    }),
  });

  if (!response.ok) {
    throw new Error("Gemini TTS request failed");
  }

  const data = await response.json();

  if (!data.audio) {
    throw new Error("Gemini TTS returned no audio");
  }

  const sampleRate = data.sampleRate || 24000;
  const channels = data.channels || 1;

  const pcmBytes = base64ToUint8Array(data.audio);

  const context = getAudioContext();

  if (context.state === "suspended") {
    await context.resume();
  }

  const audioBuffer = pcmToAudioBuffer(
    pcmBytes,
    sampleRate,
    channels
  );

  const source = context.createBufferSource();

  source.buffer = audioBuffer;
  source.connect(context.destination);

  currentSource = source;

  // IMPORTANT:
  // The Promise resolves ONLY after the real audio
  // playback has completely finished.
  await new Promise<void>((resolve) => {
    source.onended = () => {
      if (currentSource === source) {
        currentSource = null;
      }

      resolve();
    };

    source.start(0);
  });
}

export function stopGeminiSpeech() {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // Audio may already have finished.
    }

    currentSource.disconnect();
    currentSource = null;
  }
}

export function isGeminiSpeaking(): boolean {
  return currentSource !== null;
}
