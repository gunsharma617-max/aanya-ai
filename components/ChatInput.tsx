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
  disabled = false,
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

  const latestTranscriptRef =
    useRef("");

  const micSupported =
    isRecognitionSupported();

  function resetInput() {
    setValue("");
    latestTranscriptRef.current = "";

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height =
          "auto";
      }
    });
  }

  function sendVoiceText(text: string) {
    const message = text.trim();

    if (!message || disabled) {
      return;
    }

    console.log(
      "AANYA AUTO SEND:",
      message
    );

    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;
    setIsListening(false);

    resetInput();

    onSend(message);
  }

  function startListening() {
    if (!micSupported || disabled) {
      return;
    }

    /*
     * Stop any previous recognition
     */
    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;

    latestTranscriptRef.current = "";

    setValue("");
    setIsListening(true);

    const recognizer =
      createRecognizer(
        recognitionLang
      );

    if (!recognizer) {
      setIsListening(false);
      return;
    }

    recognizer.continuous = false;
    recognizer.interimResults = false;

    recognizerRef.current =
      recognizer;

    recognizer.onresult = (
      event: unknown
    ) => {
      const e =
        event as RecognitionResultEvent;

      let finalText = "";

      for (
        let i = 0;
        i < e.results.length;
        i++
      ) {
        const transcript =
          e.results[i]?.[0]?.transcript
            ?.trim() ?? "";

        if (transcript) {
          finalText +=
            (finalText ? " " : "") +
            transcript;
        }
      }

      finalText = finalText.trim();

      if (!finalText) {
        return;
      }

      console.log(
        "AANYA SPEECH:",
        finalText
      );

      latestTranscriptRef.current =
        finalText;

      setValue(finalText);

      /*
       * IMPORTANT:
       *
       * Do NOT wait for onend.
       * Send directly when speech result
       * arrives.
       */
      sendVoiceText(finalText);
    };

    recognizer.onerror = (
      event: unknown
    ) => {
      console.error(
        "Speech recognition error:",
        event
      );

      setIsListening(false);

      recognizerRef.current = null;
    };

    recognizer.onend = () => {
      console.log(
        "Speech recognition ended"
      );

      setIsListening(false);

      recognizerRef.current = null;

      /*
       * Safety fallback:
       * If result happened but sendVoiceText
       * somehow didn't run, send it here.
       */
      const remaining =
        latestTranscriptRef.current.trim();

      if (remaining && !disabled) {
        latestTranscriptRef.current =
          "";

        setValue("");

        onSend(remaining);
      }
    };

    try {
      recognizer.start();

      console.log(
        "AANYA MICROPHONE STARTED"
      );
    } catch (error) {
      console.error(
        "Microphone start failed:",
        error
      );

      recognizerRef.current = null;
      setIsListening(false);
    }
  }

  function stopListening() {
    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;
    setIsListening(false);
  }

  function handleMicToggle() {
    if (disabled) {
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    startListening();
  }

  function handleSend() {
    const message =
      value.trim();

    if (!message || disabled) {
      return;
    }

    stopListening();
    resetInput();

    onSend(message);
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
    const text =
      e.target.value;

    setValue(text);

    requestAnimationFrame(() => {
      const element =
        textareaRef.current;

      if (!element) {
        return;
      }

      element.style.height =
        "auto";

      element.style.height =
        `${Math.min(
          element.scrollHeight,
          140
        )}px`;
    });
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

      {/* INPUT */}

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

        {/* MIC */}

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
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
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
