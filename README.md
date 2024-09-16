# Milkdo Bot

STATUS: Hardcoded to only respond to messages from a specific list of users and a specific project/category.

Serverless [grammy.js](https://grammy.dev/) bot to help us add items to a grocery list

Whitelisted to only respond to messages from a specific list of users.

HARDCODED for one's own use case. Just reference. Maybe you can use it as a starting point.

Runs on Cloudflare Workers to take advantage of their reliable and scalable infrastructure.

Idea is to use the conversational data model to better translate *conversations* and not just phrases.

## Usage

It's just a bot. Invited to a group.

Commands:

* `/resetHistory` - Reset the conversation history in the bot. Sometimes the bot gets stuck or goes wild and needs a reset.

## Deployment

Requires a Workers Paid plan to run on Cloudflare Workers. Once it's there though, it's pretty infinitely scalable.

Requires an OpenRouter OpenAI API compatible API base URL and API key to be set in the environment variables.
Uses whatever the best model is currently available.

Requires a Replicate.com key for voice transcription using Whisper 3.
This allows transcription of voice messages to text in any supported Whisper 3 language.
