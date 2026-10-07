import { supabase } from "./db/supabase.js";
import { generate, LLM_PROVIDER } from "./llm/index.js";
import { toolDeclarations, runTool } from "./tools.js";

const HISTORY_LIMIT = 20;
// Obergrenze für Tool-Runden pro Nachricht, damit keine Endlosschleife entsteht
const MAX_TOOL_ROUNDS = 5;

// System prompt für das LLM
const SYSTEM_PROMPT = `Du bist der interne Assistent eines Unternehmens.
Du hilfst dem Team bei Fragen zu Kunden, Aufgaben und der täglichen Arbeit.
Antworte auf Deutsch, knapp und sachlich.
Nutze für Fragen zu Kunden und Aufgaben immer die Tools, statt zu raten.`;

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

async function loadHistory(userId) {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) throw new Error(`Verlauf laden fehlgeschlagen: ${error.message}`);

  return data.reverse().map((row) => ({ role: row.role, content: row.content }));
}

async function saveMessages(rows) {
  const { error } = await supabase.from("messages").insert(rows);
  if (error) throw new Error(`Nachrichten speichern fehlgeschlagen: ${error.message}`);
}

export async function chat(userId, message) {
  const history = await loadHistory(userId);
  const messages = [...history, { role: "user", content: message }];
  const toolLog = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await generate({
      system: `${SYSTEM_PROMPT}\nHeute ist ${today()}.`,
      messages,
      tools: toolDeclarations,
    });

    if (!response.toolCalls.length) {
      const reply = response.text;
      if (!reply) throw new Error(`Leere Antwort von ${LLM_PROVIDER}`);

      await saveMessages([
        { user_id: userId, role: "user", content: message },
        ...toolLog.map((entry) => ({
          user_id: userId,
          role: "tool",
          content: JSON.stringify(entry),
        })),
        { user_id: userId, role: "assistant", content: reply },
      ]);

      return reply;
    }

    // Das LLM will Tools aufrufen: seine Anfrage in den Verlauf übernehmen,
    // Tools ausführen und die Ergebnisse zurückschicken.
    messages.push(response.message);

    for (const call of response.toolCalls) {
      const result = await runTool(call.name, call.args);
      toolLog.push({ name: call.name, args: call.args, result });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, result });
    }
  }

  throw new Error(`Mehr als ${MAX_TOOL_ROUNDS} Tool-Runden ohne Antwort`);
}
