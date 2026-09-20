import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reply: vi.fn(), typing: vi.fn(), completion: vi.fn(), appendInputTurn: vi.fn(), addTask: vi.fn(),
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
      tools: expect.arrayContaining([expect.objectContaining({ type: "function", name: "addShoppingListItems", strict: false })]),
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
