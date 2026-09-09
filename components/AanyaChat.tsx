"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import Image from "next/image";

import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";

import {
  voiceQueue,
  splitCompletedSentences,
} from "@/lib/gemini-tts";

import {
  createMessageId,
  isAbortError,
  type ChatMessage as ChatMessageType,
  type ChatErrorBody,
  type ChatStreamEvent,
} from "@/lib/aanya";

const FALLBACK_ERROR =
  "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.";

const VOICE_PREF_KEY =
  "aanya-voice-enabled";

type Phase =
  | "idle"
  | "thinking"
  | "generating"
  | "error";

export default function AanyaChat() {
  const [messages, setMessages] =
    useState<ChatMessageType[]>([]);

  const [phase, setPhase] =
    useState<Phase>("idle");

  const [isSpeaking, setIsSpeaking] =
    useState(false);

  const [streamingId, setStreamingId] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [voiceEnabled, setVoiceEnabled] =
    useState(true);

  const scrollRef =
    useRef<HTMLDivElement>(null);

  const chatAbortRef =
    useRef<AbortController | null>(
      null
    );

  const voiceEnabledRef =
    useRef(true);

  useEffect(() => {
    const saved =
      localStorage.getItem(
        VOICE_PREF_KEY
      );

    if (saved !== null) {
      setVoiceEnabled(
        saved === "true"
      );
    }
  }, []);

  useEffect(() => {
    voiceEnabledRef.current =
      voiceEnabled;

    localStorage.setItem(
      VOICE_PREF_KEY,
      String(voiceEnabled)
    );

    if (!voiceEnabled) {
      voiceQueue.cancel();
    }
  }, [voiceEnabled]);

  useEffect(() => {
    const unsubscribe =
      voiceQueue.onSpeakingChange(
        setIsSpeaking
      );

    voiceQueue.onError(() => {
      setError(
        (previous) =>
          previous ??
          "Aanya's voice had trouble with part of that reply."
      );
    });

    return () => {
      unsubscribe();
      voiceQueue.onError(null);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top:
        scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, phase]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      voiceQueue.cancel();
    };
  }, []);

  async function handleSend(
    text: string
  ) {
    setError(null);

    /*
     * New request always wins.
     *
     * Abort:
     * 1. Previous Gemini request
     * 2. Previous TTS requests
     * 3. Previous audio playback
     */
    chatAbortRef.current?.abort();

    chatAbortRef.current = null;

    voiceQueue.cancel();

    const userMessage:
      ChatMessageType = {
      id: createMessageId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    const assistantId =
      createMessageId();

    const assistantMessage:
      ChatMessageType = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    const historyForApi = [
      ...messages,
      userMessage,
    ].map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((previous) => [
      ...previous,
      userMessage,
      assistantMessage,
    ]);

    setStreamingId(assistantId);

    setPhase("thinking");

    const controller =
      new AbortController();

    chatAbortRef.current =
      controller;

    /*
     * IMPORTANT:
     *
     * Start AudioContext synchronously from
     * the send action.
     *
     * This is required for Android/mobile
     * browser user-activation rules.
     */
    if (voiceEnabledRef.current) {
      voiceQueue.start("Leda");
    }

    let fullText = "";
    let ttsBuffer = "";
    let gotFirstToken = false;

    try {
      const response = await fetch(
        "/api/chat",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          signal:
            controller.signal,

          body: JSON.stringify({
            messages:
              historyForApi,
          }),
        }
      );

      if (
        !response.ok ||
        !response.body
      ) {
        const body: ChatErrorBody =
          await response
            .json()
            .catch(() => ({
              error:
                FALLBACK_ERROR,
            }));

        throw new Error(
          body.error ||
            FALLBACK_ERROR
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let buffer = "";

      let streamError:
        | string
        | null = null;

      let streamDone = false;

      const processEvent = (
        frame: string
      ): boolean => {
        const dataLines = frame
          .split(/\r\n|\n|\r/)
          .filter((line) =>
            line.startsWith("data:")
          )
          .map((line) =>
            line.slice(5).trim()
          );

        if (
          dataLines.length === 0
        ) {
          return false;
        }

        const payload =
          dataLines
            .join("\n")
            .trim();

        if (!payload) {
          return false;
        }

        if (
          payload === "[DONE]"
        ) {
          streamDone = true;
          return true;
        }

        let event:
          ChatStreamEvent;

        try {
          event =
            JSON.parse(
              payload
            ) as ChatStreamEvent;
        } catch {
          streamError =
            "Aanya received an invalid stream event.";

          return true;
        }

        if (event.error) {
          streamError =
            event.error;

          return true;
        }

        if (event.delta) {
          if (!gotFirstToken) {
            gotFirstToken = true;

            setPhase(
              "generating"
            );
          }

          fullText += event.delta;

          ttsBuffer += event.delta;

          setMessages(
            (previous) =>
              previous.map(
                (message) =>
                  message.id ===
                  assistantId
                    ? {
                        ...message,
                        content:
                          fullText,
                      }
                    : message
              )
          );

          if (
            voiceEnabledRef.current
          ) {
            const {
              sentences,
              rest,
            } =
              splitCompletedSentences(
                ttsBuffer
              );

            ttsBuffer = rest;

            for (
              const sentence of sentences
            ) {
              voiceQueue.enqueue(
                sentence
              );
            }
          }
        }

        if (event.done) {
          streamDone = true;
          return true;
        }

        return false;
      };

      const processBufferedEvents =
        (
          flush = false
        ): boolean => {
          while (true) {
            const delimiter =
              findSseDelimiter(
                buffer
              );

            if (
              delimiter === -1
            ) {
              break;
            }

            const frame =
              buffer.slice(
                0,
                delimiter
              );

            buffer =
              buffer.slice(
                delimiter +
                  sseDelimiterLength(
                    buffer,
                    delimiter
                  )
              );

            if (
              processEvent(frame)
            ) {
              return true;
            }
          }

          if (
            flush &&
            buffer.trim()
          ) {
            const finalFrame =
              buffer;

            buffer = "";

            return processEvent(
              finalFrame
            );
          }

          return false;
        };

      while (!streamDone) {
        const {
          done,
          value,
        } = await reader.read();

        if (done) {
          buffer +=
            decoder.decode();

          processBufferedEvents(
            true
          );

          break;
        }

        if (value) {
          buffer +=
            decoder.decode(
              value,
              {
                stream: true,
              }
            );

          if (
            processBufferedEvents(
              false
            )
          ) {
            break;
          }
        }
      }

      if (streamError) {
        throw new Error(
          streamError
        );
      }

      if (!fullText.trim()) {
        throw new Error(
          FALLBACK_ERROR
        );
      }

      if (
        voiceEnabledRef.current
      ) {
        if (
          ttsBuffer.trim()
        ) {
          voiceQueue.enqueue(
            ttsBuffer
          );
        }

        voiceQueue.finish();
      }

      setPhase("idle");
    } catch (err) {
      if (isAbortError(err)) {
        /*
         * Old request was replaced by a
         * newer request.
         */
        return;
      }

      voiceQueue.cancel();

      setError(
        err instanceof Error
          ? err.message
          : FALLBACK_ERROR
      );

      setPhase("error");

      setMessages(
        (previous) =>
          previous.filter(
            (message) =>
              message.id !==
                assistantId ||
              message.content.trim()
          )
      );
    } finally {
      setStreamingId(
        (currentId) =>
          currentId ===
          assistantId
            ? null
            : currentId
      );

      if (
        chatAbortRef.current ===
        controller
      ) {
        chatAbortRef.current =
          null;
      }
    }
  }

  const statusLabel =
    phase === "thinking"
      ? "Thinking..."
      : phase === "generating"
      ? "Typing..."
      : isSpeaking
      ? "Speaking..."
      : phase === "error"
      ? "Error"
      : "Ready";

  const statusDotClass =
    phase === "error"
      ? "bg-red-400"
      : phase === "thinking" ||
        phase === "generating"
      ? "bg-amber-400 animate-pulse"
      : isSpeaking
      ? "bg-[var(--accent)] animate-pulse"
      : "bg-emerald-400";

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <Image
            src="/aanya/avatar.svg"
            alt="Aanya"
            width={38}
            height={38}
            className="h-[38px] w-[38px] rounded-full"
          />

          <div className="flex flex-col leading-tight">
            <span className="font-display text-[17px] font-medium text-[var(--text)]">
              Aanya
            </span>

            <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
              />

              {statusLabel}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setVoiceEnabled(
              (value) => !value
            )
          }
          aria-label={
            voiceEnabled
              ? "Mute Aanya's voice"
              : "Unmute Aanya's voice"
          }
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)]"
        >
          {voiceEnabled ? (
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M4 9v6h4l5 4V5L8 9H4z"
                fill="currentColor"
              />

              <path
                d="M16 8a5 5 0 010 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M4 9v6h4l5 4V5L8 9H4z"
                fill="currentColor"
              />

              <path
                d="M16 9l5 6M21 9l-5 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
      >
        {messages.length ===
          0 && <WelcomeState />}

        {messages.map(
          (message) => (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={
                message.id ===
                streamingId
              }
            />
          )
        )}

        {phase ===
          "thinking" && (
          <TypingIndicator />
        )}

        {error && (
          <div className="mx-auto max-w-[85%] rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5 text-center text-[13.5px] text-[var(--text)]">
            {error}
          </div>
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        disabled={false}
        wakeWordEnabled={true}
      />
    </div>
  );
}

function findSseDelimiter(
  value: string
): number {
  let best = -1;

  for (const delimiter of [
    "\r\n\r\n",
    "\n\n",
    "\r\r",
  ]) {
    const index =
      value.indexOf(delimiter);

    if (
      index !== -1 &&
      (best === -1 ||
        index < best)
    ) {
      best = index;
    }
  }

  return best;
}

function sseDelimiterLength(
  value: string,
  index: number
): number {
  if (
    value.startsWith(
      "\r\n\r\n",
      index
    )
  ) {
    return 4;
  }

  if (
    value.startsWith(
      "\n\n",
      index
    )
  ) {
    return 2;
  }

  return 2;
}

function WelcomeState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-14 text-center">
      <Image
        src="/aanya/avatar.svg"
        alt="Aanya"
        width={56}
        height={56}
        className="h-14 w-14 rounded-full"
      />

      <p className="font-display text-[20px] font-medium text-[var(--text)]">
        Hi Boss 👋
      </p>

      <p className="max-w-xs text-[14.5px] text-[var(--text-muted)]">
        I&apos;m Aanya. What are we working on today?
      </p>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/aanya/avatar.svg"
        alt="Aanya"
        width={30}
        height={30}
        className="h-[30px] w-[30px] shrink-0 rounded-full"
      />

      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3.5">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />

        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />

        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
      </div>
    </div>
  );
        }
