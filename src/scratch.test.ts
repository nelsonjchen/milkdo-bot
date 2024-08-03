import OpenAI from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";


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
    // Tools
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "getShoppingList",
          description: "Returns a list of items on the shopping list with their due dates.",
        }
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      tools,
      messages: [
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
          content: '@milkdo add wine to the shopping list',
        },
      ],
    });
    // Output the response, fully, without truncation
    console.log(JSON.stringify(response, null, 2));


  });

});