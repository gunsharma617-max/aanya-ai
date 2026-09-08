let audioContext: AudioContext | null = null;

let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

export async function speakWithGemini(
  text: string,
  voice = "Leda"
): Promise<void> {
  if (!text.trim()) return;

  stopGeminiSpeaking();

  const context = getAudioContext();

  // Helps mobile browsers allow audio playback
  // after the user interacts with Aanya.
  if (context.state === "suspended") {
    await context.resume();
  }

  const response = await fetch("/api/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice,
    }),
  });

  if (!response.ok) {
    throw new Error("Gemini TTS request failed.");
  }

  const audioData = await response.arrayBuffer();

  const audioBuffer =
    await context.decodeAudioData(audioData);

  const source = context.createBufferSource();

  source.buffer = audioBuffer;
  source.connect(context.destination);

  currentSource = source;

  source.onended = () => {
    if (currentSource === source) {
      currentSource = null;
    }
  };

  source.start(0);
}

export function stopGeminiSpeaking(): void {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // Already stopped.
    }

    currentSource.disconnect();
    currentSource = null;
  }
}
