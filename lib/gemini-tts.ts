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
  if (!text.trim()) {
    return;
  }

  stopGeminiSpeaking();

  const context = getAudioContext();

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
    const errorText = await response.text();

    throw new Error(
      `Gemini TTS failed: ${response.status} ${errorText}`
    );
  }

  const audioData = await response.arrayBuffer();

  if (!audioData.byteLength) {
    throw new Error("Gemini returned empty audio.");
  }

  const audioBuffer = await context.decodeAudioData(audioData);

  const source = context.createBufferSource();

  source.buffer = audioBuffer;
  source.connect(context.destination);

  currentSource = source;

  /*
   * IMPORTANT:
   * Do not resolve speakWithGemini() when audio STARTS.
   *
   * Resolve it only when the actual audio playback
   * has finished.
   */
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

export function stopGeminiSpeaking(): void {
  if (!currentSource) {
    return;
  }

  try {
    currentSource.stop();
  } catch {
    // Audio may already have stopped.
  }

  try {
    currentSource.disconnect();
  } catch {
    // Already disconnected.
  }

  currentSource = null;
}

export function isGeminiSpeaking(): boolean {
  return currentSource !== null;
}
