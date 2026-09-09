import { NextRequest, NextResponse } from "next/server";
import { AANYA_SYSTEM_PROMPT } from "@/prompts/aanya-master-prompt";
import type { ChatRequestBody, ChatErrorBody } from "@/lib/aanya";
import { isAbortError } from "@/lib/aanya";

export const runtime = "nodejs";

const DEFAULT_MODEL = "gemini-3.5-flash";
const MAX_MESSAGE_LENGTH = 8000;
const MAX_HISTORY = 40;

/**
 * POST /api/chat
 *
 * Streams Aanya's reply back as Server-Sent Events.
 *
 * Each event body is JSON:
 *   {"delta": "..."}   — a chunk of new text
 *   {"done": true}     — the reply is complete
 *   {"error": "..."}   — something failed
 */
export async function POST(req: NextRequest) {
  let body: ChatRequestBody;

  try {
    body = await req.json();
  } catch {
    return errorResponse("Malformed request body.", 400);
  }

  const validation = validateBody(body);
  if (!validation.ok) {
    return errorResponse(validation.reason, 400);
  }

  const apiKey = process.env.AI_API_KEY?.trim();

  if (!apiKey) {
    console.error("AI_API_KEY is not set.");

    return errorResponse(
      "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
      500
    );
  }

  // Keep the configured model if it is valid. Whitespace around the value is
  // ignored so values copied into deployment settings cannot break the URL.
  const model = (process.env.AI_MODEL?.trim() || DEFAULT_MODEL).trim();

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(apiKey)}`;

  let upstream: Response;

  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: req.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: AANYA_SYSTEM_PROMPT }],
        },
        contents: body.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      }),
    });
  } catch (err) {
    if (isAbortError(err)) {
      return new Response(null, { status: 499 });
    }

    console.error("Chat route failure (network):", err);

    return errorResponse(
      "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
      500
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await safeReadText(upstream);

    console.error(
      "AI provider error:",
      upstream.status,
      detail
    );

    return errorResponse(
      getProviderErrorMessage(detail) ??
        "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
      502
    );
  }

  const encoder = new TextEncoder();
  const upstreamReader = upstream.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let sawAnyText = false;
      let streamEnded = false;
      let terminalError: string | null = null;

      const onAbort = () => {
        void upstreamReader.cancel().catch(() => undefined);
      };

      req.signal.addEventListener("abort", onAbort);

      const emit = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(sseData(payload))
          );
        } catch {
          // Client may have disconnected.
        }
      };

      const processEvent = (event: string): boolean => {
        const dataLines = getSseDataLines(event);

        if (dataLines.length === 0) {
          return false;
        }

        // SSE combines multiple data lines into one event payload.
        const payload = dataLines.join("\n").trim();

        if (!payload) {
          return false;
        }

        if (payload === "[DONE]") {
          streamEnded = true;
          return true;
        }

        let parsed: unknown;

        try {
          parsed = JSON.parse(payload);
        } catch {
          terminalError =
            "Gemini returned an invalid streaming event.";

          console.error(
            "Invalid Gemini SSE JSON:",
            payload
          );

          return true;
        }

        const providerError =
          getProviderErrorMessageFromData(parsed);

        if (providerError) {
          terminalError = providerError;
          return true;
        }

        const blockReason =
          getBlockReason(parsed);

        if (blockReason) {
          terminalError =
            `Response blocked: ${blockReason}`;

          return true;
        }

        const finishReason =
          getFinishReason(parsed);

        if (
          finishReason &&
          !extractDeltaText(parsed)
        ) {
          const normalized =
            finishReason.toUpperCase();

          if (normalized !== "STOP") {
            terminalError =
              `Gemini ended the response with finish reason: ${finishReason}.`;

            return true;
          }
        }

        const delta =
          extractDeltaText(parsed);

        if (delta) {
          sawAnyText = true;

          emit({
            delta,
          });
        }

        return false;
      };

      const processBufferedEvents = (
        flush = false
      ) => {
        /*
         * Normalize all newline styles before parsing.
         *
         * Handles:
         *   \n\n
         *   \r\n\r\n
         *   \r\r
         *   CRLF split across network chunks
         */
        buffer = buffer
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");

        const frames =
          buffer.split("\n\n");

        buffer =
          frames.pop() ?? "";

        for (const frame of frames) {
          if (processEvent(frame)) {
            return true;
          }
        }

        /*
         * SSE allows the stream to end without a final blank line.
         * Never silently throw away the remaining event.
         */
        if (
          flush &&
          buffer.trim()
        ) {
          const finalEvent =
            buffer;

          buffer = "";

          return processEvent(
            finalEvent
          );
        }

        return false;
      };

      try {
        outer: while (!streamEnded) {
          const {
            done,
            value,
          } = await upstreamReader.read();

          if (done) {
            /*
             * Flush any UTF-8 bytes still held by TextDecoder.
             */
            buffer += decoder.decode();

            /*
             * Process every remaining SSE event,
             * including an unterminated final event.
             */
            processBufferedEvents(true);

            break;
          }

          if (value) {
            buffer += decoder.decode(
              value,
              {
                stream: true,
              }
            );

            if (
              processBufferedEvents(false)
            ) {
              break outer;
            }
          }

          if (req.signal.aborted) {
            break outer;
          }
        }

        if (req.signal.aborted) {
          return;
        }

        if (terminalError) {
          emit({
            error: terminalError,
          });

          return;
        }

        if (!sawAnyText) {
          emit({
            error:
              "Gemini completed the stream without returning any text.",
          });

          return;
        }

        /*
         * IMPORTANT:
         * done is emitted only after the complete Gemini
         * stream has been processed.
         */
        emit({
          done: true,
        });
      } catch (err) {
        if (
          isAbortError(err) ||
          req.signal.aborted
        ) {
          return;
        }

        console.error(
          "Chat stream failure:",
          err
        );

        emit({
          error:
            "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
        });
      } finally {
        req.signal.removeEventListener(
          "abort",
          onAbort
        );

        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },

    cancel() {
      void upstreamReader
        .cancel()
        .catch(() => undefined);
    },
  });

  return new Response(stream, {
    status: 200,

    headers: {
      "Content-Type":
        "text/event-stream; charset=utf-8",

      "Cache-Control":
        "no-cache, no-transform",

      Connection:
        "keep-alive",

      "X-Accel-Buffering":
        "no",
    },
  });
}

function sseData(
  payload: Record<string, unknown>
): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function getSseDataLines(
  event: string
): string[] {
  return event
    .split("\n")
    .filter((line) =>
      line.startsWith("data:")
    )
    .map((line) =>
      line.slice(5).trim()
    );
}

function validateBody(
  body: unknown
):
  | { ok: true }
  | {
      ok: false;
      reason: string;
    } {
  if (
    !body ||
    typeof body !== "object"
  ) {
    return {
      ok: false,
      reason:
        "Request body must be an object.",
    };
  }

  const messages =
    (body as ChatRequestBody)
      .messages;

  if (
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    return {
      ok: false,
      reason:
        "`messages` must be a non-empty array.",
    };
  }

  if (
    messages.length >
    MAX_HISTORY
  ) {
    return {
      ok: false,
      reason:
        "Conversation history is too long.",
    };
  }

  for (const m of messages) {
    if (
      !m ||
      typeof m !== "object" ||
      (m.role !== "user" &&
        m.role !== "assistant") ||
      typeof m.content !==
        "string" ||
      m.content.trim()
        .length === 0
    ) {
      return {
        ok: false,
        reason:
          "Each message needs a valid role and content.",
      };
    }

    if (
      m.content.length >
      MAX_MESSAGE_LENGTH
    ) {
      return {
        ok: false,
        reason:
          "A message is too long.",
      };
    }
  }

  return {
    ok: true,
  };
}

/**
 * Pulls all text from:
 *
 * candidates[0]
 *   .content
 *   .parts[]
 *   .text
 */
function extractDeltaText(
  data: unknown
): string | null {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }

  const candidates =
    (
      data as {
        candidates?: unknown;
      }
    ).candidates;

  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return null;
  }

  const first =
    candidates[0] as {
      content?: {
        parts?: Array<{
          text?: unknown;
        }>;
      };
    };

  const parts =
    first.content?.parts;

  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .map(
      (part) =>
        part?.text
    )
    .filter(
      (
        text
      ): text is string =>
        typeof text ===
        "string"
    )
    .join("");

  return text.length > 0
    ? text
    : null;
}

function getBlockReason(
  data: unknown
): string | null {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }

  const feedback =
    (
      data as {
        promptFeedback?: {
          blockReason?: unknown;
        };
      }
    ).promptFeedback;

  return typeof feedback
    ?.blockReason ===
    "string"
    ? feedback.blockReason
    : null;
}

function getFinishReason(
  data: unknown
): string | null {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }

  const candidates =
    (
      data as {
        candidates?: unknown;
      }
    ).candidates;

  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return null;
  }

  const first =
    candidates[0] as {
      finishReason?: unknown;
    };

  return typeof first.finishReason ===
    "string"
    ? first.finishReason
    : null;
}

function getProviderErrorMessageFromData(
  data: unknown
): string | null {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }

  const error =
    (
      data as {
        error?: {
          message?: unknown;
          status?: unknown;
          code?: unknown;
        };
      }
    ).error;

  if (
    !error ||
    typeof error !== "object"
  ) {
    return null;
  }

  if (
    typeof error.message ===
      "string" &&
    error.message.trim()
  ) {
    return `Gemini error: ${error.message.trim()}`;
  }

  if (
    typeof error.status ===
      "string" &&
    error.status.trim()
  ) {
    return `Gemini error: ${error.status.trim()}`;
  }

  if (
    typeof error.code ===
    "number"
  ) {
    return `Gemini error (code ${error.code}).`;
  }

  return "Gemini returned an error.";
}

function getProviderErrorMessage(
  detail: string
): string | null {
  try {
    const parsed: unknown =
      JSON.parse(detail);

    return getProviderErrorMessageFromData(
      parsed
    );
  } catch {
    return null;
  }
}

async function safeReadText(
  res: Response
): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable response body>";
  }
}

function errorResponse(
  message: string,
  status: number
) {
  const body: ChatErrorBody = {
    error: message,
  };

  return NextResponse.json(
    body,
    { status }
  );
                   }
