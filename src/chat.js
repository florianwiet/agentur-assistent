import { supabase } from "./db/supabase.js";
import { generate, LLM_PROVIDER } from "./llm/index.js";
import { toolDeclarations, runTool } from "./tools.js";
import { DatabaseError, LlmError } from "./errors.js";

const HISTORY_LIMIT = 20;
// Obergrenze für Tool-Runden pro Nachricht, damit keine Endlosschleife entsteht
const MAX_TOOL_ROUNDS = 5;
const GIVE_UP_REPLY =
  "Ich konnte die Anfrage nicht abschließen. Bitte formuliere sie genauer oder teile sie auf.";

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

  if (error) throw new DatabaseError(error);

  return data.reverse().map((row) => ({ role: row.role, content: row.content }));
}

async function saveMessages(rows) {
  const { error } = await supabase.from("messages").insert(rows);
  if (error) throw new DatabaseError(error);
}

async function callLlm(messages) {
  try {
    return await generate({
      system: `${SYSTEM_PROMPT}\nHeute ist ${today()}.`,
      messages,
      tools: toolDeclarations,
    });
  } catch (error) {
    throw new LlmError(`${LLM_PROVIDER} nicht erreichbar`, error);
  }
}

// Speichert den kompletten Durchlauf: Nutzernachricht, alle Tool-Aufrufe
// und die Antwort. Die Tool-Aufrufe gehören dazu, weil z. B. create_task
// schon Daten geändert hat.
async function finish(userId, message, toolLog, reply) {
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

export async function chat(userId, message) {
  const history = await loadHistory(userId);
  const messages = [...history, { role: "user", content: message }];
  const toolLog = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callLlm(messages);

    if (!response.toolCalls.length) {
      if (response.text) return finish(userId, message, toolLog, response.text);

      console.warn(`Leere Antwort von ${LLM_PROVIDER} für ${userId}, Abbruch`);
      return finish(userId, message, toolLog, GIVE_UP_REPLY);
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

  // Kein Fehler werfen: Tools mit Seiteneffekten sind evtl. schon gelaufen,
  // der Durchlauf muss trotzdem im Verlauf landen.
  console.warn(`Mehr als ${MAX_TOOL_ROUNDS} Tool-Runden für ${userId}, Abbruch`);
  return finish(userId, message, toolLog, GIVE_UP_REPLY);
}
