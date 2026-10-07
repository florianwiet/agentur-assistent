import { gemini, GEMINI_MODEL } from "../src/llm/gemini.js";

try {
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: "Antworte nur mit: ok",
    config: { httpOptions: { timeout: 30_000 } },
  });
  console.log(`Verbindung ok (${GEMINI_MODEL}):`, response.text.trim());
} catch (error) {
  console.error("Verbindung fehlgeschlagen:", error.message);
  process.exit(1);
}
