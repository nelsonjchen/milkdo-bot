import { Bot, webhookCallback } from "grammy";
import { UserFromGetMe } from "grammy/types";

export interface Env {
  BOT_TOKEN: string;
}

let botInfo: UserFromGetMe | undefined = undefined;

export default {
  async fetch(request: Request, env: Env) {
    try {
      const bot = new Bot(env.BOT_TOKEN, { botInfo });

      if (botInfo === undefined) {
        await bot.init();
        botInfo = bot.botInfo;
      }

      bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
      bot.on("message", (ctx) => ctx.reply("Got another message!"));

      const cb = webhookCallback(bot, "cloudflare-mod");

      return await cb(request);
    } catch (e: any) {
      return new Response(e.message);
    }
  },
}