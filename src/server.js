import express from "express";
import { chat } from "./chat.js";
import { AppError, ValidationError } from "./errors.js";

const MAX_MESSAGE_LENGTH = 4000;

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Kein try/catch nötig: Express 5 reicht Fehler aus async-Routen
// automatisch an den Error-Handler unten weiter.
app.post("/chat", async (req, res) => {
  const { user_id, message } = req.body ?? {};
  if (!isNonEmptyString(user_id) || !isNonEmptyString(message)) {
    throw new ValidationError("user_id und message müssen nicht-leere Strings sein");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`message ist länger als ${MAX_MESSAGE_LENGTH} Zeichen`);
  }

  const reply = await chat(user_id.trim(), message.trim());
  res.json({ reply });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route nicht gefunden" });
});

// Zentraler Error-Handler, vergleichbar mit exception_handler in FastAPI.
// Express erkennt ihn an den vier Parametern, daher bleibt next stehen.
app.use((err, req, res, next) => {
  // Kaputter JSON-Body, geworfen von express.json()
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Body ist kein gültiges JSON" });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) console.error(`${err.name}:`, err.cause?.message ?? err.message);
    return res.status(err.status).json({ error: err.message });
  }

  console.error("Unerwarteter Fehler:", err);
  res.status(500).json({ error: "Interner Fehler" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Läuft auf Port ${PORT}`));
