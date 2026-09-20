import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { compactChatHistory } from "./chatHistory";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
const user: Message = { role: "user", content: "napa cabbage" };
const call: Message = {
  role: "assistant", content: null,
  tool_calls: [{ id: "add-1", type: "function", function: {
    name: "addShoppingListItems", arguments: '{"items":[{"name":"Cabbage"}]}',
  } }],
};
const result: Message = { role: "tool", tool_call_id: "add-1", content: "Added cabbage" };

describe("chat history", () => {
  it("does not leave an orphan result when the 20-message boundary cuts a tool exchange", () => {
    const history = [call, result, ...Array.from({ length: 19 }, () => user)];
    expect(compactChatHistory(history)).toEqual(Array.from({ length: 19 }, () => user));
  });

  it("repairs orphan results already persisted by an older worker", () => {
    expect(compactChatHistory([result, user])).toEqual([user]);
  });

  it("removes incomplete calls after an interrupted write", () => {
    expect(compactChatHistory([call, user])).toEqual([user]);
  });

  it("retains a complete exchange and the latest user message", () => {
    expect(compactChatHistory([user, call, result, user])).toEqual([user, call, result, user]);
  });

  it("discards a partial parallel tool exchange", () => {
    const multi: Message = { ...call, tool_calls: [
      ...call.tool_calls!, { ...call.tool_calls![0], id: "add-2" },
    ] };
    expect(compactChatHistory([multi, result, user])).toEqual([user]);
  });

  it("drops mismatched and duplicate results", () => {
    expect(compactChatHistory([call, { ...result, tool_call_id: "wrong" }, user])).toEqual([user]);
    expect(compactChatHistory([call, result, result, user])).toEqual([user]);
  });
});
