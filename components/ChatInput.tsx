"use client";

import {
  useEffect,
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

type Mode = "idle" | "wake" | "command";

const WAKE_PHRASE = "hey aanya";

export default function ChatInput({
  onSend,
  disabled,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<Mode>("idle");

  const [recognitionLang, setRecognitionLang] =
    useState<RecognitionLang>("en-IN");

  const textareaRef =
    useRef<HTMLTextAreaElement>(null);

  const recognizerRef =
    useRef<ReturnType<typeof createRecognizer>>(null);

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const wakeEnabledRef =
    useRef(false);

  const commandTextRef =
    useRef("");

  const startingRef =
    useRef(false);

  const micSupported =
    isRecognitionSupported();

  /*
   * Cleanup
   */
  useEffect(() => {
    return () => {
      wakeEnabledRef.current = false;
      clearSilenceTimer();

      try {
        recognizerRef.current?.stop();
      } catch {}

      recognizerRef.current = null;
    };
  }, []);

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function resetInput() {
    setValue("");
    commandTextRef.current = "";

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  }

  function stopRecognizer() {
    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;
    startingRef.current = false;
  }

  /*
   * SEND COMMAND
   */
  function sendCommand(text: string) {
    const trimmed = text.trim();

    if (!trimmed || disabled) {
      return;
    }

    clearSilenceTimer();
    stopRecognizer();

    setMode(
      wakeEnabledRef.current
        ? "wake"
        : "idle"
    );

    resetInput();

    onSend(trimmed);
  }

  /*
   * START COMMAND LISTENING
   */
  function startCommandListening() {
    if (!micSupported || disabled) {
      return;
    }

    clearSilenceTimer();
    stopRecognizer();

    commandTextRef.current = "";

    setValue("");
    setMode("command");

    const recognizer =
      createRecognizer(recognitionLang);

    if (!recognizer) {
      setMode("idle");
      return;
    }

    // Command can listen continuously
    recognizer.continuous = false;
    recognizer.interimResults = false;

    recognizerRef.current = recognizer;

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
        last?.[0]?.transcript?.trim() ?? "";

      if (!transcript) return;

      commandTextRef.current =
        commandTextRef.current
          ? `${commandTextRef.current} ${transcript}`
          : transcript;

      setValue(commandTextRef.current);

      clearSilenceTimer();

      silenceTimerRef.current =
        setTimeout(() => {
          sendCommand(
            commandTextRef.current
          );
        }, 1200);
    };

    recognizer.onerror = (event) => {
      console.error(
        "Command recognition error:",
        event
      );

      clearSilenceTimer();

      stopRecognizer();

      if (wakeEnabledRef.current) {
        setMode("wake");
        startWakeListener();
      } else {
        setMode("idle");
      }
    };

    recognizer.onend = () => {
      recognizerRef.current = null;

      if (
        commandTextRef.current.trim()
      ) {
        clearSilenceTimer();

        silenceTimerRef.current =
          setTimeout(() => {
            sendCommand(
              commandTextRef.current
            );
          }, 400);
      } else if (
        wakeEnabledRef.current
      ) {
        setMode("wake");
        startWakeListener();
      } else {
        setMode("idle");
      }
    };

    try {
      recognizer.start();
    } catch (error) {
      console.error(
        "Could not start command recognition:",
        error
      );

      stopRecognizer();
      setMode("idle");
    }
  }

  /*
   * START WAKE-WORD LISTENER
   */
  function startWakeListener() {
    if (
      !micSupported ||
      disabled ||
      !wakeEnabledRef.current ||
      startingRef.current ||
      recognizerRef.current
    ) {
      return;
    }

    startingRef.current = true;

    const recognizer =
      createRecognizer(recognitionLang);

    if (!recognizer) {
      startingRef.current = false;
      return;
    }

    // Important: continuously listen for wake phrase
    recognizer.continuous = true;
    recognizer.interimResults = false;

    recognizerRef.current = recognizer;

    recognizer.onresult = (
      event: unknown
    ) => {
      const e =
        event as RecognitionResultEvent;

      for (
        let i = 0;
        i < e.results.length;
        i++
      ) {
        const transcript =
          e.results[i]?.[0]?.transcript
            ?.trim()
            .toLowerCase() ?? "";

        if (!transcript) continue;

        console.log(
          "Wake listener heard:",
          transcript
        );

        /*
         * Detect:
         * "hey aanya"
         * "hey anya"
         * "hey ania"
         */
        const normalized =
          transcript
            .replace(/[.,!?]/g, "")
            .replace(/\s+/g, " ")
            .trim();

        const wakeDetected =
          normalized.includes(
            WAKE_PHRASE
          ) ||
          normalized.includes(
            "hey anya"
          ) ||
          normalized.includes(
            "hey ania"
          );

        if (wakeDetected) {
          console.log(
            "🔥 Hey Aanya detected"
          );

          stopRecognizer();

          wakeEnabledRef.current =
            true;

          setMode("command");

          /*
           * Give recognition a tiny moment
           * before starting command capture.
           */
          setTimeout(() => {
            if (
              wakeEnabledRef.current &&
              !disabled
            ) {
              startCommandListening();
            }
          }, 250);

          return;
        }
      }
    };

    recognizer.onerror = (event) => {
      console.error(
        "Wake listener error:",
        event
      );

      stopRecognizer();

      if (
        wakeEnabledRef.current
      ) {
        setMode("wake");

        setTimeout(() => {
          startWakeListener();
        }, 800);
      }
    };

    recognizer.onend = () => {
      recognizerRef.current = null;
      startingRef.current = false;

      /*
       * Browser recognition can stop automatically.
       * Restart it while Wake Mode is enabled.
       */
      if (
        wakeEnabledRef.current
      ) {
        setTimeout(() => {
          startWakeListener();
        }, 300);
      }
    };

    try {
      recognizer.start();

      startingRef.current = false;

      setMode("wake");
    } catch (error) {
      console.error(
        "Could not start wake listener:",
        error
      );

      stopRecognizer();

      if (
        wakeEnabledRef.current
      ) {
        setMode("wake");
      }
    }
  }

  /*
   * TOGGLE WAKE MODE
   */
  function toggleWakeMode() {
    if (!micSupported || disabled) {
      return;
    }

    if (wakeEnabledRef.current) {
      wakeEnabledRef.current = false;

      clearSilenceTimer();
      stopRecognizer();

      setMode("idle");

      return;
    }

    wakeEnabledRef.current = true;

    startWakeListener();
  }

  /*
   * MANUAL MIC
   */
  function handleManualMic() {
    if (!micSupported || disabled) {
      return;
    }

    if (mode === "command") {
      sendCommand(
        commandTextRef.current
      );
      return;
    }

    startCommandListening();
  }

  /*
   * NORMAL SEND
   */
  function handleSend() {
    const trimmed = value.trim();

    if (!trimmed || disabled) {
      return;
    }

    clearSilenceTimer();
    stopRecognizer();

    onSend(trimmed);

    resetInput();

    if (wakeEnabledRef.current) {
      setMode("wake");

      setTimeout(() => {
        startWakeListener();
      }, 500);
    } else {
      setMode("idle");
    }
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

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-3 sm:px-6">

      {/* STATUS */}

      {micSupported && (
        <div className="flex items-center justify-between gap-2">

          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">

            {mode === "wake" && (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span>
                  Hey Aanya mode ON
                </span>
              </>
            )}

            {mode === "command" && (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                <span>
                  Aanya sun rahi hai...
                </span>
              </>
            )}

            {mode === "idle" && (
              <span>
                Wake word OFF
              </span>
            )}

          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">

            <span>
              Language:
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
            mode === "wake"
              ? 'Say "Hey Aanya"...'
              : mode === "command"
              ? "Aanya sun rahi hai..."
              : "Message Aanya…"
          }
          aria-label="Message Aanya"
          className="max-h-[140px] flex-1 resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        />

        {/* WAKE WORD BUTTON */}

        {micSupported && (
          <button
            type="button"
            onClick={toggleWakeMode}
            disabled={disabled}
            aria-label={
              wakeEnabledRef.current
                ? "Disable Hey Aanya"
                : "Enable Hey Aanya"
            }
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
              mode === "wake"
                ? "border-emerald-400 bg-emerald-400/15 text-emerald-400"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
            }`}
          >
            <span className="text-[15px] font-semibold">
              A
            </span>
          </button>
        )}

        {/* MANUAL MIC */}

        {micSupported && (
          <button
            type="button"
            onClick={
              handleManualMic
            }
            disabled={disabled}
            aria-label={
              mode === "command"
                ? "Stop listening"
                : "Speak your message"
            }
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              mode === "command"
                ? "border-transparent bg-red-500 text-white"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
            }`}
          >
            {mode === "command" ? (
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
