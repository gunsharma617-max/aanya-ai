/**
 * Shared types for Aanya AI.
 *
 * Keeping these in one place means the frontend and the API route
 * agree on shape without duplicating type definitions.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

/** Body shape the client sends to POST /api/chat */
export interface ChatRequestBody {
  messages: Pick<ChatMessage, "role" | "content">[];
}

/** Successful (non-streaming) response shape — kept for reference/back-compat. */
export interface ChatResponseBody {
  message: {
    role: "assistant";
    content: string;
  };
}

/** Error response shape from POST /api/chat */
export interface ChatErrorBody {
  error: string;
}

/** One Server-Sent Event emitted by POST /api/chat. */
export interface ChatStreamEvent {
  delta?: string;
  done?: boolean;
  error?: string;
}

/**
 * Creates a locally-unique id for a chat message.
 * Good enough for client-side React keys; not for database primary keys.
 */
export function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** True if `err` is a fetch/stream abort triggered by our own cancellation. */
export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
