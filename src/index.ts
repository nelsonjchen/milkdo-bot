import { D1Database } from '@cloudflare/workers-types'
import OpenAI from 'openai';
import { Bot, Context, Filter, matchFilter, webhookCallback } from "grammy";
import { UserFromGetMe } from "grammy/types";
import Replicate from "replicate";
import { autoQuote } from "@roziscoding/grammy-autoquote";
import { retry } from 'ts-retry-promise';
import { DurableObject } from "cloudflare:workers";
import { TodoistApi } from "@doist/todoist-api-typescript"



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

const model_process = "gpt-4o-mini	";

const replicateWhisperModel = "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;


// Flavor the context type to include sessions.
type MyContext = Context

let botInfo: UserFromGetMe | undefined = undefined;

interface SystemPromptConfig {
}

function getSystemPrompt(
  config: SystemPromptConfig = {
  }
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  let content = `You are a shopping list assistance bot. For right now, you can only add items to the shopping list. When you do add items to the list, add them with a nice name, and with a postfix emoji to represent the item. For example, "Milk 🥛", "Organic Strawberries 🍓", "Cheese 🧀", and so on. If no due date is specified, add it for today.`
  return {
    role: "system",
    content,
  };
}


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
      return new Response(e.message);
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
      await ctx.replyWithChatAction("typing");
      const interval = setInterval(async () => {
        await ctx.replyWithChatAction("typing");
      }, 4000);
      try {
        await handleChat(ctx, message);
      } finally {
        clearInterval(interval);
      }
    };

    const handleChat = async (ctx: Filter<MyContext, "message">, transcribedText: string | undefined) => {
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
      const messages = await doInstance.pushMessage(
        { role: "user", content: `${message}`, name: fullName }
      );

      // Does this message need to be processed? Is it mentioning us?
      if (!message.includes("@Milkdo")) {
        return;
      }

      const todoistAPI = new TodoistApi(env.TODOIST_API_TOKEN);

      const addShoppingListItem = async (item: string, due_date: string): Promise<string> => {
        todoistAPI.addTask({
          content: item,
          dueString: due_date,
          sectionId: "150049165",
          projectId: "2328224336",
        });
        // Add item to the to-do list
        await ctx.reply(`Added "${item}" to the to-do list.`);
        return `Added "${item}" to the to-do list.`;
      }

      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "addShoppingListItem",
            description: "Adds an item to the shopping list.",
            parameters: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "The name of the item to add to the shopping list, postfixed with an emoji to represent the item, e.g. 'Milk 🥛'."
                },
                dueDate: {
                  type: "string",
                  description: "The due date of the item to add to the shopping list, e.g. 'today', or 'tomorrow'."
                }
              },
              "required": ["name", "dueDate"],
            },
          }
        },
      ];

      interface AddShoppingListItemArguments {
        name: string;
        dueDate: string;
      }

      let completion = await retry(async () => {
        const completion = await openai_process.chat.completions.create({
          model: model_process,
          messages,
          temperature: 0,
          tools,
        });
        // If no completion.choices, retry
        if (!completion.choices) {
          throw new Error("No completion.choices");
        }
        return completion;
      }, { retries: 3 });
      let tool_resp: string | undefined;
      // If there's a tool call, do it
      if (completion.choices[0].message.tool_calls) {
        const tool = completion.choices[0].message.tool_calls[0];
        if (tool.function.name === "addShoppingListItem") {
          const args = JSON.parse(tool.function.arguments) as AddShoppingListItemArguments;
          const item = args.name;
          if (!item) {
            throw new Error("No item found");
          }
          const item_due_date = args.dueDate;
          if (!item_due_date) {
            throw new Error("No due date found");
          }
          tool_resp = await addShoppingListItem(item, item_due_date);
          const tool_call_id = tool.id;
          // Add the response to the messages
          await doInstance.pushMessage(
            { role: "tool", content: tool_resp, tool_call_id }
          );
        }
      }

      const responded = completion.choices[0].message;
      if (responded.content) {
        try {
          await ctx.reply(
            responded.content,
            {
              reply_parameters: {
                message_id: ctx.message.message_id,
              },
            },
          );
        } catch (e) {
          console.error("Error sending message: ", e);
        }

        await doInstance.pushMessage(responded);
        responded.content = `${responded.content}`;
      } else {
        console.error("No content in bot response!");
      }
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
      if (file_path) {
        console.log(fullUrl);
      }
      const replicateInput = {
        audio: fullUrl,
        batch_size: 64
      };

      const output = await retry(() => replicate.run(replicateWhisperModel, {
        input: replicateInput
      }), {retries: 3}) as WhisperOutput;

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

      if (textFilter(context)) {
        await handleText(context);
      } else if (mediaFilter(context)) {
        await handleMedia(context);
      } else if (voiceFilter(context)) {
        await handleVoice(context);
      }
    }
  },
}

// Handles configuration and state of the Telegram chat
export class ChatDurableObject extends DurableObject<Env> {
  async clearHistory(): Promise<number> {
    // Get the last history's length
    const lastMessages = await this.ctx.storage.get<ChatMessageParam[]>("messages");
    if (!lastMessages) {
      return 0;
    }
    await this.ctx.storage.put("messages", [
      getSystemPrompt({})
    ]);
    return lastMessages.length - 1;
  }

  async getMessages(): Promise<ChatMessageParam[]> {
    let messages = await this.ctx.storage.get<ChatMessageParam[]>("messages") || [
      getSystemPrompt({})
    ];
    console.log("Messages Retrieved: ", messages)
    return messages;
  }

  async pushMessage(message: ChatMessageParam): Promise<ChatMessageParam[]> {
    const keepLength = 20;
    let messages = await this.getMessages();
    messages.push(message);
    // If there's more than the limit messages, keep the last limit.
    // Don't remove the system message!
    if (messages.length > keepLength) {
      messages = [
        getSystemPrompt({
        }),
        ...messages.slice(-keepLength)
      ];
    }
    await this.ctx.storage.put("messages", messages);
    console.log("Messages Updated: ", messages)
    return messages;
  }

}