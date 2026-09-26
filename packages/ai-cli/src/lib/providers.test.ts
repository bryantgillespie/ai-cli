import { afterEach, describe, expect, test } from "bun:test";

import {
  createProvider,
  getLanguageModel,
  getVideoModel,
  resolveProviderId,
} from "./providers.js";

const originalProvider = process.env.AI_CLI_PROVIDER;
const credentialKeys = [
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "FAL_API_KEY",
  "FAL_KEY",
  "OLLAMA_API_KEY",
  "OMLX_API_KEY",
  "OLLAMA_BASE_URL",
  "OMLX_BASE_URL",
] as const;
const originalCredentials = Object.fromEntries(
  credentialKeys.map((key) => [key, process.env[key]])
);

afterEach(() => {
  if (originalProvider === undefined) delete process.env.AI_CLI_PROVIDER;
  else process.env.AI_CLI_PROVIDER = originalProvider;
  for (const key of credentialKeys) {
    const value = originalCredentials[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveProviderId", () => {
  test("defaults deterministically to OpenRouter", () => {
    delete process.env.AI_CLI_PROVIDER;
    expect(resolveProviderId()).toBe("openrouter");
  });

  test("uses explicit input before environment configuration", () => {
    process.env.AI_CLI_PROVIDER = "fal";
    expect(resolveProviderId("openai")).toBe("openai");
  });

  test("rejects unknown providers at the configuration boundary", () => {
    expect(() => resolveProviderId("gateway")).toThrow(
      'provider must be one of: openrouter, anthropic, openai, fal, ollama, omlx (got "gateway")'
    );
  });
});

describe("createProvider", () => {
  test("requires the selected provider credential", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => createProvider("openrouter")).toThrow(
      'provider "openrouter" requires OPENROUTER_API_KEY'
    );
  });

  test("creates OpenRouter text and video models without another provider", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const provider = createProvider("openrouter");

    expect(typeof getLanguageModel(provider, "openai/gpt-5.5")).toBe("object");
    expect(typeof getVideoModel(provider, "bytedance/seedance-2.0")).toBe(
      "object"
    );
  });

  test("requires Anthropic credentials at the provider boundary", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => createProvider("anthropic")).toThrow(
      'provider "anthropic" requires ANTHROPIC_API_KEY'
    );
  });

  test("creates direct Anthropic text models", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const provider = createProvider("anthropic");

    expect(typeof getLanguageModel(provider, "claude-sonnet-4-6")).toBe(
      "object"
    );
  });

  test("creates local providers without requiring credentials", () => {
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OMLX_API_KEY;

    expect(typeof getLanguageModel(createProvider("ollama"), "qwen3")).toBe(
      "object"
    );
    expect(typeof getLanguageModel(createProvider("omlx"), "qwen3")).toBe(
      "object"
    );
  });

  test("does not silently route an unsupported capability", () => {
    process.env.FAL_API_KEY = "test-key";
    const provider = createProvider("fal");

    expect(() => getLanguageModel(provider, "some-model")).toThrow(
      'text generation is not supported by provider "fal"'
    );
  });
});
