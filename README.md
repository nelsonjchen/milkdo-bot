# Dialoh Bot

Serverless [grammy.js](https://grammy.dev/) bot to help me converse with Ukrainian-speaking friends.

Whitelisted to only respond to messages from a specific list of users.

Runs on Cloudflare Workers to take advantage of their reliable and scalable infrastructure.

Idea is to use the conversational data model to better translate *conversations* and not just phrases.

## Usage

Talk to DialohBot on Telegram. You can invite and/or kick the bot into a group chat, and it will respond to messages from the users in the whitelist to translate.

Commands:

* `/setLanguages <language>` - Set the language of the bot to the conversations inside. Make sure to include English if there's English!
* `/resetHistory` - Reset the conversation history in the bot. Sometimes the bot gets stuck or goes wild and needs a reset.

## Deployment

Requires a Workers Paid plan to run on Cloudflare Workers. Once it's there though, it's pretty infinitely scalable.

Requires an OpenRouter OpenAI API compatible API base URL and API key to be set in the environment variables.
Uses whatever the best model is currently available.

Requires a Replicate.com key for voice transcription using Whisper 3.
This allows transcription of voice messages to text in any supported Whisper 3 language.
