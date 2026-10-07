import { generate, LLM_PROVIDER, LLM_MODEL } from "../src/llm/index.js";

try {
  const { text } = await generate({
    messages: [{ role: "user", content: "Antworte nur mit: ok" }],
  });
  console.log(`Verbindung ok (${LLM_PROVIDER}, ${LLM_MODEL}):`, text);
} catch (error) {
  console.error("Verbindung fehlgeschlagen:", error.message);
  process.exit(1);
}
