import type OpenAI from "openai";
import type { ResponseInput, ResponseOutputItem } from "openai/resources/responses/responses";
import { compactChatHistory } from "./chatHistory";

// One turn is persisted and trimmed atomically, including its reasoning, calls,
// and results. The current system prompt is supplied separately on each request.
export type ResponseHistory = ResponseInput[];

export function appendResponseTurn(history: ResponseHistory, turn: ResponseInput, limit = 20): ResponseHistory {
  const next = [...history, turn];
  let count = next.reduce((total, items) => total + items.length, 0);
  while (count > limit && next.length > 1) count -= next.shift()!.length;
  return next;
}

export function migrateChatHistory(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): ResponseHistory {
  const valid = compactChatHistory(messages);
  let history: ResponseHistory = [];
  for (let index = 0; index < valid.length; index++) {
    const message = valid[index];
    const turn: ResponseInput = [];
    if (message.role === "user" || message.role === "assistant") {
      if (typeof message.content === "string" && message.content) {
        turn.push({ role: message.role, content: message.role === "user" && message.name
          ? `${message.name}: ${message.content}` : message.content });
      }
      if (message.role === "assistant" && message.tool_calls?.length) {
        turn.push(...message.tool_calls.map(call => ({
          type: "function_call" as const, call_id: call.id,
          name: call.function.name, arguments: call.function.arguments,
        })));
        while (valid[index + 1]?.role === "tool") {
          const result = valid[++index];
          if (result.role === "tool") turn.push({
            type: "function_call_output", call_id: result.tool_call_id,
            output: typeof result.content === "string" ? result.content : JSON.stringify(result.content),
          });
        }
      }
    }
    if (turn.length) history = appendResponseTurn(history, turn);
  }
  return history;
}

// Keep only request-compatible fields, including encrypted reasoning for
// stateless continuation (store:false). Never discard reasoning on tool turns.
export function responseOutputToInput(output: ResponseOutputItem[]): ResponseInput {
  return output.map(item => {
    switch (item.type) {
      case "reasoning":
        return { type: item.type, id: item.id, summary: item.summary,
          ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}) };
      case "function_call":
        return { type: item.type, ...(item.id ? { id: item.id } : {}),
          call_id: item.call_id, name: item.name, arguments: item.arguments };
      case "message":
        return { type: item.type, id: item.id, role: item.role, status: item.status,
          content: item.content.map(content => content.type === "output_text"
            ? { type: content.type, text: content.text, annotations: content.annotations }
            : { type: content.type, refusal: content.refusal }) };
      default:
        throw new Error(`Unexpected response item: ${item.type}`);
    }
  });
}
