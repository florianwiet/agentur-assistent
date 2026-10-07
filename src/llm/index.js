// Wählt den LLM-Anbieter über LLM_PROVIDER in der .env.
//
// Alle Anbieter bieten dieselbe Funktion:
//   generate({ system, messages, tools }) -> { text, toolCalls, message }
//
// Neutrales Nachrichtenformat in messages:
//   { role: "user", content }
//   { role: "assistant", content, toolCalls: [{ id, name, args }], raw? }
//   { role: "tool", toolCallId, name, result }
// Tools: { name, description, parameters } mit parameters als JSON Schema.
// message aus der Rückgabe kann unverändert an messages angehängt werden.

const providers = {
  gemini: () => import("./gemini.js").then((m) => ({ model: m.GEMINI_MODEL, generate: m.generate })),
  ollama: () => import("./ollama.js").then((m) => ({ model: m.OLLAMA_MODEL, generate: m.generate })),
};

export const LLM_PROVIDER = process.env.LLM_PROVIDER || "gemini";

if (!providers[LLM_PROVIDER]) {
  throw new Error(
    `Unbekannter LLM_PROVIDER '${LLM_PROVIDER}', erlaubt: ${Object.keys(providers).join(", ")}`,
  );
}

// Nur der gewählte Anbieter wird geladen, damit z. B. für Ollama
// kein GEMINI_API_KEY nötig ist.
const provider = await providers[LLM_PROVIDER]();

export const LLM_MODEL = provider.model;
export const generate = provider.generate;
