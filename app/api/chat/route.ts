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
 * Streams Aanya's reply back as Server-Sent Events so the UI can render
 * text progressively and start TTS on the first finished sentence
 * instead of waiting for the whole reply to finish generating.
 *
 * Each event body is JSON:
 *   {"delta": "..."}   — a chunk of new text
 *   {"done": true}     — the reply is complete
 *   {"error": "..."}   — something failed; text so far (if any) is real
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

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    console.error("AI_API_KEY is not set.");
    return errorResponse(
      "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
      500
    );
  }

  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent` +
    `?alt=sse&key=${apiKey}`;

  let upstream: Response;

  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    console.error("AI provider error:", upstream.status, detail);
    return errorResponse(
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
      let blocked = false;

      const onAbort = () => {
        try {
          upstreamReader.cancel();
        } catch {
          // Already cancelled.
        }
      };
      req.signal.addEventListener("abort", onAbort);

      try {
        outer: while (true) {
          const { done, value } = await upstreamReader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by a blank line.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;

            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            let parsed: unknown;
            try {
              parsed = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            const blockReason = getBlockReason(parsed);
            if (blockReason) {
              controller.enqueue(
                encoder.encode(sseData({ error: `Response blocked: ${blockReason}` }))
              );
              blocked = true;
              break outer;
            }

            const delta = extractDeltaText(parsed);
            if (delta) {
              sawAnyText = true;
              controller.enqueue(encoder.encode(sseData({ delta })));
            }
          }
        }

        if (!blocked) {
          if (!sawAnyText) {
            controller.enqueue(
              encoder.encode(
                sseData({
                  error:
                    "Sorry Boss, I got a response I couldn't understand. Please try again.",
                })
              )
            );
          } else {
            controller.enqueue(encoder.encode(sseData({ done: true })));
          }
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.error("Chat stream failure:", err);
          try {
            controller.enqueue(
              encoder.encode(
                sseData({
                  error:
                    "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
                })
              )
            );
          } catch {
            // Controller may already be in a bad state; nothing more to do.
          }
        }
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      try {
        upstreamReader.cancel();
      } catch {
        // Already cancelled.
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function sseData(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function validateBody(
  body: unknown
): { ok: true } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "Request body must be an object." };
  }
  const messages = (body as ChatRequestBody).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, reason: "`messages` must be a non-empty array." };
  }
  if (messages.length > MAX_HISTORY) {
    return { ok: false, reason: "Conversation history is too long." };
  }
  for (const m of messages) {
    if (
      !m ||
      typeof m !== "object" ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      m.content.trim().length === 0
    ) {
      return { ok: false, reason: "Each message needs a valid role and content." };
    }
    if (m.content.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, reason: "A message is too long." };
    }
  }
  return { ok: true };
}

/** Pulls the incremental text out of one streamGenerateContent SSE chunk. */
function extractDeltaText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const first = candidates[0] as {
    content?: { parts?: { text?: string }[] };
  };
  const parts = first.content?.parts;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .map((p) => p.text)
    .filter((t): t is string => typeof t === "string")
    .join("");

  return text.length > 0 ? text : null;
}

function getBlockReason(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const feedback = (data as { promptFeedback?: { blockReason?: string } })
    .promptFeedback;
  return feedback?.blockReason ?? null;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable response body>";
  }
}

function errorResponse(message: string, status: number) {
  const body: ChatErrorBody = { error: message };
  return NextResponse.json(body, { status });
}
