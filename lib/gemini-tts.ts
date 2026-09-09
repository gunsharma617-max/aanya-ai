/**
 * Streaming-friendly voice player for Aanya's Gemini TTS.
 *
 * Sentences are pushed in one at a time as the chat reply streams in —
 * enqueue() can be called repeatedly while more text is still arriving.
 * finish() marks that no more sentences are coming for this reply.
 *
 * - Only one AudioContext / one active queue at a time (singleton).
 * - Starting a new reply always cancels whatever was queued or playing.
 * - A single sentence's TTS request failing does not stop the rest of
 *   the reply from being spoken — it's skipped and reported via onError.
 */

const TTS_TIMEOUT_MS = 15000;

export type SpeakingListener = (speaking: boolean) => void;
export type ErrorListener = (err: Error) => void;

class AanyaVoiceQueue {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private queue: string[] = [];
  private activeToken = 0;
  private processing = false;
  private streamFinished = true;
  private voice = "Leda";
  private speaking = false;
  private speakingListeners = new Set<SpeakingListener>();
  private errorListener: ErrorListener | null = null;

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  /** Subscribe to speaking-state changes. Fires immediately with the current value. */
  onSpeakingChange(listener: SpeakingListener): () => void {
    this.speakingListeners.add(listener);
    listener(this.speaking);
    return () => this.speakingListeners.delete(listener);
  }

  /** Set (or clear with null) a callback for non-fatal per-sentence TTS failures. */
  onError(listener: ErrorListener | null): void {
    this.errorListener = listener;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /** Begin a fresh reply. Cancels anything still queued/playing from before. */
  start(voice = "Leda"): void {
    this.cancel();
    this.activeToken++;
    this.voice = voice;
    this.streamFinished = false;
  }

  /** Queue another finished sentence for speech. */
  enqueue(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.queue.push(trimmed);
    void this.runLoop(this.activeToken);
  }

  /** Call once the text stream has ended — no more sentences are coming. */
  finish(): void {
    this.streamFinished = true;
  }

  /** Stop everything immediately: playback, pending fetches, the queue. */
  cancel(): void {
    this.activeToken++;
    this.queue = [];
    this.streamFinished = true;

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

    this.setSpeaking(false);
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking === value) return;
    this.speaking = value;
    this.speakingListeners.forEach((l) => l(value));
  }

  private async runLoop(token: number): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    const context = this.getContext();
    try {
      if (context.state === "suspended") {
        await context.resume();
      }
    } catch {
      // Will implicitly retry on the next user gesture.
    }

    let prefetched: Promise<AudioBuffer | null> | null = null;

    while (token === this.activeToken) {
      let bufferPromise: Promise<AudioBuffer | null>;

      if (prefetched) {
        bufferPromise = prefetched;
        prefetched = null;
      } else {
        const text = this.queue.shift();
        if (!text) {
          if (this.streamFinished) break;
          await sleep(50);
          continue;
        }
        bufferPromise = this.fetchBuffer(text, this.voice, context);
      }

      const buffer = await bufferPromise;
      if (token !== this.activeToken) break;

      if (!buffer) {
        // This sentence failed TTS — skip it, keep the rest of the reply going.
        continue;
      }

      // Prefetch the next sentence (if one's already queued) while this one
      // plays, so there's no dead air between sentences.
      const nextText = this.queue.shift();
      if (nextText) {
        prefetched = this.fetchBuffer(nextText, this.voice, context);
      }

      this.setSpeaking(true);
      await this.playBuffer(context, buffer, token);
    }

    if (token === this.activeToken) {
      this.setSpeaking(false);
    }

    this.processing = false;
  }

  private async fetchBuffer(
    text: string,
    voice: string,
    context: AudioContext
  ): Promise<AudioBuffer | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ text, voice }),
      });

      if (!response.ok) {
        throw new Error(`Gemini TTS failed: ${response.status}`);
      }

      const audioData = await response.arrayBuffer();
      if (!audioData.byteLength) {
        throw new Error("Gemini TTS returned empty audio.");
      }

      return await context.decodeAudioData(audioData);
    } catch (err) {
      this.errorListener?.(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private playBuffer(
    context: AudioContext,
    buffer: AudioBuffer,
    token: number
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      if (token !== this.activeToken) {
        resolve();
        return;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      this.currentSource = source;

      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        resolve();
      };

      try {
        source.start(0);
      } catch {
        resolve();
      }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls finished sentences off the front of a growing text buffer so they
 * can be sent to TTS the moment they're complete, without waiting for the
 * whole reply. Whatever hasn't ended in sentence punctuation yet comes
 * back as `rest` and should be prepended to the next chunk.
 */
export function splitCompletedSentences(buffer: string): {
  sentences: string[];
  rest: string;
} {
  const matches = buffer.match(/[^.!?।]*[.!?।]+(?:["')\]]+)?\s*/g);

  if (!matches) {
    return { sentences: [], rest: buffer };
  }

  const sentences: string[] = [];
  let consumed = 0;

  for (const m of matches) {
    const trimmed = m.trim();
    if (trimmed) sentences.push(trimmed);
    consumed += m.length;
  }

  return { sentences, rest: buffer.slice(consumed) };
}

/** Singleton — there's only ever one Aanya speaking at a time. */
export const voiceQueue = new AanyaVoiceQueue();
