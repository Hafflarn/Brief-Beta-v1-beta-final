export type Role = "admin" | "supervisor" | "worker";
export type Member = {
  id: string;
  name: string;
  role: Role;
  job: string;
  employer: string;
  phone: string;
  email: string;
  active: boolean;
  deleted: boolean;
  external: boolean;
  joined: boolean;
};
export type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string;
};
export type Company = {
  id: string;
  name: string;
  kind: string;
  contacts: Contact[];
  archived: boolean;
};
export type Connection = {
  id: string;
  company: string;
  person?: string;
  contact: string;
  function: string;
};
export type Project = {
  id: string;
  number: string;
  customerNumber: string;
  customer: string;
  name: string;
  address: string;
  connections: Connection[];
  archived: boolean;
};
export type Attachment = {
  id: string;
  name: string;
  type: string;
  path: string;
  bucket?: string;
};
export type Note = {
  id: string;
  author: string;
  at: string;
  text: string;
  files: Attachment[];
};
export type HistoryEvent = { id: string; at: string; text: string };
export type Participant = {
  user: string;
  invitedBy: string;
  invitedAt: string;
  acceptedAt?: string;
};
export type Order = {
  id: string;
  project: string;
  number: string;
  title: string;
  description: string;
  address: string;
  assignee: string | null;
  issuedBy: string;
  issuedAt: string;
  status: "Ej påbörjad" | "Påbörjad" | "Avslutad";
  due: string;
  priority: string;
  completedAt?: string;
  deletedAt?: string;
  participants: Participant[];
  notes: Note[];
  events: HistoryEvent[];
};
export type Snapshot = {
  user: string;
  workspace: string;
  revision: number;
  people: Member[];
  companies: Company[];
  projects: Project[];
  orders: Order[];
  contactLinks: { contact: string; company: string; authUser: string }[];
};
export type Command = { kind: string; [key: string]: unknown };
export const roles: Record<Role, string> = {
  admin: "Admin",
  supervisor: "Arbetsledare",
  worker: "Utförare",
};
export const rank = (role: Role) =>
  ({ admin: 1, supervisor: 2, worker: 3 })[role];
export const manages = (m: Member) => !m.external && rank(m.role) < 3;
export const joined = (o: Order, m: Member) =>
  o.assignee === m.id ||
  o.participants.some((p) => p.user === m.id && p.acceptedAt);
export const canWrite = (o: Order, m: Member) =>
  !o.deletedAt && (manages(m) || joined(o, m));
export const onHome = (o: Order, at = Date.now()) =>
  !o.deletedAt &&
  (o.status !== "Avslutad" ||
    (!!o.completedAt &&
      at - new Date(o.completedAt).getTime() < 14 * 86400000));
export const date = (v?: string) =>
  v
    ? new Date(v).toLocaleString("sv-SE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
export const id = () => crypto.randomUUID();
export const filters = [
  "Alla",
  "Mina ordrar",
  "Påbörjade",
  "Ej påbörjade",
  "Avslutade",
];
export function visible(o: Order, m: Member, people: Member[]) {
  const target = people.find((p) => p.id === o.assignee);
  if (rank(m.role) > (target ? rank(target.role) : 2)) return false;
  if (o.deletedAt) return manages(m);
  return (
    !m.external ||
    o.assignee === m.id ||
    o.participants.some((p) => p.user === m.id)
  );
}
