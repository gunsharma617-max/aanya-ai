"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";

import {
  speakWithGemini,
  stopGeminiSpeaking,
} from "@/lib/gemini-tts";

import {
  createMessageId,
  type ChatMessage as ChatMessageType,
  type ChatResponseBody,
  type ChatErrorBody,
} from "@/lib/aanya";

const FALLBACK_ERROR =
  "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.";

const VOICE_PREF_KEY = "aanya-voice-enabled";

const QUICK_ACTIONS: { label: string; prompt: string; icon: JSX.Element }[] = [
  {
    label: "Research",
    prompt: "Help me research a topic — ask me what it is.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M20 20l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Plan my day",
    prompt: "Help me plan my day. Ask me what's on my plate.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="5.5" width="16" height="14.5" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Open YouTube",
    prompt: "Open YouTube for me.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="3.2" y="6" width="17.6" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10.5 9.5l4.5 2.5-4.5 2.5v-5z" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: "Check weather",
    prompt: "What's the weather like right now?",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="8.5" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6 18h11a3.3 3.3 0 000-6.6 5 5 0 00-9.6-1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function AanyaChat() {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load saved voice preference
  useEffect(() => {
    const saved = localStorage.getItem(VOICE_PREF_KEY);

    if (saved !== null) {
      setVoiceEnabled(saved === "true");
    }
  }, []);

  // Save voice preference
  useEffect(() => {
    localStorage.setItem(
      VOICE_PREF_KEY,
      String(voiceEnabled)
    );

    if (!voiceEnabled) {
      stopGeminiSpeaking();
    }
  }, [voiceEnabled]);

  // Auto scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  // Stop voice when component unmounts
  useEffect(() => {
    return () => {
      stopGeminiSpeaking();
    };
  }, []);

  async function handleSend(text: string) {
    setError(null);

    // Stop previous Gemini voice
    stopGeminiSpeaking();

    const userMessage: ChatMessageType = {
      id: createMessageId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    const nextMessages = [
      ...messages,
      userMessage,
    ];

    setMessages(nextMessages);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        const body: ChatErrorBody =
          await res.json().catch(() => ({
            error: FALLBACK_ERROR,
          }));

        throw new Error(
          body.error || FALLBACK_ERROR
        );
      }

      const data: ChatResponseBody =
        await res.json();

      const assistantMessage: ChatMessageType = {
        id: createMessageId(),
        role: "assistant",
        content: data.message.content,
        createdAt: Date.now(),
      };

      setMessages((prev) => [
        ...prev,
        assistantMessage,
      ]);

      // ==============================
      // GEMINI TTS — LEDA
      // ==============================

      if (voiceEnabled) {
        speakWithGemini(
          data.message.content,
          "Leda"
        ).catch((error) => {
          console.error(
            "Aanya Gemini TTS failed:",
            error
          );

          setError(
            "Aanya's Gemini voice could not be played."
          );
        });
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : FALLBACK_ERROR
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden">

      {/* HEADER */}

      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-3.5 sm:px-6">

        <div className="flex items-center gap-3">

          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--gold-soft)] bg-[var(--surface)] shadow-[0_0_14px_rgba(232,184,92,0.18)]">
            <Image
              src="/aanya/avatar.svg"
              alt="Aanya"
              width={26}
              height={26}
              className="h-[26px] w-[26px] rounded-full"
            />
          </span>

          <div className="flex flex-col leading-tight">

            <span className="font-sans text-[15px] font-semibold tracking-[0.08em] text-[var(--text)]">
              AANYA
            </span>

            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
              Personal AI · Online
            </span>

          </div>

        </div>

        {/* VOICE BUTTON */}

        <button
          type="button"
          onClick={() =>
            setVoiceEnabled((v) => !v)
          }
          aria-label={
            voiceEnabled
              ? "Mute Aanya's voice"
              : "Unmute Aanya's voice"
          }
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
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

      {/* CHAT */}

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
      >

        {messages.length === 0 && (
          <WelcomeState onQuickAction={handleSend} />
        )}

        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            message={m}
          />
        ))}

        {isLoading && (
          <TypingIndicator />
        )}

        {error && (
          <div className="mx-auto max-w-[85%] rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5 text-center text-[13.5px] text-[var(--text)]">
            {error}
          </div>
        )}

      </div>

      {/* INPUT */}

      <ChatInput
        onSend={handleSend}
        disabled={isLoading}
        wakeWordEnabled={true}
      />

    </div>
  );
}

/* ==============================
   WELCOME STATE
================================ */

function WelcomeState({
  onQuickAction,
}: {
  onQuickAction: (text: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-6 text-center">

      {/* status strip */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10.5px] uppercase tracking-wide text-[var(--text-dim)]">
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          System Online
        </span>
        <span className="opacity-40">·</span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          Voice Ready
        </span>
        <span className="opacity-40">·</span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-[var(--cyan)]" />
          AI Core Active
        </span>
      </div>

      {/* AANYA CORE ORB */}
      <div className="relative flex h-[168px] w-[168px] items-center justify-center">

        <span className="orbit-ring-a absolute h-[168px] w-[168px] rounded-full border border-dashed border-[var(--gold-soft)]" />
        <span className="orbit-ring-b absolute h-[132px] w-[132px] rounded-full border border-[var(--cyan-soft)]" />

        <span className="core-glow absolute h-[92px] w-[92px] rounded-full bg-[radial-gradient(circle,rgba(232,184,92,0.35),transparent_70%)]" />

        <span className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full border border-[var(--gold-soft)] bg-[var(--surface-raised)] shadow-[0_0_30px_rgba(232,184,92,0.25)]">
          <Image
            src="/aanya/avatar.svg"
            alt="Aanya"
            width={44}
            height={44}
            className="h-11 w-11 rounded-full"
          />
        </span>

      </div>

      {/* GREETING */}
      <div className="flex flex-col items-center gap-1.5">
        <p className="font-display text-[24px] font-medium text-[var(--gold-strong)]">
          {getGreeting()}, Boss.
        </p>

        <p className="max-w-[280px] text-[14.5px] text-[var(--text-muted)]">
          I&apos;m ready. What are we working on?
        </p>
      </div>

      {/* QUICK ACTIONS */}
      <div className="grid w-full max-w-[340px] grid-cols-2 gap-2.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => onQuickAction(action.prompt)}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)]/60 px-3 py-3.5 text-[13px] text-[var(--text-muted)] transition hover:border-[var(--gold-soft)] hover:text-[var(--gold)] active:scale-[0.97]"
          >
            <span className="text-[var(--gold)]">{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      {/* TAGLINE */}
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-[var(--text-dim)]">
        <span className="h-px w-8 bg-[var(--border)]" />
        Your Personal AI Operating System
        <span className="h-px w-8 bg-[var(--border)]" />
      </div>

    </div>
  );
}

/* ==============================
   TYPING INDICATOR
================================ */

function TypingIndicator() {
  return (
    <div className="msg-in flex items-center gap-2.5">

      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--gold-soft)] bg-[var(--surface-raised)]">
        <Image
          src="/aanya/avatar.svg"
          alt="Aanya"
          width={22}
          height={22}
          className="h-[22px] w-[22px] rounded-full"
        />
      </span>

      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-[var(--border-soft)] bg-[var(--surface-raised)]/90 px-4 py-3.5">

        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />

        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />

        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />

      </div>

    </div>
  );
        }
