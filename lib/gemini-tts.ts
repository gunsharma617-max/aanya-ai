/**
 * Streaming-friendly voice player for Aanya's Gemini TTS.
 *
 * Sentences are queued while Gemini is generating the answer.
 *
 * A new request cancels:
 * - old TTS fetches
 * - old audio playback
 * - old queued sentences
 *
 * This prevents an old answer from speaking over a new answer.
 */

const TTS_TIMEOUT_MS = 15000;

export type SpeakingListener =
  (speaking: boolean) => void;

export type ErrorListener =
  (err: Error) => void;

class AanyaVoiceQueue {
  private audioContext:
    AudioContext | null = null;

  private currentSource:
    AudioBufferSourceNode | null =
      null;

  private currentPlaybackCancel:
    (() => void) | null = null;

  private queue: string[] = [];

  private activeToken = 0;

  private processing = false;

  private streamFinished = true;

  private voice = "Leda";

  private speaking = false;

  private speakingListeners =
    new Set<SpeakingListener>();

  private errorListener:
    ErrorListener | null = null;

  private activeTtsControllers =
    new Set<AbortController>();

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

      this.audioContext =
        new AudioContextCtor();
    }

    return this.audioContext;
  }

  onSpeakingChange(
    listener: SpeakingListener
  ): () => void {
    this.speakingListeners.add(
      listener
    );

    listener(this.speaking);

    return () =>
      this.speakingListeners.delete(
        listener
      );
  }

  onError(
    listener: ErrorListener | null
  ): void {
    this.errorListener = listener;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Start a completely new voice session.
   */
  start(voice = "Leda"): void {
    this.cancel();

    this.activeToken++;

    this.voice = voice;

    this.streamFinished = false;

    /*
     * IMPORTANT:
     *
     * Create AudioContext immediately while the
     * browser still considers this a user gesture.
     *
     * This fixes many Android/mobile autoplay cases.
     */
    try {
      const context =
        this.getContext();

      if (
        context.state ===
        "suspended"
      ) {
        void context
          .resume()
          .catch(() => undefined);
      }
    } catch (error) {
      this.errorListener?.(
        error instanceof Error
          ? error
          : new Error(
              "Unable to initialize audio playback."
            )
      );
    }
  }

  enqueue(text: string): void {
    const trimmed =
      text.trim();

    if (!trimmed) {
      return;
    }

    this.queue.push(trimmed);

    void this.runLoop(
      this.activeToken
    );
  }

  finish(): void {
    this.streamFinished = true;

    if (
      !this.processing &&
      this.queue.length > 0
    ) {
      void this.runLoop(
        this.activeToken
      );
    }
  }

  /**
   * Completely stop current voice activity.
   */
  cancel(): void {
    /*
     * Invalidate old work FIRST.
     */
    this.activeToken++;

    this.queue = [];

    this.streamFinished = true;

    /*
     * Abort every active TTS request.
     */
    for (
      const controller of
        this.activeTtsControllers
    ) {
      try {
        controller.abort();
      } catch {
        // Already aborted.
      }
    }

    this.activeTtsControllers.clear();

    /*
     * Stop current audio immediately.
     */
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

    /*
     * Do not depend only on onended().
     *
     * Explicitly resolve the playback promise so
     * an old request can never keep processing=true.
     */
    const cancelPlayback =
      this.currentPlaybackCancel;

    this.currentPlaybackCancel =
      null;

    cancelPlayback?.();

    this.setSpeaking(false);
  }

  private setSpeaking(
    value: boolean
  ): void {
    if (
      this.speaking === value
    ) {
      return;
    }

    this.speaking = value;

    this.speakingListeners.forEach(
      (listener) =>
        listener(value)
    );
  }

  private async runLoop(
    token: number
  ): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    let prefetched:
      | Promise<AudioBuffer | null>
      | null = null;

    try {
      const context =
        this.getContext();

      try {
        if (
          context.state ===
          "suspended"
        ) {
          await context.resume();
        }
      } catch {
        /*
         * Browser may require another
         * user gesture.
         */
      }

      while (
        token ===
        this.activeToken
      ) {
        let bufferPromise:
          Promise<AudioBuffer | null>;

        if (prefetched) {
          bufferPromise =
            prefetched;

          prefetched = null;
        } else {
          const text =
            this.queue.shift();

          if (!text) {
            if (
              this.streamFinished
            ) {
              break;
            }

            await sleep(50);

            continue;
          }

          bufferPromise =
            this.fetchBuffer(
              text,
              this.voice,
              context,
              token
            );
        }

        const buffer =
          await bufferPromise;

        if (
          token !==
          this.activeToken
        ) {
          break;
        }

        if (!buffer) {
          continue;
        }

        /*
         * Prefetch next sentence while
         * current sentence plays.
         */
        const nextText =
          this.queue.shift();

        if (nextText) {
          prefetched =
            this.fetchBuffer(
              nextText,
              this.voice,
              context,
              token
            );
        }

        if (
          token !==
          this.activeToken
        ) {
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
      if (
        token ===
        this.activeToken
      ) {
        this.setSpeaking(false);
      }

      this.processing = false;

      /*
       * If a new request arrived while the
       * old loop was shutting down, restart
       * using the newest token.
       */
      if (
        this.queue.length > 0 &&
        !this.streamFinished &&
        token !== this.activeToken
      ) {
        void this.runLoop(
          this.activeToken
        );
      } else if (
        this.queue.length > 0 &&
        token === this.activeToken
      ) {
        void this.runLoop(
          this.activeToken
        );
      }
    }
  }

  private async fetchBuffer(
    text: string,
    voice: string,
    context: AudioContext,
    token: number
  ): Promise<AudioBuffer | null> {
    if (
      token !==
      this.activeToken
    ) {
      return null;
    }

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        TTS_TIMEOUT_MS
      );

    this.activeTtsControllers.add(
      controller
    );

    try {
      const response =
        await fetch(
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

      if (
        !audioData.byteLength
      ) {
        throw new Error(
          "Gemini TTS returned empty audio."
        );
      }

      if (
        token !==
        this.activeToken
      ) {
        return null;
      }

      return await context.decodeAudioData(
        audioData
      );
    } catch (error) {
      const wasAbort =
        error instanceof
          DOMException &&
        error.name ===
          "AbortError";

      const wasAbortError =
        error instanceof Error &&
        error.name ===
          "AbortError";

      /*
       * Aborts caused by Stop/new request
       * are expected and should not show
       * as errors.
       */
      if (
        !wasAbort &&
        !wasAbortError &&
        token ===
          this.activeToken
      ) {
        this.errorListener?.(
          error instanceof Error
            ? error
            : new Error(
                String(error)
              )
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

  private playBuffer(
    context: AudioContext,
    buffer: AudioBuffer,
    token: number
  ): Promise<void> {
    return new Promise<void>(
      (resolve) => {
        if (
          token !==
          this.activeToken
        ) {
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
