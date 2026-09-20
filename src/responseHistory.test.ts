import { describe, expect, it } from "vitest";
import type { ResponseInput, ResponseOutputItem } from "openai/resources/responses/responses";
import { appendResponseTurn, migrateChatHistory, responseOutputToInput } from "./responseHistory";

const output: ResponseOutputItem[] = [
  { type: "reasoning", id: "rs-1", summary: [], encrypted_content: "encrypted" },
  { type: "function_call", id: "fc-1", call_id: "call-1", name: "addShoppingListItems", arguments: "{}" },
];
const toolTurn: ResponseInput = [
  ...responseOutputToInput(output),
  { type: "function_call_output", call_id: "call-1", output: "Added cabbage" },
];

describe("Responses history migration", () => {
  it("migrates existing named users and complete tool exchanges without stale system dates", () => {
    expect(migrateChatHistory([
      { role: "system", content: "Yesterday's date" },
      { role: "user", content: "napa cabbage", name: "Nelson" },
      { role: "assistant", content: null, tool_calls: [{ type: "function", id: "call-1",
        function: { name: "addShoppingListItems", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-1", content: "Added cabbage" },
    ])).toEqual([
      [{ role: "user", content: "Nelson: napa cabbage" }],
      [
        { type: "function_call", call_id: "call-1", name: "addShoppingListItems", arguments: "{}" },
        { type: "function_call_output", call_id: "call-1", output: "Added cabbage" },
      ],
    ]);
  });

  it("repairs broken legacy exchanges before conversion", () => {
    expect(migrateChatHistory([
      { role: "tool", tool_call_id: "orphan", content: "Done" },
      { role: "user", content: "hello" },
    ])).toEqual([[{ role: "user", content: "hello" }]]);
  });

  it("preserves encrypted reasoning alongside tool calls and results", () => {
    expect(appendResponseTurn([], toolTurn)).toEqual([toolTurn]);
    expect(toolTurn[0]).toEqual(output[0]);
  });

  it("trims whole tool turns instead of orphaning results or reasoning", () => {
    const users: ResponseInput[] = Array.from({ length: 18 }, () => [{ role: "user", content: "hello" }]);
    const latest: ResponseInput = [{ role: "user", content: "turnip" }];
    expect(appendResponseTurn([toolTurn, ...users], latest)).toEqual([...users, latest]);
  });

  it("retains the complete newest turn even when it exceeds the history budget", () => {
    expect(appendResponseTurn([[{ role: "user", content: "hello" }]], toolTurn, 2)).toEqual([toolTurn]);
  });

  it("keeps assistant text and refusal content in response history", () => {
    const message: ResponseOutputItem = { type: "message", id: "msg-1", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "Hello", annotations: [] }, { type: "refusal", refusal: "Cannot do that" }] };
    expect(responseOutputToInput([message])).toEqual([message]);
  });
});
