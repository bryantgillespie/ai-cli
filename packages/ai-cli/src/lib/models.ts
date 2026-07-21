import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

import {
  localProviderBaseUrl,
  PROVIDER_IDS,
  type ProviderId,
} from "./providers.js";

export type Modality = "text" | "image" | "video" | "speech" | "transcription";

const DEFAULTS: Record<ProviderId, Record<Modality, string | null>> = {
  openrouter: {
    text: "openai/gpt-5.5",
    image: "openai/gpt-image-2",
    video: "bytedance/seedance-2.0",
    speech: "",
    transcription: "",
  },
  anthropic: {
    text: "claude-sonnet-4-6",
    image: "",
    video: "",
    speech: "",
    transcription: "",
  },
  openai: {
    text: "gpt-5.5",
    image: "gpt-image-2",
    video: "",
    speech: "tts-1",
    transcription: "whisper-1",
  },
  fal: {
    text: "",
    image: "fal-ai/flux-pro/v1.1-ultra",
    video: "fal-ai/luma-dream-machine/ray-2",
    speech: "fal-ai/minimax/speech-02-hd",
    transcription: "whisper",
  },
  ollama: {
    text: null,
    image: "",
    video: "",
    speech: "",
    transcription: "",
  },
  omlx: {
    text: null,
    image: "",
    video: "",
    speech: "",
    transcription: "",
  },
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_IMAGE_MODELS_URL =
  "https://openrouter.ai/api/v1/images/models";
const OPENROUTER_VIDEO_MODELS_URL =
  "https://openrouter.ai/api/v1/videos/models";
const MODELS_DEV_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1_000;

export interface ModelPricing {
  input?: string;
  output?: string;
  image?: string;
  [key: string]: unknown;
}

export interface ModelEntry {
  id: string;
  name?: string;
  description?: string;
  creator: string;
  capabilities: Modality[];
  pricing?: ModelPricing;
  contextWindow?: number;
  maxTokens?: number;
  released?: number;
  tags?: string[];
}

export interface ModelCatalog {
  provider: ProviderId;
  text: ModelEntry[];
  image: ModelEntry[];
  video: ModelEntry[];
  speech: ModelEntry[];
  transcription: ModelEntry[];
  all: ModelEntry[];
  lookup: ModelEntry[];
}

interface CatalogCacheRecord {
  fetchedAt: number;
  entries: ModelEntry[];
}

interface FetchCatalogOptions {
  cache?: boolean;
  fetch?: typeof fetch;
  now?: number;
}

interface RawOpenRouterModel {
  id?: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
  };
}

interface RawModelsDevModel {
  id?: string;
  name?: string;
  description?: string;
  release_date?: string;
  modalities?: {
    output?: string[];
  };
  cost?: {
    input?: number;
    output?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
}

interface RawCompatibleModel {
  id?: string;
  owned_by?: string;
}

const BUILTIN_MODELS: Record<ProviderId, ModelEntry[]> = {
  openrouter: [
    entry("openai/gpt-5.5", "text"),
    entry("openai/gpt-image-2", "image"),
    entry("bytedance/seedance-2.0", "video"),
  ],
  anthropic: [entry("claude-sonnet-4-6", "text", "anthropic")],
  openai: [
    entry("gpt-5.5", "text", "openai"),
    entry("gpt-image-2", "image", "openai"),
    entry("tts-1", "speech", "openai"),
    entry("whisper-1", "transcription", "openai"),
  ],
  fal: [
    entry("fal-ai/flux-pro/v1.1-ultra", "image", "fal-ai"),
    entry("fal-ai/luma-dream-machine/ray-2", "video", "fal-ai"),
    entry("fal-ai/minimax/speech-02-hd", "speech", "fal-ai"),
    entry("whisper", "transcription", "fal"),
  ],
  ollama: [],
  omlx: [],
};

const memoryCache = new Map<ProviderId, Promise<ModelCatalog>>();

export function fetchModelCatalog(
  provider: ProviderId,
  options: FetchCatalogOptions = {}
): Promise<ModelCatalog> {
  if (options.cache === false) return fetchCatalog(provider, options);

  let cached = memoryCache.get(provider);
  if (!cached) {
    cached = fetchCatalog(provider, options).catch((error) => {
      memoryCache.delete(provider);
      throw error;
    });
    memoryCache.set(provider, cached);
  }
  return cached;
}

export function resetModelCache(): void {
  memoryCache.clear();
}

async function fetchCatalog(
  provider: ProviderId,
  options: FetchCatalogOptions
): Promise<ModelCatalog> {
  const now = options.now ?? Date.now();
  const useCache = options.cache !== false;
  const cached = useCache ? await readCache(provider) : null;
  const cacheTtl = isLocalProvider(provider) ? 0 : CACHE_TTL_MS;
  if (cached && now - cached.fetchedAt < cacheTtl) {
    return buildCatalog(provider, cached.entries);
  }

  try {
    const remote =
      provider === "openrouter"
        ? await fetchOpenRouterModels(options.fetch ?? fetch)
        : provider === "anthropic" || provider === "openai"
          ? await fetchModelsDevProvider(provider, options.fetch ?? fetch)
          : isLocalProvider(provider)
            ? await fetchCompatibleModels(provider, options.fetch ?? fetch)
            : [];
    const entries = mergeEntries([...BUILTIN_MODELS[provider], ...remote]);
    if (useCache) await writeCache(provider, { fetchedAt: now, entries });
    return buildCatalog(provider, entries);
  } catch {
    process.stderr.write(
      `Warning: could not refresh ${provider} models; using cached defaults\n`
    );
    return buildCatalog(provider, cached?.entries ?? BUILTIN_MODELS[provider]);
  }
}

async function fetchOpenRouterModels(
  fetchImpl: typeof fetch
): Promise<ModelEntry[]> {
  const results = await Promise.all([
    fetchJson<RawOpenRouterModel[]>(fetchImpl, OPENROUTER_MODELS_URL),
    fetchJson<RawOpenRouterModel[]>(fetchImpl, OPENROUTER_IMAGE_MODELS_URL),
    fetchJson<RawOpenRouterModel[]>(fetchImpl, OPENROUTER_VIDEO_MODELS_URL),
  ]);

  const entries: ModelEntry[] = [];
  for (const [index, models] of results.entries()) {
    const forcedCapability: Modality | null =
      index === 1 ? "image" : index === 2 ? "video" : null;
    for (const model of models) {
      if (!model.id) continue;
      const capabilities = forcedCapability
        ? [forcedCapability]
        : capabilitiesFromOutputs(model.architecture?.output_modalities);
      if (capabilities.length === 0) continue;
      entries.push({
        id: model.id,
        name: model.name,
        description: model.description,
        creator: creatorFromId(model.id),
        capabilities,
        pricing: normalizeOpenRouterPricing(model.pricing),
        contextWindow: model.context_length,
        maxTokens: model.top_provider?.max_completion_tokens,
        released: model.created,
      });
    }
  }
  return entries;
}

async function fetchModelsDevProvider(
  provider: "anthropic" | "openai",
  fetchImpl: typeof fetch
): Promise<ModelEntry[]> {
  const providers = await fetchJson<
    Record<string, { models?: Record<string, RawModelsDevModel> }>
  >(fetchImpl, MODELS_DEV_URL);
  const models = providers[provider]?.models ?? {};

  return Object.entries(models).flatMap(([id, model]) => {
    const capabilities = capabilitiesFromOutputs(
      model.modalities?.output
    ).filter(
      (capability) =>
        capability === "text" ||
        (provider === "openai" && capability === "image")
    );
    if (capabilities.length === 0) return [];
    return [
      {
        id: model.id ?? id,
        name: model.name,
        description: model.description,
        creator: provider,
        capabilities,
        pricing: normalizeModelsDevPricing(model.cost),
        contextWindow: model.limit?.context,
        maxTokens: model.limit?.output,
        released: parseDate(model.release_date),
      },
    ];
  });
}

async function fetchCompatibleModels(
  provider: "ollama" | "omlx",
  fetchImpl: typeof fetch
): Promise<ModelEntry[]> {
  const apiKey =
    provider === "ollama"
      ? process.env.OLLAMA_API_KEY
      : process.env.OMLX_API_KEY;
  const models = await fetchJson<RawCompatibleModel[]>(
    fetchImpl,
    `${localProviderBaseUrl(provider)}/models`,
    apiKey ? { authorization: `Bearer ${apiKey}` } : undefined
  );
  return models.flatMap((model) =>
    model.id ? [entry(model.id, "text", model.owned_by || provider)] : []
  );
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  headers?: Record<string, string>
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "ai-cli", ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = (await response.json()) as { data?: T } | T;
  if (typeof json === "object" && json !== null && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function buildCatalog(provider: ProviderId, input: ModelEntry[]): ModelCatalog {
  const lookup = mergeEntries(input);
  const byCapability = (capability: Modality) =>
    lookup.filter((model) => model.capabilities.includes(capability));
  return {
    provider,
    text: byCapability("text"),
    image: byCapability("image"),
    video: byCapability("video"),
    speech: byCapability("speech"),
    transcription: byCapability("transcription"),
    all: lookup.filter((model) => model.capabilities.length > 0),
    lookup,
  };
}

function mergeEntries(entries: ModelEntry[]): ModelEntry[] {
  const merged = new Map<string, ModelEntry>();
  for (const model of entries) {
    const current = merged.get(model.id);
    if (!current) {
      merged.set(model.id, model);
      continue;
    }
    merged.set(model.id, {
      ...current,
      ...withoutUndefined(model),
      capabilities: [
        ...new Set([...current.capabilities, ...model.capabilities]),
      ],
    });
  }
  return [...merged.values()];
}

function withoutUndefined(model: ModelEntry): Partial<ModelEntry> {
  return Object.fromEntries(
    Object.entries(model).filter(([, value]) => value !== undefined)
  ) as Partial<ModelEntry>;
}

function capabilitiesFromOutputs(outputs?: string[]): Modality[] {
  const capabilities: Modality[] = [];
  if (outputs?.includes("text")) capabilities.push("text");
  if (outputs?.includes("image")) capabilities.push("image");
  if (outputs?.includes("video")) capabilities.push("video");
  return capabilities;
}

function normalizeOpenRouterPricing(
  pricing?: RawOpenRouterModel["pricing"]
): ModelPricing | undefined {
  if (!pricing) return undefined;
  const normalized = {
    input: pricing.prompt,
    output: pricing.completion,
    image: pricing.image,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function normalizeModelsDevPricing(
  cost?: RawModelsDevModel["cost"]
): ModelPricing | undefined {
  if (!cost) return undefined;
  const normalized = {
    input: cost.input == null ? undefined : String(cost.input / 1_000_000),
    output: cost.output == null ? undefined : String(cost.output / 1_000_000),
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function parseDate(value?: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : undefined;
}

function entry(
  id: string,
  capability: Modality,
  creator = creatorFromId(id)
): ModelEntry {
  return { id, creator, capabilities: [capability] };
}

function creatorFromId(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? "other" : id.slice(0, slash);
}

function cachePath(provider: ProviderId): string {
  const root =
    process.env.AI_CLI_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ai-cli");
  return join(root, `models-${provider}.json`);
}

async function readCache(
  provider: ProviderId
): Promise<CatalogCacheRecord | null> {
  try {
    const value = JSON.parse(await readFile(cachePath(provider), "utf8")) as {
      fetchedAt?: unknown;
      entries?: unknown;
    };
    if (
      typeof value.fetchedAt !== "number" ||
      !Array.isArray(value.entries) ||
      !value.entries.every(isModelEntry)
    ) {
      return null;
    }
    return value as CatalogCacheRecord;
  } catch {
    return null;
  }
}

async function writeCache(
  provider: ProviderId,
  value: CatalogCacheRecord
): Promise<void> {
  const path = cachePath(provider);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value), "utf8");
  } catch {
    // Model discovery still works when the cache is not writable.
  }
}

function isModelEntry(value: unknown): value is ModelEntry {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Partial<ModelEntry>;
  return (
    typeof model.id === "string" &&
    typeof model.creator === "string" &&
    Array.isArray(model.capabilities) &&
    model.capabilities.every((item) =>
      ["text", "image", "video", "speech", "transcription"].includes(item)
    )
  );
}

export interface ModelTarget {
  provider: ProviderId;
  modelId: string;
  reference: string;
}

export function resolveModels(
  provider: ProviderId,
  modality: Modality,
  userModel?: string
): ModelTarget[] {
  const configured =
    userModel ?? process.env[modelEnvironmentVariable(modality)];
  if (configured) {
    const models = configured
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean)
      .map((model) => parseModelTarget(model, provider));
    if (models.length > 0) return models;
  }

  const fallback = DEFAULTS[provider][modality];
  if (fallback === null) {
    throw new Error(
      `${modality} model is required for provider "${provider}"; use -m or ${modelEnvironmentVariable(modality)}`
    );
  }
  if (!fallback) {
    throw new Error(
      `${modality} generation is not supported by provider "${provider}"`
    );
  }
  return [modelTarget(provider, fallback)];
}

export function parseModelTarget(
  input: string,
  defaultProvider: ProviderId
): ModelTarget {
  const separator = input.indexOf(":");
  const prefix = separator === -1 ? "" : input.slice(0, separator);
  const provider = isProviderId(prefix) ? prefix : defaultProvider;
  const rawModelId = isProviderId(prefix) ? input.slice(separator + 1) : input;
  if (!rawModelId) throw new Error(`model ID is required after "${provider}:"`);
  return modelTarget(provider, normalizeModelId(provider, rawModelId));
}

function modelTarget(provider: ProviderId, modelId: string): ModelTarget {
  return { provider, modelId, reference: `${provider}:${modelId}` };
}

function normalizeModelId(provider: ProviderId, modelId: string): string {
  const creatorPrefix =
    provider === "anthropic"
      ? "anthropic/"
      : provider === "openai"
        ? "openai/"
        : undefined;
  return creatorPrefix && modelId.startsWith(creatorPrefix)
    ? modelId.slice(creatorPrefix.length)
    : modelId;
}

function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

function isLocalProvider(provider: ProviderId): provider is "ollama" | "omlx" {
  return provider === "ollama" || provider === "omlx";
}

function modelEnvironmentVariable(modality: Modality): string {
  return `AI_CLI_${modality.toUpperCase()}_MODEL`;
}

export function expandModelId(
  input: string,
  knownModels?: Pick<ModelEntry, "id">[]
): string {
  if (input.includes("/") || !knownModels) return input;
  const matches = knownModels.filter(
    (model) => model.id.slice(model.id.indexOf("/") + 1) === input
  );
  return matches.length === 1 ? matches[0].id : input;
}
