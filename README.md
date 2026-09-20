# Milkdo Bot

STATUS: Hardcoded to only respond to messages from a specific list of users and a specific project/category.

Serverless [grammy.js](https://grammy.dev/) bot to help us add, delete, and reschedule items on a grocery list

Whitelisted to only respond to messages from a specific list of users.

HARDCODED for one's own use case. Just reference. Maybe you can use it as a starting point.

Runs on Cloudflare Workers to take advantage of their reliable and scalable infrastructure.

Idea is to use the conversational data model to better translate *conversations* and not just phrases.

## Usage

It's just a bot. Invited to a group.

Send messages such as “delete milk” or “move bananas to tomorrow at 5 PM”.
Dates and times use Pacific time. If multiple active items have the same name,
the bot asks you to choose before deleting or rescheduling one.

Commands:

* `/clearHistory` - Reset the conversation history in the bot.

## Deployment

Requires a Workers Paid plan to run on Cloudflare Workers. Once it's there though, it's pretty infinitely scalable.

Uses the OpenAI Responses API with `gpt-5.6-luna` and low reasoning effort. Set
`OPENAI_API_KEY` and `OPENAI_BASE_URL` (normally `https://api.openai.com/v1`).
Any alternate API provider must support Responses, function tools, and encrypted reasoning.

Conversation history stays in the chat's Durable Object. Existing Chat Completions
history migrates automatically, and complete reasoning/tool exchanges stay together
when history is trimmed. Responses use `store: false` and replay encrypted reasoning.
Persistent Cloudflare Worker logs are enabled for troubleshooting.

Requires a Replicate.com key for voice transcription using Whisper 3.
This allows transcription of voice messages to text in any supported Whisper 3 language.
