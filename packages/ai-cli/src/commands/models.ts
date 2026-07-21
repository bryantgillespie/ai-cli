import type { Command } from "commander";

import {
  formatPerUnitPrice,
  formatPricePerMillion,
  formatReleaseDate,
  formatTokenCount,
  formatWebSearchPrice,
} from "../lib/format.js";
import {
  expandModelId,
  fetchModelCatalog,
  parseModelTarget,
  type Modality,
  type ModelCatalog,
  type ModelEntry,
} from "../lib/models.js";
import {
  PROVIDER_IDS,
  resolveProviderId,
  type ProviderId,
} from "../lib/providers.js";

type ModelFilter = Modality | "audio";
type ProviderSelection = ProviderId | "all";

function groupByCreator(models: ModelEntry[]): Map<string, ModelEntry[]> {
  const groups = new Map<string, ModelEntry[]>();
  for (const m of models) {
    if (!groups.has(m.creator)) groups.set(m.creator, []);
    groups.get(m.creator)!.push(m);
  }
  return new Map(
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function modelName(id: string): string {
  const slash = id.indexOf("/");
  return slash !== -1 ? id.slice(slash + 1) : id;
}

function pricingString(pricing: ModelEntry["pricing"], key: string) {
  const value = pricing?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function showModelInfo(
  input: string,
  json: boolean,
  selection: ProviderSelection
): Promise<void> {
  const provider = providerForModelInfo(input, selection);
  const target = parseModelTarget(input, provider);
  const catalog = await fetchModelCatalog(target.provider);
  const id = expandModelId(target.modelId, catalog.lookup);
  const entry = catalog.lookup.find((model) => model.id === id);
  if (!entry) {
    process.stderr.write(
      `Error: model not found: ${input}\nRun "ai models" to list available models\n`
    );
    process.exit(1);
  }

  if (json) {
    const output = {
      provider: target.provider,
      id: entry.id,
      reference: `${target.provider}:${entry.id}`,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      creator: entry.creator,
      capabilities: entry.capabilities,
      ...(entry.tags ? { tags: entry.tags } : {}),
      ...(entry.contextWindow != null
        ? { contextWindow: entry.contextWindow }
        : {}),
      ...(entry.maxTokens != null ? { maxTokens: entry.maxTokens } : {}),
      ...(entry.released != null ? { released: entry.released } : {}),
      ...(entry.pricing ? { pricing: entry.pricing } : {}),
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return;
  }

  process.stdout.write(
    entry.name
      ? `\n${entry.name}  ${target.provider}:${entry.id}\n`
      : `\n${target.provider}:${entry.id}\n`
  );

  const meta: string[] = [];
  if (entry.released != null)
    meta.push(`Released ${formatReleaseDate(entry.released)}`);
  if (entry.tags) meta.push(...entry.tags);
  if (meta.length > 0) process.stdout.write(`${meta.join(" · ")}\n`);
  if (entry.description) process.stdout.write(`\n${entry.description}\n`);

  const rows: [string, string][] = [];
  if (entry.contextWindow)
    rows.push(["Context", formatTokenCount(entry.contextWindow)]);
  if (entry.maxTokens)
    rows.push(["Max output", formatTokenCount(entry.maxTokens)]);

  const tokenPrices: [string, string][] = [
    ["Input", "input"],
    ["Output", "output"],
    ["Cache read", "input_cache_read"],
    ["Cache write", "input_cache_write"],
  ];
  for (const [label, key] of tokenPrices) {
    const value = pricingString(entry.pricing, key);
    if (value) rows.push([label, formatPricePerMillion(value)]);
  }
  const webSearch = pricingString(entry.pricing, "web_search");
  if (webSearch && Number.parseFloat(webSearch) > 0)
    rows.push(["Web search", formatWebSearchPrice(webSearch)]);
  const imagePrice = pricingString(entry.pricing, "image");
  if (imagePrice) rows.push(["Image", formatPerUnitPrice(imagePrice, "image")]);

  if (rows.length > 0) {
    const width = Math.max(...rows.map(([label]) => label.length));
    process.stdout.write("\n");
    for (const [label, value] of rows) {
      process.stdout.write(`  ${label.padEnd(width + 2)}${value}\n`);
    }
  }

  process.stdout.write("\n");
}

function resolveProviderSelection(input?: string): ProviderSelection {
  const value = input ?? process.env.AI_CLI_PROVIDER ?? "openrouter";
  return value === "all" ? value : resolveProviderId(value);
}

function providerForModelInfo(
  input: string,
  selection: ProviderSelection
): ProviderId {
  if (selection !== "all") return selection;
  const prefix = input.slice(0, input.indexOf(":"));
  if (PROVIDER_IDS.includes(prefix as ProviderId)) return prefix as ProviderId;
  throw new Error(
    'model must use a provider-qualified ID with "--provider all"'
  );
}

function filterEntries(
  entries: ModelEntry[],
  filterType?: ModelFilter,
  filterCreator?: string
): ModelEntry[] {
  return entries.filter((model) => {
    const matchesType = filterType
      ? filterType === "audio"
        ? model.capabilities.includes("speech") ||
          model.capabilities.includes("transcription")
        : model.capabilities.includes(filterType)
      : true;
    const matchesCreator = filterCreator
      ? model.creator.toLowerCase() === filterCreator
      : true;
    return matchesType && matchesCreator;
  });
}

function catalogSections(
  catalog: ModelCatalog,
  filterType?: ModelFilter
): { title: string; entries: ModelEntry[] }[] {
  const sections: { title: string; entries: ModelEntry[] }[] = [];
  if (!filterType || filterType === "text")
    sections.push({ title: "Text", entries: catalog.text });
  if (!filterType || filterType === "image")
    sections.push({ title: "Image", entries: catalog.image });
  if (!filterType || filterType === "video")
    sections.push({ title: "Video", entries: catalog.video });
  if (!filterType || filterType === "audio" || filterType === "speech")
    sections.push({ title: "Speech", entries: catalog.speech });
  if (!filterType || filterType === "audio" || filterType === "transcription") {
    sections.push({
      title: "Transcription",
      entries: catalog.transcription,
    });
  }
  return sections;
}

export function registerModelsCommand(program: Command) {
  program
    .command("models")
    .description("List available models for a provider")
    .argument(
      "[model]",
      "Show detailed info for a model (e.g. anthropic/claude-opus-4.6)"
    )
    .option(
      "-P, --provider <provider>",
      "Provider: openrouter, openai, fal, ollama, omlx, all (default: openrouter)"
    )
    .option(
      "--type <type>",
      "Filter by type: text, image, video, audio, speech, transcription"
    )
    .option("--creator <name>", "Filter by creator (e.g. openai, google)")
    .option("--json", "Output as JSON (includes descriptions)")
    .action(
      async (
        model: string | undefined,
        opts: {
          provider?: string;
          type?: string;
          creator?: string;
          json?: boolean;
        }
      ) => {
        const provider = resolveProviderSelection(opts.provider);
        if (model) {
          if (opts.type || opts.creator) {
            process.stderr.write(
              "Error: --type and --creator cannot be used with a model argument\n"
            );
            process.exit(1);
          }
          await showModelInfo(model, opts.json ?? false, provider);
          return;
        }
        const validTypes = [
          "text",
          "image",
          "video",
          "audio",
          "speech",
          "transcription",
        ];
        const filterType = opts.type?.toLowerCase() as ModelFilter | undefined;
        if (filterType && !validTypes.includes(filterType)) {
          process.stderr.write(
            `Error: --type must be one of: ${validTypes.join(", ")} (got "${opts.type}")\n`
          );
          process.exit(1);
        }
        const filterCreator = opts.creator?.toLowerCase();

        const providers = provider === "all" ? PROVIDER_IDS : [provider];
        const catalogs = await Promise.all(
          providers.map((id) => fetchModelCatalog(id))
        );

        if (opts.json) {
          const output = catalogs.flatMap((catalog) =>
            filterEntries(catalog.all, filterType, filterCreator).map((m) => ({
              provider: catalog.provider,
              id: m.id,
              reference: `${catalog.provider}:${m.id}`,
              ...(m.name ? { name: m.name } : {}),
              ...(m.description ? { description: m.description } : {}),
              creator: m.creator,
              capabilities: m.capabilities,
              ...(m.pricing ? { pricing: m.pricing } : {}),
            }))
          );
          process.stdout.write(JSON.stringify(output, null, 2) + "\n");
          return;
        }

        let totalCount = 0;
        for (const catalog of catalogs) {
          const sections = catalogSections(catalog, filterType);
          const providerCount = sections.reduce(
            (sum, section) =>
              sum +
              filterEntries(section.entries, undefined, filterCreator).length,
            0
          );
          if (providerCount === 0) continue;
          if (provider === "all") {
            process.stdout.write(`\n${catalog.provider}\n`);
          }
          for (const section of sections) {
            const entries = filterEntries(
              section.entries,
              undefined,
              filterCreator
            );
            const grouped = groupByCreator(entries);
            const count = [...grouped.values()].reduce(
              (sum, models) => sum + models.length,
              0
            );
            if (count === 0) continue;
            totalCount += count;
            process.stdout.write(`\n${section.title} models (${count}):\n`);
            for (const [creator, models] of grouped) {
              process.stdout.write(`\n  ${creator}\n`);
              for (const m of models) {
                const name =
                  provider === "all"
                    ? `${catalog.provider}:${m.id}`
                    : modelName(m.id);
                process.stdout.write(`    ${name}\n`);
              }
            }
          }
        }

        if (totalCount === 0) {
          process.stderr.write("No models found matching filters\n");
        } else {
          process.stdout.write("\n");
        }
      }
    );
}
