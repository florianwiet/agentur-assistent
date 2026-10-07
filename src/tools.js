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
    name: "get_client",
    description:
      "Liefert Kontakt-E-Mail und Notizen eines Kunden. Der Name darf unvollständig sein, Groß-/Kleinschreibung egal.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Kundenname oder Teil davon, z. B. 'Huber'." },
      },
      required: ["name"],
    },
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
          description: "Kundenname oder Teil davon, z. B. 'Maier'. Optional.",
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
        client_name: { type: "string", description: "Kundenname oder Teil davon." },
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

// % und _ sind Platzhalter in LIKE. Escapen, damit sie aus der
// Nutzereingabe wörtlich gesucht werden.
function escapeLike(text) {
  return text.replace(/[\\%_]/g, "\\$&");
}

// Sucht einen Kunden per Teilstring, ohne Groß-/Kleinschreibung.
// Normalisiert wird nur die Suche, gespeichert bleibt die Originalschreibweise.
async function findClient(clientName) {
  const search = typeof clientName === "string" ? clientName.trim().replace(/\s+/g, " ") : "";
  if (!search) throw new Error("Kundenname fehlt");

  const { data, error } = await supabase
    .from("clients")
    .select("id, name, contact_email, notes")
    .ilike("name", `%${escapeLike(search)}%`)
    .order("name")
    .limit(10);

  if (error) throw new Error(error.message);
  if (!data.length) throw new Error(`Kein Kunde passt zu '${search}'`);
  if (data.length === 1) return data[0];

  // Mehrere Treffer: ein exakter Treffer gewinnt, sonst muss das LLM nachfragen
  const exact = data.find((client) => client.name.toLowerCase() === search.toLowerCase());
  if (exact) return exact;

  const names = data.map((client) => client.name).join(", ");
  throw new Error(`Mehrere Kunden passen zu '${search}': ${names}. Bitte nachfragen, welcher gemeint ist.`);
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

  async get_client({ name }) {
    const { id, ...client } = await findClient(name);
    return client;
  },

  async list_open_tasks({ client_name }) {
    let query = supabase
      .from("tasks")
      .select("title, due_date, clients!inner(name)")
      .eq("status", "open")
      .order("due_date", { nullsFirst: false });

    // Kunde vorher auflösen: Ein unbekannter Name soll als Fehler
    // ankommen, nicht als leere Liste ("keine offenen Aufgaben").
    if (client_name) {
      const client = await findClient(client_name);
      query = query.eq("client_id", client.id);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return data.map((task) => ({
      client: task.clients.name,
      title: task.title,
      due_date: task.due_date,
    }));
  },

  async create_task({ client_name, title, due_date }) {
    const client = await findClient(client_name);

    const { data, error } = await supabase
      .from("tasks")
      .insert({ client_id: client.id, title, due_date: due_date || null })
      .select("title, due_date, status")
      .single();

    if (error) throw new Error(error.message);
    return { client: client.name, ...data };
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
