"use client";

import { useEffect, useRef } from "react";
import {
  createRecognizer,
  isRecognitionSupported,
} from "@/lib/speech";

interface WakeWordListenerProps {
  enabled?: boolean;
  onWake: () => void;
}

export default function WakeWordListener({
  enabled = true,
  onWake,
}: WakeWordListenerProps) {
  const recognizerRef = useRef<
    ReturnType<typeof createRecognizer>
  >(null);

  const restartTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  const triggeredRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isRecognitionSupported()) {
      return;
    }

    function startListening() {
      if (triggeredRef.current) {
        return;
      }

      const recognizer =
        createRecognizer("en-IN");

      if (!recognizer) {
        return;
      }

      recognizer.continuous = true;
      recognizer.interimResults = true;

      recognizerRef.current = recognizer;

      recognizer.onresult = (event: unknown) => {
        const e = event as {
          results: ArrayLike<
            ArrayLike<{ transcript: string }>
          >;
        };

        let text = "";

        for (
          let i = 0;
          i < e.results.length;
          i++
        ) {
          const transcript =
            e.results[i]?.[0]?.transcript;

          if (transcript) {
            text += " " + transcript;
          }
        }

        const normalized = text
          .toLowerCase()
          .replace(/[.,!?]/g, "")
          .trim();

        const wakeDetected =
          normalized.includes("hey aanya") ||
          normalized.includes("hey anya") ||
          normalized.includes("hey ania");

        if (wakeDetected) {
          console.log(
            "Wake word detected:",
            normalized
          );

          triggeredRef.current = true;

          try {
            recognizer.stop();
          } catch {}

          recognizerRef.current = null;

          onWake();
        }
      };

      recognizer.onerror = () => {
        recognizerRef.current = null;

        if (!triggeredRef.current) {
          restartTimerRef.current =
            setTimeout(() => {
              startListening();
            }, 1000);
        }
      };

      recognizer.onend = () => {
        recognizerRef.current = null;

        if (!triggeredRef.current) {
          restartTimerRef.current =
            setTimeout(() => {
              startListening();
            }, 500);
        }
      };

      try {
        recognizer.start();

        console.log(
          'Aanya wake listener started. Say "Hey Aanya".'
        );
      } catch (error) {
        console.error(
          "Wake listener could not start:",
          error
        );
      }
    }

    triggeredRef.current = false;

    startListening();

    return () => {
      if (restartTimerRef.current) {
        clearTimeout(
          restartTimerRef.current
        );
      }

      try {
        recognizerRef.current?.stop();
      } catch {}

      recognizerRef.current = null;
    };
  }, [enabled, onWake]);

  return null;
      }
