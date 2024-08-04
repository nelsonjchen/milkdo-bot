import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { m } from "vitest/dist/reporters-yx5ZTtEV";


describe("OpenAI", () => {
  // Sample Hello World Test
  it("should return Hello World", async () => {
    expect("Hello World").toMatchInlineSnapshot(`"Hello World"`);
  });

  // Simulate an OpenAI API call

  it("should return a response from the OpenAI API", async () => {
    // const openai_wake = new OpenAI({
    //   baseURL: env.OPENAI_BASE_URL,
    //   apiKey: env.OPENAI_API_KEY,
    //   defaultHeaders: {
    //     "X-Title": "MilkdoWake",
    //   },
    // })

  });


  it('uses OPENAI_API_KEY', () => {
    const apiKey = process.env.OPENAI_API_KEY;
    // Make sure it's defined and a string
    expect(apiKey).toBeDefined();
    expect(typeof apiKey).toBe('string');
  });

  // Run against the real OpenAI API
  it('should return a response from the OpenAI API', async () => {
    console.log('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    interface ShoppingListItem {
      name: string;
      dueDate: string;
    }

    // Tools
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "getShoppingList",
          description: "Returns a list of items on the shopping list with their due dates.",
        }
      },
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
                description: "The name of the item to add to the shopping list."
              },
              dueDate: {
                type: "string",
                description: "The due date of the item to add to the shopping list."
              }
            },
            "required": ["name", "dueDate"],
          },
        }
      },
    ];

    let messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: 'You are a helpful shopping list assistant named Milkdo. You may be called in at any time to help with managing a shopping list.',
      },
      {
        role: 'user',
        name: 'bob',
        content: 'What is the purpose of life?',
      },
      {
        role: 'user',
        name: 'alice',
        content: 'Eat, drink, and be merry.',
      },
      {
        role: 'user',
        name: 'alice',
        content: '@milkdo what\'s in the shopping list?',
      },
    ];


    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      tools,
      messages,
    });
    // Output the response, fully, without truncation
    console.log(JSON.stringify(response, null, 2));

    // Make a fake shopping list response
    const shoppingListInit: ShoppingListItem[] = [
      {
        name: 'cheese',
        dueDate: 'today',
      },
      {
        name: 'wine',
        dueDate: 'today',
      },
    ];
    // appends the response to the messages array

    const tool_calls = response.choices[0].message.tool_calls;
    if (!tool_calls) {
      throw new Error('tool_calls not found');
    }

    // Find the tool call that corresponds to the getShoppingList tool
    const getShoppingListToolCall = tool_calls.find((tool_call) => tool_call.function.name === 'getShoppingList');

    if (!getShoppingListToolCall) {
      throw new Error('getShoppingList tool call not found');
    }

    messages.push(response.choices[0].message);

    messages.push({
      role: 'tool',
      tool_call_id: getShoppingListToolCall.id,
      content: JSON.stringify(shoppingListInit),
    });

    // Call the API again with the updated messages
    const response2 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      tools,
      messages,
    });
    console.log(JSON.stringify(response2));


  });

});