import { generateImage } from "ai";
import type { Command } from "commander";

import {
  collectImageReference,
  loadImageReferences,
  type ImageReference,
} from "../lib/image-references.js";
import { buildJobs, runJobs } from "../lib/jobs.js";
import { resolveModels } from "../lib/models.js";
import { parsePositiveInt, parseSize, parseAspectRatio } from "../lib/parse.js";
import {
  createProviderResolver,
  getImageModel,
  resolveProviderId,
  type ProviderId,
} from "../lib/providers.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin } from "../lib/stdin.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 300_000;

interface ImageOptions {
  provider?: string;
  model?: string;
  output?: string;
  image?: string[];
  count?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency?: string;
  preview?: boolean;
}

export function registerImageCommand(program: Command) {
  program
    .command("image")
    .description("Generate an image from a prompt")
    .argument("[prompt]", "The prompt to generate an image from")
    .option(
      "-P, --provider <provider>",
      "Default provider: openrouter, openai, fal (default: openrouter)"
    )
    .option(
      "-m, --model <model>",
      "Model ID; prefix with provider: to mix providers"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option(
      "-i, --image <path-or-url>",
      "Reference image path or URL (repeatable)",
      collectImageReference,
      []
    )
    .option("-n, --count <n>", "Number of images per model (default: 1)")
    .option("--size <WxH>", "Image size (e.g. 1024x1024)")
    .option("--aspect-ratio <W:H>", "Aspect ratio (e.g. 16:9)")
    .option("--quality <level>", "Provider/model-specific quality level")
    .option("--style <style>", "OpenAI model style (e.g. vivid, natural)")
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .option(
      "--no-preview",
      "Disable inline image preview in supported terminals"
    )
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    )
    .action(async (rawPrompt: string | undefined, opts: ImageOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      const imageReferenceInputs = opts.image ?? [];
      if (!prompt && !stdin && imageReferenceInputs.length === 0) {
        process.stderr.write(
          "Error: prompt or reference image is required (provide a prompt, --image, or pipe an image via stdin)\n"
        );
        process.exit(1);
      }

      let referenceImages: ImageReference[] = [];
      try {
        referenceImages = await loadImageReferences(imageReferenceInputs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }

      const images: ImageReference[] = [
        ...(stdin ? [new Uint8Array(stdin)] : []),
        ...referenceImages,
      ];

      let imagePrompt: string | { images: ImageReference[]; text?: string };
      if (images.length > 0) {
        imagePrompt = prompt ? { images, text: prompt } : { images };
      } else {
        imagePrompt = prompt!;
      }

      const defaultProvider = resolveProviderId(opts.provider);
      const models = resolveModels(defaultProvider, "image", opts.model);
      const providerFor = createProviderResolver();
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const size = opts.size ? parseSize(opts.size) : undefined;
      const aspectRatio = opts.aspectRatio
        ? parseAspectRatio(opts.aspectRatio)
        : undefined;
      if (opts.style && models.some((target) => target.provider !== "openai")) {
        process.stderr.write(
          "Warning: --style only applies to OpenAI targets\n"
        );
      }
      if (opts.quality && models.some((target) => target.provider === "fal")) {
        process.stderr.write(
          "Warning: --quality is not supported by FAL targets\n"
        );
      }

      const jobs = buildJobs(models, countPerModel);

      const { total, failed } = await runJobs(
        jobs,
        async (target) => {
          const abort = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
          const providerOptions = imageProviderOptions(target.provider, opts);
          const result = await generateImage({
            model: getImageModel(providerFor(target.provider), target.modelId),
            prompt: imagePrompt,
            abortSignal: abort,
            n: 1,
            size,
            aspectRatio,
            providerOptions:
              Object.keys(providerOptions).length > 0
                ? providerOptions
                : undefined,
          });
          return {
            data: Buffer.from(result.image.uint8Array),
            id: responseIdFromHeaders(result.responses[0]?.headers),
          };
        },
        {
          noun: "image",
          format: "image",
          outputPath: opts.output,
          quiet: opts.quiet,
          json: opts.json,
          display: opts.preview,
          concurrency: opts.concurrency
            ? parsePositiveInt(opts.concurrency, "concurrency")
            : DEFAULT_CONCURRENCY,
        }
      );
      if (failed === total) process.exit(1);
      if (failed > 0) process.exit(2);
    });
}

export function imageProviderOptions(
  provider: ProviderId,
  opts: ImageOptions
): Record<string, Record<string, string>> {
  if (provider === "openai" && (opts.quality || opts.style)) {
    return {
      openai: {
        ...(opts.quality ? { quality: opts.quality } : {}),
        ...(opts.style ? { style: opts.style } : {}),
      },
    };
  }
  if (provider === "openrouter" && opts.quality) {
    return { openrouter: { quality: opts.quality } };
  }
  return {};
}
