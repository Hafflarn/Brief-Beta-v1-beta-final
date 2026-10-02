const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    filename,
  );
const { onHome, visible, canWrite } = require("../lib/beta.ts");
const schema = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/001_brief_v1_beta.sql"),
  "utf8",
);
const stub = `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,created_at timestamptz default now());alter table storage.objects enable row level security;`;
test("14-day home cutoff preserves search data, and role/participation rules", () => {
  const at = Date.now();
  const worker = {
    id: "w",
    role: "worker",
    active: true,
    deleted: false,
    external: false,
  };
  const admin = {
    id: "a",
    role: "admin",
    active: true,
    deleted: false,
    external: false,
  };
  const order = {
    assignee: "w",
    participants: [],
    status: "Avslutad",
    completedAt: new Date(at - 14 * 86400000).toISOString(),
  };
  assert.equal(onHome(order, at), false);
  assert.equal(visible(order, worker, [worker, admin]), true);
  assert.equal(canWrite({ ...order, assignee: "other" }, worker), false);
  assert.equal(
    visible({ ...order, assignee: "a" }, worker, [worker, admin]),
    false,
  );
  assert.equal(
    visible(order, { ...worker, external: true, id: "outside" }, [
      worker,
      admin,
    ]),
    false,
  );
});
test("Database authorizes every business action and isolates workspaces", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(stub);
  await db.exec(schema);
  await db.exec(schema);
  const ids = {
    admin: crypto.randomUUID(),
    lead: crypto.randomUUID(),
    worker: crypto.randomUUID(),
    peer: crypto.randomUUID(),
    external: crypto.randomUUID(),
    other: crypto.randomUUID(),
  };
  let workspace;
  async function login(uid) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid,
    ]);
  }
  async function as(uid, fn) {
    await login(uid);
    await db.exec("set role authenticated");
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }
  async function auth(name) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)",
      [
        ids[name],
        name + "@example.se",
        JSON.stringify({
          full_name: name,
          job_title: "Snickare",
          company_name: "Företag",
          phone: "070" + Object.keys(ids).indexOf(name) + "123456",
        }),
      ],
    );
  }
  async function load(uid = ids.admin, w = workspace) {
    return (
      await as(uid, () =>
        db.query("select public.brief_beta_load($1) as s", [w]),
      )
    ).rows[0].s;
  }
  async function apply(uid, c, w = workspace) {
    const revision = (
      await db.query("select revision from bb_workspaces where id=$1", [w])
    ).rows[0].revision;
    return (
      await as(uid, () =>
        db.query("select public.brief_beta_apply($1,$2,$3::jsonb) as s", [
          w,
          revision,
          JSON.stringify(c),
        ]),
      )
    ).rows[0].s;
  }
  async function bootstrap(uid) {
    return (
      await as(uid, () => db.query("select public.brief_beta_bootstrap() as w"))
    ).rows[0].w;
  }
  await auth("admin");
  workspace = (await bootstrap(ids.admin))[0].id;
  let s = await load();
  const admin = s.user;
  async function invite(name, role, external = false) {
    await apply(ids.admin, {
      kind: "invite_member",
      name,
      email: name + "@example.se",
      role,
      job: "Snickare",
      employer: "Företag",
      phone: "0700000000",
      external,
    });
    await auth(name);
    await bootstrap(ids[name]);
    return (await load(ids[name])).user;
  }
  const lead = await invite("lead", "supervisor");
  const worker = await invite("worker", "worker");
  const peer = await invite("peer", "worker");
  const outside = await invite("external", "worker", true);
  await auth("other");
  const otherWorkspace = (await bootstrap(ids.other))[0].id;
  await assert.rejects(() => load(ids.other), /aktiv profil/);
  await assert.rejects(
    () => as(ids.worker, () => db.query("select * from public.bb_orders")),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      as(ids.worker, () => db.query("select brief_beta_private.rank('admin')")),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      apply(ids.lead, {
        kind: "edit_member",
        id: admin,
        name: "hack",
        job: "x",
        employer: "x",
        phone: "0",
      }),
    /lägre rollers/,
  );
  await assert.rejects(
    () => apply(ids.admin, { kind: "delete_member", id: admin }),
    /lägre rollers/,
  );
  await assert.rejects(
    () =>
      apply(ids.admin, {
        kind: "edit_member",
        id: worker,
        name: "worker",
        role: "supervisor",
        job: "x",
        employer: "x",
        phone: "0",
      }),
    /låst/,
  );
  const company = crypto.randomUUID();
  const project = crypto.randomUUID();
  await apply(ids.admin, {
    kind: "save_company",
    id: company,
    name: "Hallstahem",
    companyKind: "Beställare",
    contacts: [
      { id: "contact", name: "Worker", email: "worker@example.se", phone: "" },
    ],
  });
  await assert.rejects(
    () =>
      apply(ids.admin, {
        kind: "save_company",
        name: "Empty",
        companyKind: "Beställare",
        contacts: [],
      }),
    /kontaktperson/,
  );
  await apply(ids.lead, {
    kind: "save_project",
    id: project,
    customer: company,
    number: "FREE/2026",
    customerNumber: "559927",
    name: "Projekt",
    address: "Storgatan",
    connections: [],
  });
  const o1 = crypto.randomUUID(),
    o2 = crypto.randomUUID(),
    o3 = crypto.randomUUID();
  const order = (id, assignee) => ({
    kind: "create_order",
    id,
    project,
    number: "AO-" + id.slice(0, 4),
    title: "Order",
    description: "Test",
    address: "Adress",
    assignee,
    due: "",
    priority: "Normal",
  });
  await apply(ids.admin, order(o1, worker));
  await apply(ids.admin, order(o2, admin));
  await apply(ids.admin, order(o3, lead));
  await assert.rejects(
    () => apply(ids.lead, order(crypto.randomUUID(), admin)),
    /egen rollnivå/,
  );
  await assert.rejects(
    () => apply(ids.admin, order(o1, worker)),
    /används redan/,
  );
  assert.equal(
    (await load(ids.lead)).orders.some((o) => o.id === o2),
    false,
  );
  assert.equal(
    (await load(ids.worker)).orders.some((o) => o.id === o3),
    false,
  );
  await assert.rejects(
    () => apply(ids.worker, { kind: "join_order", id: o2 }),
    /åtkomst/,
  );
  await assert.rejects(
    () => apply(ids.peer, { kind: "add_note", id: o1, text: "No", files: [] }),
    /Anslut/,
  );
  await apply(ids.peer, { kind: "join_order", id: o1 });
  await apply(ids.peer, {
    kind: "add_note",
    id: o1,
    text: "Joined",
    files: [],
  });
  assert.equal((await load(ids.external)).orders.length, 0);
  await apply(ids.lead, { kind: "invite_order", id: o1, member: outside });
  assert.equal((await load(ids.external)).orders.length, 1);
  await assert.rejects(
    () =>
      apply(ids.external, {
        kind: "add_note",
        id: o1,
        text: "Not accepted",
        files: [],
      }),
    /Anslut/,
  );
  await apply(ids.external, { kind: "join_order", id: o1 });
  assert.equal(
    (await load(ids.external)).orders[0].participants.find(
      (p) => p.user === outside,
    ).invitedBy,
    lead,
  );
  await apply(ids.external, {
    kind: "add_note",
    id: o1,
    text: "External",
    files: [],
  });
  await assert.rejects(
    () => apply(ids.external, { kind: "save_project", id: project }),
    /hantera/,
  );
  await apply(ids.worker, {
    kind: "set_status",
    id: o1,
    status: "Avslutad",
    comment: "",
  });
  assert.equal(
    (await load()).orders.find((o) => o.id === o1).status,
    "Avslutad",
  );
  await assert.rejects(
    () => apply(ids.worker, { kind: "set_status", id: o1, status: "Påbörjad" }),
    /återöppna/,
  );
  await apply(ids.lead, { kind: "set_status", id: o1, status: "Påbörjad" });
  await apply(ids.lead, {
    ...order(o1, worker),
    kind: "edit_order",
    title: "Ändrad",
  });
  const history = (await load()).orders
    .find((o) => o.id === o1)
    .events.at(-1).text;
  assert.equal(history, "lead uppdaterade arbetsordern.");
  assert.equal(history.includes("Ändrad"), false);
  await apply(ids.lead, { kind: "deactivate_member", id: worker });
  assert.equal((await load()).orders.find((o) => o.id === o1).assignee, admin);

  // Storage path ownership and read/write access remain enforced server-side.
  await apply(ids.admin, { kind: "activate_member", id: worker });
  const fileID = crypto.randomUUID();
  const filePath = workspace + "/" + o1 + "/" + worker + "/" + fileID;
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)",
    ["brief-beta-files", filePath, ids.worker],
  );
  await apply(ids.admin, { ...order(o1, worker), kind: "edit_order" });
  await apply(ids.worker, {
    kind: "add_note",
    id: o1,
    text: "Bilaga",
    files: [
      { id: fileID, name: "bild.png", type: "image/png", path: filePath },
    ],
  });
  assert.equal(
    (
      await as(ids.worker, () =>
        db.query("select public.brief_beta_file_access($1) as ok", [filePath]),
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await as(ids.other, () =>
        db.query("select public.brief_beta_file_access($1) as ok", [filePath]),
      )
    ).rows[0].ok,
    false,
  );
  const fake = crypto.randomUUID();
  await assert.rejects(
    () =>
      apply(ids.worker, {
        kind: "add_note",
        id: o1,
        text: "fake",
        files: [
          {
            id: fake,
            name: "x",
            type: "text/plain",
            path: workspace + "/" + o1 + "/" + worker + "/" + fake,
          },
        ],
      }),
    /uppladdad/,
  );
  await assert.rejects(
    () => as(ids.worker, () => db.query("select public.brief_beta_cleanup()")),
    /permission denied/,
  );
  // Unassigned fallback when both responsible person and creator are inactive.
  await apply(ids.admin, { kind: "activate_member", id: worker });
  const o4 = crypto.randomUUID();
  await apply(ids.lead, order(o4, worker));
  await apply(ids.admin, { kind: "deactivate_member", id: lead });
  await apply(ids.admin, { kind: "deactivate_member", id: worker });
  assert.equal((await load()).orders.find((o) => o.id === o4).assignee, null);
  await apply(ids.admin, { kind: "trash_order", id: o1 });
  await assert.rejects(
    () => apply(ids.worker, { kind: "restore_order", id: o1 }),
    /aktiv profil/,
  );
  await apply(ids.admin, { kind: "restore_order", id: o1 });
  await apply(ids.admin, { kind: "trash_order", id: o1 });
  await apply(ids.admin, { kind: "purge_orders", ids: [o1] });
  assert.equal(
    (
      await as(ids.worker, () =>
        db.query("select public.brief_beta_file_access($1) as ok", [filePath]),
      )
    ).rows[0].ok,
    false,
  );
  const cleanup = (
    await db.query("select public.brief_beta_cleanup() as files")
  ).rows[0].files;
  assert(cleanup.some((f) => f.path === filePath));
  await db.query("select public.brief_beta_cleanup_ack($1::jsonb)", [
    JSON.stringify(cleanup),
  ]);
  assert.equal(
    (await db.query("select count(*)::int as n from bb_file_cleanup")).rows[0]
      .n,
    0,
  );
  assert.equal(
    (await load()).orders.some((o) => o.id === o1),
    false,
  );
  await apply(ids.admin, { kind: "trash_order", id: o4 });
  await db.query(
    "update bb_orders set body=jsonb_set(body,'{deletedAt}',to_jsonb((now()-interval '15 days')::text)) where id=$1",
    [o4],
  );
  assert.equal(
    (await load()).orders.some((o) => o.id === o4),
    false,
  );
  // Confirmed Auth email synchronization and contact matching.
  await db.query("update auth.users set email=$1 where id=$2", [
    "new-admin@example.se",
    ids.admin,
  ]);
  await bootstrap(ids.admin);
  assert.equal(
    (await load()).people.find((p) => p.id === admin).email,
    "new-admin@example.se",
  );
  await db.query("update bb_members set active=true where id=$1", [worker]);
  s = await load();
  assert.equal(s.contactLinks.length, 1);
  // Cross-workspace caller cannot overwrite an entity by reusing its UUID.
  await assert.rejects(
    () =>
      apply(
        ids.other,
        {
          kind: "save_company",
          id: company,
          name: "Attack",
          companyKind: "Beställare",
          contacts: [{ id: "x", name: "x" }],
        },
        otherWorkspace,
      ),
    /Fel arbetsyta/,
  );
  // Stale revisions are rejected atomically.
  await assert.rejects(
    () =>
      as(ids.admin, () =>
        db.query("select public.brief_beta_apply($1,-1,$2::jsonb)", [
          workspace,
          JSON.stringify({ kind: "self_contact", phone: "0" }),
        ]),
      ),
    /ändrats/,
  );
  // Unconfirmed users cannot claim invitations or create a workspace.
  const unconfirmed = crypto.randomUUID();
  await db.query(
    "insert into auth.users values($1,'unconfirmed@example.se',null,'{}')",
    [unconfirmed],
  );
  await assert.rejects(() => bootstrap(unconfirmed), /Bekräfta/);
  // Optional legacy import also works when old tables do not exist.
  await db.exec(
    fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/002_import_legacy.sql"),
      "utf8",
    ),
  );

  await db.exec(
    fs.readFileSync(path.join(__dirname, "fixtures/legacy.sql"), "utf8"),
  );
  const legacyCompany = crypto.randomUUID(),
    legacyMember = crypto.randomUUID(),
    legacyCustomer = crypto.randomUUID(),
    legacyProject = crypto.randomUUID(),
    legacyOrder = crypto.randomUUID();
  await db.query("insert into brief_companies(id,name) values($1,$2)", [
    legacyCompany,
    "Legacy workspace",
  ]);
  await db.query(
    "insert into brief_members(id,company_id,email,name,role) values($1,$2,'legacy@example.se','Old worker','employee')",
    [legacyMember, legacyCompany],
  );
  await db.query(
    "insert into brief_customers(id,company_id,name,prefix) values($1,$2,'Old customer','1842')",
    [legacyCustomer, legacyCompany],
  );
  await db.query(
    "insert into brief_projects(id,company_id,number,customer_project,customer_id,name,address) values($1,$2,'1842-001','559927',$3,'Old project','Old street')",
    [legacyProject, legacyCompany, legacyCustomer],
  );
  await db.query(
    "insert into brief_orders(id,company_id,project_id,title,description,due,priority,assignee,issued_by,status) values($1,$2,$3,'Old order','Old description',current_date,'Normal',$4,$4,'Slutförd')",
    [legacyOrder, legacyCompany, legacyProject, legacyMember],
  );
  await db.query(
    "insert into brief_events(order_id,actor,text) values($1,$2,'Original history')",
    [legacyOrder, legacyMember],
  );
  await db.exec(
    fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/002_import_legacy.sql"),
      "utf8",
    ),
  );
  const imported = (
    await db.query("select body from bb_orders where id=$1", [legacyOrder])
  ).rows[0].body;
  assert.equal(imported.status, "Avslutad");
  assert.equal(imported.events[0].text, "Original history");
  assert(imported.completedAt);
  assert.equal(
    (await db.query("select role from bb_members where id=$1", [legacyMember]))
      .rows[0].role,
    "worker",
  );
  await db.exec(
    fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/002_import_legacy.sql"),
      "utf8",
    ),
  );
  assert.equal(
    (
      await db.query("select count(*)::int as n from bb_orders where id=$1", [
        legacyOrder,
      ])
    ).rows[0].n,
    1,
  );
  await db.exec(
    fs.readFileSync(
      path.join(__dirname, "../supabase/RETIRE_LEGACY_AFTER_VERIFICATION.sql"),
      "utf8",
    ),
  );
  assert.equal(
    (await db.query("select to_regclass('public.brief_orders') as legacy"))
      .rows[0].legacy,
    null,
  );
  assert.equal(
    (
      await db.query("select count(*)::int as n from bb_orders where id=$1", [
        legacyOrder,
      ])
    ).rows[0].n,
    1,
  );
});
