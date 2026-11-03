/**
 * Sends one real chat request through the app's Ollama client and prints the
 * reply. Run it with the app's local secrets loaded:
 *
 *   node --env-file=.env.local scripts/ollama-check.mjs
 *
 * Optional first argument picks a model id (defaults to glm-5.3-flash).
 */
import { chatWithOllama, getOllamaKey, ollamaErrorMessage } from "../src/lib/ai/ollama.ts";

const model = process.argv[2] ?? "glm-5.3-flash";

if (!getOllamaKey()) {
  console.error("OLLAMA_API_KEY is not set. Add it to .env.local, then run:");
  console.error("  node --env-file=.env.local scripts/ollama-check.mjs");
  process.exit(1);
}

try {
  const reply = await chatWithOllama({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a concise assistant inside a productivity app. Reply in one sentence, plain text.",
      },
      {
        role: "user",
        content:
          "I keep putting off tidying my desk. What is the smallest first step?",
      },
    ],
    timeoutMs: 60_000,
  });

  console.log(`model: ${reply.model}`);
  console.log(reply.content);
} catch (error) {
  console.error(`failed: ${ollamaErrorMessage(error)}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
