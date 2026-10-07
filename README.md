# Agentur-Assistent

Chat-Agent mit Tool Calling falls notwendig.

Lernprojekt: ein kleiner Nachbau eines produktiven Agent-Stacks (Node.js, Supabase, Container). Der Agent-Loop ist selbst geschrieben, ohne LangChain o. ä.

## Architektur

```
             POST /chat { user_id, message }
                          │
                          ▼
┌──────────────────── server.js ────────────────────┐
│  Express: Body prüfen, zentrales Error-Handling    │
└──────────────────────────┬─────────────────────────┘
                           ▼
┌───────────────────── chat.js ─────────────────────┐
│  Agent-Loop                                        │
│  1. Verlauf des Users laden                        │
│  2. LLM fragen ──► Tool-Calls? ──nein──► Antwort   │
│  3.          ja ──► Tools ausführen, Ergebnis      │
│                     zurück ans LLM, weiter bei 2   │
│  4. Nachricht, Tool-Aufrufe und Antwort speichern  │
└───────┬───────────────────────────────┬────────────┘
        ▼                               ▼
┌─── llm/ ─────────┐          ┌─── tools.js ────────┐
│ Gemini oder      │          │ list_clients        │
│ Ollama, gleiche  │          │ get_client          │
│ Schnittstelle    │          │ list_open_tasks     │
└──────────────────┘          │ create_task         │
                              └─────────┬───────────┘
                                        ▼
                         Supabase (Postgres)
                         clients · tasks · messages
```

## Stack

- Node.js mit ES Modules, Express 5
- Supabase über `@supabase/supabase-js`
- LLM: Google Gemini (Standard) oder lokal per Ollama, umschaltbar über `LLM_PROVIDER`

## Setup

1. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
2. `.env.example` nach `.env` kopieren und ausfüllen. Supabase-URL und Secret Key findest du im Supabase-Dashboard unter Project Settings, API Keys.
3. Datenbank anlegen: Inhalt von `supabase/schema.sql` im Supabase SQL Editor ausführen. Das legt die Tabellen und Testdaten an.
4. Verbindungen prüfen:
   ```bash
   npm run db:check
   npm run llm:check
   ```
5. Server starten (Port 3000, `dev` startet bei Änderungen neu):
   ```bash
   npm run dev
   ```

## Beispiel-Requests

```bash
curl localhost:3000/health
```

```bash
curl -X POST localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "florian", "message": "Welche Aufgaben sind bei Maier offen?"}'
```

Antwort: `{ "reply": "..." }`

Fehler kommen immer als `{ "error": "..." }` zurück:

| Status | Bedeutung                                                                  |
| ------ | -------------------------------------------------------------------------- |
| 400    | Ungültiger Body (kein JSON,`user_id`/`message` fehlen oder sind leer) |
| 502    | LLM nicht erreichbar                                                       |
| 503    | Datenbank nicht erreichbar                                                 |

## Offen

- **Docker:** `Dockerfile`, `.dockerignore` und `docker-compose.yml`, damit der Agent als Container auf einem VPS läuft
- **Telegram-Anbindung (eventuell):** dem Agenten per Telegram-Bot schreiben, entweder direkt in Node oder über einen n8n-Workflow
