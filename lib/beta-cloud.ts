import { supabase } from "./supabase";
import type { Command, Snapshot, Attachment } from "./beta";
const client = () => {
  if (!supabase) throw Error("Supabase är inte konfigurerat.");
  return supabase;
};
export async function bootstrap(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await client().rpc("brief_beta_bootstrap");
  if (error) throw Error(error.message);
  return data;
}
export async function load(workspace: string): Promise<Snapshot> {
  const { data, error } = await client().rpc("brief_beta_load", {
    workspace_id: workspace,
  });
  if (error) throw Error(error.message);
  return data;
}
export async function apply(s: Snapshot, command: Command): Promise<Snapshot> {
  const { data, error } = await client().rpc("brief_beta_apply", {
    workspace_id: s.workspace,
    expected_revision: s.revision,
    command,
  });
  if (error) throw Error(error.message);
  return data;
}
export async function upload(
  s: Snapshot,
  order: string,
  files: File[],
): Promise<Attachment[]> {
  if (files.length > 5 || files.some((f) => f.size > 10 * 1024 * 1024))
    throw Error("Högst 5 filer, max 10 MB per fil.");
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
  ];
  if (files.some((f) => !allowed.includes(f.type)))
    throw Error("Välj JPG, PNG, WebP, PDF eller textfil.");
  const uploaded: Attachment[] = [];
  for (const f of files) {
    const ident = crypto.randomUUID();
    const path = `${s.workspace}/${order}/${s.user}/${ident}`;
    const { error } = await client()
      .storage.from("brief-beta-files")
      .upload(path, f, { contentType: f.type });
    if (error) throw Error(error.message);
    uploaded.push({ id: ident, name: f.name, type: f.type, path });
  }
  return uploaded;
}
export async function download(file: Attachment) {
  const { data, error } = await client()
    .storage.from(file.bucket || "brief-beta-files")
    .download(file.path);
  if (error) throw Error(error.message);
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function contactProfile(
  workspace: string,
  company: string,
  contact: string,
) {
  const { data, error } = await client().rpc("brief_beta_contact_profile", {
    workspace_id: workspace,
    company_id: company,
    contact_id: contact,
  });
  if (error) throw Error(error.message);
  return data as {
    name: string;
    job: string;
    employer: string;
    phone: string;
    email: string;
  } | null;
}
