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

/** Successful response shape from POST /api/chat */
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

/**
 * Creates a locally-unique id for a chat message.
 * Good enough for client-side React keys; not for database primary keys.
 */
export function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
