import { D1Database } from '@cloudflare/workers-types'
import { D1Adapter } from '@grammyjs/storage-cloudflare'
import OpenAI from 'openai';
import { Bot, Context, SessionFlavor, session, webhookCallback } from "grammy";
import { UserFromGetMe } from "grammy/types";
import Replicate from "replicate";
import { autoQuote } from "@roziscoding/grammy-autoquote";
import { retry } from 'ts-retry-promise';
import { QueueRetryBatch } from '@cloudflare/workers-types/experimental';

interface WhisperOutput {
  text: string;
}

export interface Env {
  BOT_TOKEN: string;
  REPLICATE_API_TOKEN: string;
  DB: D1Database;
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
  WHITELISTED_USERS: string;
  DIALOH_QUEUE: Queue<any>;
}

const to_language = "Ukranian";

const model = "meta-llama/llama-3-70b-instruct";

const replicateWhisperModel = "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"

// Define the shape of our session.
interface SessionData {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

// Flavor the context type to include sessions.
type MyContext = Context & SessionFlavor<SessionData>;

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

      const grammyD1StorageAdapter = await D1Adapter.create<SessionData>(env.DB, 'GrammySessions')

      const systemMessage = getSystemPrompt(to_language);

      const whitelisted_users = env.WHITELISTED_USERS.split(",");

      const bot = new Bot<MyContext>(env.BOT_TOKEN, { botInfo });
      bot.use(autoQuote());

      if (botInfo === undefined) {
        await bot.init();
        botInfo = bot.botInfo;
      }


      bot.command("start", (ctx) => ctx.reply(
        "Hello!"
      ));

      bot.use(session({
        initial: (): SessionData => {
          return {
            messages: [systemMessage],
          }
        },
        storage: grammyD1StorageAdapter,
      }))

      bot.command("clearHistory", async (ctx) => {
        const oldLength = ctx.session.messages.length;
        ctx.session.messages = [systemMessage];
        await ctx.reply("History cleared! Previous length: " + oldLength);
      });

      const handleChat = async (ctx: MyContext, transcribedText: string | undefined) => {
        console.log("sending to dialoh queue")
        await env.DIALOH_QUEUE.send({ messages: ctx.session.messages });
        console.log("sent to dialoh queue")
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

        ctx.session.messages.push(
          { role: "user", content: `${message}`, name: fullName }
        );

        ctx.session.messages = [
          systemMessage,
          ...ctx.session.messages.filter((msg) => msg.role !== "system").slice(-10)
        ];

        const completion = await retry(async () => {
          const completion = await openai.chat.completions.create({
            model,
            messages: ctx.session.messages,
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
          ctx.session.messages.push(responded);
          responded.content = `${responded.content}`;
        } else {
          console.error("No content in bot response!");
        }
      }

      const handleSendLongChat = async (ctx: MyContext, message: string) => {
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

      bot.on("message:photo", async (ctx) => {
        if (!whitelisted_users.includes(ctx.from.id.toString())) {
          console.log("User not whitelisted", {
            from: ctx.message.from,
          });
          return;
        }
        console.log("Received photo message", {
          message: ctx.message.caption,
          from: ctx.message.from,
        });
        // if there's a caption, use that as the message
        if (ctx.message.caption) {
          await handleSendLongChat(ctx, ctx.message.caption);
        }
      });

      bot.on("message:text", async (ctx) => {
        if (!whitelisted_users.includes(ctx.from.id.toString())) {
          console.log("User not whitelisted", {
            from: ctx.message.from,
          });
          return;
        }
        console.log("Received text message", {
          message: ctx.message.text,
          from: ctx.message.from,
        });
        await handleSendLongChat(ctx, ctx.message.text);
      });

      bot.on("message:voice", async (ctx) => {
        if (!whitelisted_users.includes(ctx.from.id.toString())) {
          console.log("User not whitelisted", {
            from: ctx.message.from,
          });
          return;
        }
        console.log("Received voice message", {
          message: ctx.message.voice,
          from: ctx.message.from,
        });
        // Send a typing action
        await ctx.replyWithChatAction("typing");
        // Get fileID from the voice message
        const fileId = ctx.message.voice.file_id;
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
      });

      const cb = webhookCallback(bot, "cloudflare-mod", "throw", 30000);
      return await cb(request);
    } catch (e: any) {
      console.error(e);
      return new Response(e.message);
    }
  },

  async queue(batch: any, env: Env): Promise<void> {
    let messages = JSON.stringify(batch.messages);
    console.log(`consumed from our queue: ${messages}`);
  },
}