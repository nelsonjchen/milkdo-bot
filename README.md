# Dialoh Bot

A bot to help me converse with Ukrainian-speaking friends.

Whitelisted to only respond to messages from a specific list of users.

## Usage

Talk to DialohBot on Telegram. You can invite and/or kick the bot into a group chat, and it will respond to messages from the users in the whitelist to translate.

Commands:

* `/setLanguage <language>` - Set the language of the bot to `<language>` for the conversation.
* `/resetHistory` - Reset the conversation history in the bot. Sometimes the bot gets stuck or goes wild and needs a reset.

## Deployment

Requires a Workers Paid plan to run on Cloudflare Workers. Once it's there though, it's pretty infinitely scalable.

Requires an OpenRouter OpenAI API compatible API base URL and API key to be set in the environment variables.
It uses GPT-3.5 model as it actually seems to follow instructions than open source models.

Requires a Replicate.com key for voice transcription using Whisper 3.
This allows transcription of voice messages to text in any supported Whisper 3 language.
