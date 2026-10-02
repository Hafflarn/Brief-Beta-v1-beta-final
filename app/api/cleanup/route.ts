import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return Response.json(
      { error: "Cleanup configuration missing" },
      { status: 503 },
    );
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let removed = 0;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await client.rpc("brief_beta_cleanup");
    if (error)
      return Response.json(
        { error: "Database cleanup failed" },
        { status: 500 },
      );
    const paths = (data || []) as { path: string; bucket: string }[];
    if (!paths.length) break;
    for (const bucket of [...new Set(paths.map((p) => p.bucket))]) {
      const { error: storageError } = await client.storage
        .from(bucket)
        .remove(paths.filter((p) => p.bucket === bucket).map((p) => p.path));
      if (storageError)
        return Response.json(
          { error: "Storage cleanup failed; queued for retry" },
          { status: 500 },
        );
    }
    const { error: ackError } = await client.rpc("brief_beta_cleanup_ack", {
      paths,
    });
    if (ackError)
      return Response.json(
        { error: "Cleanup acknowledgement failed" },
        { status: 500 },
      );
    removed += paths.length;
  }
  return Response.json({ ok: true, removed });
}
