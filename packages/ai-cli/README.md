# ai

A tiny, agent-native CLI for generating images, video, audio and text with dead-simple commands, stdin support and predictable artifact outputs. Use OpenRouter, connect directly to OpenAI and FAL, or run local Ollama and OMLX models.

## Install

```bash
npm install -g ai-cli
```

Requires Node.js 22+. Cloud providers require their API key. Ollama and OMLX connect to local servers and require no key unless the server enables authentication. OpenRouter is the default provider.

## Usage

```bash
ai image "a cute dog"
ai video "a spinning triangle"
ai text "explain quantum computing"
ai text -P ollama -m qwen3 "explain this locally"
ai audio speak -P openai "Thanks for trying ai-cli"
ai audio transcribe -P openai recording.mp3
ai models                          # list available models
```

### Piping and References

```bash
ai image "a dragon" | ai video "animate this"
ai video -i input.png "animate this"
ai image --image reference.png "make a sticker in this style"
ai image -i sketch.png -i palette.jpg "render this product concept"
ai text --image screenshot.png "what is broken in this UI?"
cat photo.png | ai text "describe this image"
cat notes.txt | ai text "summarize this"
git diff | ai text "explain these changes"
echo "Ship the changelog" | ai audio speak -P openai -o changelog.mp3
cat recording.mp3 | ai audio transcribe -P openai
```

### Common Options

All commands support:

```
-P, --provider <name>    Default provider: openrouter, openai, fal, ollama, omlx
-m, --model <id>         Model ID; prefix with provider: to mix providers
-o, --output <path>      Output file path or directory
-n, --count <n>          Number of generations per model (default: 1)
-p, --concurrency <n>    Max parallel generations (default: 4, video: 2)
-q, --quiet              Suppress progress output
--json                   Output metadata as JSON
```

When using `--json`, stdout contains only metadata. Generated text, image, video and audio outputs are written to files even when stdout is piped.

Use the model IDs shown by `ai models`. OpenRouter IDs include the creator prefix; direct and local providers use native IDs. Prefix any model with `<provider>:` to route that model independently:

```bash
ai text -m openai/gpt-5.5 "hello"
ai text -P ollama -m qwen3:latest "hello locally"
ai text -m "openrouter:anthropic/claude-sonnet-4,ollama:qwen3:latest,omlx:qwen3:thinking" "compare these"
ai image -m openai/gpt-image-2 "a sunset"
ai audio speak -P openai -m tts-1 "hello"
```

Only the first colon separates the provider, so native variants such as `qwen3:thinking` remain intact. `-P` and `AI_CLI_PROVIDER` provide the fallback for unqualified IDs.

### image

```
-i, --image <path-or-url> Reference image path or URL (repeatable)
--size <WxH>             Image size (e.g. 1024x1024)
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--quality <level>        Provider/model-specific quality level
--style <style>          OpenAI model style (e.g. vivid, natural)
--no-preview             Disable inline image preview
```

Reference images can be local paths, `file://` URLs, `http(s)://` URLs or data URLs. You can repeat `--image` to pass multiple references, and you can still pipe one image through stdin:

```bash
cat input.png | ai image -i style.png "combine the subject with this style"
```

Reference-image support is model-dependent; unsupported models may reject image inputs.

Gemini image models (e.g. `google/gemini-2.5-flash-image`) don't support `--size`; use `--aspect-ratio` instead.

### video

```
-i, --image <path-or-url> Image input path or URL
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--duration <seconds>     Duration in seconds
--no-preview             Disable inline video frame preview
```

Image inputs can be local paths, `file://` URLs, `http(s)://` URLs or data URLs. Video generation accepts one input image, provided either through `--image` or piped stdin:

```bash
ai video -i input.png "animate this"
cat input.png | ai video "animate this"
```

### text

```
-f, --format <fmt>       Output format: md, txt (default: md)
-i, --image <path-or-url> Image input path or URL for vision (repeatable)
-s, --system <prompt>    System prompt
--max-tokens <n>         Maximum tokens to generate
-t, --temperature <n>    Temperature (0-2)
```

For vision-capable text models, `ai text` accepts images from `--image` or piped stdin:

```bash
ai text -i chart.png -i table.jpg "summarize the data"
cat screenshot.png | ai text "list the visible errors"
```

### audio

`audio` has two subcommands:

```bash
ai audio speak -P openai "Hello from ai-cli"
ai audio transcribe -P openai recording.mp3
```

#### audio speak

```
-f, --format <fmt>       Audio output format (default: mp3)
--voice <voice>          Voice to use for speech generation
--instructions <text>    Instructions for speech generation
--speed <n>              Speech speed
--language <code>        Language code (e.g. en, fr) or auto
--no-play                Disable audio playback after generation
--no-waveform            Disable accurate terminal waveform preview
```

`audio speak` accepts text from an argument or stdin and saves audio to `<id>.mp3` by default:

```bash
ai audio speak -P openai --voice alloy "Read this as a friendly update"
cat announcement.txt | ai audio speak -P openai --format wav -o announcement.wav
```

When using OpenAI speech models, `ai audio speak -P openai` defaults to the `alloy` voice unless `--voice` is provided. FAL speech targets support MP3 output only.

When `-o` points to a file with a known audio extension and `--format` is omitted, the extension selects the audio format. If both are provided, `--format` must match the filename extension.

In interactive terminals, `audio speak` plays the generated audio after saving it and shows an accurate waveform derived from decoded audio samples. Use `--no-play` to skip playback and `--no-waveform` or `--quiet` to suppress the waveform. Playback and waveform previews are skipped for `--json` and binary stdout pipeline output. WAV output is decoded directly; MP3 and other encoded formats use a local decoder when available (`ffmpeg`, `mpg123`, `sox`, or `afconvert`).

#### audio transcribe

```
-f, --format <fmt>       Output format: md, txt (default: txt)
```

`audio transcribe` accepts a local path, `file://` URL, `http(s)://` URL or piped audio:

```bash
ai audio transcribe -P openai meeting.mp3
ai audio transcribe -P openai https://example.com/call.wav
cat voice-note.mp3 | ai audio transcribe -P openai -o transcript.txt
```

### models

```
[model]                  Show detailed info for a model (e.g. anthropic/claude-opus-4.6)
--type <type>            Filter by type: text, image, video, audio, speech, transcription
--creator <name>         Filter by creator (e.g. openai, google)
--json                   Output as JSON (includes descriptions)
```

OpenRouter model availability is fetched live from OpenRouter. Direct OpenAI metadata comes from [models.dev](https://models.dev/). Ollama and OMLX models come from each server's `/v1/models` endpoint. Use `ai models -P all` to aggregate catalogs with provider-qualified references. Cloud catalogs are cached locally for one hour, and explicit model IDs do not depend on catalog discovery.

Pass a model ID to see its context window, max output, pricing and release date:

```
$ ai models claude-opus-4.6

Claude Opus 4.6  anthropic/claude-opus-4.6
Released 2026-02-05 · tool-use · reasoning · vision · web-search

  Context      1M
  Max output   128K
  Input        $5/M
  Output       $25/M
  Cache read   $0.5/M
  Cache write  $6.25/M
  Web search   $10/K + input costs

```

### Providers

| Provider   | Text | Image | Video | Speech | Transcription |
| ---------- | ---: | ----: | ----: | -----: | ------------: |
| OpenRouter |  Yes |   Yes |   Yes |     No |            No |
| OpenAI     |  Yes |   Yes |    No |    Yes |           Yes |
| FAL        |   No |   Yes |   Yes |    Yes |           Yes |
| Ollama     |  Yes |    No |    No |     No |            No |
| OMLX       |  Yes |    No |    No |     No |            No |

Ollama and OMLX text models may accept image inputs when the selected local model supports vision. Provider selection is explicit. ai-cli never sends a request to a different provider as a fallback.

### Multi-Model Comparison

Generate with multiple models by comma-separating `-m`. Provider-qualified IDs can run cloud and local models concurrently:

```bash
ai text "compare these approaches" -m "openrouter:anthropic/claude-sonnet-4,ollama:qwen3:latest,omlx:qwen3:thinking"
ai image "a sunset" -m "openai/gpt-image-1,xai/grok-imagine-image,bfl/flux-2-pro"
```

Combine with `-n` to generate multiple per model:

```bash
ai image "a sunset" -n 2 -m "openai/gpt-image-1,bfl/flux-2-pro"   # 4 images total
```

### Inline Preview

When running in a terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) (Kitty, Ghostty, WezTerm, Warp, iTerm2), generated images and videos are displayed inline automatically. Video previews decode an H.264 keyframe from the midpoint of the video using [openh264](https://github.com/cisco/openh264) compiled to WebAssembly — no native dependencies required. `audio speak` can also play generated speech and render a terminal waveform after saving. Use `--no-preview` for image/video previews, `--no-play` or `--no-waveform` for audio previews, or set `AI_CLI_PREVIEW=1` to force visual previews on in undetected terminals.

### Output Behavior

- **text**: saves to `<id>.md` (interactive), stdout when piped
- **image/video**: saves to `<id>.png` / `<id>.mp4` (interactive), raw binary stdout when piped
- **audio speak**: saves to `<id>.mp3` (interactive), raw binary stdout when piped
- **audio transcribe**: saves to `<id>.txt` (interactive), stdout when piped
- **`-o <dir>`**: saves inside the directory with auto-generated names

When the CLI needs to choose a filename, it uses a response id when available and falls back to a random 8-character id.

### Environment Variables

| Variable                     | Description                                                 |
| ---------------------------- | ----------------------------------------------------------- |
| `AI_CLI_PROVIDER`            | Default: `openrouter`, `openai`, `fal`, `ollama`, or `omlx` |
| `OPENROUTER_API_KEY`         | OpenRouter API key                                          |
| `OPENAI_API_KEY`             | OpenAI API key                                              |
| `FAL_API_KEY` / `FAL_KEY`    | FAL API key                                                 |
| `OLLAMA_BASE_URL`            | Ollama API URL (default: `http://127.0.0.1:11434/v1`)       |
| `OLLAMA_API_KEY`             | Optional Ollama server API key                              |
| `OMLX_BASE_URL`              | OMLX API URL (default: `http://127.0.0.1:8000/v1`)          |
| `OMLX_API_KEY`               | Optional OMLX server API key                                |
| `AI_CLI_TEXT_MODEL`          | Default text model for the selected provider                |
| `AI_CLI_IMAGE_MODEL`         | Default image model for the selected provider               |
| `AI_CLI_VIDEO_MODEL`         | Default video model for the selected provider               |
| `AI_CLI_SPEECH_MODEL`        | Default speech model for the selected provider              |
| `AI_CLI_TRANSCRIPTION_MODEL` | Default transcription model for the selected provider       |
| `AI_CLI_OUTPUT_DIR`          | Default output directory for generated files                |
| `AI_CLI_PREVIEW`             | Set to `1` to force inline image preview, `0` to disable    |
| `NO_COLOR`                   | Disable ANSI color output                                   |
| `FORCE_COLOR`                | Force color output even when not a TTY                      |

Provider-qualified model IDs take priority over `-P`, which takes priority over `AI_CLI_PROVIDER`. The `-m` flag takes priority over `AI_CLI_*_MODEL` variables. The `-o` flag takes priority over `AI_CLI_OUTPUT_DIR`. Local providers require an explicit text model through `-m` or `AI_CLI_TEXT_MODEL`.

### Timeouts

Requests that exceed the timeout are aborted automatically:

| Command            | Timeout     |
| ------------------ | ----------- |
| `text`             | 120 seconds |
| `image`            | 300 seconds |
| `video`            | 300 seconds |
| `audio speak`      | 120 seconds |
| `audio transcribe` | 120 seconds |

### Exit Codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| `0`  | Success                                       |
| `1`  | All generations failed                        |
| `2`  | Partial failure (some succeeded, some failed) |

## License

[Apache-2.0](LICENSE)
