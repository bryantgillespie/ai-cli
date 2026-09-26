import { readFile } from "node:fs/promises";

import type { Command } from "../lib/command.js";
import {
  buildQuestions,
  decodeEvaluationText,
  evaluateState,
  parseInputFormat,
  parseMaxRetries,
  parseProviderOptions,
  parseQuestions,
  parseState,
  type InputFormat,
  type QuestionOptions,
} from "../lib/evaluation.js";
import { resolveModels, type ModelTarget } from "../lib/models.js";
import {
  createProvider,
  getEvaluationModel,
  resolveProviderId,
} from "../lib/providers.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

interface EvaluateOptions extends QuestionOptions {
  questions?: string;
  provider?: string;
  model?: string;
  input: InputFormat;
  providerOptions?: string;
  maxRetries: number;
  timeout: number;
}

async function readTextFile(path: string, flag: string): Promise<string> {
  try {
    return decodeEvaluationText(await readFile(path));
  } catch (error) {
    throw new Error(
      `Could not read --${flag} file ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function resolveEvaluationTarget(
  provider?: string,
  userModel?: string
): ModelTarget {
  const models = resolveModels(
    resolveProviderId(provider),
    "evaluation",
    userModel === "jev" ? "openrouter:typesafe/jev-router" : userModel
  );
  if (models.length !== 1)
    throw new Error("ai evaluate requires exactly one evaluation model");
  return models[0];
}

const append = (value: string, previous: string[] = []) => [...previous, value];

export function registerEvaluateCommand(program: Command) {
  const command = program
    .command("evaluate")
    .description(
      "Evaluate named, typed questions against stdin; output answers and metadata as JSON"
    )
    .option(
      "--boolean <id=question>",
      "Ask for P(true); repeat for multiple questions",
      append
    )
    .option(
      "--choice <id=question>",
      "Ask for one of the supplied choices; repeatable",
      append
    )
    .option(
      "--choices <id=a,b,...>",
      "Comma-separated choices for the named question",
      append
    )
    .option(
      "--score <id=question>",
      "Ask for a score on ordered levels; repeatable",
      append
    )
    .option(
      "--levels <id=low,...,high>",
      "Comma-separated score levels, lowest to highest",
      append
    )
    .option(
      "--questions <path>",
      "JSON file of named questions with typed criteria"
    )
    .option(
      "-P, --provider <provider>",
      "Default provider: openrouter, anthropic, openai (default: openrouter)"
    )
    .option(
      "-m, --model <model>",
      "Evaluation model ID or jev; prefix with provider: to switch providers (default: typesafe/jev-router)"
    )
    .option(
      "--input <format>",
      "State format: auto, text, or json (arrays stay intact)",
      parseInputFormat,
      "auto" as InputFormat
    )
    .option(
      "--provider-options <path>",
      "JSON file of provider-specific options"
    )
    .option(
      "--max-retries <n>",
      "Retries for transient provider failures",
      parseMaxRetries,
      2
    );

  addTimeoutOption(command, 30_000).action(
    async (_: undefined, options: EvaluateOptions) => {
      const questions = buildQuestions(
        options,
        options.questions
          ? parseQuestions(await readTextFile(options.questions, "questions"))
          : undefined
      );
      const providerOptions = options.providerOptions
        ? parseProviderOptions(
            await readTextFile(options.providerOptions, "provider-options")
          )
        : undefined;
      if (process.stdin.isTTY)
        throw new Error("Pipe text or a JSON state to stdin.");
      const state = parseState(
        decodeEvaluationText((await readStdin()) ?? new Uint8Array()),
        options.input
      );
      const target = resolveEvaluationTarget(options.provider, options.model);
      const result = await evaluateState(state, questions, {
        model: getEvaluationModel(
          createProvider(target.provider),
          target.modelId
        ),
        timeoutMs: timeoutMs(options.timeout),
        maxRetries: options.maxRetries,
        providerOptions,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
  );
}
