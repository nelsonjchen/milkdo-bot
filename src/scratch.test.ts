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

});