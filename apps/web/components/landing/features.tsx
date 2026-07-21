"use client";

import type { ReactNode } from "react";

import { Stage } from "./stage";
import { Window } from "./window";

interface row {
  readonly tone: "cmd" | "code" | "dim";
  readonly text: string;
}

const multimodelrows: readonly row[] = [
  {
    tone: "cmd",
    text: '$ ai image "a sunset" -m "openai/gpt-image-2,bfl/flux-2-pro"',
  },
  { tone: "dim", text: "" },
  { tone: "code", text: "Saved to /Users/you/resp_img_a-1.png (3.2s)" },
  { tone: "code", text: "Saved to /Users/you/resp_img_b-2.png (4.7s)" },
];

const pipingrows: readonly row[] = [
  { tone: "cmd", text: '$ git diff | ai text "explain these changes"' },
  { tone: "dim", text: "" },
  { tone: "code", text: "These changes refactor the auth module:" },
  { tone: "code", text: "" },
  { tone: "code", text: "  1. Splits session logic into its own file" },
  { tone: "code", text: "  2. Adds token expiry validation" },
  { tone: "code", text: "  3. Removes deprecated OAuth1 flow" },
  { tone: "dim", text: "" },
  { tone: "cmd", text: '$ ai image "a dragon" | ai video "animate this"' },
  { tone: "code", text: "Saved to /Users/you/resp_video.mp4" },
  { tone: "dim", text: "" },
  {
    tone: "cmd",
    text: '$ echo "Ship the changelog" | ai audio speak -P openai',
  },
  { tone: "code", text: "Saved to /Users/you/resp_speech.mp3" },
];

const modelrows: readonly row[] = [
  { tone: "cmd", text: "$ ai models -P openai --type audio" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "Speech models (1):" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "  openai" },
  { tone: "code", text: "    tts-1" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "Transcription models (1):" },
  { tone: "dim", text: "" },
  { tone: "dim", text: "  openai" },
  { tone: "code", text: "    whisper-1" },
];

function rowstyle(tone: row["tone"]): string {
  switch (tone) {
    case "cmd": {
      return "text-white/75";
    }
    case "dim": {
      return "text-white/35";
    }
    default: {
      return "text-white/60";
    }
  }
}

function Panel({ rows }: { readonly rows: readonly row[] }) {
  return (
    <div className="flex h-[280px] flex-col overflow-hidden bg-[#050505]">
      <div className="flex-1 overflow-x-auto overflow-y-auto px-5 py-4 font-mono text-[12px] leading-[1.65] tabular-nums sm:text-[13px]">
        <div className="w-fit min-w-full whitespace-pre">
          {rows.map((entry, index) => (
            <div
              key={`${entry.text}-${index}`}
              className={rowstyle(entry.tone)}
            >
              {entry.text || "\u00A0"}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Spotlight({
  tone,
  title,
  description,
  bullets,
  flip,
  window,
}: {
  readonly tone: "slate" | "ash" | "iron";
  readonly title: string;
  readonly description: string;
  readonly bullets: readonly string[];
  readonly flip?: boolean;
  readonly window: ReactNode;
}) {
  return (
    <div className="grid min-w-0 items-center gap-10 overflow-hidden md:grid-cols-2 md:gap-16">
      <div
        className={`min-w-0 ${flip ? "order-1 md:order-2" : "order-1 md:order-1"}`}
      >
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h2>
        <p className="mt-4 text-sm text-[#888] leading-relaxed">
          {description}
        </p>
        <ul className="mt-8 space-y-3">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-center gap-3 text-sm text-white/70"
            >
              <span className="h-1 w-1 rounded-full bg-white/40" />
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div
        className={`min-w-0 ${flip ? "order-2 md:order-1" : "order-2 md:order-2"}`}
      >
        <Stage tone={tone}>
          <div className="mx-auto w-full min-w-0 max-w-[1160px]">
            <Window title="" bar={false}>
              {window}
            </Window>
          </div>
        </Stage>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section>
      <div className="mx-auto max-w-[1320px] overflow-hidden px-6 pt-20 pb-20 md:pt-28 md:pb-28">
        <div className="space-y-16 md:space-y-28">
          <Spotlight
            tone="slate"
            title="Multi-model comparison."
            description="Run the same prompt across multiple models in parallel. Compare outputs side by side to find the best result. Combine with -n to generate multiple per model."
            bullets={[
              "comma-separated model IDs for parallel generation",
              "configurable concurrency limits",
              "per-job timing and structured JSON output",
            ]}
            window={<Panel rows={multimodelrows} />}
          />

          <Spotlight
            tone="ash"
            title="Pipe everything."
            description="Pipe text in as context, pipe images into video generation, turn text into speech, or transcribe piped audio. Raw output on stdout when piped, file saves when interactive."
            bullets={[
              "text stdin becomes prompt context",
              "binary stdin for image, video, and audio workflows",
              "chain: ai image | ai video, or pipe text to ai audio speak -P openai",
            ]}
            flip
            window={<Panel rows={pipingrows} />}
          />

          <Spotlight
            tone="iron"
            title="Choose how you connect."
            description="Use OpenRouter for broad model access, connect directly to OpenAI and FAL, or run Ollama and OMLX models locally."
            bullets={[
              "explicit provider selection with no silent fallback",
              "live OpenRouter and models.dev catalogs",
              "cloud and local models in one concurrent run",
              "per-provider defaults configurable via env vars",
            ]}
            window={<Panel rows={modelrows} />}
          />
        </div>
      </div>
    </section>
  );
}
