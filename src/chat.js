import { supabase } from "./db/supabase.js";
import { gemini, GEMINI_MODEL } from "./llm/gemini.js";
import { toolDeclarations, runTool } from "./tools.js";

const HISTORY_LIMIT = 20;
// Obergrenze für Tool-Runden pro Nachricht, damit keine Endlosschleife entsteht
const MAX_TOOL_ROUNDS = 5;

// System prompt für Gemini
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

  return data.reverse().map((row) => ({
    role: row.role === "assistant" ? "model" : "user",
    parts: [{ text: row.content }],
  }));
}

async function saveMessages(rows) {
  const { error } = await supabase.from("messages").insert(rows);
  if (error) throw new Error(`Nachrichten speichern fehlgeschlagen: ${error.message}`);
}

export async function chat(userId, message) {
  const history = await loadHistory(userId);
  const contents = [...history, { role: "user", parts: [{ text: message }] }];
  const toolLog = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: `${SYSTEM_PROMPT}\nHeute ist ${today()}.`,
        tools: [{ functionDeclarations: toolDeclarations }],
        // Gemini antwortet gelegentlich mit 503/504, daher kurze Wiederholungen
        httpOptions: { timeout: 30_000, retryOptions: { attempts: 3 } },
      },
    });

    const calls = response.functionCalls;

    if (!calls?.length) {
      const reply = response.text?.trim();
      if (!reply) throw new Error("Leere Antwort von Gemini");

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

    // Gemini will Tools aufrufen: seine Anfrage unverändert in den Verlauf
    // übernehmen, Tools ausführen und die Ergebnisse zurückschicken.
    contents.push(response.candidates[0].content);

    const parts = [];
    for (const call of calls) {
      const result = await runTool(call.name, call.args);
      toolLog.push({ name: call.name, args: call.args, result });
      parts.push({
        functionResponse: { id: call.id, name: call.name, response: result },
      });
    }
    contents.push({ role: "user", parts });
  }

  throw new Error(`Mehr als ${MAX_TOOL_ROUNDS} Tool-Runden ohne Antwort`);
}
