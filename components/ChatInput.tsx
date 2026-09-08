"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  createRecognizer,
  isRecognitionSupported,
  type RecognitionLang,
} from "@/lib/speech";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

export default function ChatInput({
  onSend,
  disabled,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [isListening, setIsListening] =
    useState(false);

  const [recognitionLang, setRecognitionLang] =
    useState<RecognitionLang>("en-IN");

  const textareaRef =
    useRef<HTMLTextAreaElement>(null);

  const recognizerRef =
    useRef<ReturnType<typeof createRecognizer>>(null);

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const transcriptRef =
    useRef("");

  const micSupported =
    isRecognitionSupported();

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function resetInput() {
    setValue("");

    transcriptRef.current = "";

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height =
          "auto";
      }
    });
  }

  function sendVoiceMessage() {
    clearSilenceTimer();

    const text =
      transcriptRef.current.trim();

    if (!text || disabled) {
      return;
    }

    // Stop recognition
    try {
      recognizerRef.current?.stop();
    } catch {
      // Already stopped
    }

    recognizerRef.current = null;

    setIsListening(false);

    // Clear input before sending
    resetInput();

    // Automatically send to Aanya
    onSend(text);
  }

  function handleSend() {
    const trimmed = value.trim();

    if (!trimmed || disabled) {
      return;
    }

    // Stop microphone if active
    clearSilenceTimer();

    try {
      recognizerRef.current?.stop();
    } catch {
      // Already stopped
    }

    recognizerRef.current = null;

    setIsListening(false);

    onSend(trimmed);

    resetInput();
  }

  function handleKeyDown(
    e: KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      e.key === "Enter" &&
      !e.shiftKey
    ) {
      e.preventDefault();

      handleSend();
    }
  }

  function handleInput(
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) {
    setValue(e.target.value);

    requestAnimationFrame(() => {
      const el = textareaRef.current;

      if (!el) return;

      el.style.height = "auto";

      el.style.height =
        `${Math.min(
          el.scrollHeight,
          140
        )}px`;
    });
  }

  function handleMicToggle() {
    if (!micSupported || disabled) {
      return;
    }

    // Stop listening
    if (isListening) {
      sendVoiceMessage();
      return;
    }

    const recognizer =
      createRecognizer(
        recognitionLang
      );

    if (!recognizer) {
      return;
    }

    clearSilenceTimer();

    transcriptRef.current = "";

    setValue("");

    recognizerRef.current =
      recognizer;

    recognizer.onresult = (
      event: unknown
    ) => {
      const e =
        event as RecognitionResultEvent;

      const last =
        e.results[
          e.results.length - 1
        ];

      const transcript =
        last?.[0]?.transcript
          ?.trim() ?? "";

      if (!transcript) {
        return;
      }

      transcriptRef.current =
        transcriptRef.current
          ? `${transcriptRef.current} ${transcript}`
          : transcript;

      setValue(
        transcriptRef.current
      );

      // Reset silence timer
      clearSilenceTimer();

      silenceTimerRef.current =
        setTimeout(() => {
          sendVoiceMessage();
        }, 1200);
    };

    recognizer.onerror = (
      event: unknown
    ) => {
      console.error(
        "Aanya speech recognition error:",
        event
      );

      clearSilenceTimer();

      recognizerRef.current =
        null;

      setIsListening(false);
    };

    recognizer.onend = () => {
      // If there is already speech text,
      // automatically send it.
      if (
        transcriptRef.current.trim()
      ) {
        clearSilenceTimer();

        silenceTimerRef.current =
          setTimeout(() => {
            sendVoiceMessage();
          }, 500);
      } else {
        setIsListening(false);
      }
    };

    setIsListening(true);

    try {
      recognizer.start();
    } catch (error) {
      console.error(
        "Could not start microphone:",
        error
      );

      recognizerRef.current =
        null;

      setIsListening(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-3 sm:px-6">

      {/* LANGUAGE */}

      {micSupported && (
        <div className="flex items-center gap-1.5 self-end text-[11px] text-[var(--text-muted)]">

          <span>
            Bolne ki language:
          </span>

          <button
            type="button"
            onClick={() =>
              setRecognitionLang(
                "en-IN"
              )
            }
            className={`rounded-full px-2 py-0.5 ${
              recognitionLang ===
              "en-IN"
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : ""
            }`}
          >
            EN
          </button>

          <button
            type="button"
            onClick={() =>
              setRecognitionLang(
                "hi-IN"
              )
            }
            className={`rounded-full px-2 py-0.5 ${
              recognitionLang ===
              "hi-IN"
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : ""
            }`}
          >
            HI
          </button>

        </div>
      )}

      {/* INPUT AREA */}

      <div className="flex items-end gap-2">

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={
            isListening
              ? "Aanya sun rahi hai..."
              : "Message Aanya…"
          }
          aria-label="Message Aanya"
          className="max-h-[140px] flex-1 resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        />

        {/* MICROPHONE */}

        {micSupported && (
          <button
            type="button"
            onClick={
              handleMicToggle
            }
            disabled={disabled}
            aria-label={
              isListening
                ? "Stop listening"
                : "Speak your message"
            }
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              isListening
                ? "border-transparent bg-red-500 text-white"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
            }`}
          >

            {isListening ? (
              <span className="typing-dot h-2.5 w-2.5 rounded-full bg-white" />
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />

                <path
                  d="M19 11a7 7 0 01-14 0M12 18v3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            )}

          </button>
        )}

        {/* SEND */}

        <button
          type="button"
          onClick={handleSend}
          disabled={
            disabled ||
            !value.trim()
          }
          aria-label="Send message"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[#1c1424] transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
        >

          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M4 12L20 4L13 20L11 13L4 12Z"
              fill="currentColor"
            />
          </svg>

        </button>

      </div>
    </div>
  );
                }
