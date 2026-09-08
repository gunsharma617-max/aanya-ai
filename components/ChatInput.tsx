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

  const micSupported =
    isRecognitionSupported();

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

  function startCommandListening() {
    if (!micSupported || disabled) {
      return;
    }

    // Stop wake-word listener while taking the actual command.
   
