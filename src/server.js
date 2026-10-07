import express from "express";
import { chat } from "./chat.js";

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/chat", async (req, res) => {
  const { user_id, message } = req.body ?? {};
  if (!user_id || !message) {
    return res.status(400).json({ error: "user_id oder message fehlt" });
  }

  try {
    const reply = await chat(user_id, message);
    res.json({ reply });
  } catch (error) {
    console.error("Chat fehlgeschlagen:", error.message);
    res.status(502).json({ error: "Antwort konnte nicht erzeugt werden" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Läuft auf Port ${PORT}`));
