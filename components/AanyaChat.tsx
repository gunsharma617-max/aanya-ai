"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import {
  createMessageId,
  type ChatMessage as ChatMessageType,
  type ChatResponseBody,
  type ChatErrorBody,
} from "@/lib/aanya";

const FALLBACK_ERROR =
  "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.";

export default function AanyaChat() {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  async function handleSend(text: string) {
    setError(null);

    const userMessage: ChatMessageType = {
      id: createMessageId(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        const body: ChatErrorBody = await res.json().catch(() => ({
          error: FALLBACK_ERROR,
        }));
        throw new Error(body.error || FALLBACK_ERROR);
      }

      const data: ChatResponseBody = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: data.message.content,
          createdAt: Date.now(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : FALLBACK_ERROR);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-6">
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
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Ready
          </span>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
      >
        {messages.length === 0 && <WelcomeState />}

        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}

        {isLoading && <TypingIndicator />}

        {error && (
          <div className="mx-auto max-w-[85%] rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5 text-center text-[13.5px] text-[var(--text)]">
            {error}
          </div>
        )}
      </div>

      <ChatInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
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
