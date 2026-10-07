export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";

// Lokale Modelle brauchen je nach Rechner deutlich länger als eine API
const TIMEOUT_MS = 120_000;

// Übersetzt das neutrale Nachrichtenformat (siehe llm/index.js) in Ollamas
// messages, die dem OpenAI-Format folgen.
function toMessages(system, messages) {
  const result = system ? [{ role: "system", content: system }] : [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      result.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.toolCalls?.map((call) => ({
          function: { name: call.name, arguments: call.args },
        })),
      });
    } else if (msg.role === "tool") {
      result.push({ role: "tool", tool_name: msg.name, content: JSON.stringify(msg.result) });
    } else {
      result.push({ role: "user", content: msg.content });
    }
  }

  return result;
}

export async function generate({ system, messages, tools }) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: toMessages(system, messages),
        tools: tools?.map(({ name, description, parameters }) => ({
          type: "function",
          function: { name, description, parameters },
        })),
        stream: false,
        // Qwen3 denkt sonst vor jeder Antwort mit, das kostet nur Zeit
        think: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Ollama unter ${OLLAMA_URL} nicht erreichbar: ${error.message}`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama antwortet mit ${res.status}: ${body}`);
  }

  const { message } = await res.json();
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    args: call.function.arguments ?? {},
  }));
  const text = message.content?.trim() ?? "";

  return {
    text,
    toolCalls,
    message: { role: "assistant", content: text, toolCalls },
  };
}
