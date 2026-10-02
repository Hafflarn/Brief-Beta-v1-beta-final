const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const required = process.env.VERCEL_ENV === "production";
if (required || url || key) {
  if (!url || !key)
    throw Error(
      "Ange både NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY före bygget.",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw Error("Supabase URL måste använda HTTPS (HTTP tillåts bara lokalt).");
  if (
    /placeholder|your[-_ ]|example|<|>/i.test(key) ||
    key.startsWith("sb_secret_")
  )
    throw Error(
      "Använd en riktig publicerbar Supabase-nyckel, aldrig en serverhemlighet.",
    );
  if (key.split(".").length === 3) {
    try {
      const claims = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString(),
      );
      if (claims.role !== "anon") throw Error();
    } catch {
      throw Error("Äldre klientnycklar måste vara giltiga anon-nycklar.");
    }
  } else if (!key.startsWith("sb_publishable_")) {
    throw Error(
      "Supabase-klientnyckeln måste vara en publishable key eller äldre anon-nyckel.",
    );
  }
}
console.log(
  url && key
    ? "Publik Supabase-konfiguration finns. Nyckelns giltighet måste verifieras mot projektet."
    : "Lokalt demobygge utan Supabase.",
);
