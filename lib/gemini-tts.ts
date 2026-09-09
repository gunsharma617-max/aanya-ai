let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

let activeToken = 0;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

/**
 * Removes markdown formatting so Gemini doesn't read symbols like
 * "**" or "#" out loud. Only affects what gets SPOKEN — the
 * on-screen chat bubble text is completely untouched.
 */
function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Splits a reply into speech-friendly chunks:
 * - the FIRST chunk is a single short sentence, so playback can
 *   start almost immediately
 * - everything after that is grouped into a small number of
 *   larger chunks, so a normal reply needs only 2-3 Gemini TTS
 *   requests total instead of one per sentence (which was slow,
 *   choppy, and easy to rate-limit).
 */
function chunkForSpeech(text: string): string[] {
  const cleaned = stripMarkdownForSpeech(text);

  if (!cleaned) {
    return [];
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return [cleaned];
  }

  const [first, ...rest] = sentences;
  const chunks: string[] = [first];

  const MAX_CHUNK_LEN = 420;
  let current = "";

  for (const sentence of rest) {
    const candidate = current ? `${current} ${sentence}` : sentence;

    if (current && candidate.length > MAX_CHUNK_LEN) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
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

  const chunks = chunkForSpeech(text);

  if (!chunks.length) {
    return;
  }

  // Start fetching the first chunk right away. If it fails, we
  // swallow the error here so one bad chunk doesn't silence the
  // whole reply — we just skip it and move on.
  let nextChunkPromise: Promise<AudioBuffer | null> | null =
    fetchGeminiAudioBuffer(chunks[0]!, voice, context).catch((error) => {
      console.error("Aanya TTS chunk failed:", error);
      return null;
    });

  let anySucceeded = false;

  for (let i = 0; i < chunks.length; i++) {
    if (myToken !== activeToken) {
      return;
    }

    const buffer = await nextChunkPromise;

    if (myToken !== activeToken) {
      return;
    }

    const hasNext = i + 1 < chunks.length;

    nextChunkPromise = hasNext
      ? fetchGeminiAudioBuffer(chunks[i + 1]!, voice, context).catch(
          (error) => {
            console.error("Aanya TTS chunk failed:", error);
            return null;
          }
        )
      : null;

    if (buffer) {
      anySucceeded = true;
      await playAudioBuffer(context, buffer);

      if (myToken !== activeToken) {
        return;
      }
    }
  }

  if (!anySucceeded) {
    throw new Error("Gemini TTS failed for every part of the reply.");
  }
}

export function stopGeminiSpeaking(): void {
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
