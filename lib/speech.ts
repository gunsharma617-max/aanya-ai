/**
 * Lightweight wrapper around the browser's built-in Web Speech APIs.
 *
 * Speech recognition (voice input) and speech synthesis (voice output)
 * are provided by the browser/device, so no separate voice API key is
 * required.
 *
 * Android Chrome generally supports both APIs.
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

  return Boolean(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );
}

export function createRecognizer(
  lang: RecognitionLang
): MinimalSpeechRecognition | null {
  if (typeof window === "undefined") return null;

  const Ctor =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Ctor) return null;

  const recognizer = new Ctor();

  recognizer.lang = lang;
  recognizer.continuous = false;
  recognizer.interimResults = false;

  return recognizer;
}

export function isSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window
  );
}

const DEVANAGARI_RANGE = /[\u0900-\u097F]/;

/**
 * Detect whether the text is primarily Hindi or English/Hinglish.
 */
export function detectSpeechLang(
  text: string
): RecognitionLang {
  return DEVANAGARI_RANGE.test(text) ? "hi-IN" : "en-IN";
}

/**
 * Select the best available voice for the requested language.
 */
function pickVoice(
  lang: RecognitionLang
): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();

  if (voices.length === 0) {
    return null;
  }

  // First try an exact match such as hi-IN or en-IN.
  const exact = voices.find((voice) => voice.lang === lang);

  if (exact) {
    return exact;
  }

  // Then try the language prefix such as "hi" or "en".
  const prefix = lang.split("-")[0] ?? lang;

  const partial = voices.find((voice) =>
    voice.lang.startsWith(prefix)
  );

  if (partial) {
    return partial;
  }

  // Finally use the browser's first available voice.
  return voices[0] ?? null;
}

/**
 * Speak text using the browser's built-in speech synthesis.
 */
export function speak(text: string): void {
  if (!isSynthesisSupported()) {
    return;
  }

  if (!text.trim()) {
    return;
  }

  const synth = window.speechSynthesis;

  // Stop any previous speech before starting new speech.
  synth.cancel();

  const utterNow = () => {
    const utterance = new SpeechSynthesisUtterance(text);

    const voice = pickVoice(detectSpeechLang(text));

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = detectSpeechLang(text);
    }

    // Natural-ish default settings.
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    synth.speak(utterance);
  };

  const availableVoices = synth.getVoices();

  if (availableVoices.length === 0) {
    synth.onvoiceschanged = () => {
      utterNow();
      synth.onvoiceschanged = null;
    };
  } else {
    utterNow();
  }
}

/**
 * Stop Aanya's current speech.
 */
export function stopSpeaking(): void {
  if (!isSynthesisSupported()) {
    return;
  }

  window.speechSynthesis.cancel();
}
