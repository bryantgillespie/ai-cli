import { experimental_generateVideo as generateVideo } from "ai";

import type { Command } from "../lib/command.js";
import {
  collectImageReference,
  loadImageReferences,
  type ImageReference,
} from "../lib/image-references.js";
import { buildJobs, runJobs } from "../lib/jobs.js";
import { resolveModels } from "../lib/models.js";
import {
  parsePositiveInt,
  parseAspectRatio,
  parseNonNegativeFloat,
  parseSize,
} from "../lib/parse.js";
import {
  createProviderResolver,
  getVideoModel,
  resolveProviderId,
} from "../lib/providers.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 300_000;

interface VideoOptions {
  provider?: string;
  model?: string;
  output?: string;
  image?: string[];
  count?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency?: string;
  preview?: boolean;
  timeout: number;
}

export function registerVideoCommand(program: Command) {
  const command = program
    .command("video")
    .description("Generate a video from a prompt")
    .argument("[prompt]", "The prompt to generate a video from")
    .option(
      "-P, --provider <provider>",
      "Default provider: openrouter, fal (default: openrouter)"
    )
    .option(
      "-m, --model <model>",
      "Model ID; prefix with provider: to mix providers"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option(
      "-i, --image <path-or-url>",
      "Image input path or URL",
      collectImageReference,
      []
    )
    .option("-n, --count <n>", "Number of videos per model (default: 1)")
    .option("--aspect-ratio <W:H>", "Aspect ratio (e.g. 16:9)")
    .option("--resolution <WxH>", "Video resolution (e.g. 1920x1080)")
    .option("--duration <seconds>", "Video duration in seconds")
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .option(
      "--no-preview",
      "Disable inline video frame preview in supported terminals"
    )
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    );
  addTimeoutOption(command, DEFAULT_TIMEOUT_MS).action(
    async (rawPrompt: string | undefined, opts: VideoOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      const imageReferenceInputs = opts.image ?? [];
      if (!prompt && !stdin && imageReferenceInputs.length === 0) {
        process.stderr.write(
          "Error: prompt or image is required (provide a prompt, --image, or pipe an image via stdin)\n"
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
      if (images.length > 1) {
        process.stderr.write(
          "Error: video generation accepts one input image; provide one --image value or pipe one image via stdin\n"
        );
        process.exit(1);
      }

      let videoPrompt: string | { image: ImageReference; text?: string } =
        prompt!;
      if (images.length > 0) {
        videoPrompt = prompt
          ? { image: images[0]!, text: prompt }
          : { image: images[0]! };
      }

      const defaultProvider = resolveProviderId(opts.provider);
      const models = resolveModels(defaultProvider, "video", opts.model);
      const providerFor = createProviderResolver();
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const generationOptions = videoGenerationOptions(opts);

      const jobs = buildJobs(models, countPerModel);

      const { total, failed } = await runJobs(
        jobs,
        async (target) => {
          const abort = AbortSignal.timeout(timeoutMs(opts.timeout));
          const result = await generateVideo({
            model: getVideoModel(providerFor(target.provider), target.modelId),
            prompt: videoPrompt,
            abortSignal: abort,
            ...generationOptions,
          });
          return {
            data: Buffer.from(result.video.uint8Array),
            id: responseIdFromHeaders(result.responses[0]?.headers),
          };
        },
        {
          noun: "video",
          format: "video",
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
    }
  );
}

export function videoGenerationOptions(opts: {
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
}) {
  return {
    aspectRatio: opts.aspectRatio
      ? parseAspectRatio(opts.aspectRatio)
      : undefined,
    resolution: opts.resolution
      ? parseSize(opts.resolution, "resolution")
      : undefined,
    duration: opts.duration
      ? parseNonNegativeFloat(opts.duration, "duration")
      : undefined,
  };
}
