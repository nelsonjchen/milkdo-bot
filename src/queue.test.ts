import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reply: vi.fn(), typing: vi.fn(), completion: vi.fn(), appendInputTurn: vi.fn(), addTask: vi.fn(),
  getTasks: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ DurableObject: class { constructor(public ctx: any) {} } }));
vi.mock("grammy", () => ({
  Bot: class {
    botInfo = { id: 1, is_bot: true, first_name: "Bot" };
    api = {};
    async init() {}
  },
  Context: class {
    constructor(public update: any, public api: any, public me: any) {}
    get from() { return this.update.message.from; }
    get chat() { return this.update.message.chat; }
    get message() { return this.update.message; }
    get msg() { return this.message; }
    reply = mocks.reply;
    replyWithChatAction = mocks.typing;
  },
  matchFilter: (filter: string) => () => ["message", "message:text"].includes(filter),
  webhookCallback: vi.fn(),
}));
vi.mock("openai", () => ({ default: class {
  responses = { create: mocks.completion };
} }));
vi.mock("replicate", () => ({ default: class {} }));
vi.mock("@doist/todoist-api-typescript", () => ({ TodoistApi: class {
  addTask = mocks.addTask;
  getTasks = mocks.getTasks;
  updateTask = mocks.updateTask;
  deleteTask = mocks.deleteTask;
} }));
vi.mock("ts-retry-promise", () => ({ retry: (action: () => unknown) => action() }));

import worker, { ChatDurableObject, type Env } from "./index";

const env = {
  WHITELISTED_USERS: "42",
  CHAT_DO: { idFromName: (name: string) => name, get: () => ({
    appendInputTurn: mocks.appendInputTurn,
  }) },
} as unknown as Env;
function queuedMessage(id: number) {
  return {
    body: { context: { update: { update_id: id, message: {
      message_id: id, text: "napa cabbage", from: { id: 42, first_name: "Test" }, chat: { id: 42 },
    } }, me: {} } }, ack: vi.fn(), retry: vi.fn(),
  };
}
async function run(messages: ReturnType<typeof queuedMessage>[]) {
  await worker.queue({ messages } as any, env, {} as ExecutionContext);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.reply.mockResolvedValue({});
  mocks.typing.mockResolvedValue(true);
  mocks.appendInputTurn.mockResolvedValue([{ role: "user", content: "napa cabbage" }]);
  mocks.completion.mockResolvedValue({ status: "completed", output_text: "Hello", output: [{
    type: "message", id: "msg-1", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "Hello", annotations: [] }],
  }] });
});

describe("queue failures", () => {
  it("uses Responses with reasoning and stateless reasoning continuity", async () => {
    await run([queuedMessage(1)]);
    expect(mocks.completion).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      store: false,
      include: ["reasoning.encrypted_content"],
      tools: expect.arrayContaining([
        expect.objectContaining({ type: "function", name: "addShoppingListItems", strict: false }),
        expect.objectContaining({ type: "function", name: "updateShoppingListItem", strict: false }),
        expect.objectContaining({ type: "function", name: "deleteShoppingListItem", strict: false }),
      ]),
    }));
  });

  it("adds a tool-requested item, replies, and stores the complete tool exchange", async () => {
    mocks.completion.mockResolvedValue({ status: "completed", output: [
      { type: "reasoning", id: "rs-1", summary: [], encrypted_content: "encrypted-reasoning" },
      { type: "function_call", id: "fc-1", call_id: "call-1", name: "addShoppingListItems",
        arguments: JSON.stringify({ items: [{ name: "Napa Cabbage 🥬" }] }) },
    ] });
    const message = queuedMessage(1);
    await run([message]);
    expect(mocks.addTask).toHaveBeenCalledOnce();
    expect(mocks.addTask).toHaveBeenCalledWith(expect.objectContaining({ content: "Napa Cabbage 🥬" }));
    expect(mocks.reply.mock.calls[0][0]).toContain("Added the following item(s)");
    expect(mocks.appendInputTurn).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: "reasoning", encrypted_content: "encrypted-reasoning" }),
      expect.objectContaining({ type: "function_call", call_id: "call-1" }),
      expect.objectContaining({ type: "function_call_output", call_id: "call-1" }),
    ]);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("replies on model failure, acknowledges it, and continues the batch", async () => {
    mocks.completion.mockRejectedValueOnce(new Error("Invalid tool history"));
    const first = queuedMessage(1), second = queuedMessage(2);
    await run([first, second]);
    expect(mocks.reply.mock.calls[0][0]).toContain("couldn't finish processing");
    expect(mocks.reply.mock.calls[1][0]).toBe("Hello");
    expect(first.ack).toHaveBeenCalledOnce();
    expect(second.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
  });

  it("replies when the model returns empty content", async () => {
    mocks.completion.mockResolvedValue({ status: "completed", output: [], output_text: "" });
    await run([queuedMessage(1)]);
    expect(mocks.reply.mock.calls[0][0]).toContain("couldn't finish processing");
  });

  it("does not execute tool calls from an incomplete response", async () => {
    mocks.completion.mockResolvedValue({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "function_call", call_id: "call-1", name: "addShoppingListItems", arguments: '{"items":[{"name":"Cabbage"}]}' }] });
    await run([queuedMessage(1)]);
    expect(mocks.addTask).not.toHaveBeenCalled();
    expect(mocks.reply.mock.calls[0][0]).toContain("couldn't finish processing");
  });

  it("continues processing when the typing indicator fails", async () => {
    mocks.typing.mockRejectedValue(new Error("Typing unavailable"));
    await run([queuedMessage(1)]);
    expect(mocks.reply.mock.calls[0][0]).toBe("Hello");
  });

  it("retries only the message whose error reply could not be delivered", async () => {
    mocks.completion.mockRejectedValueOnce(new Error("Model unavailable"));
    mocks.reply.mockRejectedValueOnce(new Error("Telegram unavailable"));
    const first = queuedMessage(1), second = queuedMessage(2);
    await run([first, second]);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    expect(second.ack).toHaveBeenCalledOnce();
  });
});

describe("Durable Object Responses storage", () => {
  function storageFixture() {
    const values = new Map<string, unknown>([["messages", [
      { role: "system", content: "Old date" },
      { role: "user", content: "milk", name: "Test" },
      { role: "assistant", content: "Added milk" },
    ]]]);
    const storage = {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => { values.set(key, value); },
      delete: async (key: string) => values.delete(key),
      transaction: async (callback: (txn: unknown) => unknown) => callback(storage),
    };
    const object = new ChatDurableObject({ storage } as unknown as DurableObjectState, env);
    return { object, values };
  }

  it("migrates once and preserves subsequent Responses turns across calls", async () => {
    const { object, values } = storageFixture();
    const first = await object.appendInputTurn([{ role: "user", content: "napa cabbage" }]);
    expect(first).toEqual([
      { role: "user", content: "Test: milk" },
      { role: "assistant", content: "Added milk" },
      { role: "user", content: "napa cabbage" },
    ]);
    expect(values.has("messages")).toBe(true);
    const second = await object.appendInputTurn([{ role: "assistant", content: "Added cabbage" }]);
    expect(second).toEqual([...first, { role: "assistant", content: "Added cabbage" }]);
  });

  it("clears both history formats so legacy messages cannot reappear", async () => {
    const { object, values } = storageFixture();
    await object.appendInputTurn([{ role: "user", content: "cabbage" }]);
    expect(await object.clearHistory()).toBe(3);
    expect(values.has("messages")).toBe(false);
    expect(await object.getResponseHistory()).toEqual([]);
    expect(await object.appendInputTurn([{ role: "user", content: "hello" }])).toEqual([
      { role: "user", content: "hello" },
    ]);
  });
});

describe("shopping-list changes through the queue", () => {
  function callTool(name: string, args: object) {
    mocks.completion.mockResolvedValue({ status: "completed", output: [{
      type: "function_call", id: "fc-1", call_id: "call-1", name,
      arguments: JSON.stringify(args),
    }] });
    mocks.getTasks.mockResolvedValue({ results: [{ id: "milk-1", content: "Milk 🥛" }], nextCursor: null });
  }

  it("deletes and records a successful tool result", async () => {
    callTool("deleteShoppingListItem", { itemName: "milk" });
    mocks.deleteTask.mockResolvedValue(true);
    const message = queuedMessage(1);
    await run([message]);
    expect(mocks.deleteTask).toHaveBeenCalledWith("milk-1");
    expect(mocks.reply).toHaveBeenCalledWith("Deleted Milk 🥛 from your shopping list.");
    expect(mocks.appendInputTurn).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: "function_call" }),
      expect.objectContaining({ type: "function_call_output", output: "Deleted Milk 🥛 from your shopping list." }),
    ]);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("reschedules an existing item with a Pacific date and time", async () => {
    callTool("updateShoppingListItem", { itemName: "milk", dueDate: "2026-09-22", dueTime: "17:00" });
    mocks.updateTask.mockResolvedValue({ id: "milk-1", content: "Milk 🥛" });
    await run([queuedMessage(1)]);
    expect(mocks.updateTask).toHaveBeenCalledWith("milk-1", { dueString: "2026-09-22 at 17:00 America/Los_Angeles" });
    expect(mocks.addTask).not.toHaveBeenCalled();
    expect(mocks.reply.mock.calls[0][0]).toContain("5:00 PM (Pacific time)");
  });

  it("rejects invalid dates without changing the list", async () => {
    callTool("updateShoppingListItem", { itemName: "milk", dueDate: "2026-02-30" });
    await run([queuedMessage(1)]);
    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(mocks.reply.mock.calls[0][0]).toContain("couldn't interpret the due date");
  });

  it("reports deletion failures without claiming success", async () => {
    callTool("deleteShoppingListItem", { itemName: "milk" });
    mocks.deleteTask.mockRejectedValue(new Error("Todoist unavailable"));
    await run([queuedMessage(1)]);
    expect(mocks.reply.mock.calls[0][0]).toContain("couldn't delete");
  });

  it("asks which duplicate and then accepts the selected ID", async () => {
    callTool("deleteShoppingListItem", { itemName: "milk" });
    mocks.getTasks.mockResolvedValue({ results: [
      { id: "milk-1", content: "Milk 🥛", due: { date: "2026-09-21" } },
      { id: "milk-2", content: "Milk 🥛", due: { date: "2026-09-22" } },
    ], nextCursor: null });
    await run([queuedMessage(1)]);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
    expect(mocks.reply.mock.calls[0][0]).toContain("2026-09-22; ID: milk-2");
    mocks.completion.mockResolvedValue({ status: "completed", output: [{
      type: "function_call", id: "fc-2", call_id: "call-2", name: "deleteShoppingListItem",
      arguments: JSON.stringify({ itemName: "milk", taskId: "milk-2" }),
    }] });
    mocks.deleteTask.mockResolvedValue(true);
    await run([queuedMessage(2)]);
    expect(mocks.deleteTask).toHaveBeenCalledWith("milk-2");
  });
});

describe("read then edit workflow", () => {
  it("feeds a fresh list result back to the model before renaming", async () => {
    mocks.getTasks.mockResolvedValue({ results: [{ id: "1", content: "Milk 🥛", description: "Whole" }], nextCursor: null });
    mocks.updateTask.mockResolvedValue({ id: "1", content: "Oat milk 🥛" });
    mocks.completion.mockResolvedValueOnce({ status: "completed", output: [{
      type: "function_call", id: "fc-read", call_id: "call-read", name: "listShoppingListItems", arguments: '{}',
    }] }).mockResolvedValueOnce({ status: "completed", output: [{
      type: "function_call", id: "fc-edit", call_id: "call-edit", name: "updateShoppingListItem",
      arguments: JSON.stringify({ itemName: "Milk", taskId: "1", name: "Oat milk 🥛" }),
    }] });
    mocks.appendInputTurn.mockImplementation(async (turn) => turn);
    await run([queuedMessage(1)]);
    expect(mocks.completion).toHaveBeenCalledTimes(2);
    expect(mocks.completion.mock.calls[1][0].input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call_output", call_id: "call-read", output: expect.stringContaining('"name":"Milk 🥛"') }),
    ]));
    expect(mocks.updateTask).toHaveBeenCalledWith("1", { content: "Oat milk 🥛" });
    expect(mocks.reply).toHaveBeenCalledWith("Updated Oat milk 🥛.");
  });

  it("answers a list request from tool results", async () => {
    mocks.getTasks.mockResolvedValue({ results: [], nextCursor: null });
    mocks.completion.mockResolvedValueOnce({ status: "completed", output: [{
      type: "function_call", id: "fc-read", call_id: "call-read", name: "listShoppingListItems", arguments: '{}',
    }] }).mockResolvedValueOnce({ status: "completed", output_text: "Your shopping list is empty.", output: [{
      type: "message", id: "msg-1", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "Your shopping list is empty.", annotations: [] }],
    }] });
    await run([queuedMessage(1)]);
    expect(mocks.reply).toHaveBeenCalledWith("Your shopping list is empty.", expect.anything());
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });
});
