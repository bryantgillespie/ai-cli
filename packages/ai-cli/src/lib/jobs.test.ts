import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

import { buildJobs, runJobs } from "./jobs.js";
import type { ModelTarget } from "./models.js";

function targets(...modelIds: string[]): ModelTarget[] {
  return modelIds.map((modelId) => ({
    provider: "openrouter",
    modelId,
    reference: `openrouter:${modelId}`,
  }));
}

async function withTempCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "ai-cli-jobs-"));
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function captureStdout(fn: () => Promise<void>): Promise<Buffer> {
  const originalWrite = process.stdout.write;
  const chunks: Uint8Array[] = [];
  (
    process.stdout as {
      write: (chunk: string | Uint8Array) => boolean;
    }
  ).write = (chunk) => {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk
    );
    return true;
  };

  try {
    await fn();
  } finally {
    (
      process.stdout as {
        write: typeof originalWrite;
      }
    ).write = originalWrite;
  }

  return Buffer.concat(chunks);
}

describe("buildJobs", () => {
  test("preserves provider routing for concurrent model targets", () => {
    const jobs = buildJobs(
      [
        {
          provider: "openrouter",
          modelId: "anthropic/claude-sonnet-4",
          reference: "openrouter:anthropic/claude-sonnet-4",
        },
        {
          provider: "ollama",
          modelId: "qwen3:latest",
          reference: "ollama:qwen3:latest",
        },
      ],
      1
    );

    expect(
      jobs.map(({ provider, modelId, reference }) => ({
        provider,
        modelId,
        reference,
      }))
    ).toEqual([
      {
        provider: "openrouter",
        modelId: "anthropic/claude-sonnet-4",
        reference: "openrouter:anthropic/claude-sonnet-4",
      },
      {
        provider: "ollama",
        modelId: "qwen3:latest",
        reference: "ollama:qwen3:latest",
      },
    ]);
  });
});

describe("runJobs", () => {
  test("json mode writes single binary output to a file and keeps stdout JSON-only", async () => {
    await withTempCwd(async () => {
      const stdout = await captureStdout(async () => {
        await runJobs(
          buildJobs(targets("openai/tts-1"), 1),
          async () => ({
            data: Buffer.from([1, 2, 3]),
            id: "speech_123",
          }),
          {
            noun: "audio",
            format: "audio",
            json: true,
            quiet: true,
            concurrency: 1,
          }
        );
      });

      expect(stdout[0]).toBe("{".charCodeAt(0));
      const meta = JSON.parse(stdout.toString("utf8")) as {
        count: number;
        results: Array<{ file: string | null }>;
      };
      const file = meta.results[0]?.file;

      expect(meta.count).toBe(1);
      expect(file).not.toBeNull();
      expect(basename(file!)).toBe("speech_123.mp3");
      expect(readFileSync(file!)).toEqual(Buffer.from([1, 2, 3]));
    });
  });

  test("json mode writes multi-run binary outputs to files and keeps stdout JSON-only", async () => {
    await withTempCwd(async () => {
      const stdout = await captureStdout(async () => {
        await runJobs(
          buildJobs(targets("openai/tts-1"), 2),
          async () => ({
            data: Buffer.from([4, 5, 6]),
            id: "speech_456",
          }),
          {
            noun: "audio",
            format: "audio",
            json: true,
            quiet: true,
            concurrency: 1,
          }
        );
      });

      expect(stdout[0]).toBe("{".charCodeAt(0));
      const meta = JSON.parse(stdout.toString("utf8")) as {
        count: number;
        results: Array<{ file: string | null }>;
      };

      expect(meta.count).toBe(2);
      expect(meta.results.map((r) => basename(r.file!)).sort()).toEqual([
        "speech_456-1.mp3",
        "speech_456-2.mp3",
      ]);
      for (const result of meta.results) {
        expect(readFileSync(result.file!)).toEqual(Buffer.from([4, 5, 6]));
      }
    });
  });

  test("json mode reports multi-run results in job order", async () => {
    await withTempCwd(async () => {
      const delays: Record<string, number> = {
        slow: 30,
        medium: 10,
        fast: 0,
      };

      const stdout = await captureStdout(async () => {
        await runJobs(
          buildJobs(targets("slow", "medium", "fast"), 1),
          async (target) => {
            await new Promise((resolve) =>
              setTimeout(resolve, delays[target.modelId] ?? 0)
            );
            return {
              data: target.modelId,
              id: target.modelId,
            };
          },
          {
            noun: "text",
            format: "txt",
            json: true,
            quiet: true,
            concurrency: 3,
          }
        );
      });

      const meta = JSON.parse(stdout.toString("utf8")) as {
        results: Array<{
          index: number;
          provider: string;
          model: string;
        }>;
      };

      expect(meta.results.map((r) => r.index)).toEqual([1, 2, 3]);
      expect(meta.results.map((r) => r.provider)).toEqual([
        "openrouter",
        "openrouter",
        "openrouter",
      ]);
      expect(meta.results.map((r) => r.model)).toEqual([
        "slow",
        "medium",
        "fast",
      ]);
    });
  });

  test("passes saved outputs to afterOutputs in job order", async () => {
    await withTempCwd(async (dir) => {
      const seen: Array<{ model: string; file: string | null }> = [];

      await runJobs(
        buildJobs(targets("slow", "fast"), 1),
        async (target) => {
          if (target.modelId === "slow") {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return {
            data: target.modelId,
            id: target.modelId,
          };
        },
        {
          noun: "text",
          format: "txt",
          outputPath: dir,
          quiet: true,
          concurrency: 2,
          afterOutputs: (outputs) => {
            seen.push(
              ...outputs.map((o) => ({ model: o.model, file: o.file }))
            );
          },
        }
      );

      expect(seen.map((o) => o.model)).toEqual(["slow", "fast"]);
      expect(seen.map((o) => basename(o.file!))).toEqual([
        "slow-1.txt",
        "fast-2.txt",
      ]);
    });
  });
});
