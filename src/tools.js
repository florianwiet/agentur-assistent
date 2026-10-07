import { supabase } from "./db/supabase.js";
import { ValidationError } from "./errors.js";

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

const MAX_TITLE_LENGTH = 200;

// Prüft Format und Kalender: "2026-02-30" passt zum Muster, existiert aber
// nicht. Ungültige Daten werden je nach Format zu "Invalid Date" oder in den
// Folgemonat gerollt, der Rückvergleich fängt beides ab.
function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// % und _ sind Platzhalter in LIKE. Escapen, damit sie aus der
// Nutzereingabe wörtlich gesucht werden.
function escapeLike(text) {
  return text.replace(/[\\%_]/g, "\\$&");
}

// Sucht einen Kunden per Teilstring, ohne Groß-/Kleinschreibung.
// Normalisiert wird nur die Suche, gespeichert bleibt die Originalschreibweise.
async function findClient(clientName) {
  const search = typeof clientName === "string" ? clientName.trim().replace(/\s+/g, " ") : "";
  if (!search) throw new ValidationError("Kundenname fehlt");

  const { data, error } = await supabase
    .from("clients")
    .select("id, name, contact_email, notes")
    .ilike("name", `%${escapeLike(search)}%`)
    .order("name")
    .limit(10);

  if (error) throw new Error(error.message);
  if (!data.length) throw new ValidationError(`Kein Kunde passt zu '${search}'`);
  if (data.length === 1) return data[0];

  // Mehrere Treffer: ein exakter Treffer gewinnt, sonst muss das LLM nachfragen
  const exact = data.find((client) => client.name.toLowerCase() === search.toLowerCase());
  if (exact) return exact;

  const names = data.map((client) => client.name).join(", ");
  throw new ValidationError(`Mehrere Kunden passen zu '${search}': ${names}. Bitte nachfragen, welcher gemeint ist.`);
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
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    if (!cleanTitle) throw new ValidationError("Titel der Aufgabe fehlt");
    if (cleanTitle.length > MAX_TITLE_LENGTH) {
      throw new ValidationError(`Titel ist länger als ${MAX_TITLE_LENGTH} Zeichen`);
    }
    if (due_date && !isValidDate(due_date)) {
      throw new ValidationError(`'${due_date}' ist kein gültiges Datum im Format YYYY-MM-DD`);
    }

    // Erst nach der Validierung, damit keine unnötige Query läuft
    const client = await findClient(client_name);

    const { data, error } = await supabase
      .from("tasks")
      .insert({ client_id: client.id, title: cleanTitle, due_date: due_date || null })
      .select("title, due_date, status")
      .single();

    if (error) throw new Error(error.message);
    return { client: client.name, ...data };
  },
};

// Führt einen Tool-Aufruf des LLM aus. Fehler gehen als Ergebnis zurück an
// das LLM, damit es sie dem Nutzer erklären kann. Nur ValidationErrors
// verraten ihre Meldung, alles andere (DB-Fehler, Bugs) wird geloggt und
// dem LLM nur allgemein gemeldet, damit keine Interna beim Nutzer landen.
export async function runTool(name, args) {
  const handler = handlers[name];
  if (!handler) return { error: `Unbekanntes Tool: ${name}` };

  try {
    return { output: await handler(args ?? {}) };
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };

    console.error(`Tool ${name} fehlgeschlagen:`, error.message);
    return { error: `Technischer Fehler in ${name}, bitte später erneut versuchen` };
  }
}
