import { NextRequest, NextResponse } from "next/server";
import { AANYA_SYSTEM_PROMPT } from "@/prompts/aanya-master-prompt";
import type { ChatRequestBody, ChatResponseBody, ChatErrorBody } from "@/lib/aanya";

export const runtime = "nodejs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_MESSAGE_LENGTH = 8000;
const MAX_HISTORY = 40;

/**
 * POST /api/chat
 *
 * Accepts the running conversation, prepends Aanya's system prompt,
 * forwards it to the configured AI provider, and returns the reply.
 * The API key never leaves this server-side route.
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

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: AANYA_SYSTEM_PROMPT,
        messages: body.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!upstream.ok) {
      const detail = await safeReadText(upstream);
      console.error("AI provider error:", upstream.status, detail);
      return errorResponse(
        "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
        502
      );
    }

    const data = await upstream.json();
    const text = extractText(data);

    if (!text) {
      console.error("Unexpected AI provider response shape:", data);
      return errorResponse(
        "Sorry Boss, I got a response I couldn't understand. Please try again.",
        502
      );
    }

    const responseBody: ChatResponseBody = {
      message: { role: "assistant", content: text },
    };
    return NextResponse.json(responseBody, { status: 200 });
  } catch (err) {
    console.error("Chat route failure:", err);
    return errorResponse(
      "Sorry Boss, I couldn't connect to my AI brain right now. Please try again.",
      500
    );
  }
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

/** Pulls the assistant's text out of an Anthropic Messages API response. */
function extractText(data: unknown): string | null {
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { content?: unknown }).content)
  ) {
    return null;
  }
  const blocks = (data as { content: { type: string; text?: string }[] }).content;
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
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
