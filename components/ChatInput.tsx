"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
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
  wakeWordEnabled?: boolean;
}

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

export default function ChatInput({
  onSend,
  disabled,
  wakeWordEnabled = true,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isWakeListening, setIsWakeListening] = useState(false);

  const [recognitionLang, setRecognitionLang] =
    useState<RecognitionLang>("en-IN");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const recognizerRef = useRef<
    ReturnType<typeof createRecognizer>
  >(null);

  const wakeRecognizerRef = useRef<
    ReturnType<typeof createRecognizer>
  >(null);

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const wakeRestartTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const transcriptRef = useRef("");

  const commandModeRef = useRef(false);
  const wakeDetectedRef = useRef(false);

  const micSupported = isRecognitionSupported();

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function clearWakeRestartTimer() {
    if (wakeRestartTimerRef.current) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
  }

  function resetInput() {
    setValue("");
    transcriptRef.current = "";

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  }

  function stopWakeListener() {
    clearWakeRestartTimer();

    try {
      wakeRecognizerRef.current?.stop();
    } catch {}

    wakeRecognizerRef.current = null;
    setIsWakeListening(false);
  }

  function sendVoiceMessage() {
    clearSilenceTimer();

    const text = transcriptRef.current.trim();

    if (!text || disabled) {
      return;
    }

    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;

    commandModeRef.current = false;
    setIsListening(false);

    resetInput();

    onSend(text);
  }

  function startCommandListening() {
    if (!micSupported || disabled) {
      return;
    }

    stopWakeListener();

    try {
      recognizerRef.current?.stop();
    } catch {}

    clearSilenceTimer();

    transcriptRef.current = "";
    commandModeRef.current = true;
    wakeDetectedRef.current = true;

    setValue("");
    setIsListening(true);

    const recognizer = createRecognizer(recognitionLang);

    if (!recognizer) {
      commandModeRef.current = false;
      setIsListening(false);
      return;
    }

    recognizerRef.current = recognizer;

    recognizer.onresult = (event: unknown) => {
      const e = event as RecognitionResultEvent;

      const last = e.results[e.results.length - 1];

      const transcript =
        last?.[0]?.transcript?.trim() ?? "";

      if (!transcript) {
        return;
      }

      transcriptRef.current = transcriptRef.current
        ? `${transcriptRef.current} ${transcript}`
        : transcript;

      setValue(transcriptRef.current);

      clearSilenceTimer();

      silenceTimerRef.current = setTimeout(() => {
        sendVoiceMessage();
      }, 1200);
    };

    recognizer.onerror = (event: unknown) => {
      console.error(
        "Aanya command recognition error:",
        event
      );

      clearSilenceTimer();

      recognizerRef.current = null;
      commandModeRef.current = false;
      setIsListening(false);

      if (wakeWordEnabled && !disabled) {
        setTimeout(() => {
          startWakeListener();
        }, 500);
      }
    };

    recognizer.onend = () => {
      if (transcriptRef.current.trim()) {
        clearSilenceTimer();

        silenceTimerRef.current = setTimeout(() => {
          sendVoiceMessage();
        }, 500);
      } else {
        recognizerRef.current = null;
        commandModeRef.current = false;
        setIsListening(false);

        if (wakeWordEnabled && !disabled) {
          setTimeout(() => {
            startWakeListener();
          }, 500);
        }
      }
    };

    try {
      recognizer.start();
    } catch (error) {
      console.error(
        "Could not start command microphone:",
        error
      );

      recognizerRef.current = null;
      commandModeRef.current = false;
      setIsListening(false);
    }
  }

  function handleSend() {
    const trimmed = value.trim();

    if (!trimmed || disabled) {
      return;
    }

    clearSilenceTimer();

    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;

    commandModeRef.current = false;
    setIsListening(false);

    onSend(trimmed);

    resetInput();
  }

  function handleKeyDown(
    e: KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(
    e: ChangeEvent<HTMLTextAreaElement>
  ) {
    setValue(e.target.value);

    requestAnimationFrame(() => {
      const el = textareaRef.current;

      if (!el) {
        return;
      }

      el.style.height = "auto";

      el.style.height = `${Math.min(
        el.scrollHeight,
        140
      )}px`;
    });
  }

  function handleMicToggle() {
    if (!micSupported || disabled) {
      return;
    }

    if (isListening) {
      sendVoiceMessage();
      return;
    }

    startCommandListening();
  }

  function startWakeListener() {
    if (
      !wakeWordEnabled ||
      !micSupported ||
      disabled ||
      commandModeRef.current
    ) {
      return;
    }

    clearWakeRestartTimer();

    try {
      wakeRecognizerRef.current?.stop();
    } catch {}

    const recognizer = createRecognizer("en-IN");

    if (!recognizer) {
      return;
    }

    recognizer.continuous = true;
    recognizer.interimResults = true;

    wakeRecognizerRef.current = recognizer;

    setIsWakeListening(true);

    recognizer.onresult = (event: unknown) => {
      if (
        commandModeRef.current ||
        wakeDetectedRef.current
      ) {
        return;
      }

      const e = event as RecognitionResultEvent;

      let transcript = "";

      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];

        const speech = result?.[0]?.transcript;

        if (speech) {
          transcript += ` ${speech}`;
        }
      }

      const normalized = transcript
        .toLowerCase()
        .replace(/[.,!?]/g, "")
        .trim();

      const wakeDetected =
        normalized.includes("hey aanya") ||
        normalized.includes("hey anya") ||
        normalized.includes("hey ania");

      if (!wakeDetected) {
        return;
      }

      console.log(
        "Aanya wake word detected:",
        normalized
      );

      wakeDetectedRef.current = true;

      stopWakeListener();

      setTimeout(() => {
        wakeDetectedRef.current = false;
        startCommandListening();
      }, 250);
    };

    recognizer.onerror = (event: unknown) => {
      console.log(
        "Wake listener error:",
        event
      );

      wakeRecognizerRef.current = null;
      setIsWakeListening(false);

      if (
        wakeWordEnabled &&
        !disabled &&
        !commandModeRef.current
      ) {
        wakeRestartTimerRef.current = setTimeout(() => {
          startWakeListener();
        }, 1000);
      }
    };

    recognizer.onend = () => {
      wakeRecognizerRef.current = null;
      setIsWakeListening(false);

      if (
        wakeWordEnabled &&
        !disabled &&
        !commandModeRef.current &&
        !wakeDetectedRef.current
      ) {
        wakeRestartTimerRef.current = setTimeout(() => {
          startWakeListener();
        }, 500);
      }
    };

    try {
      recognizer.start();

      console.log(
        'Aanya is waiting for "Hey Aanya"...'
      );
    } catch (error) {
      console.error(
        "Could not start wake listener:",
        error
      );

      wakeRecognizerRef.current = null;
      setIsWakeListening(false);
    }
  }

  useEffect(() => {
    if (
      wakeWordEnabled &&
      micSupported &&
      !disabled
    ) {
      startWakeListener();
    } else {
      stopWakeListener();
    }

    return () => {
      stopWakeListener();

      try {
        recognizerRef.current?.stop();
      } catch {}

      recognizerRef.current = null;

      clearSilenceTimer();
    };
  }, [
    wakeWordEnabled,
    micSupported,
    disabled,
  ]);

  return (
    <div className="border-t border-white/[0.06] bg-[#090b10]/95 px-3 py-3 backdrop-blur-xl sm:px-6">
      
      {/* WAKE STATUS */}

      {micSupported && (
        <div className="mb-2.5 flex items-center justify-end gap-2 px-1 text-[11px] text-[var(--text-muted)]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isListening
                ? "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.7)]"
                : isWakeListening
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                : "bg-zinc-600"
            }`}
          />

          <span>
            {isListening
              ? "Aanya sun rahi hai..."
              : isWakeListening
              ? '"Hey Aanya" active'
              : "Wake word off"}
          </span>
        </div>
      )}

      {/* LANGUAGE */}

      {micSupported && (
        <div className="mb-2.5 flex items-center justify-end gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
          <span>Language</span>

          <button
            type="button"
            onClick={() =>
              setRecognitionLang("en-IN")
            }
            className={`rounded-full px-2.5 py-1 transition ${
              recognitionLang === "en-IN"
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-white"
            }`}
          >
            EN
          </button>

          <button
            type="button"
            onClick={() =>
              setRecognitionLang("hi-IN")
            }
            className={`rounded-full px-2.5 py-1 transition ${
              recognitionLang === "hi-IN"
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-white"
            }`}
          >
            HI
          </button>
        </div>
      )}

      {/* MAIN INPUT */}

      <div
        className="
          flex items-end gap-1.5
          rounded-[22px]
          border border-white/[0.08]
          bg-[#12151c]/95
          p-1.5
          shadow-[0_12px_40px_rgba(0,0,0,0.35)]
          transition
          focus-within:border-[rgba(232,184,92,0.35)]
          focus-within:shadow-[0_0_0_1px_rgba(232,184,92,0.08),0_12px_40px_rgba(0,0,0,0.4)]
        "
      >

        {/* @ ICON */}

        <div className="flex h-11 w-9 shrink-0 items-center justify-center text-[#697282]">
          <span className="text-[18px] font-medium">@</span>
        </div>

        {/* TEXTAREA */}

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
              : "Message Aanya..."
          }
          aria-label="Message Aanya"
          className="
            max-h-[140px]
            min-h-[44px]
            flex-1
            resize-none
            bg-transparent
            px-1
            py-2.5
            text-[15px]
            leading-5
            text-[#f5f7fa]
            placeholder:text-[#697282]
            focus:outline-none
            disabled:opacity-50
          "
        />

        {/* AGENT */}

        <div className="hidden shrink-0 items-center rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-[11px] text-[#8b93a3] sm:flex">
          Agent
        </div>

        {/* AUTO */}

        <div className="hidden shrink-0 items-center rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-[11px] text-[#8b93a3] sm:flex">
          Auto
        </div>

        {/* MICROPHONE */}

        {micSupported && (
          <button
            type="button"
            onClick={handleMicToggle}
            disabled={disabled}
            aria-label={
              isListening
                ? "Stop listening"
                : "Speak your message"
            }
            className={`
              flex h-11 w-11 shrink-0 items-center justify-center
              rounded-full
              border
              transition-all
              disabled:cursor-not-allowed
              disabled:opacity-35

              ${
                isListening
                  ? "border-red-400/30 bg-red-400/15 text-red-300 shadow-[0_0_18px_rgba(248,113,113,0.12)]"
                  : "border-white/[0.08] bg-white/[0.035] text-[#a0a8b7] hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white"
              }
            `}
          >
            {isListening ? (
              <span className="typing-dot h-2.5 w-2.5 rounded-full bg-red-300" />
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
            disabled || !value.trim()
          }
          aria-label="Send message"
          className="
            flex h-11 w-11 shrink-0
            items-center justify-center
            rounded-full
            bg-[var(--accent)]
            text-[#17130b]
            shadow-[0_4px_16px_rgba(232,184,92,0.18)]
            transition-all
            hover:brightness-110
            active:scale-95
            disabled:cursor-not-allowed
            disabled:opacity-25
            disabled:shadow-none
          "
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
