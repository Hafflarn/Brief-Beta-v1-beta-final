import { DiaryContent, DiaryReport } from "./building-diary";
import { canWrite } from "./beta";
import { configureControls } from "./order-controls";
import { remainingSelfChecks, ControlKind } from "./beta";
import { Snapshot, Command, visible, id, rank } from "./beta";
export function demo(): Snapshot {
  const people = [
    {
      id: "samuel",
      name: "Samuel Fredriksson",
      role: "admin" as const,
      job: "Snickare",
      employer: "Brief Bygg",
      phone: "0701234567",
      email: "samuel@example.se",
      active: true,
      deleted: false,
      external: false,
      joined: true,
    },
    {
      id: "anna",
      name: "Anna Andersson",
      role: "supervisor" as const,
      job: "Arbetsledare",
      employer: "Brief Bygg",
      phone: "0702345678",
      email: "anna@example.se",
      active: true,
      deleted: false,
      external: false,
      joined: true,
    },
    {
      id: "erik",
      name: "Erik Svensson",
      role: "worker" as const,
      job: "Snickare",
      employer: "Brief Bygg",
      phone: "0703456789",
      email: "erik@example.se",
      active: true,
      deleted: false,
      external: false,
      joined: true,
    },
  ];
  const companies = [
    {
      id: "hallstahem",
      name: "Hallstahem",
      kind: "Beställare",
      archived: false,
      contacts: [
        {
          id: "anna-contact",
          name: "Anna Andersson",
          phone: "0702345678",
          email: "anna@example.se",
        },
      ],
    },
    {
      id: "elvbygg",
      name: "Elvbygg",
      kind: "Underentreprenör",
      archived: false,
      contacts: [
        {
          id: "johan-contact",
          name: "Johan Nilsson",
          phone: "0704567890",
          email: "johan@example.se",
        },
      ],
    },
    {
      id: "elfabriken",
      name: "Elfabriken",
      kind: "Underentreprenör",
      archived: false,
      contacts: [
        {
          id: "emma-contact",
          name: "Emma Berg",
          phone: "0705678901",
          email: "emma@example.se",
        },
      ],
    },
  ];
  const projects = [
    {
      id: "p1",
      customer: "hallstahem",
      number: "BR-2026-018",
      customerNumber: "559927",
      name: "Lägenhetsrenovering",
      address: "Storgatan 12, Hallstahammar",
      archived: false,
      connections: [
        {
          id: "c1",
          company: "elvbygg",
          contact: "johan-contact",
          function: "Snickare",
        },
        {
          id: "c2",
          company: "elfabriken",
          contact: "emma-contact",
          function: "Elektriker",
        },
      ],
    },
  ];
  const at = new Date().toISOString();
  const orders = [
    "Byta innerdörr",
    "Laga kökslucka",
    "Montera handtag",
    "Äldre avslutad order",
  ].map((title, i) => ({
    id: "o" + i,
    project: "p1",
    number: "AO-" + (1042 + i),
    title,
    description:
      "Kontakta hyresgästen före besök. Skydda golvet under arbetet.",
    address:
      ["Storgatan 12", "Parkvägen 8", "Björkgatan 4", "Stationsgatan 9"][i] +
      ", Hallstahammar",
    assignee: i === 1 ? "erik" : "samuel",
    issuedBy: "anna",
    issuedAt: at,
    status: (i === 0 ? "Påbörjad" : i === 1 ? "Ej påbörjad" : "Avslutad") as
      "Påbörjad" | "Ej påbörjad" | "Avslutad",
    completedAt:
      i > 1
        ? new Date(Date.now() - (i === 3 ? 20 : 1) * 86400000).toISOString()
        : undefined,
    due: "",
    priority: "Normal",
    participants: [],
    notes: [],
    events: [{ id: id(), at, text: "Anna Andersson skapade arbetsordern." }],
  }));
  return {
    user: "samuel",
    workspace: "demo",
    revision: 0,
    people,
    companies,
    projects,
    orders,
    diaryReports:[],
    inbox:[],
    contactLinks: [
      { contact: "anna-contact", company: "hallstahem", authUser: "anna" },
    ],
  };
}
export function demoApply(input: Snapshot, c: Command): Snapshot {
  const s = structuredClone(input),
    m = s.people.find((x) => x.id === s.user)!;
  const stamp = new Date().toISOString();
  const event = (o: Snapshot["orders"][0], text: string) =>
    o.events.push({ id: id(), at: stamp, text: m.name + " " + text });
  const key = String(c.id || id());
  const o = s.orders.find((o) => o.id === key);
  if (c.kind === "read_inbox") {
    const item=s.inbox?.find(i=>i.id===c.id && i.recipient===m.id);
    if(!item)throw Error("Inkorgsposten är inte tillgänglig.");item.readAt=stamp;
  } else if (c.kind === "save_diary") {
    if(!o || !canWrite(o,m) || o.status==="Avslutad" || !o.buildingDiary)throw Error("Du får inte skriva rapport för denna order.");
    const reports=s.diaryReports ||= [];
    const reportId=String(c.report || id());
    const prior=reports.find(r=>r.id===reportId);
    if(prior && (prior.submittedAt || prior.author!==m.id || prior.order!==o.id))throw Error("Rapporten är låst eller tillhör en annan upprättare.");
    const content=c.content as DiaryContent;
    if(c.submit && !content.work.trim())throw Error("Beskriv dagens utförda arbeten.");
    const project=s.projects.find(p=>p.id===o.project)!;
    const report:DiaryReport={id:reportId,order:o.id,author:m.id,date:String(c.date),updatedAt:stamp,submittedAt:c.submit?stamp:undefined,
      header:{project:project.name,projectNumber:project.number,orderNumber:o.number,customer:s.companies.find(p=>p.id===project.customer)?.name || "",address:o.address || project.address,author:m.name,siteManager:s.people.find(p=>p.id===o.issuedBy)?.name || "",siteManagerId:o.issuedBy},content};
    if(prior)Object.assign(prior,report);else reports.unshift(report);
    if(c.submit){(s.inbox ||= []).unshift({id:id(),recipient:o.issuedBy,order:o.id,report:reportId,kind:"diary",at:stamp,title:o.number+" · "+o.title,sender:m.name});event(o,"sparade en byggdagboksrapport.");}
  } else if (c.kind === "self_contact") {
    m.phone = String(c.phone);
  } else if (c.kind === "invite_member") {
    s.people.push({
      id: id(),
      name: String(c.name),
      role: c.role as typeof m.role,
      job: String(c.job),
      employer: String(c.employer),
      phone: String(c.phone),
      email: String(c.email),
      external: !!c.external,
      active: true,
      deleted: false,
      joined: false,
    });
  } else if (c.kind.endsWith("_member")) {
    const t = s.people.find((x) => x.id === c.id)!;
    if (rank(t.role) <= rank(m.role))
      throw Error("Du får bara ändra lägre rollers profiler.");
    if (c.kind === "edit_member")
      Object.assign(t, {
        name: c.name,
        job: c.job,
        employer: c.employer,
        phone: c.phone,
      });
    else {
      t.active = c.kind === "activate_member";
      t.deleted = c.kind === "delete_member";
      if (!t.active)
        for (const order of s.orders.filter(
          (o) => o.assignee === t.id && o.status !== "Avslutad",
        )) {
          const author = s.people.find(
            (p) => p.id === order.issuedBy && p.active && !p.deleted,
          );
          order.assignee = author?.id || null;
          event(order, "uppdaterade arbetsordern.");
        }
    }
  } else if (c.kind === "save_company") {
    const t = s.companies.find((x) => x.id === key);
    const v = {
      id: key,
      name: String(c.name),
      kind: String(c.companyKind),
      contacts: c.contacts as (typeof s.companies)[0]["contacts"],
      archived: false,
    };
    if (t) Object.assign(t, v);
    else s.companies.push(v);
  } else if (c.kind === "archive_company") {
    s.companies.find((x) => x.id === key)!.archived = true;
  } else if (c.kind === "save_project") {
    const t = s.projects.find((x) => x.id === key);
    const v = {
      ...c,
      id: key,
      archived: false,
    } as unknown as (typeof s.projects)[0];
    if (t) Object.assign(t, v);
    else s.projects.push(v);
  } else if (c.kind === "archive_project") {
    s.projects.find((x) => x.id === key)!.archived = true;
  } else if (c.kind === "purge_orders") {
    s.orders = s.orders.filter(
      (o) => !o.deletedAt || (!c.all && !(c.ids as string[]).includes(o.id)),
    );
  } else if (
    c.kind === "create_order" ||
    c.kind === "edit_order" ||
    c.kind === "duplicate_order"
  ) {
    if (c.kind === "edit_order") {
      const controls = configureControls(
        o!.controls,
        c.controls as Record<string, { enabled: boolean }> | undefined,
        c.selfLabels as string | undefined,
      );
      Object.assign(o!, c, { controls });
      event(o!, "uppdaterade arbetsordern.");
    } else {
      const source = c.kind === "duplicate_order" ? o! : c;
      const created = {
        ...source,
        id: id(),
        status: "Ej påbörjad",
        issuedBy: m.id,
        issuedAt: stamp,
        completedAt: undefined,
        deletedAt: undefined,
        participants: [],
        notes: [],
        events: [],
      } as unknown as (typeof s.orders)[0];
      created.controls = configureControls(
        (source as unknown as import("./beta").Order).controls,
        c.controls as Record<string, { enabled: boolean }> | undefined,
        c.selfLabels as string | undefined,
        c.kind === "duplicate_order",
      );
      if (c.kind === "duplicate_order") created.number += " (kopia)";
      event(created, "skapade arbetsordern.");
      s.orders.unshift(created);
    }
  } else if (o) {
    if (!visible(o, m, s.people)) throw Error("Du saknar åtkomst.");
    if (c.kind === "trash_order") {
      o.deletedAt = stamp;
      event(o, "flyttade arbetsordern till papperskorgen.");
    }
    if (c.kind === "restore_order") {
      delete o.deletedAt;
      event(o, "återställde arbetsordern.");
    }
    if (c.kind === "join_order") {
      const prior = o.participants.find((p) => p.user === m.id);
      o.participants = o.participants.filter((p) => p.user !== m.id);
      o.participants.push({
        ...prior,
        user: m.id,
        invitedBy: prior?.invitedBy || m.id,
        invitedAt: prior?.invitedAt || stamp,
        acceptedAt: stamp,
      });
      event(o, "anslöt till arbetsordern.");
    }
    if (c.kind === "invite_order") {
      o.participants.push({
        user: String(c.member),
        invitedBy: m.id,
        invitedAt: stamp,
      });
      event(o, "bjöd in en deltagare.");
    }
    if (c.kind === "set_status") {
      if (o.status === "Avslutad" && m.role === "worker")
        throw Error("Du får inte återöppna.");
      if(c.status === "Avslutad" && o.status !== "Avslutad") (s.inbox ||= []).unshift({id:id(),recipient:o.issuedBy,order:o.id,kind:"completed",at:stamp,title:o.number+" · "+o.title,sender:m.name});
      if (c.status === "Avslutad" && remainingSelfChecks(o) > 0)
        throw Error("Egenkontrollen måste vara utförd före avslut.");
      if (c.status === "Påbörjad" && !o.startedAt) o.startedAt = stamp;
      o.status = c.status as typeof o.status;
      if (o.status === "Avslutad") {
        o.completedAt = stamp;
        if (c.comment)
          o.notes.push({
            id: id(),
            at: stamp,
            author: m.id,
            text: String(c.comment),
            files: [],
          });
        event(o, "avslutade arbetsordern.");
      } else {
        delete o.completedAt;
        event(o, "startade eller återöppnade arbetsordern.");
      }
    }
    if (c.kind === "set_access") {
      if (o.status === "Avslutad") throw Error("Återöppna först.");
      if (typeof c.keysReceived === "boolean") o.keysReceived = c.keysReceived;
      if (typeof c.keysReturned === "boolean") o.keysReturned = c.keysReturned;
      event(o, "uppdaterade nycklar och tillträde.");
    }
    if (c.kind === "set_control") {
      if (o.status === "Avslutad") throw Error("Återöppna först.");
      const control = o.controls?.[c.control as ControlKind];
      const item = control?.items.find((i) => i.id === c.item);
      if (!control?.enabled || !item)
        throw Error("Kontrollen är inte aktiverad.");
      item.done = !!c.done;
      item.comment = String(c.comment || "");
      item.author = m.id;
      item.at = stamp;
      event(o, "uppdaterade en kontrollpunkt.");
    }
    if (c.kind === "add_note") {
      o.notes.push({
        id: id(),
        at: stamp,
        author: m.id,
        text: String(c.text),
        phase: String(c.phase || "Under"),
        hours: c.hours === undefined ? undefined : Number(c.hours),
        files: [],
      });
      event(o, "lade till en kommentar.");
    }
  }
  s.revision++;
  return s;
}
