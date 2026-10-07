import { supabase } from "./db/supabase.js";

// Beschreibungen für das LLM: Name, Zweck und Parameter (JSON Schema) jedes
// Tools. Das LLM liest nur diese Texte, nicht den Code darunter.
export const toolDeclarations = [
  {
    name: "list_clients",
    description: "Listet alle Kunden mit Kontakt-E-Mail und Notizen auf.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_open_tasks",
    description:
      "Listet offene Aufgaben auf, sortiert nach Fälligkeit. Ohne client_name werden die offenen Aufgaben aller Kunden geliefert.",
    parameters: {
      type: "object",
      properties: {
        client_name: {
          type: "string",
          description: "Exakter Kundenname, z. B. 'Autohaus Maier'. Optional.",
        },
      },
    },
  },
  {
    name: "create_task",
    description: "Legt eine neue offene Aufgabe für einen Kunden an.",
    parameters: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Exakter Kundenname." },
        title: { type: "string", description: "Kurzer Titel der Aufgabe." },
        due_date: {
          type: "string",
          description: "Fälligkeitsdatum im Format YYYY-MM-DD. Optional.",
        },
      },
      required: ["client_name", "title"],
    },
  },
];

async function findClientId(clientName) {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("name", clientName)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Kunde '${clientName}' nicht gefunden`);
  return data.id;
}

const handlers = {
  async list_clients() {
    const { data, error } = await supabase
      .from("clients")
      .select("name, contact_email, notes")
      .order("name");

    if (error) throw new Error(error.message);
    return data;
  },

  async list_open_tasks({ client_name }) {
    let query = supabase
      .from("tasks")
      .select("title, due_date, clients!inner(name)")
      .eq("status", "open")
      .order("due_date", { nullsFirst: false });

    if (client_name) query = query.eq("clients.name", client_name);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return data.map((task) => ({
      client: task.clients.name,
      title: task.title,
      due_date: task.due_date,
    }));
  },

  async create_task({ client_name, title, due_date }) {
    const client_id = await findClientId(client_name);

    const { data, error } = await supabase
      .from("tasks")
      .insert({ client_id, title, due_date: due_date || null })
      .select("title, due_date, status")
      .single();

    if (error) throw new Error(error.message);
    return { client: client_name, ...data };
  },
};

// Führt einen Tool-Aufruf des LLM aus. Fehler gehen als Ergebnis
// zurück an das LLM, damit es sie dem Nutzer erklären kann.
export async function runTool(name, args) {
  const handler = handlers[name];
  if (!handler) return { error: `Unbekanntes Tool: ${name}` };

  try {
    return { output: await handler(args ?? {}) };
  } catch (error) {
    return { error: error.message };
  }
}
