import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Questions } from "../lib/evaluation.js";

const directory = mkdtempSync(join(tmpdir(), "ai-cli-evaluate-"));
const preload = join(directory, "openrouter.js");
writeFileSync(
  preload,
  `
import { appendFileSync } from "node:fs";
let calls = 0;
globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith('/decisions')) throw new Error('Unexpected network request');
  const body = JSON.parse(init.body);
  appendFileSync(process.env.TEST_REQUESTS, JSON.stringify(body) + '\\n');
  calls++;
  const status = calls <= Number(process.env.TEST_FAIL_FIRST || 0) ? 503 : Number(process.env.TEST_STATUS || 200);
  if (status !== 200) return new Response(JSON.stringify({ error: { message: 'provider unavailable', code: status } }), { status, headers: { 'content-type': 'application/json' } });
  // Fixtures use SDK answer shapes; the Decisions API reports booleans as "noul".
  const fixture = JSON.parse(process.env.TEST_RESPONSE);
  const answers = Object.fromEntries(Object.entries(fixture.answers).map(([id, answer]) => [id, answer.type === 'boolean' ? { type: 'noul', noul: answer.probability } : answer]));
  const usage = fixture.usage && { input_tokens: fixture.usage.inputTokens, output_tokens: fixture.usage.outputTokens };
  return new Response(JSON.stringify({ model: body.model, answers, ...(usage ? { usage } : {}) }), { headers: { 'content-type': 'application/json' } });
};
if (process.env.TEST_STDOUT_TTY) process.stdout.isTTY = true;
`
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const graphicArgs = [
  "--boolean",
  "refund=Refund requested?",
  "--choice",
  "team=Which team?",
  "--choices",
  "team=billing,support",
  "--score",
  "tone=How positive?",
  "--levels",
  "tone=angry,neutral,happy",
];
const mixedAnswers = {
  refund: { type: "boolean", probability: 0.01 },
  team: {
    type: "choice",
    choice: "billing",
    probabilities: { billing: 0.9, support: 0.1 },
  },
  tone: {
    type: "score",
    score: 0.3,
    probabilities: { "0": 0.8, "1": 0.1, "2": 0.1 },
  },
};

async function run(
  args: string[],
  input: string,
  response: Record<string, unknown> = { answers: mixedAnswers },
  extraEnv: Record<string, string> = {}
) {
  const requestPath = join(directory, `requests-${crypto.randomUUID()}.jsonl`);
  const env = { ...process.env };
  delete env.AI_CLI_PROVIDER;
  delete env.AI_CLI_EVALUATION_MODEL;
  writeFileSync(requestPath, "");
  const proc = Bun.spawn(
    ["bun", "run", "--preload", preload, "src/index.ts", "evaluate", ...args],
    {
      cwd: import.meta.dir + "/../..",
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        OPENROUTER_API_KEY: "test-key",
        TEST_REQUESTS: requestPath,
        TEST_RESPONSE: JSON.stringify(response),
        ...extraEnv,
      },
    }
  );
  proc.stdin.write(input);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const requests = readFileSync(requestPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { stdout, stderr, exitCode, requests };
}

describe("evaluate CLI", () => {
  test("the graphic's exact syntax sends one mixed request and prints complete JSON in a TTY", async () => {
    const result = await run(
      graphicArgs,
      "  Original ticket\n\nwith details\n",
      {
        answers: mixedAnswers,
        usage: { inputTokens: 20, outputTokens: 0 },
      },
      { TEST_STDOUT_TTY: "1" }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].state).toBe(
      "  Original ticket\n\nwith details\n"
    );
    expect(result.requests[0].model).toBe("typesafe/jev-router");
    expect(Object.keys(result.requests[0].questions)).toHaveLength(3);
    expect(result.requests[0].questions.team.criteria).toEqual({
      billing: "billing",
      support: "support",
    });
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      answers: mixedAnswers,
      providerMetadata: {
        openrouter: { answers: { refund: {}, team: {}, tone: {} } },
      },
      usage: { inputTokens: 20, outputTokens: 0, totalTokens: 20 },
      rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
      response: { modelId: "typesafe/jev-router" },
    });
    expect(Number.isNaN(Date.parse(output.response.timestamp))).toBe(false);
    expect(output.response.body.answers.refund).toEqual({
      type: "noul",
      noul: 0.01,
    });
    expect(output.response.headers["content-type"]).toBe("application/json");
    expect(Object.keys(output).sort()).toEqual([
      "answers",
      "providerMetadata",
      "response",
      "rounding",
      "usage",
      "warnings",
    ]);
    expect(output).not.toHaveProperty("state");
  });

  test("question and provider files preserve structured data alongside inline questions", async () => {
    const path = join(directory, "questions.json");
    const providers = join(directory, "providers.json");
    const question = {
      type: "choice",
      instructions: { task: "Which team?" },
      criteria: {
        billing: { handles: ["payments", "refunds"] },
        support: null,
      },
    };
    writeFileSync(path, JSON.stringify({ team: question }));
    writeFileSync(
      providers,
      JSON.stringify({ openrouter: { provider: { order: ["typesafe"] } } })
    );
    const result = await run(
      [
        "--questions",
        path,
        "--boolean",
        "refund=Refund requested?",
        "--provider-options",
        providers,
        "-m",
        "jev",
      ],
      '[{"message":"Refund please"},{"account":"123"}]',
      { answers: { team: mixedAnswers.team, refund: mixedAnswers.refund } }
    );
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].state).toEqual([
      { message: "Refund please" },
      { account: "123" },
    ]);
    expect(result.requests[0].model).toBe("typesafe/jev-router");
    expect(result.requests[0].questions.team).toEqual(question);
    expect(result.requests[0].provider).toEqual({ order: ["typesafe"] });
    expect(JSON.parse(result.stdout).usage).toEqual({});
  });

  test("CLI JSON matches the SDK result without renaming or dropping fields", async () => {
    const fixture = {
      answers: mixedAnswers,
      usage: { inputTokens: 20, outputTokens: 0 },
    };
    const result = await run(graphicArgs, "ticket", fixture);
    expect(result.exitCode).toBe(0);

    const { experimental_evaluate } = await import("ai");
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    const output = JSON.parse(result.stdout);
    const openrouter = createOpenRouter({
      apiKey: "test-key",
      fetch: Object.assign(
        async () =>
          new Response(JSON.stringify(output.response.body), {
            headers: { "content-type": "application/json" },
          }),
        { preconnect: () => {} }
      ),
    });
    const questions = Object.fromEntries(
      Object.entries(
        result.requests[0].questions as Record<string, { type: string }>
      ).map(([id, question]) => [
        id,
        question.type === "noul" ? { ...question, type: "boolean" } : question,
      ])
    ) as Questions;
    const sdk = await experimental_evaluate({
      model: openrouter.evaluationModel("typesafe/jev-router"),
      state: result.requests[0].state,
      questions,
      maxRetries: 0,
    });
    const expected = JSON.parse(JSON.stringify(sdk));
    expected.response.timestamp = output.response.timestamp;
    expect(output).toEqual(expected);
  });

  test("passes model-specific limits to the provider and accepts other evaluation models", async () => {
    const args = [
      "--score",
      "q=Rate?",
      "--levels",
      "q=" + Array.from({ length: 11 }, (_, i) => String(i)).join(","),
    ];
    const rejected = await run(args, "text", {}, { TEST_STATUS: "400" });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.requests).toHaveLength(1);
    expect(rejected.stdout).toBe("");

    const supported = await run([...args, "-m", "example/evaluator"], "text", {
      answers: { q: { type: "score", score: 10 } },
    });
    expect(supported.exitCode).toBe(0);
    expect(JSON.parse(supported.stdout).response.modelId).toBe(
      "example/evaluator"
    );
  });

  test("flag order does not bind choices to the wrong question", async () => {
    const result = await run(
      [
        "--choices",
        "team=billing,support",
        "--boolean",
        "refund=Refund requested?",
        "--choice",
        "team=Which team?",
      ],
      "message",
      { answers: { team: mixedAnswers.team, refund: mixedAnswers.refund } }
    );
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].questions.team.criteria).toEqual({
      billing: "billing",
      support: "support",
    });
  });

  test.each([0, 0.01, 0.5, 1])(
    "P(true)=%s remains a successful answer",
    async (probability) => {
      const result = await run(
        ["--boolean", "q=Refund requested?"],
        "message",
        { answers: { q: { type: "boolean", probability } } }
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).answers.q.probability).toBe(probability);
      expect(result.stderr).toBe("");
    }
  );

  test("accepts empty JSON arrays as shared state", async () => {
    const result = await run(["--boolean", "q=Any requests present?"], "[]", {
      answers: { q: { type: "boolean", probability: 0 } },
    });
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].state).toEqual([]);
  });

  test("invalid local inputs fail before any network request or stdout", async () => {
    for (const [args, input] of [
      [graphicArgs, '[{"id":1}'],
      [["--boolean", "q=Test?"], ""],
      [
        ["--boolean", "q=Test?", "-m", "typesafe-ai/jev,typesafe-ai/jev"],
        "text",
      ],
      [["--questions", join(directory, "missing.json")], "text"],
      [["--boolean", "q=Test?", "--boolean", "q=Again?"], "text"],
    ] as [string[], string][]) {
      const result = await run(args, input);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.requests).toHaveLength(0);
    }
  });

  test("provider and invalid response failures emit no partial JSON", async () => {
    const environments: Record<string, string>[] = [{ TEST_STATUS: "403" }, {}];
    for (const extraEnv of environments) {
      const result = await run(
        graphicArgs,
        "text",
        { answers: { refund: mixedAnswers.refund } },
        extraEnv
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      expect(result.requests).toHaveLength(1);
    }
  });

  test("transient failures honor the configured retry limit", async () => {
    const noRetry = await run(
      [...graphicArgs, "--max-retries", "0"],
      "text",
      { answers: mixedAnswers },
      { TEST_FAIL_FIRST: "1" }
    );
    expect(noRetry.exitCode).toBe(1);
    expect(noRetry.requests).toHaveLength(1);
    const retry = await run(
      [...graphicArgs, "--max-retries", "1"],
      "text",
      { answers: mixedAnswers },
      { TEST_FAIL_FIRST: "1" }
    );
    expect(retry.exitCode).toBe(0);
    expect(retry.requests).toHaveLength(2);
  });
});
