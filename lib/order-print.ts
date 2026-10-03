import {
  Order,
  Snapshot,
  roles,
  controlKinds,
  controlLabels,
  date,
} from "./beta";
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function printOrder(o: Order, s: Snapshot) {
  const popup = window.open("", "_blank");
  if (!popup)
    throw Error("Tillåt popupfönstret för att skriva ut eller spara PDF.");
  const p = s.projects.find((p) => p.id === o.project);
  const person = (id: string | null | undefined) =>
    s.people.find((p) => p.id === id);
  const name = (id: string | null | undefined) => person(id)?.name || "—";
  const field = (label: string, value: unknown) =>
    `<p><strong>${esc(label)}</strong><br>${esc(value)}</p>`;
  const controls = controlKinds
    .map((k) => {
      const c = o.controls?.[k];
      if (
        !c ||
        (!c.enabled && !c.items.some((i) => i.at || i.comment || i.done))
      )
        return "";
      return (
        `<h3>${controlLabels[k]}${c.enabled ? "" : " – avmarkerad"}</h3>` +
        c.items
          .map((i) =>
            field(
              (i.done ? "✓ " : "☐ ") + i.label,
              [i.comment, i.at ? name(i.author) + " · " + date(i.at) : ""]
                .filter(Boolean)
                .join("\n"),
            ),
          )
          .join("")
      );
    })
    .join("");
  popup.document.write(
    `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${esc(o.number)} Serviceorder</title><style>body{font:12pt Arial,sans-serif;color:#173440;margin:36px;line-height:1.5}h1{font-size:24pt}h2{border-bottom:1px solid #d5e1e8;padding-top:14px}p{white-space:pre-wrap;break-inside:avoid}small{color:#536c7d}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media print{button{display:none}body{margin:0}h2,h3{break-after:avoid}}</style></head><body><strong>brēf</strong><h1>${esc(o.number)} · ${esc(o.title)}</h1><button id="print">Skriv ut / Spara som PDF</button><div class="grid">${field("Status", o.status)}${field("Ansvarig upprättare", name(o.issuedBy) + " · " + roles[person(o.issuedBy)?.role || "supervisor"])}${field("Utförare", name(o.assignee))}${field("Adress", o.address || p?.address)}${field("Projekt", p?.number + " / " + p?.customerNumber)}${field("Beställare", s.companies.find((c) => c.id === p?.customer)?.name)}</div><h2>Arbetsbeskrivning</h2>${field("", o.description)}<h2>Planering och datum</h2>${field("Planerad start / färdigt", (o.start || "—") + " / " + (o.due || "—"))}${field("Påbörjad / avslutad", date(o.startedAt) + " / " + date(o.completedAt))}<h2>Kontakter och UE</h2>${(
      p?.connections || []
    )
      .map((cn) => {
        const firm = s.companies.find((c) => c.id === cn.company);
        const ct = firm?.contacts.find((c) => c.id === cn.contact);
        const member = person(cn.person);
        return field(
          firm?.name || member?.employer || "",
          [
            cn.function,
            ct?.name || member?.name,
            ct?.phone || member?.phone,
            ct?.email || member?.email,
          ]
            .filter(Boolean)
            .join(" · "),
        );
      })
      .join(
        "",
      )}<h2>Nycklar och tillträde</h2>${field("", o.access)}${field("Nycklar", "Mottagna: " + (o.keysReceived ? "Ja" : "Ej markerat") + " · Återlämnade: " + (o.keysReturned ? "Ja" : "Ej markerat"))}<h2>Dagbok och bilagor</h2>${o.notes.map((n) => field(name(n.author) + " · " + date(n.at), [n.phase, typeof n.hours === "number" ? n.hours + " timmar" : "", n.text].filter(Boolean).join(" · ") + "\n" + n.files.map((f) => f.name).join("\n"))).join("")}<h2>Kontroller</h2>${controls || "<p>Inga kontroller valda.</p>"}</body></html>`,
  );
  popup.document.close();
  popup.opener = null;
  popup.document
    .getElementById("print")
    ?.addEventListener("click", () => popup.print());
}
