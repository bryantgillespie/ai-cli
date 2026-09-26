---
name: ai-cli
description: Runs ai-cli to generate text, images, video, speech, and transcripts with cloud or local models, and to evaluate typed questions. Use when the user asks to generate AI media, invoke OpenRouter/Anthropic/OpenAI/FAL/Ollama/OMLX, compare models, score or classify input, or compose terminal AI pipelines.
---

# ai-cli

## Quick start

```bash
ai text "summarize this"
ai image "a letterpress poster"
ai video "a paper airplane unfolding"
ai audio speak -P openai "hello"
ai audio transcribe -P openai recording.mp3
ai evaluate --boolean "refund=Refund requested?" < ticket.txt
ai models
```

Cloud providers require their corresponding environment variable:
`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `FAL_API_KEY`. Ollama and OMLX
use local OpenAI-compatible endpoints. OMLX may require `OMLX_API_KEY`.
Never print, persist, or include secret values in commands or output.

## Providers and models

`-P` selects the default provider for unqualified model IDs:

```bash
ai text -P anthropic -m claude-sonnet-4-6 "explain with Claude"
ai text -P ollama -m qwen3:latest "explain this locally"
ai text -P omlx -m local-model "explain this locally"
ai models -P anthropic
ai models -P ollama
ai models -P omlx
ai models -P all
```

Prefix individual models with `<provider>:` to run providers concurrently:

```bash
ai text \
  -m "anthropic:claude-sonnet-4-6,openrouter:anthropic/claude-sonnet-4-6,ollama:qwen3:latest" \
  "compare these approaches"
```

Only the first colon separates the provider, preserving IDs such as
`qwen3:thinking`. Unqualified IDs use `-P`, then `AI_CLI_PROVIDER`, then
OpenRouter. Use `ai models -P <provider>` instead of guessing model IDs.

Default local endpoints:

```text
Ollama  http://127.0.0.1:11434/v1  (override OLLAMA_BASE_URL)
OMLX    http://127.0.0.1:8000/v1   (override OMLX_BASE_URL)
```

## Agent-safe output

Always give binary generation an explicit output path. Prefer `--json` when
another tool or agent will consume metadata.

```bash
ai image "a sunset" -o /tmp/sunset.png --json
ai video "animate this" -i input.png -o /tmp/video.mp4 --json
ai audio speak -P openai "hello" -o /tmp/speech.mp3 --json
ai text "summarize" -o /tmp/summary.md --json
```

JSON results contain `provider`, native `model`, success, timing, and file path.
Exit code `0` means success, `1` invalid input or all failed, and `2` partial failure.

Use `--timeout <seconds>` when a request legitimately needs longer than the
default (text and speech 120, image and video 300, evaluate 30) instead of
switching to a faster model. `ai video --resolution 1920x1080` requests a
resolution; support varies by model.

Without `-o`, text writes to stdout when piped; image, video, and speech write
raw binary. Never let raw binary enter agent context.

## Pipelines

```bash
git diff | ai text "review this change"
cat screenshot.png | ai text -P anthropic -m claude-sonnet-4-6 "describe errors"
ai image "a dragon" | ai video "animate this"
cat recording.mp3 | ai audio transcribe -P openai -o /tmp/transcript.txt
```

## Evaluate

`ai evaluate` asks named Boolean, Choice, and Score questions about stdin and
always prints the SDK result as JSON. It defaults to Jev
(`openrouter:typesafe/jev-router`); `-P openai` or `-P anthropic` switches
providers.

```bash
cat ticket.txt |
  ai evaluate \
    --boolean "refund=Refund requested?" \
    --choice "team=Which team?" --choices "team=billing,support" \
    --score "tone=How positive?" --levels "tone=angry,neutral,happy"
ai evaluate --questions triage.json < ticket.json |
  jq -e '.answers.refund.probability >= 0.9'
```

Boolean returns `probability` (P(true)); Choice returns `choice`; Score returns
a fractional `score` index into the levels. Keep arithmetic and date comparisons
in code, and supply any reference date the question needs. See
https://ai-cli.dev/docs/evaluate for the question file schema.

## Failure checks

- `API key required`: load the selected provider's environment variable.
- Local connection failure: verify the server and `*_BASE_URL`.
- Unsupported capability: choose a provider supporting that command.
- Mixed run exit `2`: inspect each JSON result by provider and model.
