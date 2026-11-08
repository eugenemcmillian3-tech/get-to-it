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
    id: "deepseek-v4-pro",
    label: "DeepSeek v4 Pro",
    vendor: "DeepSeek",
    blurb: "Default. Holds a long structured reply on the first attempt.",
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    vendor: "DeepSeek",
    blurb: "Fast inference with a long context window.",
  },
  {
    id: "mimo-v2.6-pro",
    label: "MiMo v2.6 Pro",
    vendor: "Xiaomi",
    blurb: "Stronger MiMo variant for writing roles.",
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
    id: "mimo-v2.6-flash",
    label: "MiMo v2.6 Flash",
    vendor: "Xiaomi",
    blurb: "Fast, compact model for review and analysis work.",
  },
];

export const DEFAULT_AI_MODEL = "deepseek-v4-pro";

export function isAiModel(id: string): boolean {
  return AI_MODELS.some((model) => model.id === id);
}

export function aiModelLabel(id: string): string {
  return AI_MODELS.find((model) => model.id === id)?.label ?? id;
}
