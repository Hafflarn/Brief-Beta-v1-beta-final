"use client";
import type { OrganizationPerson } from "../../lib/beta-cloud";
import { roles, type Role } from "../../lib/beta";
const level = (person: OrganizationPerson) => person.role === "worker" ? 2 : person.role === "supervisor" || (person.role === "site_manager" && person.organizationLevel !== "client") ? 1 : 0;
export default function OrganizationPeople({people,onPerson}:{people:OrganizationPerson[];onPerson:(person:OrganizationPerson)=>void}) {
 return <div className="organization-tree">{[0,1,2].filter(index=>people.some(person=>level(person)===index)).map(index=><div className="organization-level" key={index}><div className="organization-people">{people.filter(person=>level(person)===index).map(person=><button type="button" className="organization-person" key={person.id} onClick={()=>onPerson(person)} aria-label={"Visa kontaktuppgifter för "+person.name}><span><strong>{person.name}</strong><small>{person.job||(person.role==="site_manager_client"?"Platschef":roles[person.role as Role]||"Beställare")}</small></span></button>)}</div></div>)}</div>;
}
