import { Bot, webhookCallback } from "grammy";
import { UserFromGetMe } from "grammy/types";
import Replicate from "replicate";


const replicateWhisperModel = "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"

interface WhisperOutput {
  text: string;
}

export interface Env {
  BOT_TOKEN: string;
  REPLICATE_API_TOKEN: string;
}

let botInfo: UserFromGetMe | undefined = undefined;

export default {
  async fetch(request: Request, env: Env) {
    try {
      const replicate = new Replicate(
        {
          auth: env.REPLICATE_API_TOKEN,
        }
      );

      const bot = new Bot(env.BOT_TOKEN, { botInfo });

      if (botInfo === undefined) {
        await bot.init();
        botInfo = bot.botInfo;
      }

      bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
      bot.on("message:text", (ctx) => { ctx.reply("Got a text message!") });
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

        await ctx.reply(`Got a voice message!: ${output.text}`)
      });

      const cb = webhookCallback(bot, "cloudflare-mod");
      console.log("Request received");
      return await cb(request);
    } catch (e: any) {
      console.error(e);
      return new Response(e.message);
    }
  },
}