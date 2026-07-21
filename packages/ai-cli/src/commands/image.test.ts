import { describe, expect, test } from "bun:test";

import { imageProviderOptions } from "./image.js";

describe("imageProviderOptions", () => {
  test("routes quality and style to direct OpenAI", () => {
    expect(
      imageProviderOptions("openai", { quality: "high", style: "vivid" })
    ).toEqual({ openai: { quality: "high", style: "vivid" } });
  });

  test("routes quality through OpenRouter", () => {
    expect(imageProviderOptions("openrouter", { quality: "high" })).toEqual({
      openrouter: { quality: "high" },
    });
  });

  test("does not send unsupported style through OpenRouter", () => {
    expect(imageProviderOptions("openrouter", { style: "vivid" })).toEqual({});
  });

  test("does not send OpenAI options to FAL", () => {
    expect(
      imageProviderOptions("fal", { quality: "high", style: "vivid" })
    ).toEqual({});
  });
});
