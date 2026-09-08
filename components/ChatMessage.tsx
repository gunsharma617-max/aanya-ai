import Image from "next/image";
import type { ChatMessage as ChatMessageType } from "@/lib/aanya";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isAanya = message.role === "assistant";

  return (
    <div
      className={`flex w-full gap-2.5 ${isAanya ? "justify-start" : "justify-end"}`}
    >
      {isAanya && (
        <Image
          src="/aanya/avatar.svg"
          alt="Aanya"
          width={30}
          height={30}
          className="mt-1 h-[30px] w-[30px] shrink-0 rounded-full"
        />
      )}
      <div
        className={[
          "max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed sm:max-w-[70%]",
          isAanya
            ? "rounded-tl-sm border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
            : "rounded-tr-sm bg-[var(--user-bubble)] text-[var(--text)]",
        ].join(" ")}
      >
        {message.content}
      </div>
    </div>
  );
}
