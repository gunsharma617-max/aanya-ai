import Image from "next/image";
import type { ChatMessage as ChatMessageType } from "@/lib/aanya";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isAanya = message.role === "assistant";

  return (
    <div
      className={`msg-in flex w-full gap-2.5 ${
        isAanya ? "justify-start" : "justify-end"
      }`}
    >
      {isAanya && (
        <span className="mt-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--gold-soft)] bg-[var(--surface-raised)] shadow-[0_0_10px_rgba(232,184,92,0.15)]">
          <Image
            src="/aanya/avatar.svg"
            alt="Aanya"
            width={22}
            height={22}
            className="h-[22px] w-[22px] rounded-full"
          />
        </span>
      )}

      <div
        className={[
          "max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed backdrop-blur-sm sm:max-w-[70%]",
          isAanya
            ? "rounded-tl-sm border border-[var(--border-soft)] bg-[var(--surface-raised)]/90 text-[var(--text)]"
            : "rounded-tr-sm border border-[var(--user-bubble-border)] bg-[var(--user-bubble)] text-[var(--text)]",
        ].join(" ")}
      >
        {message.content}
      </div>
    </div>
  );
}
