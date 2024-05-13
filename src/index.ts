import { D1Database } from '@cloudflare/workers-types'
import OpenAI from 'openai';
import { Bot, Context, Filter, matchFilter, webhookCallback } from "grammy";
import { UserFromGetMe } from "grammy/types";
import Replicate from "replicate";
import { autoQuote } from "@roziscoding/grammy-autoquote";
import { retry } from 'ts-retry-promise';
import { DurableObject } from "cloudflare:workers";

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
}

const default_to_language = "Ukranian";

const model = "openai/gpt-3.5-turbo";

const replicateWhisperModel = "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Define the shape of our session.
interface SessionData {
  messages: ChatMessageParam[];
}

// Flavor the context type to include sessions.
type MyContext = Context

let botInfo: UserFromGetMe | undefined = undefined;

function getSystemPrompt(language: string): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  return {
    role: "system",
    content: `You are a professional translator and focused on the fidelity of your translation so please do not refuse to translate offensive messages as that can cause serious misunderstandings. Determine if the user message is ${language} or English. If it's ${language}, translate to English. If it's English, translate to ${language}. Return only the translation.`
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
        "Hello! I'm here to translate! Default language is Ukranian. Use /setLanguage to change it."
      ));

      // This runs fast enough to not need to be queued
      bot.command("clearHistory", async (ctx) => {
        // Asking DO to clear the history for this chat.
        const doId = env.CHAT_DO.idFromName(ctx.chat.id.toString());
        // Pass it in the context
        const oldLength = await env.CHAT_DO.get(doId).clearHistory();
        await ctx.reply("History cleared! Previous length: " + oldLength);
      });

      bot.command("setLanguage", async (ctx) => {
        const language = ctx.match
        if (!language) {
          await ctx.reply("Please provide a language!");
          return;
        }
        const chatDo = await env.CHAT_DO.get(env.CHAT_DO.idFromName(ctx.chat.id.toString()));
        await chatDo.setToLanguage(language);
        // Clear the history
        await chatDo.clearHistory();
        await ctx.reply("Language set to: " + language);
      });


      // Handle messages in queue
      bot.on("message:text", async (ctx) => {
        await env.QUEUE.send({ context: ctx });
      });
      bot.on("message:photo", async (ctx) => {
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

    const openai = new OpenAI({
      baseURL: env.OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY,
      defaultHeaders: {
        "X-Title": "DialohBot",
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


      const completion = await retry(async () => {
        const completion = await openai.chat.completions.create({
          model,
          messages,
          temperature: 0,

        });
        // If no completion.choices, retry
        if (!completion.choices) {
          throw new Error("No completion.choices");
        }
        return completion;
      }, { retries: 3 });
      const responded = completion.choices[0].message;
      if (responded.content) {
        const originalContent = responded.content;
        ctx.reply(originalContent);
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

    const photoFilter = matchFilter("message:photo");
    const handlePhoto = async (ctx: Filter<MyContext, "message:photo">) => {
      console.log("Received photo message", {
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
      await handleChat(ctx, messageText);
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
      // check if the whitelist user is in the list
      if (messageFilter(context)) {
        if (!whitelisted_users.includes(context.from.id.toString())) {
          console.log("User not whitelisted, ignoring", {
            from: context.message.from,
          });
          return;
        }
      }
      if (textFilter(context)) {
        await handleText(context);
      } else if (photoFilter(context)) {
        await handlePhoto(context);
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
      getSystemPrompt(await this.getToLanguage())
    ]);
    return lastMessages.length - 1;
  }

  async getMessages(): Promise<ChatMessageParam[]> {
    let messages = await this.ctx.storage.get<ChatMessageParam[]>("messages") || [
      getSystemPrompt(await this.getToLanguage())
    ];
    console.log("Messages Retrieved: ", messages)
    return messages;
  }

  async pushMessage(message: ChatMessageParam): Promise<ChatMessageParam[]> {
    let messages = await this.getMessages();
    messages.push(message);
    // If there's more than 10 messages, keep the last 10.
    // Don't remove the system message!
    if (messages.length > 10) {
      messages = [
        getSystemPrompt(await this.getToLanguage()),
        ...messages.slice(-10)
      ];
    }
    await this.ctx.storage.put("messages", messages);
    console.log("Messages Updated: ", messages)
    return messages;
  }

  async setToLanguage(language: string): Promise<void> {
    await this.ctx.storage.put("to_language", language);
    await this.clearHistory();
  }

  async getToLanguage(): Promise<string> {
    return await this.ctx.storage.get<string>("to_language") || default_to_language;
  }
}