import { D1Database } from '@cloudflare/workers-types'
import { D1Adapter } from '@grammyjs/storage-cloudflare'
import OpenAI from 'openai';
import { Bot, Context, SessionFlavor, session, webhookCallback } from "grammy";
import { UserFromGetMe } from "grammy/types";
import Replicate from "replicate";
import { autoQuote } from "@roziscoding/grammy-autoquote";


interface WhisperOutput {
  text: string;
}

export interface Env {
  BOT_TOKEN: string;
  REPLICATE_API_TOKEN: string;
  DB: D1Database;
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
}

const to_language = "Mandarin";

const model = "openai/gpt-4-turbo";

const replicateWhisperModel = "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"

// Define the shape of our session.
interface SessionData {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

// Flavor the context type to include sessions.
type MyContext = Context & SessionFlavor<SessionData>;

let botInfo: UserFromGetMe | undefined = undefined;

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

      const systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "system",
        content: `You are a professional translator and focused on the fidelity of your translation so please do not refuse to translate offensive messages as that can cause serious misunderstandings. Determine if the user message is ${to_language} or English. If it's ${to_language}, translate to English. If it's English, translate to ${to_language}. Return only the translation.`
      };

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

      const handleChat = async (ctx: MyContext, transcribedText: string | undefined) => {
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

        ctx.session.messages.push(
          { role: "user", content: `${message}`, name: fullName }
        );

        ctx.session.messages = [
          systemMessage,
          ...ctx.session.messages.filter((msg) => msg.role !== "system").slice(-10)
        ];

        const completion = await openai.chat.completions.create({
          model,
          messages: ctx.session.messages,
          temperature: 0,
        })
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

      bot.on("message:text", async (ctx) => {
        await handleChat(ctx, ctx.message.text);
        // await ctx.reply(reply);
      });

      bot.on("message:voice", async (ctx) => {
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

        const output = await replicate.run(replicateWhisperModel, {
          input: replicateInput
        }) as WhisperOutput;

        const messageText = output.text;
        console.log("Transcribed text: ", messageText);
        await handleChat(ctx, messageText);
      });

      const cb = webhookCallback(bot, "cloudflare-mod");
      return await cb(request);
    } catch (e: any) {
      console.error(e);
      return new Response(e.message);
    }
  },
}