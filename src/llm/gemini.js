import { GoogleGenAI } from "@google/genai";

const geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey) {
  throw new Error("GEMINI_API_KEY fehlt in der .env");
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export const gemini = new GoogleGenAI({ apiKey: geminiApiKey });

// Übersetzt das neutrale Nachrichtenformat (siehe llm/index.js) in Geminis
// contents. Aufeinanderfolgende Tool-Ergebnisse landen gemeinsam in einer
// user-Nachricht, so wie Gemini sie erwartet.
function toContents(messages) {
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      // Eigene Antworten unverändert zurückgeben, damit Geminis
      // thought signatures bei Tool-Aufrufen erhalten bleiben.
      contents.push(msg.raw ?? { role: "model", parts: [{ text: msg.content }] });
    } else if (msg.role === "tool") {
      const part = {
        functionResponse: { id: msg.toolCallId, name: msg.name, response: msg.result },
      };
      const last = contents.at(-1);
      if (last?.role === "user" && last.parts[0]?.functionResponse) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
    }
  }

  return contents;
}

export async function generate({ system, messages, tools }) {
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: toContents(messages),
    config: {
      systemInstruction: system,
      tools: tools?.length
        ? [
            {
              functionDeclarations: tools.map(({ name, description, parameters }) => ({
                name,
                description,
                parametersJsonSchema: parameters,
              })),
            },
          ]
        : undefined,
      // Gemini antwortet gelegentlich mit 503/504, daher kurze Wiederholungen
      httpOptions: { timeout: 30_000, retryOptions: { attempts: 3 } },
    },
  });

  const toolCalls = (response.functionCalls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    args: call.args ?? {},
  }));
  const text = toolCalls.length ? "" : (response.text?.trim() ?? "");

  return {
    text,
    toolCalls,
    message: { role: "assistant", content: text, toolCalls, raw: response.candidates?.[0]?.content },
  };
}
