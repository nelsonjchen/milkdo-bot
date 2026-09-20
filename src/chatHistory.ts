import type OpenAI from "openai";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Keep tool calls and their results together, and repair histories saved by
// older versions that sliced through a tool exchange or stopped mid-write.
export function compactChatHistory(messages: Message[], limit = 20): Message[] {
  const groups: Message[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "system" || message.role === "tool") continue;
    if (message.role === "assistant" && message.tool_calls?.length) {
      const results: Message[] = [];
      while (messages[index + 1]?.role === "tool") {
        results.push(messages[++index]);
      }
      const expected = new Set(message.tool_calls.map(call => call.id));
      if (results.length !== expected.size || !results.every(result =>
        result.role === "tool" && expected.delete(result.tool_call_id)
      )) continue;
      groups.push([message, ...results]);
    } else {
      groups.push([message]);
    }
  }

  let count = groups.reduce((total, group) => total + group.length, 0);
  while (count > limit && groups.length) count -= groups.shift()!.length;
  return groups.flat();
}
