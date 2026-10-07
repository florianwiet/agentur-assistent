import { supabase } from "../src/db/supabase.js";

const { data, error } = await supabase
  .from("clients")
  .select("name, contact_email");

if (error) {
  console.error("Verbindung fehlgeschlagen:", error.message);
  process.exit(1);
}

console.log(`Verbindung ok, ${data.length} Kunden gefunden:`);
console.table(data);
