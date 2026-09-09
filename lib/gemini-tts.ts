let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

// Increments every time speak() starts or stop() is called,
// so an in-flight sentence queue can detect it's been cancelled.
let activeToken = 0;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

/**
 * Splits a reply into sentence-sized chunks so we can start
 * speaking the first one immediately instead of waiting for
 * Gemini to generate audio for the entire message.
 */
function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  const parts = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  return parts.length ? parts : [trimmed];
}

async function fetchGeminiAudioBuffer(
  text: string,
  voice: string,
  context: AudioContext
): Promise<AudioBuffer> {
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

  return context.decodeAudioData(audioData);
}

function playAudioBuffer(
  context: AudioContext,
  buffer: AudioBuffer
): Promise<void> {
  return new Promise<void>((resolve) => {
    const source = context.createBufferSource();

    source.buffer = buffer;
    source.connect(context.destination);

    currentSource = source;

    source.onended = () => {
      if (currentSource === source) {
        currentSource = null;
      }

      resolve();
    };

    source.start(0);
  });
}

export async function speakWithGemini(
  text: string,
  voice = "Leda"
): Promise<void> {
  if (!text.trim()) {
    return;
  }

  stopGeminiSpeaking();

  const myToken = ++activeToken;

  const context = getAudioContext();

  if (context.state === "suspended") {
    await context.resume();
  }

  const chunks = splitIntoSentences(text);

  if (!chunks.length) {
    return;
  }

  // Start fetching the first chunk right away.
  let nextChunkPromise: Promise<AudioBuffer> | null =
    fetchGeminiAudioBuffer(chunks[0], voice, context);

  for (let i = 0; i < chunks.length; i++) {
    // Bail out if a newer speak() or stopGeminiSpeaking() call
    // happened while we were awaiting.
    if (myToken !== activeToken) {
      return;
    }

    const buffer = await nextChunkPromise!;

    if (myToken !== activeToken) {
      return;
    }

    // While this chunk plays, prefetch the next one in the
    // background so there's no gap between sentences.
    nextChunkPromise =
      i + 1 < chunks.length
        ? fetchGeminiAudioBuffer(chunks[i + 1], voice, context)
        : null;

    await playAudioBuffer(context, buffer);

    if (myToken !== activeToken) {
      return;
    }
  }
}

export function stopGeminiSpeaking(): void {
  // Invalidate any in-progress sentence queue.
  activeToken++;

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
