import { createClient } from "@supabase/supabase-js";
import { timedFetch } from "./network";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
function initialize() {
  if (!url?.trim() || !key?.trim()) return null;
  try {
    return createClient(url.trim(), key.trim(), {
      global: { fetch: timedFetch },
    });
  } catch {
    return null;
  }
}
export const supabase = initialize();
export const cloudEnabled = Boolean(supabase);
export const configurationError = supabase
  ? ""
  : "Briefs anslutning är inte korrekt konfigurerad. Kontakta administratören eller öppna demonstrationen.";
