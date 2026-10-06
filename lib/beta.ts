import type { DiaryReport, InboxItem } from "./building-diary";
export type Role = "admin" | "site_manager" | "supervisor" | "worker";
export type Member = {
  id: string;
  name: string;
  role: Role;
  organizationLevel?: "client" | "management";
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
  organizationRole?: "client" | "site_manager_client" | "site_manager" | "supervisor" | "worker";
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
  siteManager?: string;
  verifier?: string;
  diaryRead?: boolean;
  diaryWrite?: boolean;
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
  phase?: string;
  hours?: number;
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
export type ControlKind = "risk" | "self" | "final";
export type ControlItem = {
  id: string;
  label: string;
  done: boolean;
  comment: string;
  author?: string;
  at?: string;
};
export type OrderControl = { enabled: boolean; items: ControlItem[] };
export const controlLabels: Record<ControlKind, string> = {
  risk: "Riskbedömning",
  self: "Egenkontroll",
  final: "Slutkontroll",
};
export const controlKinds: ControlKind[] = ["risk", "self", "final"];
export const remainingSelfChecks = (o: Order) =>
  o.controls?.self?.enabled
    ? Math.max(1, o.controls.self.items.length) -
      o.controls.self.items.filter((i) => i.done).length
    : 0;
export const hasControls = (o: Order) =>
  controlKinds.some(
    (k) =>
      o.controls?.[k]?.enabled ||
      o.controls?.[k]?.items.some((i) => i.done || i.comment || i.at),
  );
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
  start?: string;
  access?: string;
  keysReceived?: boolean;
  keysReturned?: boolean;
  startedAt?: string;
  buildingDiary?: boolean;
  controls?: Partial<Record<ControlKind, OrderControl>>;
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
  diaryReports?: DiaryReport[];
  inbox?: InboxItem[];
  contactLinks: { contact: string; company: string; authUser: string }[];
};
export type Command = { kind: string; [key: string]: unknown };
export const roles: Record<Role, string> = {
  admin: "Admin",
  site_manager: "Platschef",
  supervisor: "Arbetsledare",
  worker: "Arbetare",
};
export const rank = (role: Role) =>
  ({ admin: 1, site_manager: 2, supervisor: 2, worker: 3 })[role];
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
  if (!m.active || m.deleted) return false;
  if (!m.external && !o.deletedAt) return true;
  const target = people.find((p) => p.id === o.assignee);
  if (rank(m.role) > (target ? rank(target.role) : 2)) return false;
  if (o.deletedAt) return manages(m);
  return (
    !m.external ||
    o.assignee === m.id ||
    o.participants.some((p) => p.user === m.id)
  );
}
