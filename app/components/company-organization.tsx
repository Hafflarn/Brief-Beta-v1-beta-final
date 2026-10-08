"use client";
import { useEffect, useState } from "react";
import type { Company, Member, Role } from "../../lib/beta";
import { roles } from "../../lib/beta";
import { companyOrganization, type OrganizationPerson } from "../../lib/beta-cloud";

const level = (p: OrganizationPerson) => p.role === "worker" ? 2 : p.role === "supervisor" || (p.role === "site_manager" && p.organizationLevel !== "client") ? 1 : 0;
const roleLabel = (p: OrganizationPerson) => p.role === "site_manager_client" ? "Platschef" : roles[p.role as Role] || "Beställare";
export default function CompanyOrganization({ company, people, workspace, revision, demo, onPerson }: {
  company: Company; people: Member[]; workspace: string; revision: number; demo: boolean; onPerson: (person: OrganizationPerson) => void;
}) {
  const [loaded, setLoaded] = useState<{company: string; people: OrganizationPerson[]} | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    setError("");
    companyOrganization(workspace, company.id).then(persons => {
      if (!cancelled) setLoaded({company: company.id, people: persons});
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Kunde inte hämta organisationsschemat."); });
    return () => { cancelled = true; };
  }, [workspace, company.id, revision, demo]);
  const local: OrganizationPerson[] = company.contacts.map(ct => {
    const member = people.find(p => !p.deleted && p.active && ct.email && p.email.toLowerCase() === ct.email.toLowerCase());
    return member || {...ct, id: "contact:" + ct.id, role: ct.organizationRole || "client", job: "", employer: company.name};
  });
  for (const person of people.filter(p => p.active && !p.deleted && p.employer.trim().toLowerCase() === company.name.trim().toLowerCase())) {
    if (!local.some(p => p.id === person.id)) local.push(person);
  }
  const persons = demo ? local : loaded?.company === company.id ? loaded.people : null;
  if (company.contactAccess === false) return <section className="organization-chart"><div className="organization-company">{company.name}</div><p className="muted">Kontaktuppgifter visas efter att båda företagen har godkänt en företagsförfrågan.</p></section>;
  return <section className="organization-chart" aria-label={"Organisationsschema för " + company.name}>
    <h3>Organisationsschema</h3>
    <p className="muted">Klicka på en person för e-post och telefon.</p>
    <div className="organization-company">{company.name}</div>
    {error ? <p role="alert">{error}</p> : !persons ? <p role="status">Hämtar organisation…</p> : <>
      {["Beställare / Platschef", "Platschef / Arbetsledare", "Arbetare"].map((label, index) => <div className="organization-level" key={label}>
        <h4>{label}</h4>
        <div className="organization-people">
          {persons.filter(p => level(p) === index).map(person => <button className="organization-person" key={person.id} onClick={() => onPerson(person)} aria-label={"Visa kontaktuppgifter för " + person.name}>
            <span className="avatar" aria-hidden="true">{person.name.split(/\s+/).slice(0,2).map(n=>n[0]).join("")}</span>
            <span><strong>{person.name}</strong><small>{roleLabel(person)}</small>{person.job && <small>{person.job}</small>}</span>
          </button>)}
          {!persons.some(p => level(p) === index) && <p className="organization-empty">Ingen person registrerad på denna nivå.</p>}
        </div>
      </div>)}
      {!persons.length && <p className="muted">Lägg till kontaktpersoner eller registrera personal hos företaget.</p>}
    </>}
  </section>;
}
