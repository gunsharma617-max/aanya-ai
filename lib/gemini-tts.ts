/**
 * Low-latency Gemini TTS voice queue for Aanya.
 *
 * Design:
 * - Starts speaking before the complete AI response is finished.
 * - Keeps one audio chunk playing while preparing the next one.
 * - Retries temporary TTS failures.
 * - Cancels stale requests when a new user message arrives.
 */

const TTS_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;

export type SpeakingListener = (speaking: boolean) => void;
export type ErrorListener = (err: Error) => void;

class AanyaVoiceQueue {
  private audioContext: AudioContext | null = null;

  private currentSource: AudioBufferSourceNode | null = null;
  private currentPlaybackCancel: (() => void) | null = null;

  private queue: string[] = [];

  private activeToken = 0;
  private processing = false;
  private streamFinished = true;

  private voice = "Leda";
  private speaking = false;

  private speakingListeners = new Set<SpeakingListener>();
  private errorListener: ErrorListener | null = null;

  private activeTtsControllers = new Set<AbortController>();

  private getContext(): AudioContext {
    if (!this.audioContext) {
      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextCtor) {
        throw new Error(
          "This browser does not support audio playback."
        );
      }

      this.audioContext = new AudioContextCtor();
    }

    return this.audioContext;
  }

  onSpeakingChange(listener: SpeakingListener): () => void {
    this.speakingListeners.add(listener);

    listener(this.speaking);

    return () => {
      this.speakingListeners.delete(listener);
    };
  }

  onError(listener: ErrorListener | null): void {
    this.errorListener = listener;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Start a completely new voice response.
   */
  start(voice = "Leda"): void {
    this.cancel();

    this.activeToken++;
    this.voice = voice;
    this.streamFinished = false;

    try {
      const context = this.getContext();

      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
    } catch (error) {
      this.errorListener?.(
        error instanceof Error
          ? error
          : new Error("Unable to initialize audio playback.")
      );
    }
  }

  /**
   * Add a small speech chunk.
   */
  enqueue(text: string): void {
    const trimmed = text.trim();

    if (!trimmed) {
      return;
    }

    this.queue.push(trimmed);

    void this.runLoop(this.activeToken);
  }

  /**
   * Tell the queue that the AI response is completely finished.
   */
  finish(): void {
    this.streamFinished = true;

    if (!this.processing && this.queue.length > 0) {
      void this.runLoop(this.activeToken);
    }
  }

  /**
   * Cancel everything belonging to the current reply.
   */
  cancel(): void {
    this.activeToken++;

    this.queue = [];
    this.streamFinished = true;

    for (const controller of this.activeTtsControllers) {
      try {
        controller.abort();
      } catch {
        // Ignore already-aborted controllers.
      }
    }

    this.activeTtsControllers.clear();

    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Already stopped.
      }

      try {
        this.currentSource.disconnect();
      } catch {
        // Already disconnected.
      }

      this.currentSource = null;
    }

    const cancelPlayback = this.currentPlaybackCancel;

    this.currentPlaybackCancel = null;

    cancelPlayback?.();

    this.setSpeaking(false);
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking === value) {
      return;
    }

    this.speaking = value;

    this.speakingListeners.forEach((listener) => {
      listener(value);
    });
  }

  /**
   * Main playback loop.
   *
   * We allow ONE next TTS request to be prepared while the current
   * audio is playing. This reduces gaps without flooding Gemini.
   */
  private async runLoop(token: number): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    let prefetched: Promise<AudioBuffer | null> | null = null;

    try {
      const context = this.getContext();

      try {
        if (context.state === "suspended") {
          await context.resume();
        }
      } catch {
        // Browser may resume it automatically after interaction.
      }

      while (token === this.activeToken) {
        let bufferPromise: Promise<AudioBuffer | null>;

        /*
         * Use the already-prepared next chunk if available.
         */
        if (prefetched) {
          bufferPromise = prefetched;
          prefetched = null;
        } else {
          const text = this.queue.shift();

          if (!text) {
            if (this.streamFinished) {
              break;
            }

            await sleep(30);
            continue;
          }

          bufferPromise = this.fetchBufferWithRetry(
            text,
            this.voice,
            context,
            token
          );
        }

        const buffer = await bufferPromise;

        if (token !== this.activeToken) {
          break;
        }

        if (!buffer) {
          continue;
        }

        /*
         * Prepare ONLY ONE next chunk.
         *
         * This is intentionally limited to one request.
         */
        const nextText = this.queue.shift();

        if (nextText) {
          prefetched = this.fetchBufferWithRetry(
            nextText,
            this.voice,
            context,
            token
          );
        }

        if (token !== this.activeToken) {
          break;
        }

        this.setSpeaking(true);

        await this.playBuffer(
          context,
          buffer,
          token
        );
      }
    } finally {
      if (token === this.activeToken) {
        this.setSpeaking(false);
      }

      this.processing = false;

      if (this.queue.length > 0) {
        void this.runLoop(this.activeToken);
      }
    }
  }

  /**
   * Retry Gemini TTS a couple of times when a request temporarily fails.
   */
  private async fetchBufferWithRetry(
    text: string,
    voice: string,
    context: AudioContext,
    token: number
  ): Promise<AudioBuffer | null> {
    for (
      let attempt = 0;
      attempt <= MAX_RETRIES;
      attempt++
    ) {
      if (token !== this.activeToken) {
        return null;
      }

      const buffer = await this.fetchBuffer(
        text,
        voice,
        context,
        token
      );

      if (buffer) {
        return buffer;
      }

      if (token !== this.activeToken) {
        return null;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(
          400 * (attempt + 1)
        );
      }
    }

    if (token === this.activeToken) {
      this.errorListener?.(
        new Error(
          "Aanya's voice could not generate one part of the reply."
        )
      );
    }

    return null;
  }

  /**
   * One Gemini TTS request.
   */
  private async fetchBuffer(
    text: string,
    voice: string,
    context: AudioContext,
    token: number
  ): Promise<AudioBuffer | null> {
    if (token !== this.activeToken) {
      return null;
    }

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      TTS_TIMEOUT_MS
    );

    this.activeTtsControllers.add(
      controller
    );

    try {
      const response = await fetch(
        "/api/tts",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          signal:
            controller.signal,

          body: JSON.stringify({
            text,
            voice,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Gemini TTS failed: ${response.status}`
        );
      }

      const audioData =
        await response.arrayBuffer();

      if (!audioData.byteLength) {
        throw new Error(
          "Gemini TTS returned empty audio."
        );
      }

      if (token !== this.activeToken) {
        return null;
      }

      return await context.decodeAudioData(
        audioData
      );
    } catch (error) {
      const isAbort =
        error instanceof DOMException &&
        error.name === "AbortError";

      const isNamedAbort =
        error instanceof Error &&
        error.name === "AbortError";

      if (
        !isAbort &&
        !isNamedAbort &&
        token === this.activeToken
      ) {
        console.error(
          "Aanya TTS error:",
          error
        );
      }

      return null;
    } finally {
      clearTimeout(timeout);

      this.activeTtsControllers.delete(
        controller
      );
    }
  }

  /**
   * Play one audio buffer.
   */
  private playBuffer(
    context: AudioContext,
    buffer: AudioBuffer,
    token: number
  ): Promise<void> {
    return new Promise<void>(
      (resolve) => {
        if (token !== this.activeToken) {
          resolve();
          return;
        }

        const source =
          context.createBufferSource();

        source.buffer = buffer;

        source.connect(
          context.destination
        );

        this.currentSource =
          source;

        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }

          settled = true;

          if (
            this.currentSource ===
            source
          ) {
            this.currentSource =
              null;
          }

          if (
            this.currentPlaybackCancel ===
            finish
          ) {
            this.currentPlaybackCancel =
              null;
          }

          try {
            source.disconnect();
          } catch {
            // Already disconnected.
          }

          resolve();
        };

        source.onended = finish;

        this.currentPlaybackCancel =
          finish;

        try {
          source.start(0);
        } catch {
          finish();
        }
      }
    );
  }
}

function sleep(
  milliseconds: number
): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

/**
 * Converts streamed AI text into low-latency speech chunks.
 *
 * Normal sentences stay intact.
 *
 * Very long sentences are split around ~80 characters so Aanya
 * does not wait for the entire paragraph before starting to speak.
 */
export function splitCompletedSentences(
  buffer: string
): {
  sentences: string[];
  rest: string;
} {
  const results: string[] = [];

  let remaining = buffer;

  /*
   * First extract completed punctuation-based sentences.
   */
  const sentenceRegex =
    /[^.!?।]*[.!?।]+(?:["')\]]+)?\s*/g;

  const matches =
    remaining.match(sentenceRegex);

  let consumed = 0;

  if (matches) {
    for (const match of matches) {
      const trimmed = match.trim();

      if (trimmed) {
        results.push(...splitLongChunk(trimmed));
      }

      consumed += match.length;
    }

    remaining =
      remaining.slice(consumed);
  }

  /*
   * If the unfinished text has already become reasonably long,
   * release a natural chunk without waiting for punctuation.
   */
  if (remaining.trim().length >= 80) {
    const cut = findNaturalCut(
      remaining,
      80
    );

    if (cut > 0) {
      const chunk =
        remaining
          .slice(0, cut)
          .trim();

      if (chunk) {
        results.push(chunk);
      }

      remaining =
        remaining.slice(cut);
    }
  }

  return {
    sentences: results,
    rest: remaining,
  };
}

/**
 * Split an unusually long sentence into natural pieces.
 */
function splitLongChunk(
  text: string
): string[] {
  const MAX = 90;

  if (text.length <= MAX) {
    return [text];
  }

  const result: string[] = [];

  let remaining = text;

  while (remaining.length > MAX) {
    const cut =
      findNaturalCut(
        remaining,
        MAX
      );

    if (cut <= 0) {
      break;
    }

    const piece =
      remaining
        .slice(0, cut)
        .trim();

    if (piece) {
      result.push(piece);
    }

    remaining =
      remaining.slice(cut).trim();
  }

  if (remaining) {
    result.push(remaining);
  }

  return result;
}

/**
 * Find a good place to cut speech.
 *
 * Priority:
 * comma → space → fallback.
 */
function findNaturalCut(
  text: string,
  target: number
): number {
  const searchStart =
    Math.max(
      20,
      target - 25
    );

  const searchEnd =
    Math.min(
      text.length,
      target + 10
    );

  const region =
    text.slice(
      searchStart,
      searchEnd
    );

  const comma =
    region.lastIndexOf(",");

  if (comma >= 0) {
    return (
      searchStart +
      comma +
      1
    );
  }

  const space =
    region.lastIndexOf(" ");

  if (space >= 0) {
    return (
      searchStart +
      space
    );
  }

  return target;
}

export const voiceQueue =
  new AanyaVoiceQueue();
