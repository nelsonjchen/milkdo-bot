import { D1Database } from '@cloudflare/workers-types'
import OpenAI from 'openai';
import { Bot, Context, Filter, matchFilter, webhookCallback } from "grammy";
import { UserFromGetMe } from "grammy/types";
import Replicate from "replicate";
import { autoQuote } from "@roziscoding/grammy-autoquote";
import { retry } from 'ts-retry-promise';
import { DurableObject } from "cloudflare:workers";
import { TodoistApi, TodoistRequestError } from "@doist/todoist-api-typescript"
import {
  formatPacificDueDate,
  resolveDueDate,
} from "./dueDates";
import {
  SHOPPING_LIST_PROJECT_ID,
  SHOPPING_LIST_SECTION_ID,
  deleteShoppingListTask,
  describeShoppingListChoices,
} from "./shoppingList";
import { getSystemPrompt } from "./systemPrompt";
import type { ResponseInput } from "openai/resources/responses/responses";
import { appendResponseTurn, migrateChatHistory, responseOutputToInput, type ResponseHistory } from "./responseHistory";
import { editShoppingListItem, listShoppingListItems, mergeShoppingListItems, type ItemChanges, type MergeItemsArguments } from "./shoppingActions";
import { shoppingTools } from "./shoppingTools";


interface WhisperOutput {
  text: string;
}


interface QueueMessage {
  context: MyContext;
}

export interface Env {
  BOT_TOKEN: string;
  REPLICATE_API_TOKEN: string;
  DB: D1Database;
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
  WHITELISTED_USERS: string;
  CHAT_DO: DurableObjectNamespace<ChatDurableObject>;
  QUEUE: Queue<QueueMessage>;
  TODOIST_API_TOKEN: string;
}

const model_process = "gpt-5.6-luna";

const replicateWhisperModel = "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;


// Flavor the context type to include sessions.
type MyContext = Context

let botInfo: UserFromGetMe | undefined = undefined;

export { getSystemPrompt } from "./systemPrompt";

interface AddShoppingListItemArguments {
  items: Array<{
    name: string;
    dueDate?: string;
    dueTime?: string;
  }>;
}

interface ShoppingListItemArguments {
  itemName: string;
  taskId?: string;
}

interface UpdateShoppingListItemArguments extends ShoppingListItemArguments, ItemChanges {}

export default {
  async fetch(request: Request, env: Env) {
    try {
      const bot = new Bot<MyContext>(env.BOT_TOKEN, { botInfo });
      bot.use(autoQuote());

      if (botInfo === undefined) {
        await bot.init();
        botInfo = bot.botInfo;
      }

      bot.command("start", (ctx) => ctx.reply(
        "Hello! I'm here to help organize "
      ));

      // This runs fast enough to not need to be queued
      bot.command("clearHistory", async (ctx) => {
        // Asking DO to clear the history for this chat.
        const doId = env.CHAT_DO.idFromName(ctx.chat.id.toString());
        // Pass it in the context
        const oldLength = await env.CHAT_DO.get(doId).clearHistory();
        await ctx.reply("History cleared! Previous length: " + oldLength);
      });

      // Handle messages in queue
      bot.on("message:text", async (ctx) => {
        await env.QUEUE.send({ context: ctx });
      });
      bot.on("message:media", async (ctx) => {
        await env.QUEUE.send({ context: ctx });
      });
      bot.on("message:voice", async (ctx) => {
        await env.QUEUE.send({ context: ctx });
      });

      const cb = webhookCallback(bot, "cloudflare-mod", "throw", 30000);
      return await cb(request);
    } catch (e: any) {
      console.error(e);
      return new Response("Unable to accept update", { status: 500 });
    }
  },

  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {

    const whitelisted_users = env.WHITELISTED_USERS.split(",");

    const replicate = new Replicate(
      {
        auth: env.REPLICATE_API_TOKEN,
      }
    );

    // Model used to process the message
    const openai_process = new OpenAI({
      baseURL: env.OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY,
      timeout: 30_000,
      maxRetries: 0,
      defaultHeaders: {
        "X-Title": "MilkdoProcess",
      },
    })

    // Create bot
    const bot = new Bot<MyContext>(env.BOT_TOKEN, { botInfo });

    // Initialize the bot
    if (botInfo === undefined) {
      await bot.init();
      botInfo = bot.botInfo;
    }

    const handleSendLongChat = async (ctx: Filter<MyContext, "message">, message: string) => {
      const sendTyping = () => ctx.replyWithChatAction("typing").catch(() => undefined);
      void sendTyping();
      const interval = setInterval(() => { void sendTyping(); }, 4000);
      try {
        await handleChat(ctx, message);
      } finally {
        clearInterval(interval);
      }
    };

    const handleChat = async (ctx: Filter<MyContext, "message">, transcribedText: string | undefined) => {
      // Use one clock snapshot for the entire request so the prompt, defaults,
      // and action results all agree about the current Pacific time.
      const requestNow = Date.now();

      // check if the whitelist user is in the list
      if (messageFilter(ctx)) {
        if (!whitelisted_users.includes(ctx.from.id.toString())) {
          console.log("User not whitelisted, ignoring", {
            from: ctx.message.from,
          });
          return;
        }
      }
      let message: string;
      if (transcribedText) {
        message = transcribedText;
      } else {
        if (ctx.message?.text) {
          message = ctx.message.text;
        } else {
          throw new Error("No message found");
        }
      }
      if (!ctx.message) {
        throw new Error("No base message found");
      }

      // Add the user message to session
      const firstName = ctx.message.from.first_name;
      let fullName = firstName;
      if (ctx.message.from.last_name) {
        fullName = `${firstName}_${ctx.message.from.last_name}`;
      }

      // Strip all all non-ASCII characters from fullName
      fullName = fullName.replace(/[^\x00-\x7F]/g, "");

      const doId = env.CHAT_DO.idFromName(ctx.chat.id.toString());
      const doInstance = env.CHAT_DO.get(doId);
      const input = await doInstance.appendInputTurn([
        { role: "user", content: `${fullName}: ${message}` },
      ]);

      // Does this message need to be processed? Is it mentioning us?
      // if (!message.includes("@Milkdo")) {
      //   return;
      // }

      const todoistAPI = new TodoistApi(env.TODOIST_API_TOKEN);

      type AddResult =
        | {
            kind: "success";
            content: string;
            date: string;
            time?: string;
          }
        | {
            kind: "failed";
            content: string;
            error: string;
          };

      const addShoppingListItems = async (items: Array<{ name: string; dueDate?: string; dueTime?: string }>): Promise<string> => {
        const addItemPromises: Promise<AddResult>[] = items.map(async (item): Promise<AddResult> => {
          const resolvedDueDate = resolveDueDate(
            item.dueDate,
            item.dueTime,
            new Date(requestNow),
          );

          if (!resolvedDueDate.ok) {
            return {
              kind: "failed",
              content: item.name,
              error: resolvedDueDate.error,
            };
          }

          try {
            await todoistAPI.addTask({
              content: item.name,
              ...resolvedDueDate.todoistArgs,
              sectionId: SHOPPING_LIST_SECTION_ID,
              projectId: SHOPPING_LIST_PROJECT_ID,
            });
            return {
              kind: "success",
              content: item.name,
              date: resolvedDueDate.date,
              ...(resolvedDueDate.time ? { time: resolvedDueDate.time } : {}),
            };
          } catch (e) {
            console.error(`Error adding task "${item.name}": `, JSON.stringify(e as TodoistRequestError));
            return {
              kind: "failed",
              content: item.name,
              error: "Todoist could not add this item.",
            };
          }
        });

        const results = await Promise.all(addItemPromises);
        const successfulItems = results.filter((result) => result.kind === "success");
        const failedItems = results.filter((result) => result.kind === "failed");
        const responseParts: string[] = [];

        if (successfulItems.length > 0) {
          responseParts.push(`Added the following item(s) to your shopping list:\n\n${successfulItems.map(item => {
            return `• ${item.content} (due ${formatPacificDueDate(item.date, item.time)})`;
          }).join('\n')}`);
        }

        if (failedItems.length > 0) {
          responseParts.push(`I couldn't add ${failedItems.map(item => item.content).join(", ")}. ${failedItems.map(item => item.error).join(" ")}`);
        }

        const responseMessage = responseParts.length > 0
          ? responseParts.join("\n\n")
          : "Failed to add any items to the shopping list. Please try again later.";

        await ctx.reply(responseMessage);
        return responseMessage;
      };

      const deleteShoppingListItem = async (itemName: string, taskId?: string): Promise<string> => {
        let responseMessage: string;
        try {
          const result = await deleteShoppingListTask(todoistAPI, itemName, taskId);
          if (result.kind === "deleted") {
            responseMessage = `Deleted ${result.task.content} from your shopping list.`;
          } else if (result.kind === "not_found") {
            responseMessage = `I couldn't find an active shopping-list item matching "${itemName}".`;
          } else {
            responseMessage = `I found multiple active shopping-list items matching "${itemName}":\n\n${describeShoppingListChoices(result.tasks)}\n\nTell me which one you want to delete.`;
          }
        } catch (e) {
          console.error("Error deleting shopping-list item", e);
          responseMessage = "I couldn't delete that shopping-list item. Please try again later.";
        }
        await ctx.reply(responseMessage);
        return responseMessage;
      };

      let modelInput = input;
      for (let step = 0; step < 8; step++) {
        const response = await retry(async () => {
          const response = await openai_process.responses.create({
            model: model_process,
            instructions: getSystemPrompt({ now: new Date(requestNow) }).content,
            input: modelInput,
            reasoning: { effort: "low" },
            store: false,
            include: ["reasoning.encrypted_content"],
            tools: shoppingTools,
            parallel_tool_calls: false,
          });
          if (response.status !== "completed" || !response.output?.length) {
            throw new Error(`Model response ${response.status}: ${response.error?.message ?? response.incomplete_details?.reason ?? "no output"}`);
          }
          return response;
        }, { retries: 3 });
        const outputItems = responseOutputToInput(response.output);
        const toolCalls = response.output.filter(item => item.type === "function_call");
        let tool_resp: string | undefined;
        // If there's a tool call, do it
        if (toolCalls.length) {
          if (toolCalls.length !== 1) {
            throw new Error("Expected one tool call");
          }
          const tool = toolCalls[0];
          if (tool.name === "addShoppingListItems") {
            const args = JSON.parse(tool.arguments) as AddShoppingListItemArguments;
            const items = args.items;
            if (!items || items.length === 0) {
              throw new Error("No items found");
            }
            tool_resp = await addShoppingListItems(items);
          } else if (tool.name === "updateShoppingListItem") {
            const args = JSON.parse(tool.arguments) as UpdateShoppingListItemArguments;
            try {
              tool_resp = await editShoppingListItem(todoistAPI, args, new Date(requestNow));
            } catch (error) {
              tool_resp = error instanceof Error ? error.message : "Could not update the item.";
            }
            await ctx.reply(tool_resp);
          } else if (tool.name === "listShoppingListItems") {
            const args = JSON.parse(tool.arguments) as { query?: string };
            const items = await listShoppingListItems(todoistAPI, args.query);
            tool_resp = JSON.stringify({ items, count: items.length });
          } else if (tool.name === "mergeShoppingListItems") {
            const args = JSON.parse(tool.arguments) as MergeItemsArguments;
            try {
              tool_resp = await mergeShoppingListItems(todoistAPI, args, new Date(requestNow));
            } catch (error) {
              tool_resp = error instanceof Error ? error.message : "Could not consolidate items.";
            }
            await ctx.reply(tool_resp);
          } else if (tool.name === "deleteShoppingListItem") {
            const args = JSON.parse(tool.arguments) as ShoppingListItemArguments;
            if (!args.itemName?.trim()) throw new Error("Item name is required");
            tool_resp = await deleteShoppingListItem(args.itemName, args.taskId);
          } else {
            throw new Error(`Unknown tool: ${tool.name}`);
          }
          modelInput = await doInstance.appendInputTurn([
            ...outputItems,
            { type: "function_call_output", output: tool_resp, call_id: tool.call_id },
          ]);
          if (tool.name === "listShoppingListItems") continue;
          return;
        } else {
          if (response.output_text) {
            await ctx.reply(
              response.output_text,
              {
                reply_parameters: {
                  message_id: ctx.message.message_id,
                },
              },
            );

            await doInstance.appendInputTurn(outputItems);
            return;
          } else {
            throw new Error("No content in bot response");
          }
        }
      }
      await ctx.reply("I reached the lookup limit. Please narrow down which items you want to change.");
    }

    const textFilter = matchFilter("message:text");
    const handleText = async (ctx: Filter<MyContext, "message:text">) => {
      console.log("Received text message", {
        message: ctx.msg.text,
        from: ctx.msg.from,
      });
      await handleSendLongChat(ctx, ctx.msg.text);
    }

    const mediaFilter = matchFilter("message:media");
    const handleMedia = async (ctx: Filter<MyContext, "message:media">) => {
      console.log("Received media message", {
        message: ctx.msg.caption,
        from: ctx.msg.from,
      });
      // if there's a caption, use that as the message
      if (ctx.msg.caption) {
        await handleSendLongChat(ctx, ctx.msg.caption);
      }
    }

    const voiceFilter = matchFilter("message:voice");
    const handleVoice = async (ctx: Filter<MyContext, "message:voice">) => {
      console.log("Received voice message", {
        message: ctx.msg.voice,
        from: ctx.msg.from,
      });
      // Send a typing action
      await ctx.replyWithChatAction("typing");
      // Get fileID from the voice message
      const fileId = ctx.msg.voice.file_id;
      // Get the file URL
      const fileUrl = await ctx.api.getFile(fileId);
      // Get the URL of the file
      const file_path = fileUrl.file_path;
      if (!file_path) {
        throw new Error("No file path found");
      }
      // https://api.telegram.org/file/bot<token>/<file_path>
      const fullUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file_path}`;
      const replicateInput = {
        audio: fullUrl,
        batch_size: 64
      };

      const output = await retry(() => replicate.run(replicateWhisperModel, {
        input: replicateInput
      }), { retries: 3 }) as WhisperOutput;

      const messageText = output.text;
      console.log("Transcribed text: ", messageText);
      // Reply with transcription, prefixed with 🎙️
      await ctx.reply(
        `🎙️: ${messageText}`,
        {
          reply_parameters: {
            message_id: ctx.message.message_id,
          },
        },
      );
      await handleSendLongChat(ctx, messageText);
    }

    const messageFilter = matchFilter("message");

    for (let message of batch.messages) {
      const contextJson = message.body.context;
      // Rehydrate Context
      const context = new Context(
        contextJson.update,
        bot.api,
        contextJson.me,
      );

      if (!context.from || !whitelisted_users.includes(context.from.id.toString())) {
        message.ack();
        continue;
      }
      try {
        if (textFilter(context)) {
          await handleText(context);
        } else if (mediaFilter(context)) {
          await handleMedia(context);
        } else if (voiceFilter(context)) {
          await handleVoice(context);
        }
        message.ack();
      } catch (error) {
        const details = error as { name?: string; message?: string; status?: number; request_id?: string };
        console.error("Message processing failed", {
          updateId: context.update.update_id,
          name: details?.name,
          message: details?.message ?? String(error),
          status: details?.status,
          requestId: details?.request_id,
        });
        try {
          await context.reply("Sorry, I couldn't finish processing your message. Please check the shopping list before trying again, in case the change was already applied.");
          message.ack();
        } catch (replyError) {
          console.error("Could not send failure reply", { updateId: context.update.update_id, error: replyError });
          message.retry();
        }
      }
    }
  },
}

// Handles configuration and state of the Telegram chat
export class ChatDurableObject extends DurableObject<Env> {
  async clearHistory(): Promise<number> {
    const oldLength = (await this.getResponseHistory()).flat().length;
    await this.ctx.storage.transaction(async txn => {
      await txn.put("responseHistory", []);
      await txn.delete("messages");
    });
    return oldLength;
  }

  async getResponseHistory(): Promise<ResponseHistory> {
    const history = await this.ctx.storage.get<ResponseHistory>("responseHistory");
    if (history) return history;
    // Migrate lazily; retain the legacy transcript for deployment rollback.
    const legacy = await this.ctx.storage.get<ChatMessageParam[]>("messages");
    return migrateChatHistory(legacy ?? []);
  }

  async appendInputTurn(turn: ResponseInput): Promise<ResponseInput> {
    return this.ctx.storage.transaction(async txn => {
      const stored = await txn.get<ResponseHistory>("responseHistory");
      const history = stored ?? migrateChatHistory(await txn.get<ChatMessageParam[]>("messages") ?? []);
      const next = appendResponseTurn(history, turn);
      await txn.put("responseHistory", next);
      console.log("Response history saved", { turns: next.length, items: next.flat().length });
      return next.flat();
    });
  }
}
