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

  const textareaRef =
    useRef<HTMLTextAreaElement>(null);

  const recognizerRef =
    useRef<ReturnType<typeof createRecognizer>>(null);

  const wakeRecognizerRef =
    useRef<ReturnType<typeof createRecognizer>>(null);

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const wakeRestartTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const transcriptRef =
    useRef("");

  const commandModeRef =
    useRef(false);

  const wakeDetectedRef =
    useRef(false);

  const micSupported =
    isRecognitionSupported();

  /* ---------------- TIMERS ---------------- */

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

  /* ---------------- INPUT RESET ---------------- */

  function resetInput() {
    setValue("");
    transcriptRef.current = "";

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  }

  /* ---------------- WAKE LISTENER ---------------- */

  function stopWakeListener() {
    clearWakeRestartTimer();

    try {
      wakeRecognizerRef.current?.stop();
    } catch {}

    wakeRecognizerRef.current = null;
    setIsWakeListening(false);
  }

  /* ---------------- VOICE MESSAGE ---------------- */

  function sendVoiceMessage() {
    clearSilenceTimer();

    const text =
      transcriptRef.current.trim();

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

  /* ---------------- COMMAND LISTENING ---------------- */

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

    const recognizer =
      createRecognizer(recognitionLang);

    if (!recognizer) {
      commandModeRef.current = false;
      setIsListening(false);
      return;
    }

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
        "Aanya command recognition error:",
        event
      );

      clearSilenceTimer();

      recognizerRef.current = null;
      commandModeRef.current = false;
      setIsListening(false);

      if (
        wakeWordEnabled &&
        !disabled
      ) {
        setTimeout(() => {
          startWakeListener();
        }, 500);
      }
    };

    recognizer.onend = () => {
      if (
        transcriptRef.current.trim()
      ) {
        clearSilenceTimer();

        silenceTimerRef.current =
          setTimeout(() => {
            sendVoiceMessage();
          }, 500);
      } else {
        recognizerRef.current = null;
        commandModeRef.current = false;
        setIsListening(false);

        if (
          wakeWordEnabled &&
          !disabled
        ) {
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

  /* ---------------- SEND ---------------- */

  function handleSend() {
    const trimmed =
      value.trim();

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

  /* ---------------- KEYBOARD ---------------- */

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

  /* ---------------- TEXT INPUT ---------------- */

  function handleInput(
    e: ChangeEvent<HTMLTextAreaElement>
  ) {
    setValue(e.target.value);

    requestAnimationFrame(() => {
      const el =
        textareaRef.current;

      if (!el) {
        return;
      }

      el.style.height = "auto";

      el.style.height =
        `${Math.min(
          el.scrollHeight,
          140
        )}px`;
    });
  }

  /* ---------------- MIC ---------------- */

  function handleMicToggle() {
    if (
      !micSupported ||
      disabled
    ) {
      return;
    }

    if (isListening) {
      sendVoiceMessage();
      return;
    }

    startCommandListening();
  }

  /* ---------------- WAKE WORD ---------------- */

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

    const recognizer =
      createRecognizer("en-IN");

    if (!recognizer) {
      return;
    }

    recognizer.continuous = true;
    recognizer.interimResults = true;

    wakeRecognizerRef.current =
      recognizer;

    setIsWakeListening(true);

    recognizer.onresult = (
      event: unknown
    ) => {
      if (
        commandModeRef.current ||
        wakeDetectedRef.current
      ) {
        return;
      }

      const e =
        event as RecognitionResultEvent;

      let transcript = "";

      for (
        let i = 0;
        i < e.results.length;
        i++
      ) {
        const result =
          e.results[i];

        const speech =
          result?.[0]?.transcript;

        if (speech) {
          transcript +=
            ` ${speech}`;
        }
      }

      const normalized =
        transcript
          .toLowerCase()
          .replace(/[.,!?]/g, "")
          .trim();

      const wakeDetected =
        normalized.includes(
          "hey aanya"
        ) ||
        normalized.includes(
          "hey anya"
        ) ||
        normalized.includes(
          "hey ania"
        );

      if (!wakeDetected) {
        return;
      }

      console.log(
        "Aanya wake word detected:",
        normalized
      );

      wakeDetectedRef.current =
        true;

      stopWakeListener();

      setTimeout(() => {
        wakeDetectedRef.current =
          false;

        startCommandListening();
      }, 250);
    };

    recognizer.onerror = (
      event: unknown
    ) => {
      console.log(
        "Wake listener error:",
        event
      );

      wakeRecognizerRef.current =
        null;

      setIsWakeListening(false);

      if (
        wakeWordEnabled &&
        !disabled &&
        !commandModeRef.current
      ) {
        wakeRestartTimerRef.current =
          setTimeout(() => {
            startWakeListener();
          }, 1000);
      }
    };

    recognizer.onend = () => {
      wakeRecognizerRef.current =
        null;

      setIsWakeListening(false);

      if (
        wakeWordEnabled &&
        !disabled &&
        !commandModeRef.current &&
        !wakeDetectedRef.current
      ) {
        wakeRestartTimerRef.current =
          setTimeout(() => {
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

      wakeRecognizerRef.current =
        null;

      setIsWakeListening(false);
    }
  }

  /* ---------------- EFFECT ---------------- */

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

      recognizerRef.current =
        null;

      clearSilenceTimer();
    };
  }, [
    wakeWordEnabled,
    micSupported,
    disabled,
  ]);

  /* ---------------- UI ---------------- */

  return (
    <div className="border-t border-[#1d1d1f] bg-[#0d0d0f] px-3 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-2xl rounded-[20px] border border-[#29292d] bg-[#1d1d1d] p-2 shadow-2xl">

        {/* INPUT CARD */}

        <div className="flex min-h-[122px] flex-col">

          {/* TOP ICON */}

          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.04]">
            <span className="text-[14px] text-[#808388]">
              @
            </span>
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
                : "Message Aanya…"
            }
            aria-label="Message Aanya"
            className="mt-3 min-h-[40px] max-h-[140px] w-full resize-none border-0 bg-transparent px-1 text-[14px] leading-5 text-[#caccd2] outline-none placeholder:text-[#4e4e4e] focus:ring-0 disabled:opacity-50"
          />

          {/* BOTTOM CONTROLS */}

          <div className="mt-auto flex items-center gap-2">

            {/* WAKE STATUS */}

            {micSupported && (
              <div className="flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2 py-1 text-[11px] text-[#8b9099]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isListening
                      ? "bg-red-500"
                      : isWakeListening
                      ? "bg-emerald-400"
                      : "bg-[#60636a]"
                  }`}
                />

                <span className="hidden sm:inline">
                  {isListening
                    ? "Listening"
                    : isWakeListening
                    ? "Hey Aanya"
                    : "Wake off"}
                </span>
              </div>
            )}

            {/* LANGUAGE */}

            {micSupported && (
              <div className="flex h-6 items-center gap-0.5 rounded-full bg-white/[0.04] px-1">

                <button
                  type="button"
                  onClick={() =>
                    setRecognitionLang(
                      "en-IN"
                    )
                  }
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    recognitionLang ===
                    "en-IN"
                      ? "bg-white/[0.08] text-white"
                      : "text-[#808388]"
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
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    recognitionLang ===
                    "hi-IN"
                      ? "bg-white/[0.08] text-white"
                      : "text-[#808388]"
                  }`}
                >
                  HI
                </button>

              </div>
            )}

            {/* AGENT */}

            <div className="hidden h-6 items-center gap-1 rounded-full bg-white/[0.04] px-2 text-[12px] text-[#caccd2] sm:flex">
              Agent

              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                style={{
                  transform:
                    "rotate(90deg)",
                }}
              >
                <path
                  d="M7 11L10 8L7 5"
                  stroke="#8B9099"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.6"
                />
              </svg>
            </div>

            {/* AUTO */}

            <div className="hidden h-6 items-center gap-1 rounded-full bg-white/[0.04] px-2 text-[12px] text-[#caccd2] sm:flex">
              Auto

              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                style={{
                  transform:
                    "rotate(90deg)",
                }}
              >
                <path
                  d="M7 11L10 8L7 5"
                  stroke="#8B9099"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.6"
                />
              </svg>
            </div>

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
                className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
                  isListening
                    ? "bg-red-500/20 text-red-400"
                    : "bg-white/[0.04] text-[#8b9099] hover:bg-white/[0.08]"
                }`}
              >
                {isListening ? (
                  <span className="typing-dot h-2 w-2 rounded-full bg-red-400" />
                ) : (
                  <svg
                    width="15"
                    height="15"
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
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[#8b8b8b] transition-all hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-30"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M8 12.6667V3.33333M12.6667 8L8 3.33333L3.33333 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}
