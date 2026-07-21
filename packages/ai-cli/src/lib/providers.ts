import { createFal } from "@ai-sdk/fal";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  experimental_generateVideo,
  type ImageModel,
  type LanguageModel,
  type SpeechModel,
  type TranscriptionModel,
} from "ai";

type VideoModel = Parameters<typeof experimental_generateVideo>[0]["model"];

export const PROVIDER_IDS = [
  "openrouter",
  "openai",
  "fal",
  "ollama",
  "omlx",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderAdapter {
  id: ProviderId;
  languageModel?: (modelId: string) => LanguageModel;
  imageModel?: (modelId: string) => ImageModel;
  videoModel?: (modelId: string) => VideoModel;
  speechModel?: (modelId: string) => SpeechModel;
  transcriptionModel?: (modelId: string) => TranscriptionModel;
}

export function resolveProviderId(input?: string): ProviderId {
  const value = input ?? process.env.AI_CLI_PROVIDER ?? "openrouter";
  if (PROVIDER_IDS.includes(value as ProviderId)) return value as ProviderId;
  throw new Error(
    `provider must be one of: ${PROVIDER_IDS.join(", ")} (got "${value}")`
  );
}

export function createProvider(input?: string): ProviderAdapter {
  const id = resolveProviderId(input);
  assertCredential(id);

  switch (id) {
    case "openrouter": {
      const provider = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
        compatibility: "strict",
      });
      return {
        id,
        languageModel: (modelId) => provider.chat(modelId),
        imageModel: (modelId) => provider.imageModel(modelId),
        videoModel: (modelId) => provider.videoModel(modelId),
      };
    }
    case "openai": {
      const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return {
        id,
        languageModel: (modelId) => provider(modelId),
        imageModel: (modelId) => provider.image(modelId),
        speechModel: (modelId) => provider.speech(modelId),
        transcriptionModel: (modelId) => provider.transcription(modelId),
      };
    }
    case "fal": {
      const provider = createFal({
        apiKey: process.env.FAL_API_KEY ?? process.env.FAL_KEY,
      });
      return {
        id,
        imageModel: (modelId) => provider.image(modelId),
        videoModel: (modelId) => provider.video(modelId),
        speechModel: (modelId) => provider.speech(modelId),
        transcriptionModel: (modelId) => provider.transcription(modelId),
      };
    }
    case "ollama":
    case "omlx": {
      const provider = createOpenAICompatible({
        name: id,
        baseURL: localProviderBaseUrl(id),
        apiKey:
          id === "ollama"
            ? process.env.OLLAMA_API_KEY
            : process.env.OMLX_API_KEY,
      });
      return {
        id,
        languageModel: (modelId) => provider.chatModel(modelId),
      };
    }
  }
}

export function createProviderResolver(): (
  provider: ProviderId
) => ProviderAdapter {
  const providers = new Map<ProviderId, ProviderAdapter>();
  return (provider) => {
    let adapter = providers.get(provider);
    if (!adapter) {
      adapter = createProvider(provider);
      providers.set(provider, adapter);
    }
    return adapter;
  };
}

export function localProviderBaseUrl(provider: "ollama" | "omlx"): string {
  const configured =
    provider === "ollama"
      ? process.env.OLLAMA_BASE_URL
      : process.env.OMLX_BASE_URL;
  return trimTrailingSlash(
    configured ??
      (provider === "ollama"
        ? "http://127.0.0.1:11434/v1"
        : "http://127.0.0.1:8000/v1")
  );
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getLanguageModel(
  provider: ProviderAdapter,
  modelId: string
): LanguageModel {
  return requireCapability(provider, "text", provider.languageModel)(modelId);
}

export function getImageModel(
  provider: ProviderAdapter,
  modelId: string
): ImageModel {
  return requireCapability(provider, "image", provider.imageModel)(modelId);
}

export function getVideoModel(
  provider: ProviderAdapter,
  modelId: string
): VideoModel {
  return requireCapability(provider, "video", provider.videoModel)(modelId);
}

export function getSpeechModel(
  provider: ProviderAdapter,
  modelId: string
): SpeechModel {
  return requireCapability(provider, "speech", provider.speechModel)(modelId);
}

export function getTranscriptionModel(
  provider: ProviderAdapter,
  modelId: string
): TranscriptionModel {
  return requireCapability(
    provider,
    "transcription",
    provider.transcriptionModel
  )(modelId);
}

function requireCapability<T>(
  provider: ProviderAdapter,
  capability: string,
  factory: ((modelId: string) => T) | undefined
): (modelId: string) => T {
  if (factory) return factory;
  throw new Error(
    `${capability} generation is not supported by provider "${provider.id}"`
  );
}

function assertCredential(provider: ProviderId): void {
  if (provider === "ollama" || provider === "omlx") return;

  const available =
    provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : provider === "openai"
        ? process.env.OPENAI_API_KEY
        : (process.env.FAL_API_KEY ?? process.env.FAL_KEY);

  if (available) return;

  const variable =
    provider === "openrouter"
      ? "OPENROUTER_API_KEY"
      : provider === "openai"
        ? "OPENAI_API_KEY"
        : "FAL_API_KEY or FAL_KEY";
  throw new Error(`provider "${provider}" requires ${variable}`);
}
