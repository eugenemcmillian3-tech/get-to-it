/**
 * Open models GET TO IT can call through Ollama's cloud API.
 * Client-safe: this file holds no secrets and is imported by the picker.
 */
export type AiModel = {
  /** Exact model id used in the Ollama request. */
  id: string;
  label: string;
  vendor: string;
  blurb: string;
};

export const AI_MODELS: AiModel[] = [
  {
    id: "glm-5.3-flash",
    label: "GLM 5.3 Flash",
    vendor: "Z.ai",
    blurb: "Default. Fast, multimodal, strong on coding and agentic steps.",
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    vendor: "DeepSeek",
    blurb: "Fast inference with a long context window.",
  },
  {
    id: "minimax-m3.1-flash",
    label: "MiniMax M3.1 Flash",
    vendor: "MiniMax",
    blurb: "Speed-focused model built for agentic work.",
  },
  {
    id: "gpt-oss:120b-cloud",
    label: "GPT-OSS 120B",
    vendor: "OpenAI open weights",
    blurb: "Large open-weight reasoning model.",
  },
  {
    id: "gemma4:31b-cloud",
    label: "Gemma 4 31B",
    vendor: "Google DeepMind",
    blurb: "Frontier open model with a 256K context window.",
  },
  {
    id: "nemotron-3-nano:30b-cloud",
    label: "Nemotron 3 Nano 30B",
    vendor: "NVIDIA",
    blurb: "Efficient reasoning model with a 1M context window.",
  },
];

export const DEFAULT_AI_MODEL = "glm-5.3-flash";

export function isAiModel(id: string): boolean {
  return AI_MODELS.some((model) => model.id === id);
}

export function aiModelLabel(id: string): string {
  return AI_MODELS.find((model) => model.id === id)?.label ?? id;
}
