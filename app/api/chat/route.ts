import { NextRequest } from "next/server";
import { AANYA_SYSTEM_PROMPT } from "@/prompts/aanya-master-prompt";
import type {
  ChatRequestBody,
  ChatErrorBody,
} from "@/lib/aanya";
import { isAbortError } from "@/lib/aanya";

export const runtime = "nodejs";

const DEFAULT_MODEL =
  "deepseek-ai/deepseek-v4-pro-0813";

const MAX_MESSAGE_LENGTH = 8000;
const MAX_HISTORY = 40;

type NvidiaStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
    };
    finish_reason?: unknown;
  }>;
};

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;

  // ------------------------------------------------------------
  // 1. Read request body
  // ------------------------------------------------------------

  try {
    body = await req.json();
  } catch {
    return errorResponse(
      "Malformed request body.",
      400
    );
  }

  // ------------------------------------------------------------
  // 2. Validate request
  // ------------------------------------------------------------

  const validation = validateBody(body);

  if (!validation.ok) {
    return errorResponse(
      validation.reason,
      400
    );
  }

  // ------------------------------------------------------------
  // 3. NVIDIA credentials
  // ------------------------------------------------------------

  const apiKey =
    process.env.NVIDIA_API_KEY?.trim();

  if (!apiKey) {
    console.error(
      "NVIDIA_API_KEY is not set."
    );

    return errorResponse(
      "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
      500
    );
  }

  const model =
    (
      process.env.NVIDIA_MODEL?.trim() ||
      DEFAULT_MODEL
    ).trim();

  // ------------------------------------------------------------
  // 4. NVIDIA OpenAI-compatible endpoint
  // ------------------------------------------------------------

  const url =
    "https://integrate.api.nvidia.com/v1/chat/completions";

  let upstream: Response;

  try {
    upstream = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },

      signal: req.signal,

      body: JSON.stringify({
        model,

        messages: [
          {
            role: "system",
            content: AANYA_SYSTEM_PROMPT,
          },

          ...body.messages.map((message) => ({
            role:
              message.role === "assistant"
                ? "assistant"
                : "user",

            content: message.content,
          })),
        ],

        temperature: 0.7,
        top_p: 0.95,

        max_tokens: 16384,

        // Disable DeepSeek thinking/reasoning output
        // so only Aanya's actual answer is streamed.
        chat_template_kwargs: {
          thinking: false,
        },

        stream: true,
      }),
    });
  } catch (error) {
    if (
      isAbortError(error) ||
      req.signal.aborted
    ) {
      return new Response(null, {
        status: 499,
      });
    }

    console.error(
      "NVIDIA provider network failure:",
      error
    );

    return errorResponse(
      "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
      500
    );
  }

  // ------------------------------------------------------------
  // 5. Handle NVIDIA HTTP errors
  // ------------------------------------------------------------

  if (!upstream.ok || !upstream.body) {
    const detail =
      await safeReadText(upstream);

    console.error(
      "NVIDIA provider error:",
      upstream.status,
      detail
    );

    return errorResponse(
      getProviderErrorMessage(detail) ??
        "Sorry Boss, NVIDIA's AI service returned an error. Please try again.",
      502
    );
  }

  // ------------------------------------------------------------
  // 6. Convert NVIDIA SSE → Aanya SSE
  // ------------------------------------------------------------

  const encoder =
    new TextEncoder();

  const reader =
    upstream.body.getReader();

  const decoder =
    new TextDecoder();

  const stream =
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";

        let sawAnyText = false;
        let streamEnded = false;

        let terminalError:
          | string
          | null = null;

        // ------------------------------------------------------
        // Abort NVIDIA request when browser cancels request
        // ------------------------------------------------------

        const onAbort = () => {
          void reader
            .cancel()
            .catch(() => undefined);
        };

        req.signal.addEventListener(
          "abort",
          onAbort
        );

        // ------------------------------------------------------
        // Send SSE event to Aanya frontend
        // ------------------------------------------------------

        const emit = (
          payload: Record<string, unknown>
        ) => {
          try {
            controller.enqueue(
              encoder.encode(
                sseData(payload)
              )
            );
          } catch {
            // Client disconnected.
          }
        };

        // ------------------------------------------------------
        // Process one NVIDIA SSE event
        // ------------------------------------------------------

        const processEvent = (
          event: string
        ): boolean => {
          const dataLines =
            getSseDataLines(event);

          if (
            dataLines.length === 0
          ) {
            return false;
          }

          const payload =
            dataLines
              .join("\n")
              .trim();

          if (!payload) {
            return false;
          }

          // NVIDIA/OpenAI-compatible
          // stream termination.
          if (
            payload === "[DONE]"
          ) {
            streamEnded = true;
            return true;
          }

          let parsed:
            | NvidiaStreamChunk
            | {
                error?: {
                  message?: unknown;
                  type?: unknown;
                  code?: unknown;
                };
              };

          try {
            parsed =
              JSON.parse(payload);
          } catch {
            terminalError =
              "NVIDIA returned an invalid streaming event.";

            console.error(
              "Invalid NVIDIA SSE JSON:",
              payload
            );

            return true;
          }

          // ----------------------------------------------------
          // Provider error inside SSE
          // ----------------------------------------------------

          const providerError =
            getProviderErrorMessageFromData(
              parsed
            );

          if (providerError) {
            terminalError =
              providerError;

            return true;
          }

          // ----------------------------------------------------
          // Extract normal assistant text
          // ----------------------------------------------------

          const delta =
            extractDeltaText(parsed);

          if (delta) {
            sawAnyText = true;

            emit({
              delta,
            });
          }

          // ----------------------------------------------------
          // Check finish reason
          // ----------------------------------------------------

          const finishReason =
            getFinishReason(parsed);

          if (
            finishReason &&
            finishReason !== "stop" &&
            finishReason !== "length"
          ) {
            terminalError =
              `NVIDIA ended the response with finish reason: ${finishReason}.`;

            return true;
          }

          return false;
        };

        // ------------------------------------------------------
        // Process buffered SSE events
        // ------------------------------------------------------

        const processBufferedEvents = (
          flush = false
        ): boolean => {
          while (true) {
            const delimiter =
              findSseDelimiter(buffer);

            if (
              delimiter === -1
            ) {
              break;
            }

            const event =
              buffer.slice(
                0,
                delimiter
              );

            buffer =
              buffer.slice(
                delimiter +
                  sseDelimiterLength(
                    buffer,
                    delimiter
                  )
              );

            if (
              processEvent(event)
            ) {
              return true;
            }
          }

          // Some providers can close the connection
          // without a final blank line.
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

        // ------------------------------------------------------
        // Read NVIDIA stream
        // ------------------------------------------------------

        try {
          outer: while (
            !streamEnded
          ) {
            const {
              done,
              value,
            } =
              await reader.read();

            if (done) {
              buffer +=
                decoder.decode();

              processBufferedEvents(
                true
              );

              break;
            }

            if (value) {
              buffer +=
                decoder.decode(
                  value,
                  {
                    stream: true,
                  }
                );

              if (
                processBufferedEvents(
                  false
                )
              ) {
                break outer;
              }
            }

            if (
              req.signal.aborted
            ) {
              break outer;
            }
          }

          // ----------------------------------------------------
          // Request was cancelled by user
          // ----------------------------------------------------

          if (
            req.signal.aborted
          ) {
            return;
          }

          // ----------------------------------------------------
          // Provider returned an error
          // ----------------------------------------------------

          if (terminalError) {
            emit({
              error:
                terminalError,
            });

            return;
          }

          // ----------------------------------------------------
          // Nothing came back
          // ----------------------------------------------------

          if (!sawAnyText) {
            emit({
              error:
                "NVIDIA completed the stream without returning any text.",
            });

            return;
          }

          // ----------------------------------------------------
          // Normal completion
          // ----------------------------------------------------

          emit({
            done: true,
          });
        } catch (error) {
          if (
            isAbortError(error) ||
            req.signal.aborted
          ) {
            return;
          }

          console.error(
            "NVIDIA chat stream failure:",
            error
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
        void reader
          .cancel()
          .catch(() => undefined);
      },
    });

  // ------------------------------------------------------------
  // 7. Return SSE response to AanyaChat.tsx
  // ------------------------------------------------------------

  return new Response(
    stream,
    {
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
    }
  );
}

// ============================================================
// SSE HELPERS
// ============================================================

function sseData(
  payload: Record<string, unknown>
): string {
  return `data: ${JSON.stringify(
    payload
  )}\n\n`;
}

function getSseDataLines(
  event: string
): string[] {
  return event
    .split(/\r\n|\n|\r/)
    .filter((line) =>
      line.startsWith("data:")
    )
    .map((line) =>
      line.slice(5).trim()
    );
}

function findSseDelimiter(
  value: string
): number {
  let best = -1;

  for (
    const delimiter of [
      "\r\n\r\n",
      "\n\n",
      "\r\r",
    ]
  ) {
    const index =
      value.indexOf(
        delimiter
      );

    if (
      index !== -1 &&
      (
        best === -1 ||
        index < best
      )
    ) {
      best = index;
    }
  }

  return best;
}

function sseDelimiterLength(
  value: string,
  index: number
): number {
  if (
    value.startsWith(
      "\r\n\r\n",
      index
    )
  ) {
    return 4;
  }

  if (
    value.startsWith(
      "\n\n",
      index
    )
  ) {
    return 2;
  }

  return 2;
}

// ============================================================
// NVIDIA RESPONSE PARSING
// ============================================================

function extractDeltaText(
  data: unknown
): string | null {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return null;
  }

  const choices =
    (
      data as {
        choices?: unknown;
      }
    ).choices;

  if (
    !Array.isArray(
      choices
    ) ||
    choices.length === 0
  ) {
    return null;
  }

  const first =
    choices[0] as {
      delta?: {
        content?: unknown;
      };
    };

  const content =
    first.delta?.content;

  return typeof content ===
    "string" &&
    content.length > 0
    ? content
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

  const choices =
    (
      data as {
        choices?: unknown;
      }
    ).choices;

  if (
    !Array.isArray(
      choices
    ) ||
    choices.length === 0
  ) {
    return null;
  }

  const first =
    choices[0] as {
      finish_reason?: unknown;
    };

  return typeof first.finish_reason ===
    "string"
    ? first.finish_reason
    : null;
}

// ============================================================
// NVIDIA ERROR PARSING
// ============================================================

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
          type?: unknown;
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
    return `NVIDIA error: ${error.message.trim()}`;
  }

  if (
    typeof error.type ===
      "string" &&
    error.type.trim()
  ) {
    return `NVIDIA error: ${error.type.trim()}`;
  }

  if (
    typeof error.code ===
      "string" &&
    error.code.trim()
  ) {
    return `NVIDIA error: ${error.code.trim()}`;
  }

  if (
    typeof error.code ===
      "number"
  ) {
    return `NVIDIA error (code ${error.code}).`;
  }

  return "NVIDIA returned an error.";
}

function getProviderErrorMessage(
  detail: string
): string | null {
  try {
    const parsed =
      JSON.parse(detail);

    return getProviderErrorMessageFromData(
      parsed
    );
  } catch {
    // Sometimes provider errors are
    // returned as plain text.
    const cleaned =
      detail.trim();

    if (
      cleaned &&
      cleaned.length < 500
    ) {
      return `NVIDIA error: ${cleaned}`;
    }

    return null;
  }
}

// ============================================================
// SAFE RESPONSE READER
// ============================================================

async function safeReadText(
  res: Response
): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable response body>";
  }
}

// ============================================================
// REQUEST VALIDATION
// ============================================================

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
    (
      body as ChatRequestBody
    ).messages;

  if (
    !Array.isArray(
      messages
    ) ||
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

  for (
    const message of messages
  ) {
    if (
      !message ||
      typeof message !==
        "object" ||
      (
        message.role !==
          "user" &&
        message.role !==
          "assistant"
      ) ||
      typeof message.content !==
        "string" ||
      message.content.trim()
        .length === 0
    ) {
      return {
        ok: false,
        reason:
          "Each message needs a valid role and content.",
      };
    }

    if (
      message.content.length >
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

// ============================================================
// ERROR RESPONSE
// ============================================================

function errorResponse(
  message: string,
  status: number
) {
  const body: ChatErrorBody = {
    error: message,
  };

  return Response.json(
    body,
    {
      status,
    }
  );
          }
