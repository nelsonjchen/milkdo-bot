import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reply: vi.fn(), typing: vi.fn(), completion: vi.fn(), pushMessage: vi.fn(),
  pushMessages: vi.fn(), addTask: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
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
  chat = { completions: { create: mocks.completion } };
} }));
vi.mock("replicate", () => ({ default: class {} }));
vi.mock("@doist/todoist-api-typescript", () => ({ TodoistApi: class {
  addTask = mocks.addTask;
} }));
vi.mock("ts-retry-promise", () => ({ retry: (action: () => unknown) => action() }));

import worker, { type Env } from "./index";

const env = {
  WHITELISTED_USERS: "42",
  CHAT_DO: { idFromName: (name: string) => name, get: () => ({
    pushMessage: mocks.pushMessage, pushMessages: mocks.pushMessages,
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
  mocks.pushMessage.mockResolvedValue([{ role: "user", content: "napa cabbage" }]);
  mocks.completion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: "Hello" } }] });
});

describe("queue failures", () => {
  it("disables reasoning for Luna tool calls on Chat Completions", async () => {
    await run([queuedMessage(1)]);
    expect(mocks.completion).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      reasoning_effort: "none",
      tools: expect.arrayContaining([expect.objectContaining({ type: "function" })]),
    }));
  });

  it("adds a tool-requested item, replies, and stores the complete tool exchange", async () => {
    mocks.completion.mockResolvedValue({ choices: [{ message: {
      role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: {
        name: "addShoppingListItems", arguments: JSON.stringify({ items: [{ name: "Napa Cabbage 🥬" }] }),
      } }],
    } }] });
    const message = queuedMessage(1);
    await run([message]);
    expect(mocks.addTask).toHaveBeenCalledOnce();
    expect(mocks.addTask).toHaveBeenCalledWith(expect.objectContaining({ content: "Napa Cabbage 🥬" }));
    expect(mocks.reply.mock.calls[0][0]).toContain("Added the following item(s)");
    expect(mocks.pushMessages).toHaveBeenCalledWith([
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({ role: "tool", tool_call_id: "call-1" }),
    ], expect.any(Number));
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
    mocks.completion.mockResolvedValue({ choices: [{ message: { content: null } }] });
    await run([queuedMessage(1)]);
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
