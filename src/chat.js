import { supabase } from "./db/supabase.js";
import { gemini, GEMINI_MODEL } from "./llm/gemini.js";

const HISTORY_LIMIT = 20;

// System prompt für Gemini
const SYSTEM_PROMPT = `Du bist der interne Assistent eines Unternehmens.
Du hilfst dem Team bei Fragen zu Kunden, Aufgaben und der täglichen Arbeit.
Antworte auf Deutsch, knapp und sachlich.`;

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

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [...history, { role: "user", parts: [{ text: message }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      // Gemini antwortet gelegentlich mit 503/504, daher kurze Wiederholungen
      httpOptions: { timeout: 30_000, retryOptions: { attempts: 3 } },
    },
  });

  const reply = response.text?.trim();
  if (!reply) throw new Error("Leere Antwort von Gemini");

  await saveMessages([
    { user_id: userId, role: "user", content: message },
    { user_id: userId, role: "assistant", content: reply },
  ]);

  return reply;
}
