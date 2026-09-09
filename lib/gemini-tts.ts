/**
 * Reliable voice player for Aanya's Gemini TTS.
 *
 * - One TTS request at a time
 * - Automatic retry on temporary TTS failures
 * - 30 second timeout
 * - Cancels old replies when a new message starts
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
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

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
   * Start a completely new reply.
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
   * Add one completed sentence to the voice queue.
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
   * Tell the voice system that the streamed answer is finished.
   */
  finish(): void {
    this.streamFinished = true;

    if (!this.processing && this.queue.length > 0) {
      void this.runLoop(this.activeToken);
    }
  }

  /**
   * Cancel all old TTS work immediately.
   */
  cancel(): void {
    this.activeToken++;

    this.queue = [];
    this.streamFinished = true;

    // Abort every active Gemini TTS request.
    for (const controller of this.activeTtsControllers) {
      try {
        controller.abort();
      } catch {
        // Already aborted.
      }
    }

    this.activeTtsControllers.clear();

    // Stop currently playing audio.
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

    // Make sure playback promise resolves.
    const cancelPlayback =
      this.currentPlaybackCancel;

    this.currentPlaybackCancel = null;

    cancelPlayback?.();

    this.setSpeaking(false);
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking === value) {
      return;
    }

    this.speaking = value;

    this.speakingListeners.forEach(
      (listener) => listener(value)
    );
  }

  /**
   * Process sentences ONE BY ONE.
   *
   * Important:
   * We intentionally do NOT prefetch the next sentence.
   * This prevents multiple Gemini TTS requests from running
   * at the same time.
   */
  private async runLoop(token: number): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      const context = this.getContext();

      try {
        if (context.state === "suspended") {
          await context.resume();
        }
      } catch {
        // Browser may resume it after the user gesture.
      }

      while (token === this.activeToken) {
        const text = this.queue.shift();

        if (!text) {
          if (this.streamFinished) {
            break;
          }

          await sleep(50);
          continue;
        }

        // Generate audio for exactly ONE sentence.
        const buffer =
          await this.fetchBufferWithRetry(
            text,
            this.voice,
            context,
            token
          );

        if (token !== this.activeToken) {
          break;
        }

        if (!buffer) {
          // Continue with the next sentence instead of
          // killing the complete voice response.
          continue;
        }

        this.setSpeaking(true);

        // Wait until this sentence completely finishes.
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

      // If something arrived while the loop was finishing,
      // continue processing it.
      if (this.queue.length > 0) {
        if (
          token !== this.activeToken ||
          !this.streamFinished
        ) {
          void this.runLoop(this.activeToken);
        } else {
          void this.runLoop(token);
        }
      }
    }
  }

  /**
   * Generate TTS with automatic retry.
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

      const result =
        await this.fetchBuffer(
          text,
          voice,
          context,
          token
        );

      if (result) {
        return result;
      }

      if (token !== this.activeToken) {
        return null;
      }

      // Small delay before retry.
      if (attempt < MAX_RETRIES) {
        await sleep(500 * (attempt + 1));
      }
    }

    if (token === this.activeToken) {
      this.errorListener?.(
        new Error(
          "Gemini TTS could not generate this part of the reply."
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
      const aborted =
        error instanceof DOMException &&
        error.name === "AbortError";

      const namedAbort =
        error instanceof Error &&
        error.name === "AbortError";

      if (
        !aborted &&
        !namedAbort &&
        token === this.activeToken
      ) {
        console.error(
          "Aanya TTS request failed:",
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
   * Play one generated audio buffer.
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

        source.onended =
          finish;

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

export function splitCompletedSentences(
  buffer: string
): {
  sentences: string[];
  rest: string;
} {
  const matches =
    buffer.match(
      /[^.!?।]*[.!?।]+(?:["')\]]+)?\s*/g
    );

  if (!matches) {
    return {
      sentences: [],
      rest: buffer,
    };
  }

  const sentences: string[] = [];

  let consumed = 0;

  for (
    const match of matches
  ) {
    const trimmed =
      match.trim();

    if (trimmed) {
      sentences.push(
        trimmed
      );
    }

    consumed +=
      match.length;
  }

  return {
    sentences,
    rest: buffer.slice(
      consumed
    ),
  };
}

export const voiceQueue =
  new AanyaVoiceQueue();
