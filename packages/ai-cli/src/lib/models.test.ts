import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { join } from "path";

import {
  expandModelId,
  fetchModelCatalog,
  resetModelCache,
  resolveModels,
  type ModelEntry,
  type ModelTarget,
} from "./models.js";
import type { ProviderId } from "./providers.js";

const originalCacheDir = process.env.AI_CLI_CACHE_DIR;
const originalLocalConfig = {
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OMLX_BASE_URL: process.env.OMLX_BASE_URL,
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
  OMLX_API_KEY: process.env.OMLX_API_KEY,
};

function target(provider: ProviderId, modelId: string): ModelTarget {
  return { provider, modelId, reference: `${provider}:${modelId}` };
}
const modelEnvKeys = [
  "AI_CLI_TEXT_MODEL",
  "AI_CLI_IMAGE_MODEL",
  "AI_CLI_VIDEO_MODEL",
  "AI_CLI_SPEECH_MODEL",
  "AI_CLI_TRANSCRIPTION_MODEL",
] as const;

afterEach(async () => {
  resetModelCache();
  for (const key of modelEnvKeys) delete process.env[key];
  if (originalCacheDir === undefined) delete process.env.AI_CLI_CACHE_DIR;
  else process.env.AI_CLI_CACHE_DIR = originalCacheDir;
  for (const [key, value] of Object.entries(originalLocalConfig)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveModels", () => {
  test("uses provider-specific defaults", () => {
    expect(resolveModels("openrouter", "text")).toEqual([
      target("openrouter", "openai/gpt-5.5"),
    ]);
    expect(resolveModels("openai", "image")).toEqual([
      target("openai", "gpt-image-2"),
    ]);
    expect(resolveModels("fal", "video")).toEqual([
      target("fal", "fal-ai/luma-dream-machine/ray-2"),
    ]);
  });

  test("environment default overrides the built-in default", () => {
    process.env.AI_CLI_TEXT_MODEL = "anthropic/claude-sonnet-4";
    expect(resolveModels("openrouter", "text")).toEqual([
      target("openrouter", "anthropic/claude-sonnet-4"),
    ]);
  });

  test("splits comma-separated models", () => {
    expect(
      resolveModels(
        "openrouter",
        "image",
        "openai/gpt-image-2, google/gemini-3-pro-image"
      )
    ).toEqual([
      target("openrouter", "openai/gpt-image-2"),
      target("openrouter", "google/gemini-3-pro-image"),
    ]);
  });

  test("strips the creator prefix for direct OpenAI", () => {
    expect(resolveModels("openai", "text", "openai/gpt-5.5")).toEqual([
      target("openai", "gpt-5.5"),
    ]);
  });

  test("routes provider-qualified models independently", () => {
    expect(
      resolveModels(
        "openrouter",
        "text",
        "openrouter:anthropic/claude-sonnet-4,ollama:qwen3.6:latest,omlx:qwen3:thinking"
      )
    ).toEqual([
      target("openrouter", "anthropic/claude-sonnet-4"),
      target("ollama", "qwen3.6:latest"),
      target("omlx", "qwen3:thinking"),
    ]);
  });

  test("preserves an unqualified model ID containing a colon", () => {
    expect(resolveModels("ollama", "text", "qwen3.6:latest")).toEqual([
      target("ollama", "qwen3.6:latest"),
    ]);
  });

  test("requires an explicit local model", () => {
    expect(() => resolveModels("ollama", "text")).toThrow(
      'text model is required for provider "ollama"'
    );
  });

  test("rejects unsupported provider capabilities", () => {
    expect(() => resolveModels("openai", "video")).toThrow(
      'video generation is not supported by provider "openai"'
    );
    expect(() => resolveModels("fal", "text")).toThrow(
      'text generation is not supported by provider "fal"'
    );
  });
});

describe("expandModelId", () => {
  test("expands a unique short model name", () => {
    expect(
      expandModelId("gpt-5.5", [
        { id: "openai/gpt-5.5" },
        { id: "anthropic/claude-sonnet-4" },
      ])
    ).toBe("openai/gpt-5.5");
  });

  test("does not guess when a short model name is ambiguous", () => {
    expect(
      expandModelId("shared", [{ id: "one/shared" }, { id: "two/shared" }])
    ).toBe("shared");
  });

  test("preserves fully-qualified model IDs", () => {
    expect(expandModelId("openai/gpt-5.5", [])).toBe("openai/gpt-5.5");
  });
});

describe("fetchModelCatalog", () => {
  test("merges OpenRouter text, image, and video discovery", async () => {
    const urls: string[] = [];
    const fetchMock = mockFetch((url) => {
      urls.push(url);
      if (url.endsWith("/images/models")) {
        return [{ id: "openai/gpt-image-2", name: "GPT Image 2" }];
      }
      if (url.endsWith("/videos/models")) {
        return [{ id: "bytedance/seedance-2.0", name: "Seedance 2" }];
      }
      return [
        {
          id: "anthropic/claude-sonnet-4",
          name: "Claude Sonnet 4",
          architecture: { output_modalities: ["text"] },
          pricing: { prompt: "0.000003", completion: "0.000015" },
          context_length: 200_000,
        },
      ];
    });

    const result = await fetchModelCatalog("openrouter", {
      cache: false,
      fetch: fetchMock,
    });

    expect(result.text.some((model) => model.id.includes("claude"))).toBe(true);
    expect(
      result.image.some((model) => model.id === "openai/gpt-image-2")
    ).toBe(true);
    expect(
      result.video.some((model) => model.id === "bytedance/seedance-2.0")
    ).toBe(true);
    expect(urls.every((url) => url.startsWith("https://openrouter.ai/"))).toBe(
      true
    );
  });

  test("uses only the selected direct provider from models.dev", async () => {
    const fetchMock = mockFetch(() => ({
      openai: {
        models: {
          "gpt-5.5": {
            id: "gpt-5.5",
            name: "GPT-5.5",
            release_date: "2026-03-01",
            modalities: { output: ["text"] },
            cost: { input: 2, output: 8 },
            limit: { context: 400_000, output: 128_000 },
          },
          "future-video": {
            modalities: { output: ["video"] },
          },
        },
      },
      "other-provider": {
        models: {
          "other/model": {
            modalities: { output: ["text"] },
          },
        },
      },
    }));

    const result = await fetchModelCatalog("openai", {
      cache: false,
      fetch: fetchMock,
    });

    expect(result.text.some((model) => model.id === "gpt-5.5")).toBe(true);
    expect(result.lookup.some((model) => model.id === "other/model")).toBe(
      false
    );
    expect(result.video).toEqual([]);
    expect(result.lookup.some((model) => model.id === "tts-1")).toBe(true);
    expect(result.lookup.some((model) => model.id === "whisper-1")).toBe(true);
  });

  test("discovers models from a local OpenAI-compatible endpoint", async () => {
    process.env.OMLX_BASE_URL = "http://127.0.0.1:9000/v1/";
    process.env.OMLX_API_KEY = "local-secret";
    let request: Request | undefined;
    const fetchMock = (async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        object: "list",
        data: [
          { id: "qwen3:thinking", owned_by: "local" },
          { object: "model" },
        ],
      });
    }) as typeof fetch;

    const result = await fetchModelCatalog("omlx", {
      cache: false,
      fetch: fetchMock,
    });

    expect(request?.url).toBe("http://127.0.0.1:9000/v1/models");
    expect(request?.headers.get("authorization")).toBe("Bearer local-secret");
    expect(result.text).toEqual([
      targetEntry("qwen3:thinking", "local", "text"),
    ]);
  });

  test("does not cache a partial OpenRouter catalog", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/images/models")) throw new Error("image catalog down");
      if (url.endsWith("/videos/models")) return [];
      return [
        {
          id: "remote/text-only",
          architecture: { output_modalities: ["text"] },
        },
      ];
    });

    const result = await fetchModelCatalog("openrouter", {
      cache: false,
      fetch: fetchMock,
    });

    expect(result.lookup.some((model) => model.id === "remote/text-only")).toBe(
      false
    );
    expect(result.lookup.some((model) => model.id === "openai/gpt-5.5")).toBe(
      true
    );
  });

  test("falls back to built-in models when discovery fails", async () => {
    const result = await fetchModelCatalog("openrouter", {
      cache: false,
      fetch: (() =>
        Promise.reject(new Error("offline"))) as unknown as typeof fetch,
    });

    expect(result.text.some((model) => model.id === "openai/gpt-5.5")).toBe(
      true
    );
    expect(
      result.image.some((model) => model.id === "openai/gpt-image-2")
    ).toBe(true);
  });

  test("reuses the local cache", async () => {
    const cacheDir = join(
      "/tmp",
      `ai-cli-model-test-${process.pid}-${Date.now()}`
    );
    process.env.AI_CLI_CACHE_DIR = cacheDir;
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls++;
      return {
        openai: {
          models: {
            "gpt-5.5": { modalities: { output: ["text"] } },
          },
        },
      };
    });

    await fetchModelCatalog("openai", { fetch: fetchMock, now: 1_000 });
    resetModelCache();
    await fetchModelCatalog("openai", { fetch: fetchMock, now: 2_000 });

    expect(calls).toBe(1);
    await rm(cacheDir, { recursive: true, force: true });
  });
});

function targetEntry(
  id: string,
  creator: string,
  capability: "text"
): ModelEntry {
  return { id, creator, capabilities: [capability] };
}

function mockFetch(responseForUrl: (url: string) => unknown): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return new Response(JSON.stringify({ data: responseForUrl(url) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}
