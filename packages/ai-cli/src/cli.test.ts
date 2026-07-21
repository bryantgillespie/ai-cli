import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import pkg from "../package.json";

const CLI = ["bun", "run", "src/index.ts"];
const ROOT = import.meta.dir + "/..";

async function run(...args: string[]) {
  return runWithEnv(args);
}

async function runWithEnv(
  args: string[],
  env?: Record<string, string | undefined>
) {
  const proc = Bun.spawn([...CLI, ...args], {
    cwd: ROOT,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("cli integration", () => {
  test("published bin targets built JavaScript", () => {
    expect(pkg.bin.ai).toBe("./dist/index.js");
    expect(pkg.files).toContain("dist");
    expect(pkg.files).not.toContain("src");
  });

  test("--help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("--help");
    expect(exitCode).toBe(0);
    for (const sub of ["text", "image", "video", "audio", "models"]) {
      expect(stdout).toContain(sub);
    }
  });

  test("--version exits 0 and prints semver", async () => {
    const { exitCode, stdout } = await run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("text with no prompt and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("text");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("prompt, stdin, or image is required");
  });

  test("text routes concurrent jobs to separate local providers", async () => {
    const ollama = mockChatServer("ollama", "ollama-secret");
    const omlx = mockChatServer("omlx", "omlx-secret");
    const output = mkdtempSync(join(tmpdir(), "ai-cli-local-routing-"));
    try {
      const { exitCode, stdout, stderr } = await runWithEnv(
        [
          "text",
          "-m",
          "ollama:shared:thinking,omlx:shared:thinking",
          "--json",
          "--quiet",
          "--format",
          "txt",
          "--output",
          output,
          "hello",
        ],
        {
          OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.port}/v1`,
          OMLX_BASE_URL: `http://127.0.0.1:${omlx.port}/v1`,
          OLLAMA_API_KEY: "ollama-secret",
          OMLX_API_KEY: "omlx-secret",
        }
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout) as {
        count: number;
        results: Array<{
          provider: string;
          model: string;
          file: string;
        }>;
      };
      expect(result.count).toBe(2);
      expect(
        result.results.map(({ provider, model }) => ({ provider, model }))
      ).toEqual([
        { provider: "ollama", model: "shared:thinking" },
        { provider: "omlx", model: "shared:thinking" },
      ]);
      expect(
        result.results.map((entry) => readFileSync(entry.file, "utf8"))
      ).toEqual(["ollama:shared:thinking", "omlx:shared:thinking"]);
    } finally {
      ollama.stop(true);
      omlx.stop(true);
      rmSync(output, { recursive: true, force: true });
    }
  });

  test("text attributes partial failures to the correct provider", async () => {
    const ollama = mockChatServer("ollama");
    const omlx = mockChatServer("omlx", undefined, true);
    const output = mkdtempSync(join(tmpdir(), "ai-cli-local-failure-"));
    try {
      const { exitCode, stdout } = await runWithEnv(
        [
          "text",
          "-m",
          "ollama:shared,omlx:shared",
          "--json",
          "--quiet",
          "--format",
          "txt",
          "--output",
          output,
          "hello",
        ],
        {
          OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.port}/v1`,
          OMLX_BASE_URL: `http://127.0.0.1:${omlx.port}/v1`,
        }
      );

      expect(exitCode).toBe(2);
      const result = JSON.parse(stdout) as {
        count: number;
        results: Array<{
          provider: string;
          model: string;
          success: boolean;
          file: string | null;
        }>;
      };
      expect(result.count).toBe(1);
      expect(result.results).toMatchObject([
        {
          provider: "ollama",
          model: "shared",
          success: true,
        },
        {
          provider: "omlx",
          model: "shared",
          success: false,
          file: null,
        },
      ]);
      expect(result.results[0]?.file).not.toBeNull();
    } finally {
      ollama.stop(true);
      omlx.stop(true);
      rmSync(output, { recursive: true, force: true });
    }
  });

  test("text --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("text", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--image");
    expect(stdout).toContain("--temperature");
    expect(stdout).toContain("ollama");
    expect(stdout).toContain("omlx");
    expect(stdout).toContain("prefix with provider:");
  });

  test("image --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("image", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--no-preview");
    expect(stdout).toContain("--image");
    expect(stdout).toContain("--size");
    expect(stdout).toContain("--aspect-ratio");
  });

  test("video --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("video", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--image");
    expect(stdout).toContain("--duration");
    expect(stdout).toContain("--aspect-ratio");
  });

  test("audio --help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("audio", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("speak");
    expect(stdout).toContain("transcribe");
  });

  test("audio speak --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("audio", "speak", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--voice");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("default: mp3");
    expect(stdout).toContain("--speed");
    expect(stdout).toContain("--no-play");
    expect(stdout).toContain("--no-waveform");
  });

  test("audio transcribe --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("audio", "transcribe", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--output");
  });

  test("audio speak with no text and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("audio", "speak");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("text or stdin is required");
  });

  test("audio speak rejects formats that FAL cannot honor", async () => {
    const { exitCode, stderr } = await runWithEnv(
      ["audio", "speak", "-P", "fal", "--format", "wav", "hello"],
      { FAL_API_KEY: "test-key" }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      '--format "wav" is not supported by FAL targets; use mp3'
    );
  });

  test("audio transcribe with no audio and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("audio", "transcribe");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("audio file, URL, or stdin is required");
  });

  test("video -i validates image paths before generation", async () => {
    const { exitCode, stderr } = await run(
      "video",
      "-i",
      "/missing/ref.png",
      "animate this"
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'could not read reference image "/missing/ref.png"'
    );
  });

  test("models --type invalid exits 1", async () => {
    const { exitCode, stderr } = await run("models", "--type", "realtime");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("must be one of");
  });

  test("models --help documents the model argument", async () => {
    const { exitCode, stdout } = await run("models", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[model]");
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("detailed info");
    expect(stdout).toContain("ollama");
    expect(stdout).toContain("omlx");
    expect(stdout).toContain("all");
  });

  test("models rejects an unknown provider", async () => {
    const { exitCode, stderr } = await run("models", "--provider", "gateway");
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "provider must be one of: openrouter, openai, fal, ollama, omlx"
    );
  });

  test("models --provider all requires a qualified model argument", async () => {
    const { exitCode, stderr } = await run(
      "models",
      "no-such-model",
      "--provider",
      "all"
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("provider-qualified ID");
  });

  test("models with unknown model exits 1", async () => {
    const { exitCode, stderr } = await run("models", "no-such/model-xyz");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("model not found: no-such/model-xyz");
  });

  test("models rejects filters combined with a model argument", async () => {
    const { exitCode, stderr } = await run(
      "models",
      "openai/gpt-5.5",
      "--type",
      "text"
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("cannot be used with a model argument");
  });
});

function mockChatServer(provider: string, apiKey?: string, fail = false) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (
        apiKey &&
        request.headers.get("authorization") !== `Bearer ${apiKey}`
      ) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (fail) {
        return Response.json(
          { error: { message: `${provider} failed` } },
          { status: 400 }
        );
      }
      const body = (await request.json()) as { model: string };
      return Response.json({
        id: `${provider}-response`,
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: `${provider}:${body.model}`,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      });
    },
  });
}
