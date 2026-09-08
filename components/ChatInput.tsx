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

type ListeningMode = "idle" | "wake" | "command";

export default function ChatInput({
  onSend,
  disabled = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [mode, setMode] =
    useState<ListeningMode>("idle");

  const [recognitionLang, setRecognitionLang] =
    useState<RecognitionLang>("en-IN");

  const textareaRef =
    useRef<HTMLTextAreaElement>(null);

  const recognizerRef =
    useRef<ReturnType<typeof createRecognizer>>(null);

  const wakeModeRef =
    useRef(false);

  const commandRef =
    useRef("");

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const restartTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const startingRef =
    useRef(false);

  const micSupported =
    isRecognitionSupported();

  /*
   * Cleanup
   */
  useEffect(() => {
    return () => {
      wakeModeRef.current = false;

      clearSilenceTimer();
      clearRestartTimer();

      try {
        recognizerRef.current?.stop();
      } catch {}

      recognizerRef.current = null;
    };
  }, []);

  /*
   * Helpers
   */

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(
        silenceTimerRef.current
      );

      silenceTimerRef.current = null;
    }
  }

  function clearRestartTimer() {
    if (restartTimerRef.current) {
      clearTimeout(
        restartTimerRef.current
      );

      restartTimerRef.current = null;
    }
  }

  function stopRecognition() {
    clearRestartTimer();
    clearSilenceTimer();

    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;
    startingRef.current = false;
  }

  function resetText() {
    setValue("");
    commandRef.current = "";

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height =
          "auto";
      }
    });
  }

  /*
   * Automatically send voice command
   */
  function autoSend(text: string) {
    const message = text.trim();

    if (!message || disabled) {
      return;
    }

    clearSilenceTimer();
    stopRecognition();

    setMode(
      wakeModeRef.current
        ? "wake"
        : "idle"
    );

    resetText();

    onSend(message);

    /*
     * If wake mode is enabled,
     * start listening again after Aanya
     * has received the command.
     */
    if (wakeModeRef.current) {
      restartTimerRef.current =
        setTimeout(() => {
          startWakeListener();
        }, 700);
    }
  }

  /*
   * Manual command listener
   *
   * Mic button → speak → automatic send
   */
  function startCommandListener() {
    if (!micSupported || disabled) {
      return;
    }

    clearRestartTimer();
    clearSilenceTimer();

    try {
      recognizerRef.current?.stop();
    } catch {}

    recognizerRef.current = null;

    commandRef.current = "";

    setValue("");
    setMode("command");

    const recognizer =
      createRecognizer(
        recognitionLang
      );

    if (!recognizer) {
      setMode("idle");
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

      const last =
        e.results[
          e.results.length - 1
        ];

      const transcript =
        last?.[0]?.transcript?.trim() ?? "";

      if (!transcript) {
        return;
      }

      commandRef.current =
        transcript;

      setValue(transcript);

      /*
       * Speech recognition has returned text.
       *
       * Wait a little so the UI can show the
       * transcript, then automatically send.
       */
      clearSilenceTimer();

      silenceTimerRef.current =
        setTimeout(() => {
          autoSend(
            commandRef.current
          );
        }, 900);
    };

    recognizer.onerror = (event) => {
      console.error(
        "Aanya command recognition error:",
        event
      );

      clearSilenceTimer();

      recognizerRef.current = null;

      setMode(
        wakeModeRef.current
          ? "wake"
          : "idle"
      );
    };

    recognizer.onend = () => {
      recognizerRef.current = null;

      /*
       * Sometimes Chrome ends recognition
       * immediately after returning the result.
       *
       * If text exists, send it automatically.
       */
      if (
        commandRef.current.trim()
      ) {
        clearSilenceTimer();

        silenceTimerRef.current =
          setTimeout(() => {
            autoSend(
              commandRef.current
            );
          }, 300);

        return;
      }

      if (wakeModeRef.current) {
        setMode("wake");

        restartTimerRef.current =
          setTimeout(() => {
            startWakeListener();
          }, 400);
      } else {
        setMode("idle");
      }
    };

    try {
      recognizer.start();
    } catch (error) {
      console.error(
        "Could not start microphone:",
        error
      );

      recognizerRef.current = null;
      setMode("idle");
    }
  }

  /*
   * Wake-word listener
   */
  function startWakeListener() {
    if (
      !micSupported ||
      disabled ||
      !wakeModeRef.current ||
      recognizerRef.current ||
      startingRef.current
    ) {
      return;
    }

    clearRestartTimer();

    startingRef.current = true;

    const recognizer =
      createRecognizer(
        recognitionLang
      );

    if (!recognizer) {
      startingRef.current = false;
      return;
    }

    recognizer.continuous = true;
    recognizer.interimResults = false;

    recognizerRef.current =
      recognizer;

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
            ?.toLowerCase()
            .trim() ?? "";

        if (!transcript) {
          continue;
        }

        console.log(
          "Wake listener:",
          transcript
        );

        const normalized =
          transcript
            .replace(/[.,!?]/g, "")
            .replace(/\s+/g, " ")
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
          continue;
        }

        console.log(
          "🔥 Hey Aanya detected"
        );

        /*
         * Stop wake listener
         */
        try {
          recognizer.stop();
        } catch {}

        recognizerRef.current = null;

        /*
         * Switch to command mode
         */
        setMode("command");

        /*
         * Start command recognition
         */
        setTimeout(() => {
          if (
            wakeModeRef.current &&
            !disabled
          ) {
            startCommandListener();
          }
        }, 350);

        return;
      }
    };

    recognizer.onerror = (event) => {
      console.error(
        "Wake listener error:",
        event
      );

      recognizerRef.current = null;
      startingRef.current = false;

      if (
        wakeModeRef.current
      ) {
        restartTimerRef.current =
          setTimeout(() => {
            startWakeListener();
          }, 800);
      }
    };

    recognizer.onend = () => {
      recognizerRef.current = null;
      startingRef.current = false;

      /*
       * Browser recognition sometimes stops
       * automatically. Restart wake mode.
       */
      if (
        wakeModeRef.current
      ) {
        restartTimerRef.current =
          setTimeout(() => {
            startWakeListener();
          }, 500);
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

      recognizerRef.current = null;
      startingRef.current = false;
      setMode("idle");
    }
  }

  /*
   * Wake mode toggle
   */
  function toggleWakeMode() {
    if (!micSupported || disabled) {
      return;
    }

    /*
     * Turn OFF
     */
    if (wakeModeRef.current) {
      wakeModeRef.current = false;

      stopRecognition();

      setMode("idle");

      return;
    }

    /*
     * Turn ON
     */
    wakeModeRef.current = true;

    setMode("wake");

    startWakeListener();
  }

  /*
   * Manual microphone button
   */
  function handleMic() {
    if (!micSupported || disabled) {
      return;
    }

    /*
     * If already listening,
     * stop and automatically send
     * whatever was recognized.
     */
    if (mode === "command") {
      if (
        commandRef.current.trim()
      ) {
        autoSend(
          commandRef.current
        );
      } else {
        stopRecognition();

        setMode(
          wakeModeRef.current
            ? "wake"
            : "idle"
        );
      }

      return;
    }

    startCommandListener();
  }

  /*
   * Normal text send
   */
  function handleSend() {
    const trimmed =
      value.trim();

    if (!trimmed || disabled) {
      return;
    }

    stopRecognition();

    setMode(
      wakeModeRef.current
        ? "wake"
        : "idle"
    );

    resetText();

    onSend(trimmed);

    if (wakeModeRef.current) {
      restartTimerRef.current =
        setTimeout(() => {
          startWakeListener();
        }, 700);
    }
  }

  /*
   * Keyboard
   */
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

  /*
   * Text input
   */
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

      {/* STATUS + LANGUAGE */}

      {micSupported && (
        <div className="flex items-center justify-between gap-2">

          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">

            {mode === "idle" && (
              <span>
                Voice ready
              </span>
            )}

            {mode === "wake" && (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />

                <span>
                  Hey Aanya ON
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

        {/* WAKE BUTTON */}

        {micSupported && (
          <button
            type="button"
            onClick={
              toggleWakeMode
            }
            disabled={disabled}
            aria-label={
              wakeModeRef.current
                ? "Turn off Hey Aanya"
                : "Turn on Hey Aanya"
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

        {/* MIC BUTTON */}

        {micSupported && (
          <button
            type="button"
            onClick={handleMic}
            disabled={disabled}
            aria-label={
              mode === "command"
                ? "Stop listening"
                : "Speak to Aanya"
            }
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              mode === "command"
                ? "border-transparent bg-red-500 text-white"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
            }`}
          >
            {mode === "command" ? (
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

        {/* SEND BUTTON */}

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
