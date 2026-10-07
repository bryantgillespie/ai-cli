import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import pkg from "../package.json";

const CLI = ["bun", "run", "src/index.ts"];
const ROOT = import.meta.dir + "/..";
const PNG_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function run(...args: string[]) {
  return runWithEnv(args);
}

async function runWithEnv(
  args: string[],
  env?: Record<string, string | undefined>,
  preload?: string
) {
  const command = preload
    ? ["bun", "run", "--preload", preload, "src/index.ts"]
    : CLI;
  const proc = Bun.spawn([...command, ...args], {
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
    expect(pkg.dependencies).not.toHaveProperty("commander");
  });

  test("--help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("--help");
    expect(exitCode).toBe(0);
    for (const sub of [
      "text",
      "image",
      "video",
      "audio",
      "models",
      "evaluate",
    ]) {
      expect(stdout).toContain(sub);
    }
  });

  test("--version exits 0 and prints semver", async () => {
    const { exitCode, stdout } = await run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--version works after a nested subcommand", async () => {
    const { exitCode, stdout } = await run("audio", "speak", "--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("--version remains global when a nested option expects a value", async () => {
    const { exitCode, stdout } = await run(
      "audio",
      "speak",
      "--voice",
      "--version"
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("help command displays subcommand help", async () => {
    const { exitCode, stdout } = await run("help", "text");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai text");
    expect(stdout).toContain("--model");
  });

  test("nested help command displays nested subcommand help", async () => {
    const { exitCode, stdout } = await run("audio", "help", "speak");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai audio speak");
    expect(stdout).toContain("--voice");
  });

  test("help options work on implicit help commands", async () => {
    const root = await run("help", "--help");
    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("Usage: ai [options] [command]");

    const nested = await run("audio", "help", "--help");
    expect(nested.exitCode).toBe(0);
    expect(nested.stdout).toContain("Usage: ai audio [options] [command]");
  });

  test("help options preserve implicit help command targets", async () => {
    const root = await run("help", "text", "--help");
    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("Usage: ai text [options] [prompt]");

    const nested = await run("audio", "help", "speak", "--help");
    expect(nested.exitCode).toBe(0);
    expect(nested.stdout).toContain("Usage: ai audio speak [options] [text]");
  });

  test("help takes precedence over an unknown command", async () => {
    const { exitCode, stdout, stderr } = await run("wat", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai [options] [command]");
    expect(stderr).toBe("");
  });

  test("unknown options fail before running a command", async () => {
    const { exitCode, stderr } = await run("text", "--wat", "hello");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown option '--wat'");
  });

  test("unknown commands and options include typo suggestions", async () => {
    const command = await run("texte");
    expect(command.exitCode).toBe(1);
    expect(command.stderr).toContain("(Did you mean text?)");

    const option = await run("text", "--modle", "openai/gpt-5.5");
    expect(option.exitCode).toBe(1);
    expect(option.stderr).toContain("(Did you mean --model?)");
  });

  test("missing option values produce a usage error", async () => {
    const { exitCode, stderr } = await run("text", "--model");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("argument missing");
  });

  test("missing option values take precedence over help", async () => {
    const { exitCode, stdout, stderr } = await run("text", "hello", "-h", "-m");
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("option '-m, --model <model>' argument missing");
  });

  test("text with no prompt and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("text");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("prompt, stdin, or image is required");
  });

  test("text sends vision requests directly to Anthropic", async () => {
    const anthropic = mockAnthropicServer("anthropic-secret");
    const output = mkdtempSync(join(tmpdir(), "ai-cli-anthropic-"));
    const image = join(output, "input.png");
    writeFileSync(image, PNG_IMAGE);

    try {
      const { exitCode, stdout, stderr } = await runWithEnv(
        [
          "text",
          "-P",
          "anthropic",
          "--image",
          image,
          "--json",
          "--quiet",
          "--format",
          "txt",
          "--output",
          output,
          "describe this",
        ],
        {
          ANTHROPIC_API_KEY: "anthropic-secret",
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropic.server.port}/v1`,
        }
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout) as {
        results: Array<{ provider: string; model: string; file: string }>;
      };
      expect(result.results).toMatchObject([
        {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
        },
      ]);
      expect(readFileSync(result.results[0]!.file, "utf8")).toBe(
        "anthropic:claude-sonnet-4-6"
      );
      expect(anthropic.requests).toHaveLength(1);
      expect(anthropic.requests[0]).toMatchObject({
        method: "POST",
        pathname: "/v1/messages",
        apiVersion: "2023-06-01",
        model: "claude-sonnet-4-6",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: PNG_IMAGE.toString("base64"),
                },
              },
              { type: "text", text: "describe this" },
            ],
          },
        ],
      });
    } finally {
      anthropic.server.stop(true);
      rmSync(output, { recursive: true, force: true });
    }
  });

  test("text keeps vision input compatible with direct OpenAI", async () => {
    const openai = mockOpenAIServer("openai-secret");
    const output = mkdtempSync(join(tmpdir(), "ai-cli-openai-vision-"));
    const image = join(output, "input.png");
    writeFileSync(image, PNG_IMAGE);

    try {
      const { exitCode, stderr } = await runWithEnv(
        [
          "text",
          "-P",
          "openai",
          "-m",
          "gpt-5.5",
          "--image",
          image,
          "--json",
          "--quiet",
          "--format",
          "txt",
          "--output",
          output,
          "describe this",
        ],
        {
          OPENAI_API_KEY: "openai-secret",
          OPENAI_BASE_URL: `http://127.0.0.1:${openai.server.port}/v1`,
        }
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(openai.requests).toHaveLength(1);
      expect(openai.requests[0]).toMatchObject({
        method: "POST",
        pathname: "/v1/responses",
        authorization: "Bearer openai-secret",
        body: {
          model: "gpt-5.5",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_image",
                  image_url: `data:image/png;base64,${PNG_IMAGE.toString("base64")}`,
                },
                { type: "input_text", text: "describe this" },
              ],
            },
          ],
        },
      });
    } finally {
      openai.server.stop(true);
      rmSync(output, { recursive: true, force: true });
    }
  });

  test("text keeps vision input compatible with OpenRouter", async () => {
    const output = mkdtempSync(join(tmpdir(), "ai-cli-openrouter-vision-"));
    const image = join(output, "input.png");
    const requestFile = join(output, "request.json");
    const preload = writeChatFetchPreload(output);
    writeFileSync(image, PNG_IMAGE);

    try {
      const { exitCode, stderr } = await runWithEnv(
        [
          "text",
          "-P",
          "openrouter",
          "-m",
          "test/vision-model",
          "--image",
          image,
          "--json",
          "--quiet",
          "--format",
          "txt",
          "--output",
          output,
          "describe this",
        ],
        {
          OPENROUTER_API_KEY: "openrouter-secret",
          AI_CLI_TEST_REQUEST_FILE: requestFile,
        },
        preload
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(readFileSync(requestFile, "utf8"))).toMatchObject({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        authorization: "Bearer openrouter-secret",
        body: {
          model: "test/vision-model",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${PNG_IMAGE.toString("base64")}`,
                  },
                },
                { type: "text", text: "describe this" },
              ],
            },
          ],
        },
      });
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  test("text keeps vision input compatible with OpenAI-style providers", async () => {
    const requests: Array<{ model: string; messages?: unknown[] }> = [];
    const ollama = mockChatServer("ollama", undefined, false, requests);
    const output = mkdtempSync(join(tmpdir(), "ai-cli-compatible-vision-"));
    const image = join(output, "input.png");
    writeFileSync(image, PNG_IMAGE);

    try {
      const { exitCode, stderr } = await runWithEnv(
        [
          "text",
          "-P",
          "ollama",
          "-m",
          "vision-model",
          "--image",
          image,
          "--json",
          "--quiet",
          "--format",
          "txt",
          "--output",
          output,
          "describe this",
        ],
        {
          OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.port}/v1`,
        }
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(requests).toHaveLength(1);
      expect(JSON.stringify(requests[0]?.messages)).toContain(
        '"type":"image_url"'
      );
    } finally {
      ollama.stop(true);
      rmSync(output, { recursive: true, force: true });
    }
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
    expect(stdout).toContain("(default: [])");
    expect(stdout).toContain("--temperature");
    expect(stdout).toContain("anthropic");
    expect(stdout).toContain("ollama");
    expect(stdout).toContain("omlx");
    expect(stdout).toContain("prefix with provider:");
    expect(
      Math.max(
        ...stdout
          .trimEnd()
          .split("\n")
          .map((line) => line.length)
      )
    ).toBeLessThanOrEqual(80);
  });

  test("text grouped short options support the help flag", async () => {
    const { exitCode, stdout, stderr } = await run("text", "-qh");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai text [options] [prompt]");
    expect(stderr).toBe("");
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
    expect(stdout).toContain("--resolution");
  });

  test("audio --help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("audio", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("speak");
    expect(stdout).toContain("transcribe");
  });

  test("root help keeps nested command signatures compatible", async () => {
    const { stdout } = await run("--help");
    const audio = stdout
      .split("\n")
      .find((line) => line.trimStart().startsWith("audio"));
    expect(audio).toBeDefined();
    expect(audio).not.toContain("[options]");
    expect(audio).not.toContain("[command]");
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

  test.each([
    [["text"], "120"],
    [["image"], "300"],
    [["video"], "300"],
    [["audio", "speak"], "120"],
    [["audio", "transcribe"], "120"],
  ])("%s --help lists --timeout with its default", async (command, seconds) => {
    const { exitCode, stdout } = await run(...command, "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--timeout");
    expect(stdout).toContain(`default: ${seconds}`);
  });

  test("--timeout rejects a value that would overflow the timer", async () => {
    const { exitCode, stderr } = await run(
      "image",
      "--timeout",
      "3600000",
      "a prompt"
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("The value is in seconds, not milliseconds.");
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
    expect(stdout).toContain("anthropic");
    expect(stdout).toContain("ollama");
    expect(stdout).toContain("omlx");
    expect(stdout).toContain("all");
    expect(stdout).toContain("evaluation");
  });

  test("evaluate documents its typed interface", async () => {
    const { exitCode, stdout } = await run("evaluate", "--help");
    expect(exitCode).toBe(0);
    for (const flag of [
      "--boolean",
      "--choice",
      "--choices",
      "--score",
      "--levels",
      "--questions",
      "--input",
      "--provider-options",
      "--max-retries",
    ]) {
      expect(stdout).toContain(flag);
    }
    expect(stdout).toContain("--provider");
    expect(stdout).toContain("typesafe/jev-router");
    expect(stdout).not.toContain("--count");
  });

  test.each(["filter", "rank", "pick", "judge"])(
    "%s is not a command",
    async (command) => {
      const result = await run(command);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command");
    }
  );

  test("evaluate requires explicit typed questions", async () => {
    const result = await run("evaluate");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("named question is required");
  });

  test("evaluate validates flags before requesting a model", async () => {
    for (const args of [
      ["--boolean", "missing-id"],
      ["--choice", "team=Which team?"],
      ["--choices", "team=billing,support"],
      ["--input", "yaml"],
      ["--max-retries", "-1"],
    ]) {
      expect((await run("evaluate", ...args)).exitCode).toBe(1);
    }
  });

  test("models rejects an unknown provider", async () => {
    const { exitCode, stderr } = await run("models", "--provider", "gateway");
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "provider must be one of: openrouter, anthropic, openai, fal, ollama, omlx"
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

function mockAnthropicServer(apiKey: string) {
  const requests: Array<{
    method: string;
    pathname: string;
    apiVersion: string | null;
    model?: string;
    messages?: unknown[];
  }> = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.headers.get("x-api-key") !== apiKey) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const body = (await request.json()) as {
        model?: string;
        messages?: unknown[];
      };
      requests.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
        apiVersion: request.headers.get("anthropic-version"),
        ...body,
      });
      return Response.json({
        type: "message",
        id: "msg_anthropic",
        model: body.model,
        content: [
          { type: "text", text: `anthropic:${body.model ?? "unknown"}` },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  return { server, requests };
}

function mockOpenAIServer(apiKey: string) {
  const requests: Array<{
    method: string;
    pathname: string;
    authorization: string | null;
    body: { model?: string; input?: unknown[] };
  }> = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${apiKey}`) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const body = (await request.json()) as {
        model?: string;
        input?: unknown[];
      };
      requests.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        body,
      });
      return Response.json({
        id: "resp_openai",
        created_at: 1,
        model: body.model,
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg_openai",
            content: [
              {
                type: "output_text",
                text: `openai:${body.model ?? "unknown"}`,
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  return { server, requests };
}

function writeChatFetchPreload(directory: string): string {
  const preload = join(directory, "mock-chat-fetch.mjs");
  writeFileSync(
    preload,
    `import { writeFileSync } from "node:fs";

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = await request.clone().json();
  writeFileSync(
    process.env.AI_CLI_TEST_REQUEST_FILE,
    JSON.stringify({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      body,
    })
  );
  return Response.json({
    id: "chatcmpl_openrouter",
    object: "chat.completion",
    created: 1,
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: \`openrouter:\${body.model}\`,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
};
`
  );
  return preload;
}

function mockChatServer(
  provider: string,
  apiKey?: string,
  fail = false,
  requests?: Array<{ model: string; messages?: unknown[] }>
) {
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
      const body = (await request.json()) as {
        model: string;
        messages?: unknown[];
      };
      requests?.push(body);
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
