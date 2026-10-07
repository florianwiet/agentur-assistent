// Eigene Fehlerklassen, ähnlich wie HTTPException in FastAPI: Jeder Fehler
// kennt seinen HTTP-Status, und seine message darf an den Aufrufer.
// Technische Details (z. B. die Original-Meldung von Supabase) stecken in
// cause und landen nur im Log.

export class AppError extends Error {
  constructor(message, { status = 500, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.status = status;
  }
}

// Ungültige Eingabe vom Nutzer oder vom LLM. Die Meldung ist bewusst
// verständlich formuliert, damit das LLM sie dem Nutzer erklären kann.
export class ValidationError extends AppError {
  constructor(message) {
    super(message, { status: 400 });
  }
}

export class DatabaseError extends AppError {
  constructor(cause) {
    super("Datenbank nicht erreichbar", { status: 503, cause });
  }
}

export class LlmError extends AppError {
  constructor(message, cause) {
    super(message, { status: 502, cause });
  }
}
