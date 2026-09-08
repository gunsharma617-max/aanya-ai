/**
 * Lightweight wrapper around the browser's built-in Web Speech APIs.
 * Both speech-to-text (recognition) and text-to-speech (synthesis) are
 * free, ship with the browser, and need no API key — quality depends
 * on the device/browser's own speech engine.
 *
 * Support varies: Android Chrome supports both well. iOS Safari does
 * not support SpeechRecognition (voice input), only SpeechSynthesis
 * (voice output).
 */

export type RecognitionLang = "hi-IN" | "en-IN";

interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
    SpeechRecognition?: new () => MinimalSpeechRecognition;
  }
}

export function isRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createRecognizer(
  lang: RecognitionLang
): MinimalSpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognizer = new Ctor();
  recognizer.lang = lang;
  recognizer.continuous = false;
  recognizer.interimResults = false;
  return recognizer;
}

export function isSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const DEVANAGARI_RANGE = /[\u0900-\u097F]/;

/** Rough guess at whether text is primarily Hindi (Devanagari script) or English/Hinglish (Latin script). */
export function detectSpeechLang(text: string): RecognitionLang {
  return DEVANAGARI_RANGE.test(text) ? "hi-IN" : "en-IN";
}

function pickVoice(lang: RecognitionLang): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = lang.split("-")[0];
  const partial = voices.find((v) => v.lang.startsWith(prefix));
  return partial ?? voices[0] ?? null;
}

/** Speaks the given text aloud using the best available matching voice. Cancels any speech already in progress first. */
export function speak(text: string): void {
  if (!isSynthesisSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();

  const utterNow = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(detectSpeechLang(text));
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 1;
    synth.speak(utterance);
  };

  if (synth.getVoices().length === 0) {
    synth.onvoiceschanged = () => {
      utterNow();
      synth.onvoiceschanged = null;
    };
  } else {
    utterNow();
  }
}

export function stopSpeaking(): void {
  if (isSynthesisSupported()) window.speechSynthesis.cancel();
}
