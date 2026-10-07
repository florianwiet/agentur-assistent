import { GoogleGenAI } from "@google/genai";

const geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey) {
  throw new Error("GEMINI_API_KEY fehlt in der .env");
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export const gemini = new GoogleGenAI({ apiKey: geminiApiKey });
