"use client";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import Login from "./login";
import { printOrder } from "../lib/order-print";
import Logo from "./components/logo";
import ThemePicker from "./components/theme";
import { useNavigation } from "./components/navigation";
import { cloudEnabled, supabase } from "../lib/supabase";
import { readPreference, writePreference } from "../lib/browser-storage";
import { withTimeout } from "../lib/network";
import * as cloud from "../lib/beta-cloud";
import { demo, demoApply } from "../lib/demo";
import {
  controlKinds,
  controlLabels,
  remainingSelfChecks,
  hasControls,
  Attachment,
  Command,
  Company,
  Connection,
  Contact,
  Member,
  Order,
  Project,
  Snapshot,
  canWrite,
  date,
  filters,
  id,
  joined,
  manages,
  rank,
  roles,
  visible,
} from "../lib/beta";

type Dialog = {
  title: string;
  body: ReactNode;
  action: () => Promise<boolean> | void;
  label: string;
  danger?: boolean;
};
type Field = {
  key: string;
  label: string;
  value?: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  max?: number;
};
function Fields({ fields }: { fields: Field[] }) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.options ? (
            <select name={f.key} defaultValue={f.value} required={f.required}>
              <option value="">Välj…</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              name={f.key}
              defaultValue={f.value}
              required={f.required}
              maxLength={f.max || 10000}
              rows={4}
            />
          ) : (
            <input
              name={f.key}
              type={f.type || "text"}
              defaultValue={f.value}
              required={f.required}
              readOnly={f.readOnly}
              maxLength={f.max || 200}
            />
          )}
        </label>
      ))}
    </>
  );
}
function Badge({ order }: { order: Order }) {
  return (
    <span
      className={
        "badge " +
        (order.status === "Avslutad"
          ? "complete"
          : order.status === "Påbörjad"
            ? "progress"
            : "pending")
      }
    >
      <i />
      {order.status}
    </span>
  );
}
function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => {
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="sheet-head">
        <h2>{title}</h2>
        <button aria-label="Stäng" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Tips({ manager }: { manager: boolean }) {
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [short, setShort] = useState(true);
  useEffect(() => {
    const mq = matchMedia("(max-width:600px)");
    const update = () => setShort(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const tips = short
    ? [
        "Min lista visar dina uppdrag.",
        "Loggan tar dig till start.",
        "Äldre ordrar finns under Sök.",
        "Dra tabellen i sidled för att se adressen.",
        "Slutkommentar är valfri.",
        "Välj ljust eller mörkt tema.",
        ...(manager
          ? ["Välj dig själv som utförare.", "Återställ från papperskorgen."]
          : []),
      ]
    : [
        "Tryck på loggan för att komma tillbaka till din lista.",
        "Hitta äldre avslutade arbetsorder på söksidan.",
        "Sök arbetsorder direkt i kontomenyn.",
        "Min lista visar uppdrag där du är tilldelad eller deltagare.",
        "Du kan avsluta en arbetsorder utan slutkommentar.",
        ...(manager
          ? [
              "Välj dig själv som utförare när du tilldelar en arbetsorder.",
              "Återställ borttagna arbetsorder från papperskorgen inom 14 dagar.",
            ]
          : []),
      ];
  useEffect(() => {
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % tips.length),
      15000,
    );
    return () => clearInterval(timer);
  }, [tips.length]);
  return hidden ? null : (
    <aside className="tips">
      <div className="tip-copy">
        <small>
          <em>Tips:</em>
        </small>
        <p>{tips[index % tips.length]}</p>
      </div>
      <div className="tip-controls">
        <button
          aria-label="Föregående tips"
          onClick={() => setIndex((index + tips.length - 1) % tips.length)}
        >
          ‹
        </button>
        <button
          aria-label="Nästa tips"
          onClick={() => setIndex((index + 1) % tips.length)}
        >
          ›
        </button>
        <button aria-label="Dölj tips" onClick={() => setHidden(true)}>
          ×
        </button>
      </div>
    </aside>
  );
}
export default function Home() {
  const [s, setS] = useState<Snapshot | null>(null);
  const [checking, setChecking] = useState(cloudEnabled);
  const connectionVersion = useRef(0);
  const [isDemo, setIsDemo] = useState(false);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [routeDirty, setRouteDirty] = useState(false);
  const { route, navigate } = useNavigation(dirty || routeDirty);
  const [filter, setFilter] = useState("Mina ordrar");
  const [accountOpen, setAccountOpen] = useState(false);
  const [directorySearch, setDirectorySearch] = useState("");
  const [directoryResults, setDirectoryResults] = useState<
    cloud.DirectoryPerson[]
  >([]);
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [query, setQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [searchPerson, setSearchPerson] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [editor, setEditor] = useState<{
    type: "order" | "member" | "company" | "project";
    value?: Order | Member | Company | Project;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bankSelected, setBankSelected] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [note, setNote] = useState("");
  const [notePhase, setNotePhase] = useState("Under");
  const [noteHours, setNoteHours] = useState("");
  const [filePhase, setFilePhase] = useState("Alla");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [orderTab, setOrderTab] = useState("Översikt");
  const [closing, setClosing] = useState("");
  const [profile, setProfile] = useState<{
    name: string;
    job: string;
    employer: string;
    phone: string;
    email: string;
  } | null>(null);
  const [invite, setInvite] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  useEffect(() => {
    let cancelled = false;
    setDirectoryResults([]);
    setDirectoryError("");
    const term = directorySearch.trim();
    if (!s || term.length < 2 || route !== "/people") {
      setDirectoryBusy(false);
      return;
    }
    setDirectoryBusy(true);
    const timer = setTimeout(async () => {
      try {
        const results = isDemo
          ? [
              ...s.people,
              {
                id: "demo-electrician",
                name: "Emma Johansson",
                job: "Elektriker",
                employer: "Elfabriken",
              },
              {
                id: "demo-contractor",
                name: "Johan Nilsson",
                job: "Snickare",
                employer: "Elvbygg",
              },
            ].filter((p) =>
              p.employer
                .toLocaleLowerCase("sv")
                .includes(term.toLocaleLowerCase("sv")),
            )
          : await withTimeout(cloud.searchDirectory(s.workspace, term));
        if (!cancelled) setDirectoryResults(results);
      } catch (error) {
        if (!cancelled)
          setDirectoryError(
            error instanceof Error ? error.message : "Sökningen misslyckades.",
          );
      } finally {
        if (!cancelled) setDirectoryBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [directorySearch, s?.workspace, isDemo, route]);
  useEffect(() => {
    setOrderTab("Översikt");
  }, [route]);
  const me = s?.people.find((p) => p.id === s.user);
  const manager = me ? manages(me) : false;
  useEffect(() => {
    try {
      const saved = JSON.parse(readPreference("brief-list-view", true) || "{}");
      setFilter(saved.filter === "Alla" ? "Alla" : "Mina ordrar");
      setQuery(saved.query || "");
      setSearchStatus(saved.searchStatus || "");
      setSearchPerson(saved.searchPerson || "");
    } catch {}
  }, []);
  useEffect(() => {
    writePreference(
      "brief-list-view",
      JSON.stringify({ filter, query, searchStatus, searchPerson }),
      true,
    );
  }, [filter, query, searchStatus, searchPerson]);
  async function connect() {
    const version = ++connectionVersion.current;
    const current = () => version === connectionVersion.current;
    try {
      const recovery =
        typeof window !== "undefined" &&
        (/type=recovery/.test(window.location.hash) ||
          window.location.hash === "#/password");
      if (supabase) {
        const { data, error } = await withTimeout(supabase.auth.getSession());
        if (!current()) return;
        if (error) throw error;
        if (!data.session) {
          setS(null);
          setChecking(false);
          return;
        }
      }
      const list = await withTimeout(cloud.bootstrap());
      if (!current()) return;
      setWorkspaces(list);
      if (!list.length)
        throw Error("Din profil är inaktiverad. Kontakta din arbetsledare.");
      const chosen =
        list.find((w) => w.id === readPreference("brief-workspace")) || list[0];
      const loaded = await withTimeout(cloud.load(chosen.id));
      if (!current()) return;
      if (
        !loaded?.people?.some(
          (person) =>
            person.id === loaded.user && person.active && !person.deleted,
        )
      )
        throw Error("Din profil kunde inte öppnas. Kontakta din arbetsledare.");
      setS(loaded);
      setMessage("");
      if (recovery) navigate("/password");
    } finally {
      if (current()) setChecking(false);
    }
  }
  useEffect(() => {
    if (!supabase) return;
    void connect().catch((e) => {
      setMessage(e.message);
      setChecking(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        connectionVersion.current++;
        setS(null);
        setChecking(false);
      }
      if (event === "PASSWORD_RECOVERY") navigate("/password");
    });
    return () => {
      connectionVersion.current++;
      data.subscription.unsubscribe();
    };
  }, []); // Initial session only. Manual login keeps its animation mounted.
  useEffect(() => {
    setRouteDirty(!!note.trim() || !!files.length || !!closing.trim());
  }, [note, files, closing]);
  useEffect(() => {
    setNote("");
    setFiles([]);
    setPending([]);
    setClosing("");
    setInvite("");
    setSelected([]);
    setDirty(false);
  }, [route]);
  const go = (path: string, saved = false) => {
    if (navigate(path, saved)) {
      setDirty(false);
      setEditor(null);
    }
  };
  async function act(c: Command) {
    if (!s || lock.current) return false;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const next = isDemo ? demoApply(s, c) : await cloud.apply(s, c);
      setS(next);
      setDirty(false);
      setMessage("Sparat.");
      return true;
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Ändringen kunde inte sparas.",
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    if (!s || busy) return;
    setBusy(true);
    try {
      if (!isDemo) setS(await cloud.load(s.workspace));
      setMessage("Arbetsytan är uppdaterad.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(
    type: "order" | "member" | "company" | "project",
    value?: Order | Member | Company | Project,
  ) {
    setEditor({ type, value });
    if (type === "company")
      setContacts(
        (value as Company)?.contacts || [
          { id: id(), name: "", email: "", phone: "" },
        ],
      );
    if (type === "project")
      setConnections((value as Project)?.connections || []);
    setDirty(false);
  }
  function closeEditor() {
    if (
      dirty &&
      !confirm("Du har osparade ändringar. Vill du lämna formuläret?")
    )
      return;
    setEditor(null);
    setDirty(false);
  }
  function confirmAction(
    title: string,
    body: ReactNode,
    label: string,
    action: Dialog["action"],
    danger = true,
  ) {
    setDialog({ title, body, label, action, danger });
  }
  if (checking)
    return (
      <main className="session-check" aria-label="Brief" aria-busy="true">
        <p role="status">Hämtar din arbetsyta…</p>
      </main>
    );
  if (!s || !me)
    return (
      <>
        {message && (
          <div className="global-error" role="alert">
            {message}
            {supabase && (
              <button
                onClick={() => {
                  setChecking(true);
                  void connect().catch((error) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Anslutningen misslyckades.",
                    ),
                  );
                }}
              >
                Försök igen
              </button>
            )}
          </div>
        )}
        <Login
          onReady={connect}
          onDemo={() => {
            setIsDemo(true);
            setS(demo());
            setChecking(false);
            navigate("/orders");
            setMessage("Demonstration – inga ändringar sparas i Supabase.");
          }}
        />
      </>
    );
  const orders = s.orders.filter((o) => visible(o, me, s.people));
  const people = s.people.filter((p) => !p.deleted);
  const memberName = (ident: string | null) =>
    s.people.find((p) => p.id === ident)?.name || "Behöver tilldelas";
  const companyName = (ident: string) =>
    s.companies.find((c) => c.id === ident)?.name || "—";
  const assignable = people.filter(
    (p) => p.active && rank(p.role) >= rank(me.role),
  );
  const nameOfProject = (o: Order) =>
    s.projects.find((p) => p.id === o.project);
  const home = route === "/orders";
  const searching = route === "/search";
  const trash = route === "/trash";
  const match = (o: Order) => {
    const p = nameOfProject(o);
    return [
      o.number,
      o.title,
      o.address,
      o.description,
      p?.number,
      p?.customerNumber,
      p?.name,
      p && companyName(p.customer),
      memberName(o.assignee),
    ]
      .join(" ")
      .toLocaleLowerCase("sv")
      .includes(query.toLocaleLowerCase("sv"));
  };
  const shown = orders
    .filter((o) => (trash ? !!o.deletedAt : !o.deletedAt))
    .filter((o) => home || match(o))
    .filter((o) => {
      if (searching)
        return (
          (!searchStatus || o.status === searchStatus) &&
          (!searchPerson || o.assignee === searchPerson)
        );
      if (trash) return true;
      if (filter === "Mina ordrar")
        return joined(o, me) || o.participants.some((p) => p.user === me.id);
      if (filter === "Påbörjade") return o.status === "Påbörjad";
      if (filter === "Ej påbörjade") return o.status === "Ej påbörjad";
      if (filter === "Avslutade") return o.status === "Avslutad";
      if (filter === "Behöver tilldelas") return !o.assignee;
      return true;
    });
  const currentOrder = route.startsWith("/order/")
    ? orders.find((o) => o.id === decodeURIComponent(route.slice(7)))
    : undefined;
  const orderLevelAllowed = currentOrder
    ? rank(me.role) <=
      rank(
        people.find((p) => p.id === currentOrder.assignee)?.role ||
          "supervisor",
      )
    : false;
  const currentPerson = route.startsWith("/person/")
    ? people.find((p) => p.id === decodeURIComponent(route.slice(8)))
    : undefined;
  async function noteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentOrder) return;
    setBusy(true);
    try {
      let uploaded = pending;
      if (files.length && !uploaded.length) {
        if (isDemo)
          throw Error("Filuppladdning testas i en Supabase-arbetsyta.");
        uploaded = await cloud.upload(s!, currentOrder.id, files);
        setPending(uploaded);
      }
      setBusy(false);
      if (
        await act({
          kind: "add_note",
          id: currentOrder.id,
          text: note,
          phase: notePhase,
          hours: noteHours ? Number(noteHours) : undefined,
          files: uploaded,
        })
      ) {
        setNote("");
        setNoteHours("");
        setFiles([]);
        setPending([]);
      }
    } catch (e) {
      setBusy(false);
      setMessage(
        e instanceof Error ? e.message : "Bilagan kunde inte laddas upp.",
      );
    }
  }
  async function saveEditor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (!editor) return;
    if (editor.type === "member") {
      data.name =
        String(data.firstName || "").trim() +
        " " +
        String(data.lastName || "").trim();
      if (
        !String(data.firstName || "").trim() ||
        !String(data.lastName || "").trim()
      ) {
        setMessage("Ange både förnamn och efternamn.");
        return;
      }
      if (String(data.name).length > 150) {
        setMessage("För- och efternamn får tillsammans vara högst 150 tecken.");
        return;
      }
      delete data.firstName;
      delete data.lastName;
    }
    const old = editor.value;
    let c: Command;
    if (editor.type === "order") {
      const controls = Object.fromEntries(
        controlKinds.map((k) => [
          k,
          { enabled: data["control_" + k] === "on" },
        ]),
      );
      c = {
        ...data,
        controls,
        kind: old ? "edit_order" : "create_order",
        id: old?.id,
      };
    } else if (editor.type === "member")
      c = {
        ...data,
        kind: old ? "edit_member" : "invite_member",
        id: old?.id,
        external: data.external === "on",
      };
    else if (editor.type === "company") {
      if (contacts.some((ct) => !/^\S+(?:\s+\S+)+$/.test(ct.name.trim()))) {
        setMessage("Ange förnamn och efternamn på alla kontaktpersoner.");
        return;
      }
      c = { ...data, kind: "save_company", id: old?.id, contacts };
    } else c = { ...data, kind: "save_project", id: old?.id, connections };
    if (await act(c)) {
      setEditor(null);
      setDirty(false);
    }
  }
  const contactName = (company: Company, ct: Contact) =>
    s.contactLinks.some(
      (l) => l.company === company.id && l.contact === ct.id,
    ) ? (
      <button
        className="contact-link"
        onClick={async () => {
          try {
            const data = isDemo
              ? people.find((p) => p.email === ct.email) || null
              : await cloud.contactProfile(s.workspace, company.id, ct.id);
            if (data) setProfile(data);
          } catch (e) {
            setMessage(String(e));
          }
        }}
      >
        {ct.name}
      </button>
    ) : (
      <span>{ct.name}</span>
    );
  const nav = [
    { path: "/orders", text: "Översikt" },
    ...(manager
      ? [
          { path: "/projects", text: "Projekt" },
          { path: "/companies", text: "Företag" },
        ]
      : []),
  ];
  const directoryPeople = people.filter((p) =>
    directorySearch.trim()
      ? p.employer
          .toLocaleLowerCase("sv")
          .includes(directorySearch.trim().toLocaleLowerCase("sv"))
      : p.employer.trim().toLocaleLowerCase("sv") ===
        me.employer.trim().toLocaleLowerCase("sv"),
  );
  return (
    <div className="app-shell">
      <div className="frosted-background" aria-hidden="true">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
          <circle cx="350" cy="90" r="70" />
          <path d="M210 220 310 160 510 230 730 225 712 280 500 294 350 250 300 530 188 540 240 310Z" />
          <path d="M750 210 895 245 850 350 715 310Z" />
          <circle cx="1500" cy="420" r="80" />
          <path d="M1500 510 1370 560 1100 380 970 345 945 400 1090 460 1310 650 1300 930 1480 1000 1520 790 1580 670Z" />
        </svg>
      </div>
      <header className="header">
        <button
          className="brand-home"
          onClick={() => go("/orders")}
          aria-label="Brief – till startsidan"
        >
          <Logo />
          <span>Keep it brief, get it done.</span>
        </button>
        <small className="beta-label">BETA</small>
        <nav aria-label="Huvudnavigation">
          {nav.map((n) => (
            <button
              key={n.path}
              className={route === n.path ? "nav-active" : ""}
              onClick={() => go(n.path)}
            >
              {n.text}
            </button>
          ))}
        </nav>
        <div className="header-user">
          <ThemePicker />
          {manager && (
            <button
              className="trash-icon"
              aria-label="Papperskorg"
              title="Papperskorg"
              onClick={() => go("/trash")}
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
              </svg>
            </button>
          )}
          <div className="account-menu">
            <button
              className="user-button"
              aria-label="Öppna kontomeny"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen(!accountOpen)}
            >
              <span className="avatar">
                {me.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="menu-chevron">⌄</span>
            </button>
            {accountOpen && (
              <>
                <button
                  className="menu-backdrop"
                  aria-label="Stäng kontomeny"
                  onClick={() => setAccountOpen(false)}
                />
                <div
                  className="account-dropdown"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAccountOpen(false);
                  }}
                >
                  <strong>{me.name}</strong>
                  <small className="muted">{me.employer}</small>
                  <button
                    onClick={() => {
                      setAccountOpen(false);
                      go("/profile");
                    }}
                  >
                    Min profil <span>›</span>
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setQuery(accountSearch);
                      setAccountOpen(false);
                      go("/search");
                    }}
                  >
                    <label htmlFor="account-search">Sök arbetsorder</label>
                    <div className="dropdown-search">
                      <input
                        id="account-search"
                        type="search"
                        placeholder="Projekt, arbete eller adress"
                        value={accountSearch}
                        onChange={(e) => setAccountSearch(e.target.value)}
                      />
                      <button aria-label="Sök" type="submit">
                        →
                      </button>
                    </div>
                  </form>
                  {!me.external && (
                    <button
                      onClick={() => {
                        setDirectorySearch("");
                        setAccountOpen(false);
                        go("/people");
                      }}
                    >
                      Personal <span>›</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      {isDemo && (
        <div className="demo-banner">
          Demonstration{" "}
          <select
            aria-label="Demoprofil"
            value={s.user}
            onChange={(e) => {
              if (dirty && !confirm("Lämna osparade ändringar?")) return;
              setS({ ...s, user: e.target.value });
              setDirty(false);
              go("/orders");
            }}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span>Ingen verklig data ändras.</span>
        </div>
      )}
      <main className="app-main">
        {message && (
          <div className="notice" role="status">
            <span>{message}</span>
            <button
              aria-label="Stäng meddelande"
              onClick={() => setMessage("")}
            >
              ×
            </button>
          </div>
        )}
        {(home || searching || trash) && (
          <>
            <div className="page-heading">
              <div>
                <h1>
                  {searching
                    ? "Sök arbetsorder"
                    : trash
                      ? "Papperskorg"
                      : "Översikt"}
                </h1>
                {searching && (
                  <p className="muted">
                    Sök bland tillgängliga arbetsorder, även äldre avslutade.
                  </p>
                )}
                {trash && (
                  <p className="muted">
                    Återställ inom 14 dagar. Därefter raderas ordern permanent.
                  </p>
                )}
              </div>
              <div className="actions">
                <button disabled={busy} onClick={() => void refresh()}>
                  Uppdatera
                </button>
                {manager && !trash && (
                  <button className="primary" onClick={() => edit("order")}>
                    + Ny arbetsorder
                  </button>
                )}
                {trash && me.role === "admin" && (
                  <button
                    className="danger"
                    disabled={busy || !shown.length}
                    onClick={() =>
                      confirmAction(
                        "Radera alla borttagna arbetsorder?",
                        <p>
                          Alla ordrar i arbetsytans papperskorg, med kommentarer
                          och bilagor, raderas permanent. Det går inte att
                          ångra.
                        </p>,
                        "Radera allt",
                        () => act({ kind: "purge_orders", all: true }),
                      )
                    }
                  >
                    Radera allt
                  </button>
                )}
              </div>
            </div>
            {trash && !manager ? (
              <p>Du saknar åtkomst till papperskorgen.</p>
            ) : (
              <>
                {home && (
                  <div
                    className="order-scope"
                    role="group"
                    aria-label="Visa arbetsorder"
                  >
                    <button
                      aria-pressed={filter === "Mina ordrar"}
                      className={filter === "Mina ordrar" ? "selected" : ""}
                      onClick={() => setFilter("Mina ordrar")}
                    >
                      Min lista
                    </button>
                    <button
                      aria-pressed={filter === "Alla"}
                      className={filter === "Alla" ? "selected" : ""}
                      onClick={() => setFilter("Alla")}
                    >
                      Företagslista
                    </button>
                  </div>
                )}
                {!home && (
                  <div className="list-search">
                    <label className="search-input">
                      <span className="sr-only">Sök arbetsorder</span>
                      <input
                        type="search"
                        placeholder="Sök ordernummer, adress eller beställare"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    {searching && (
                      <>
                        <select
                          aria-label="Statusfilter"
                          value={searchStatus}
                          onChange={(e) => setSearchStatus(e.target.value)}
                        >
                          <option value="">Alla statusar</option>
                          {["Ej påbörjad", "Påbörjad", "Avslutad"].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                        <select
                          aria-label="Utförarfilter"
                          value={searchPerson}
                          onChange={(e) => setSearchPerson(e.target.value)}
                        >
                          <option value="">Alla utförare</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                )}
                {searching && <p className="muted">{shown.length} träffar</p>}
                {trash && selected.length > 0 && me.role === "admin" && (
                  <button
                    className="danger"
                    onClick={() =>
                      confirmAction(
                        "Radera markerade arbetsorder?",
                        <p>
                          {selected.length} markerade ordrar med kommentarer och
                          bilagor raderas permanent.
                        </p>,
                        "Radera permanent",
                        async () => {
                          const ok = await act({
                            kind: "purge_orders",
                            ids: selected,
                          });
                          if (ok) setSelected([]);
                          return ok;
                        },
                      )
                    }
                  >
                    Radera markerade ({selected.length})
                  </button>
                )}
                {home ? (
                  <section className="panel compact-orders">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th className="overview-status">Status</th>
                            <th className="overview-number">
                              <span className="desktop-only">
                                Projektnummer
                              </span>
                              <span className="mobile-only">Ordernr</span>
                            </th>
                            <th className="overview-work">Arbete</th>
                            {filter === "Alla" && (
                              <th className="overview-assignee desktop-only">
                                Utförare
                              </th>
                            )}
                            <th className="overview-address desktop-only">
                              Adress
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((o) => {
                            const address =
                              o.address || nameOfProject(o)?.address || "";
                            return (
                              <tr
                                key={o.id}
                                tabIndex={0}
                                aria-label={"Öppna " + o.title}
                                onClick={() => go("/order/" + o.id)}
                                onKeyDown={(e) => {
                                  if (
                                    e.target === e.currentTarget &&
                                    e.key === "Enter"
                                  )
                                    go("/order/" + o.id);
                                }}
                              >
                                <td className="overview-status">
                                  <span
                                    title={o.status}
                                    className={
                                      "order-status status-" +
                                      (o.status === "Avslutad"
                                        ? "green"
                                        : o.status === "Påbörjad"
                                          ? "yellow"
                                          : "red")
                                    }
                                  >
                                    <i aria-hidden="true" />
                                    <span className="desktop-only">
                                      {o.status}
                                    </span>
                                    <span className="mobile-only">
                                      {o.status === "Avslutad"
                                        ? "Klar"
                                        : o.status === "Påbörjad"
                                          ? "Pågår"
                                          : "Ej startad"}
                                    </span>
                                  </span>
                                </td>
                                <td className="overview-number">
                                  <span className="desktop-only">
                                    {nameOfProject(o)?.number || "—"}
                                  </span>
                                  <span className="mobile-only">
                                    {o.number}
                                  </span>
                                </td>
                                <td className="overview-work">
                                  <button
                                    className="compact-title"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      go("/order/" + o.id);
                                    }}
                                  >
                                    {o.title}
                                  </button>
                                  {filter === "Alla" && (
                                    <small className="mobile-only mobile-assignee">
                                      Utförare:{" "}
                                      {o.assignee
                                        ? memberName(o.assignee)
                                        : "Ej tilldelad"}
                                    </small>
                                  )}
                                </td>
                                {filter === "Alla" && (
                                  <td className="overview-assignee desktop-only">
                                    {o.assignee
                                      ? memberName(o.assignee)
                                      : "Ej tilldelad"}
                                  </td>
                                )}
                                <td className="overview-address desktop-only">
                                  {address ? (
                                    <a
                                      href={
                                        "https://www.google.com/maps/search/?api=1&query=" +
                                        encodeURIComponent(address)
                                      }
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {address} ↗
                                    </a>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!shown.length && (
                      <p className="empty-orders">Inga arbetsorder att visa.</p>
                    )}
                  </section>
                ) : (
                  <>
                    <section
                      className={
                        "panel order-list " + (trash ? "trash-list" : "")
                      }
                    >
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              {trash && me.role === "admin" && (
                                <th>
                                  <span className="sr-only">Markera</span>
                                </th>
                              )}
                              <th>Order</th>
                              <th>Adress</th>
                              <th>Utförare</th>
                              <th>Status</th>
                              <th>
                                <span className="sr-only">Åtgärder</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.map((o) => (
                              <tr key={o.id}>
                                {trash && me.role === "admin" && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      aria-label={"Markera " + o.number}
                                      checked={selected.includes(o.id)}
                                      onChange={(e) =>
                                        setSelected(
                                          e.target.checked
                                            ? [...selected, o.id]
                                            : selected.filter(
                                                (v) => v !== o.id,
                                              ),
                                        )
                                      }
                                    />
                                  </td>
                                )}
                                <td>
                                  <button
                                    className="order-link"
                                    onClick={() => go("/order/" + o.id)}
                                  >
                                    <strong>{o.number}</strong>
                                    <span>{o.title}</span>
                                  </button>
                                  <small className="muted">
                                    {nameOfProject(o)?.customerNumber} ·{" "}
                                    {nameOfProject(o) &&
                                      companyName(nameOfProject(o)!.customer)}
                                  </small>
                                </td>
                                <td>
                                  {o.address ||
                                    nameOfProject(o)?.address ||
                                    "—"}
                                </td>
                                <td>{memberName(o.assignee)}</td>
                                <td>
                                  <Badge order={o} />
                                  {o.completedAt && !trash && (
                                    <small className="muted">
                                      {date(o.completedAt)}
                                    </small>
                                  )}
                                  {trash && (
                                    <small className="muted">
                                      Borttagen {date(o.deletedAt)}
                                    </small>
                                  )}
                                </td>
                                <td>
                                  {trash ? (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void act({
                                          kind: "restore_order",
                                          id: o.id,
                                        })
                                      }
                                    >
                                      Återställ
                                    </button>
                                  ) : (
                                    <button
                                      aria-label={"Öppna " + o.number}
                                      onClick={() => go("/order/" + o.id)}
                                    >
                                      Visa ›
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!shown.length && (
                        <p className="empty">Inga arbetsorder att visa.</p>
                      )}
                    </section>
                  </>
                )}
              </>
            )}
          </>
        )}
        {route.startsWith("/order/") &&
          (currentOrder ? (
            <>
              <button className="back" onClick={() => go("/orders")}>
                ← Till min lista
              </button>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">{nameOfProject(currentOrder)?.name}</p>
                  <h1>
                    {currentOrder.number} · {currentOrder.title}
                  </h1>
                  <Badge order={currentOrder} />
                </div>
                {manager && orderLevelAllowed && !currentOrder.deletedAt && (
                  <div className="actions">
                    <button
                      disabled={busy || currentOrder.status === "Avslutad"}
                      onClick={() => edit("order", currentOrder)}
                    >
                      Redigera
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act({
                          kind: "duplicate_order",
                          id: currentOrder.id,
                        })
                      }
                    >
                      Duplicera
                    </button>
                    <button
                      className="danger-quiet"
                      disabled={busy}
                      onClick={() =>
                        confirmAction(
                          "Ta bort arbetsorder?",
                          <>
                            <p>
                              {currentOrder.number} · {currentOrder.title}
                            </p>
                            <p>
                              Ordern flyttas till papperskorgen. Den kan
                              återställas inom 14 dagar och raderas sedan
                              permanent.
                            </p>
                          </>,
                          "Flytta till papperskorgen",
                          async () => {
                            const ok = await act({
                              kind: "trash_order",
                              id: currentOrder.id,
                            });
                            if (ok) go("/trash", true);
                            return ok;
                          },
                        )
                      }
                    >
                      Ta bort
                    </button>
                  </div>
                )}
              </div>
              <div className="actions">
                <button
                  onClick={() => {
                    try {
                      printOrder(currentOrder, s);
                    } catch (e) {
                      setMessage(
                        e instanceof Error
                          ? e.message
                          : "Exporten misslyckades.",
                      );
                    }
                  }}
                >
                  Exportera PDF / skriv ut
                </button>
              </div>
              <div
                className="order-tabs"
                role="tablist"
                aria-label="Avsnitt i arbetsorder"
              >
                {[
                  "Översikt",
                  "Dagbok",
                  "Bilagor",
                  ...(hasControls(currentOrder) ? ["Kontroller"] : []),
                ].map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={orderTab === t}
                    className={orderTab === t ? "active" : ""}
                    onKeyDown={(e) => {
                      const tabs = Array.from(
                        e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                          "button",
                        ),
                      );
                      const i = tabs.indexOf(e.currentTarget);
                      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                        e.preventDefault();
                        tabs[
                          (i +
                            (e.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                            tabs.length
                        ].focus();
                      }
                    }}
                    onClick={() => {
                      if (dirty && !confirm("Lämna osparade ändringar?"))
                        return;
                      setOrderTab(t);
                      setDirty(false);
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div hidden={orderTab !== "Översikt"}>
                <section className="panel detail-grid">
                  <div>
                    <small>Adress</small>
                    <p>
                      {currentOrder.address ||
                        nameOfProject(currentOrder)?.address}
                    </p>
                    <small>Beställare</small>
                    <p>
                      {nameOfProject(currentOrder) &&
                        companyName(nameOfProject(currentOrder)!.customer)}
                    </p>
                    <small>Projektnummer</small>
                    <p>
                      {nameOfProject(currentOrder)?.number} /{" "}
                      {nameOfProject(currentOrder)?.customerNumber}
                    </p>
                  </div>
                  <div>
                    <small>Ansvarig upprättare</small>
                    <p>
                      {memberName(currentOrder.issuedBy)} ·{" "}
                      {
                        roles[
                          people.find((p) => p.id === currentOrder.issuedBy)
                            ?.role || "supervisor"
                        ]
                      }
                    </p>
                    <small>Utförare</small>
                    <p>{memberName(currentOrder.assignee)}</p>
                    {currentOrder.due && (
                      <>
                        <small>Planerat datum</small>
                        <p>{currentOrder.due}</p>
                      </>
                    )}
                  </div>
                  <div className="detail-actions">
                    {manager &&
                      orderLevelAllowed &&
                      currentOrder.assignee !== me.id &&
                      currentOrder.status !== "Avslutad" &&
                      !currentOrder.deletedAt && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act({
                              ...currentOrder,
                              kind: "edit_order",
                              assignee: me.id,
                            })
                          }
                        >
                          Tilldela mig
                        </button>
                      )}
                    {orderLevelAllowed &&
                      !joined(currentOrder, me) &&
                      !currentOrder.deletedAt && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void act({
                              kind: "join_order",
                              id: currentOrder.id,
                            })
                          }
                        >
                          Anslut mig
                        </button>
                      )}
                  </div>
                </section>
                <section className="panel content-panel">
                  <h2>Beskrivning</h2>
                  <p className="pre-wrap">
                    {currentOrder.description || "Ingen beskrivning."}
                  </p>
                </section>
                <section className="panel content-panel order-sections">
                  <details open>
                    <summary>Planering och datum</summary>
                    <p>
                      Planerad start: {currentOrder.start || "Ej angiven"}
                      <br />
                      Planerat färdigt: {currentOrder.due || "Ej angivet"}
                      <br />
                      Påbörjad: {date(currentOrder.startedAt)}
                      <br />
                      Avslutad: {date(currentOrder.completedAt)}
                    </p>
                  </details>
                  <details>
                    <summary>Kontakter och underentreprenörer</summary>
                    {(nameOfProject(currentOrder)?.connections || []).map(
                      (cn) => {
                        const firm = s.companies.find(
                          (c) => c.id === cn.company,
                        );
                        const ct = firm?.contacts.find(
                          (c) => c.id === cn.contact,
                        );
                        const p = people.find((p) => p.id === cn.person);
                        return (
                          <div className="connection-row" key={cn.id}>
                            <strong>{firm?.name || p?.employer}</strong>
                            <span>
                              {cn.function} · {ct?.name || p?.name}
                            </span>
                            <a href={"tel:" + (ct?.phone || p?.phone || "")}>
                              {ct?.phone || p?.phone}
                            </a>
                            <a href={"mailto:" + (ct?.email || p?.email || "")}>
                              {ct?.email || p?.email}
                            </a>
                          </div>
                        );
                      },
                    )}
                    <p className="muted">
                      Kontakter hämtas från projektets anknytningar.
                    </p>
                  </details>
                  <details>
                    <summary>Nycklar och tillträde</summary>
                    <p className="pre-wrap">
                      {currentOrder.access ||
                        "Ingen tillträdesinformation angiven."}
                    </p>
                    {["keysReceived", "keysReturned"].map((k) => (
                      <label className="check-label" key={k}>
                        <input
                          type="checkbox"
                          checked={
                            !!currentOrder[k as "keysReceived" | "keysReturned"]
                          }
                          disabled={
                            busy ||
                            !orderLevelAllowed ||
                            !canWrite(currentOrder, me) ||
                            currentOrder.status === "Avslutad"
                          }
                          onChange={(e) =>
                            void act({
                              kind: "set_access",
                              id: currentOrder.id,
                              [k]: e.target.checked,
                            })
                          }
                        />
                        {k === "keysReceived"
                          ? "Nycklar mottagna"
                          : "Nycklar återlämnade"}
                      </label>
                    ))}
                  </details>
                </section>
                <section className="panel content-panel">
                  <h2>Deltagare</h2>
                  <div className="chips">
                    {currentOrder.participants.map((p) => (
                      <span key={p.user}>
                        {memberName(p.user)}
                        {!p.acceptedAt ? " · Inbjuden" : ""}
                      </span>
                    ))}
                  </div>
                  {orderLevelAllowed &&
                    canWrite(currentOrder, me) &&
                    currentOrder.status !== "Avslutad" && (
                      <div className="inline-form">
                        <select
                          aria-label="Bjud in deltagare"
                          value={invite}
                          onChange={(e) => setInvite(e.target.value)}
                        >
                          <option value="">Välj person att bjuda in…</option>
                          {assignable
                            .filter(
                              (p) =>
                                rank(p.role) <=
                                  rank(
                                    s.people.find(
                                      (t) => t.id === currentOrder.assignee,
                                    )?.role || "supervisor",
                                  ) &&
                                p.id !== currentOrder.assignee &&
                                !currentOrder.participants.some(
                                  (t) => t.user === p.id,
                                ) &&
                                (!p.external || manager),
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.external ? " · Extern" : ""}
                              </option>
                            ))}
                        </select>
                        <button
                          disabled={busy || !invite}
                          onClick={async () => {
                            if (
                              await act({
                                kind: "invite_order",
                                id: currentOrder.id,
                                member: invite,
                              })
                            )
                              setInvite("");
                          }}
                        >
                          Bjud in
                        </button>
                      </div>
                    )}
                </section>
                {!currentOrder.deletedAt && (
                  <section className="panel content-panel">
                    {currentOrder.status === "Avslutad" ? (
                      <>
                        <h2>Avslutad {date(currentOrder.completedAt)}</h2>
                        {manager && (
                          <button
                            disabled={busy}
                            className="primary"
                            onClick={() =>
                              confirmAction(
                                "Återöppna arbetsorder?",
                                <p>
                                  {currentOrder.number} återgår till Påbörjad.
                                </p>,
                                "Återöppna",
                                () =>
                                  act({
                                    kind: "set_status",
                                    id: currentOrder.id,
                                    status: "Påbörjad",
                                  }),
                                false,
                              )
                            }
                          >
                            Återöppna order
                          </button>
                        )}
                      </>
                    ) : orderLevelAllowed && canWrite(currentOrder, me) ? (
                      <>
                        <h2 id="order-completion">Avslut</h2>
                        {currentOrder.status === "Ej påbörjad" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act({
                                kind: "set_status",
                                id: currentOrder.id,
                                status: "Påbörjad",
                              })
                            }
                          >
                            Starta order
                          </button>
                        )}
                        <label>
                          Slutkommentar (valfri)
                          <textarea
                            value={closing}
                            onChange={(e) => {
                              setClosing(e.target.value);
                              setDirty(true);
                            }}
                            placeholder="Du kan avsluta utan att skriva något."
                            maxLength={10000}
                          />
                        </label>
                        <button
                          className="primary"
                          disabled={
                            busy || remainingSelfChecks(currentOrder) > 0
                          }
                          onClick={async () => {
                            if (
                              await act({
                                kind: "set_status",
                                id: currentOrder.id,
                                status: "Avslutad",
                                comment: closing,
                              })
                            )
                              setClosing("");
                          }}
                        >
                          Avsluta order
                        </button>
                        {remainingSelfChecks(currentOrder) > 0 && (
                          <p role="status" className="muted">
                            {remainingSelfChecks(currentOrder)}{" "}
                            egenkontrollpunkter återstår före avslut.{" "}
                            <button onClick={() => setOrderTab("Kontroller")}>
                              Öppna egenkontroll
                            </button>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="muted">
                        Du kan läsa ordern. Anslut för att kunna uppdatera den.
                      </p>
                    )}
                  </section>
                )}
              </div>
              <div hidden={orderTab !== "Dagbok"}>
                <section className="panel content-panel">
                  <h2>Dagbok</h2>
                  {orderLevelAllowed &&
                    canWrite(currentOrder, me) &&
                    currentOrder.status !== "Avslutad" && (
                      <form
                        onSubmit={noteSubmit}
                        onChange={() => setDirty(true)}
                      >
                        <div className="note-options">
                          <label>
                            Avsnitt
                            <select
                              value={notePhase}
                              onChange={(e) => setNotePhase(e.target.value)}
                            >
                              {["Före", "Under", "Efter", "Handlingar"].map(
                                (p) => (
                                  <option key={p}>{p}</option>
                                ),
                              )}
                            </select>
                          </label>
                          <label>
                            Tidsåtgång i timmar (valfri)
                            <input
                              type="number"
                              min="0"
                              max="1000"
                              step="0.25"
                              value={noteHours}
                              onChange={(e) => setNoteHours(e.target.value)}
                            />
                          </label>
                        </div>
                        <label>
                          Kommentar
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            maxLength={10000}
                          />
                        </label>
                        <label>
                          Bilagor
                          <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
                            onChange={(e) => {
                              setFiles(Array.from(e.target.files || []));
                              setPending([]);
                            }}
                          />
                        </label>
                        <small className="muted">
                          Högst 5 filer, max 10 MB per fil.
                        </small>
                        <button
                          className="primary"
                          disabled={busy || (!note.trim() && !files.length)}
                        >
                          Lägg till kommentar
                        </button>
                      </form>
                    )}
                  {[...currentOrder.notes].reverse().map((n) => (
                    <article className="comment-entry" key={n.id}>
                      <div>
                        <strong>{memberName(n.author)}</strong>
                        <time>{date(n.at)}</time>
                      </div>
                      <p className="muted">
                        {n.phase || "Under"}
                        {typeof n.hours === "number"
                          ? " · " + n.hours + " timmar"
                          : ""}
                      </p>
                      <p className="pre-wrap">{n.text}</p>
                      <div className="chips">
                        {n.files.map((f) => (
                          <button
                            key={f.id}
                            onClick={() =>
                              void cloud
                                .download(f)
                                .catch((e) => setMessage(e.message))
                            }
                          >
                            ↧ {f.name}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </section>
              </div>
              {orderTab === "Bilagor" && (
                <section className="panel content-panel">
                  <h2>Bilder och handlingar</h2>
                  <p className="muted">
                    Bifoga bilder och handlingar i dagboken. De samlas här.
                  </p>
                  <button onClick={() => setOrderTab("Dagbok")}>
                    Lägg till bilaga
                  </button>
                  <div className="chips">
                    {["Alla", "Före", "Under", "Efter", "Handlingar"].map(
                      (p) => (
                        <button
                          key={p}
                          aria-pressed={filePhase === p}
                          onClick={() => setFilePhase(p)}
                        >
                          {p}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="attachment-grid">
                    {currentOrder.notes
                      .filter(
                        (n) =>
                          filePhase === "Alla" ||
                          (n.phase || "Under") === filePhase,
                      )
                      .flatMap((n) =>
                        n.files.map((f) => (
                          <button
                            key={f.id}
                            onClick={() =>
                              void cloud
                                .download(f)
                                .catch((e) => setMessage(e.message))
                            }
                          >
                            {f.type.startsWith("image/") ? "▧" : "↧"} {f.name}
                            <small>
                              {n.phase || "Under"} · {date(n.at)} ·{" "}
                              {memberName(n.author)}
                            </small>
                          </button>
                        )),
                      )}
                  </div>
                  {!currentOrder.notes.some((n) => n.files.length > 0) && (
                    <p>Inga bilagor ännu.</p>
                  )}
                </section>
              )}
              {orderTab === "Kontroller" && (
                <section className="panel content-panel">
                  <h2>Kontroller</h2>
                  {controlKinds.map((k) => {
                    const control = currentOrder.controls?.[k];
                    if (
                      !control ||
                      (!control.enabled &&
                        !control.items.some((i) => i.at || i.comment || i.done))
                    )
                      return null;
                    return (
                      <section className="control-section" key={k}>
                        <h3>{controlLabels[k]}</h3>
                        {!control.enabled && (
                          <p className="muted">
                            Avmarkerad – tidigare dokumentation finns kvar.
                          </p>
                        )}
                        {k === "self" && control.enabled && (
                          <p>
                            Egenkontrollen måste vara utförd före avslut.{" "}
                            {control.items.filter((i) => i.done).length} av{" "}
                            {control.items.length} utförda.
                          </p>
                        )}
                        {control.items.map((item) => (
                          <ControlRow
                            key={item.id}
                            item={item}
                            memberName={memberName}
                            disabled={
                              busy ||
                              !control.enabled ||
                              !orderLevelAllowed ||
                              !canWrite(currentOrder, me) ||
                              currentOrder.status === "Avslutad"
                            }
                            onDirty={() => setDirty(true)}
                            onSave={(done, comment) =>
                              act({
                                kind: "set_control",
                                id: currentOrder.id,
                                control: k,
                                item: item.id,
                                done,
                                comment,
                              })
                            }
                          />
                        ))}
                      </section>
                    );
                  })}
                </section>
              )}
              {orderLevelAllowed &&
                canWrite(currentOrder, me) &&
                currentOrder.status !== "Avslutad" && (
                  <div className="mobile-order-actions">
                    <button
                      onClick={() => {
                        setOrderTab("Dagbok");
                      }}
                    >
                      Anteckning
                    </button>
                    <label className="camera-action">
                      Foto
                      <input
                        aria-label="Ta foto"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        disabled={busy}
                        onChange={(e) => {
                          setFiles(Array.from(e.target.files || []));
                          setPending([]);
                          setDirty(true);
                          setOrderTab("Dagbok");
                        }}
                      />
                    </label>
                    <button
                      disabled={busy || remainingSelfChecks(currentOrder) > 0}
                      onClick={() => {
                        setOrderTab("Översikt");
                        requestAnimationFrame(() =>
                          document
                            .getElementById("order-completion")
                            ?.scrollIntoView({ behavior: "smooth" }),
                        );
                      }}
                    >
                      Avsluta
                    </button>
                  </div>
                )}
              <details className="panel content-panel">
                <summary>Historik</summary>
                <ol className="history">
                  {[...currentOrder.events].reverse().map((e) => (
                    <li key={e.id}>
                      <span>{e.text}</span>
                      <time>{date(e.at)}</time>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <section className="panel content-panel">
              <h1>Ordern är inte tillgänglig</h1>
              <p>Den kan vara borttagen eller ligga utanför din behörighet.</p>
            </section>
          ))}
        {route === "/people" && !me.external && (
          <>
            <div className="page-heading">
              <h1>Personal</h1>
              {manager && (
                <button className="primary" onClick={() => edit("member")}>
                  + Lägg till profil
                </button>
              )}
            </div>
            <section className="panel content-panel">
              <div className="directory-search">
                <label htmlFor="directory-search">Sök företag</label>
                <input
                  id="directory-search"
                  type="search"
                  placeholder="Sök ett annat företag för att visa dess personal"
                  value={directorySearch}
                  onChange={(e) => setDirectorySearch(e.target.value)}
                />
                <small className="muted">
                  Sök med minst två tecken. Katalogen visar namn, yrkesroll och
                  företag.
                </small>
              </div>
              <h2>
                {directorySearch.trim()
                  ? "Personal hos sökta företag"
                  : "Mina kollegor · " + me.employer}
              </h2>
              {directorySearch.trim() ? (
                <div aria-live="polite">
                  {directoryBusy && <p>Söker företag…</p>}
                  {directoryError && <p role="alert">{directoryError}</p>}
                  {!directoryBusy &&
                    !directoryError &&
                    !directoryResults.length && (
                      <p>
                        {directorySearch.trim().length < 2
                          ? "Skriv minst två tecken."
                          : "Ingen registrerad personal hittades hos det företaget."}
                      </p>
                    )}
                  {directoryResults.map((p) => (
                    <div className="person-row" key={p.id}>
                      <span className="person-name">
                        <span className="avatar">
                          {p.name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <span>
                          {p.name}
                          <small>
                            {p.job} · {p.employer}
                          </small>
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {directoryPeople.map((p) => (
                    <div className="person-row" key={p.id}>
                      <button
                        className="person-name"
                        onClick={() => go("/person/" + p.id)}
                      >
                        <span className="avatar">
                          {p.name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <span>
                          {p.name}
                          <small>
                            {p.job} · {p.employer}
                          </small>
                        </span>
                      </button>
                      <span className="muted">
                        {p.active
                          ? p.joined
                            ? "Aktiv"
                            : "Väntar på registrering"
                          : "Inaktiverad"}
                      </span>
                      {manager && rank(p.role) > rank(me.role) && (
                        <button onClick={() => edit("member", p)}>
                          Redigera
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </section>
          </>
        )}
        {(route === "/profile" || currentPerson) && (
          <Profile
            person={route === "/profile" ? me : currentPerson!}
            self={route === "/profile" || currentPerson?.id === me.id}
            busy={busy}
            onChange={setDirty}
            onSave={async (phone) => act({ kind: "self_contact", phone })}
            onEmail={async (email) => {
              if (isDemo) {
                setMessage("E-postbekräftelse testas med Supabase.");
                return;
              }
              const { error } = await supabase!.auth.updateUser(
                { email },
                { emailRedirectTo: window.location.origin },
              );
              setMessage(
                error
                  ? error.message
                  : "Bekräfta e-postbytet via länkarna som skickas. Den gamla adressen gäller tills bytet är bekräftat.",
              );
              setDirty(false);
            }}
            onEdit={
              manager && rank((currentPerson || me).role) > rank(me.role)
                ? () => edit("member", currentPerson!)
                : undefined
            }
          />
        )}
        {route === "/password" && (
          <section className="panel content-panel narrow">
            <h1>Välj nytt lösenord</h1>
            <form
              onChange={() => setDirty(true)}
              onSubmit={async (e) => {
                e.preventDefault();
                const password = String(
                  new FormData(e.currentTarget).get("password"),
                );
                const { error } = await supabase!.auth.updateUser({ password });
                if (error) setMessage(error.message);
                else {
                  setDirty(false);
                  setMessage("Lösenordet är uppdaterat.");
                  go("/orders", true);
                }
              }}
            >
              <label>
                Nytt lösenord
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button className="primary">Spara lösenord</button>
            </form>
          </section>
        )}
        {(route === "/companies" || route === "/projects") && manager && (
          <>
            <div className="page-heading">
              <div>
                <h1>{route === "/projects" ? "Projekt" : "Företag"}</h1>
                <p className="muted">
                  {route === "/projects"
                    ? "Företagets projekt och anknytningar."
                    : "Företagsbank och kontaktpersoner."}
                </p>
              </div>
              <button
                className="primary"
                onClick={() =>
                  edit(route === "/projects" ? "project" : "company")
                }
              >
                {route === "/projects"
                  ? "+ Lägg till projekt"
                  : "+ Lägg till företag"}
              </button>
            </div>
            <div className="bank-grid">
              <section className="panel content-panel company-bank">
                <h2>Företagsbank</h2>
                <input
                  aria-label="Sök företag"
                  type="search"
                  placeholder="Sök företag eller organisation"
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Visa arkiverade
                </label>
                {s.companies
                  .filter(
                    (c) =>
                      (showArchived || !c.archived) &&
                      c.name.toLowerCase().includes(bankSearch.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      className={
                        "company-choice " +
                        (bankSelected === c.id ? "selected" : "")
                      }
                      key={c.id}
                      onClick={() => setBankSelected(c.id)}
                    >
                      <strong>{c.name}</strong>
                      <small>
                        {c.kind}
                        {c.archived ? " · Arkiverad" : ""}
                      </small>
                    </button>
                  ))}
              </section>
              <div>
                {(() => {
                  const company =
                    s.companies.find((c) => c.id === bankSelected) ||
                    s.companies.find((c) => !c.archived);
                  if (!company)
                    return (
                      <section className="panel content-panel">
                        <p>Lägg till ditt första företag.</p>
                      </section>
                    );
                  return (
                    <>
                      {route === "/companies" && (
                        <section className="panel content-panel">
                          <div className="section-heading">
                            <h2>{company.name}</h2>
                            <div className="actions">
                              <button onClick={() => edit("company", company)}>
                                Redigera
                              </button>
                              {!company.archived && (
                                <button
                                  onClick={() =>
                                    confirmAction(
                                      "Arkivera företag?",
                                      <p>
                                        Företaget och dess historik behålls.
                                      </p>,
                                      "Arkivera",
                                      () =>
                                        act({
                                          kind: "archive_company",
                                          id: company.id,
                                        }),
                                      false,
                                    )
                                  }
                                >
                                  Arkivera
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="muted">{company.kind}</p>
                          <h3>Kontaktpersoner</h3>
                          <div className="contact-grid">
                            {company.contacts.map((ct) => (
                              <div key={ct.id}>
                                {contactName(company, ct)}
                                <p>
                                  <a href={"mailto:" + ct.email}>{ct.email}</a>
                                  <br />
                                  <a href={"tel:" + ct.phone}>{ct.phone}</a>
                                </p>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                      {route === "/projects" && (
                        <section className="panel content-panel">
                          <div className="section-heading">
                            <h2>Projekt</h2>
                            <button
                              disabled={company.archived}
                              onClick={() => {
                                edit("project");
                                setBankSelected(company.id);
                              }}
                            >
                              + Nytt projekt
                            </button>
                          </div>
                          {s.projects
                            .filter(
                              (p) =>
                                p.customer === company.id &&
                                (showArchived || !p.archived),
                            )
                            .map((p) => (
                              <article className="project-card" key={p.id}>
                                <div className="section-heading">
                                  <h3>
                                    {p.customerNumber} · {p.name}
                                  </h3>
                                  <button onClick={() => edit("project", p)}>
                                    Redigera
                                  </button>
                                </div>
                                <p className="muted">
                                  Beställarens projektnummer: {p.customerNumber}
                                  <br />
                                  Eget projektnummer: {p.number}
                                  <br />
                                  {p.address}
                                </p>
                                <h4>Anknytningar till projektet</h4>
                                {p.connections.map((cn) => {
                                  const firm = s.companies.find(
                                    (c) => c.id === cn.company,
                                  );
                                  const contact = firm?.contacts.find(
                                    (c) => c.id === cn.contact,
                                  );
                                  const person = people.find(
                                    (p) => p.id === cn.person,
                                  );
                                  return (
                                    <div className="connection-row" key={cn.id}>
                                      <span>{firm?.name || person?.name}</span>
                                      <span>{cn.function}</span>
                                      <span>
                                        {contact && firm
                                          ? contactName(firm, contact)
                                          : person?.name}
                                      </span>
                                    </div>
                                  );
                                })}
                                <div className="actions">
                                  <button
                                    onClick={() => {
                                      setQuery(p.number);
                                      go("/search");
                                    }}
                                  >
                                    Visa projektets arbetsorder
                                  </button>
                                  {!p.archived && (
                                    <button
                                      onClick={() =>
                                        confirmAction(
                                          "Arkivera projekt?",
                                          <p>
                                            Historiken behålls. Nya order kan
                                            inte kopplas till ett arkiverat
                                            projekt.
                                          </p>,
                                          "Arkivera",
                                          () =>
                                            act({
                                              kind: "archive_project",
                                              id: p.id,
                                            }),
                                          false,
                                        )
                                      }
                                    >
                                      Arkivera projekt
                                    </button>
                                  )}
                                </div>
                              </article>
                            ))}
                        </section>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}
        <Tips manager={manager} />
        <footer className="brief-footer">
          <div className="footer-brand"><Logo /><p>© 2026 Brief. All rights reserved. · Established 2026 · Sweden</p></div>
          <div className="actions">
            {workspaces.length > 1 && (
              <select
                aria-label="Arbetsyta"
                value={s.workspace}
                onChange={async (e) => {
                  if (dirty && !confirm("Lämna osparade ändringar?")) return;
                  try {
                    setS(await cloud.load(e.target.value));
                    writePreference("brief-workspace", e.target.value);
                    setDirty(false);
                    go("/orders");
                  } catch (err) {
                    setMessage(String(err));
                  }
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={async () => {
                if (dirty && !confirm("Lämna osparade ändringar och logga ut?"))
                  return;
                try {
                  if (!isDemo) {
                    const { error } = await supabase!.auth.signOut();
                    if (error) throw error;
                  }
                  setS(null);
                  setIsDemo(false);
                  setDirty(false);
                  setMessage("");
                } catch (e) {
                  setMessage(String(e));
                }
              }}
            >
              Logga ut
            </button>
          </div>
        </footer>
      </main>
      {dialog && (
        <Sheet title={dialog.title} onClose={() => !busy && setDialog(null)}>
          {dialog.body}
          <div className="form-actions">
            <button disabled={busy} onClick={() => setDialog(null)}>
              Avbryt
            </button>
            <button
              disabled={busy}
              className={dialog.danger ? "danger" : "primary"}
              onClick={async () => {
                const result = await dialog.action();
                if (result !== false) setDialog(null);
              }}
            >
              {dialog.label}
            </button>
          </div>
        </Sheet>
      )}
      {profile && (
        <Sheet title={profile.name} onClose={() => setProfile(null)}>
          <p>
            {profile.job} · {profile.employer}
          </p>
          <p>
            <a href={"tel:" + profile.phone}>{profile.phone}</a>
          </p>
          <p>
            <a href={"mailto:" + profile.email}>{profile.email}</a>
          </p>
          <p className="muted">
            Kontaktkopplingen ger ingen åtkomst till personens arbetsorder.
          </p>
        </Sheet>
      )}
      {editor && (
        <Sheet
          title={
            (editor.value ? "Redigera " : "Lägg till ") +
            {
              order: "arbetsorder",
              member: "profil",
              company: "företag",
              project: "projekt",
            }[editor.type]
          }
          onClose={closeEditor}
        >
          <form onSubmit={saveEditor} onChange={() => setDirty(true)}>
            <fieldset disabled={busy}>
              {editor.type === "order" && (
                <Fields
                  fields={(() => {
                    const o = editor.value as Order | undefined;
                    return [
                      {
                        key: "number",
                        label: "Ordernummer",
                        value: o?.number,
                        required: true,
                        max: 100,
                      },
                      {
                        key: "title",
                        label: "Titel",
                        value: o?.title,
                        required: true,
                      },
                      {
                        key: "project",
                        label: "Projekt",
                        value: o?.project,
                        required: true,
                        options: s.projects
                          .filter((p) => !p.archived)
                          .map((p) => ({
                            value: p.id,
                            label: p.number + " · " + p.name,
                          })),
                      },
                      {
                        key: "address",
                        label: "Adress",
                        value: o?.address,
                        max: 300,
                      },
                      {
                        key: "description",
                        label: "Beskrivning",
                        type: "textarea",
                        value: o?.description,
                      },
                      {
                        key: "assignee",
                        label: "Utförare",
                        value: o?.assignee || me.id,
                        required: true,
                        options: assignable.map((p) => ({
                          value: p.id,
                          label: p.name + (p.id === me.id ? " (jag)" : ""),
                        })),
                      },
                      {
                        key: "start",
                        label: "Planerad start",
                        type: "date",
                        value: o?.start,
                      },
                      {
                        key: "access",
                        label: "Nycklar och tillträde",
                        type: "textarea",
                        value: o?.access,
                        max: 2000,
                      },
                      {
                        key: "due",
                        label: "Planerat färdigt (valfritt)",
                        type: "date",
                        value: o?.due,
                      },
                      {
                        key: "priority",
                        label: "Prioritet",
                        value: o?.priority || "Normal",
                        options: ["Låg", "Normal", "Hög"].map((v) => ({
                          value: v,
                          label: v,
                        })),
                      },
                    ];
                  })()}
                />
              )}
              {editor.type === "order" && (
                <div className="control-picker">
                  <p>
                    <strong>Ansvarig upprättare</strong>
                    <br />
                    {memberName(
                      (editor.value as Order)?.issuedBy || me.id,
                    )} ·{" "}
                    {
                      roles[
                        people.find(
                          (p) =>
                            p.id ===
                            ((editor.value as Order)?.issuedBy || me.id),
                        )?.role || me.role
                      ]
                    }
                  </p>
                  <h3>Valbara kontroller</h3>
                  {controlKinds.map((k) => (
                    <label className="check-label" key={k}>
                      <input
                        name={"control_" + k}
                        type="checkbox"
                        defaultChecked={
                          (editor.value as Order)?.controls?.[k]?.enabled ||
                          false
                        }
                      />
                      {controlLabels[k]}
                    </label>
                  ))}
                  <p className="muted">
                    Vald egenkontroll måste utföras före avslut. Avmarkerade
                    kontroller behåller tidigare dokumentation.
                  </p>
                  <label>
                    Egenkontrollpunkter – en per rad
                    <textarea
                      name="selfLabels"
                      rows={3}
                      maxLength={5000}
                      defaultValue={
                        (editor.value as Order)?.controls?.self?.items
                          .map((i) => i.label)
                          .join("\n") ||
                        "Arbetet kontrollerat enligt arbetsbeskrivningen\nAvvikelser dokumenterade\nDokumentation bifogad"
                      }
                    />
                  </label>
                  <p className="muted">
                    Planering, kontakter och UE, nycklar och tillträde, dagbok
                    och bilagor finns alltid med.
                  </p>
                </div>
              )}
              {editor.type === "member" && (
                <>
                  <Fields
                    fields={(() => {
                      const p = editor.value as Member | undefined;
                      return [
                        {
                          key: "firstName",
                          label: "Förnamn",
                          value: p?.name.split(" ")[0],
                          required: true,
                          max: 150,
                        },
                        {
                          key: "lastName",
                          label: "Efternamn",
                          value: p?.name.split(" ").slice(1).join(" "),
                          required: true,
                          max: 150,
                        },
                        {
                          key: "job",
                          label: "Yrkesroll",
                          value: p?.job,
                          required: true,
                          max: 150,
                        },
                        {
                          key: "employer",
                          label: "Företag",
                          value: p?.employer,
                          required: true,
                        },
                        {
                          key: "phone",
                          label: "Telefon",
                          value: p?.phone,
                          type: "tel",
                          required: true,
                          max: 40,
                        },
                        ...(!p
                          ? [
                              {
                                key: "email",
                                label: "E-post för registrering",
                                type: "email",
                                required: true,
                              },
                              {
                                key: "role",
                                label: "Roll",
                                value: "worker",
                                required: true,
                                options: (["supervisor", "worker"] as const)
                                  .filter((r) => rank(r) > rank(me.role))
                                  .map((r) => ({ value: r, label: roles[r] })),
                              },
                            ]
                          : []),
                      ];
                    })()}
                  />
                  {!editor.value ? (
                    <>
                      <label className="check-label">
                        <input name="external" type="checkbox" />
                        Extern användare från annat företag
                      </label>
                      <p className="muted">
                        Be personen registrera sig med denna e-postadress. Ingen
                        e-postinbjudan skickas automatiskt.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="muted">
                        Roll: {roles[(editor.value as Member).role]}. Rollen är
                        låst.
                      </p>
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() =>
                            confirmAction(
                              (editor.value as Member).active
                                ? "Inaktivera profil?"
                                : "Aktivera profil?",
                              <p>
                                Vid inaktivering återgår aktiva ordrar till
                                orderskaparen, eller markeras Behöver tilldelas.
                              </p>,
                              (editor.value as Member).active
                                ? "Inaktivera"
                                : "Aktivera",
                              async () => {
                                const ok = await act({
                                  kind: (editor.value as Member).active
                                    ? "deactivate_member"
                                    : "activate_member",
                                  id: editor.value!.id,
                                });
                                if (ok) setEditor(null);
                                return ok;
                              },
                            )
                          }
                        >
                          {(editor.value as Member).active
                            ? "Inaktivera"
                            : "Aktivera"}
                        </button>
                        <button
                          type="button"
                          className="danger-quiet"
                          onClick={() =>
                            confirmAction(
                              "Ta bort profil?",
                              <p>
                                Profilen tas bort från personalen.
                                Orderhistoriken behålls och aktiva ordrar
                                återgår till orderskaparen.
                              </p>,
                              "Ta bort profil",
                              async () => {
                                const ok = await act({
                                  kind: "delete_member",
                                  id: editor.value!.id,
                                });
                                if (ok) setEditor(null);
                                return ok;
                              },
                            )
                          }
                        >
                          Ta bort profil
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {editor.type === "company" && (
                <>
                  <Fields
                    fields={[
                      {
                        key: "name",
                        label: "Företag eller organisation",
                        value: (editor.value as Company)?.name,
                        required: true,
                      },
                      {
                        key: "companyKind",
                        label: "Typ",
                        value: (editor.value as Company)?.kind || "Beställare",
                        required: true,
                        options: [
                          "Beställare",
                          "Underentreprenör",
                          "Organisation",
                          "Övrigt",
                        ].map((v) => ({ value: v, label: v })),
                      },
                    ]}
                  />
                  <h3>Kontaktpersoner</h3>
                  {contacts.map((ct, i) => (
                    <div className="subform" key={ct.id}>
                      {(["name", "phone", "email"] as const).map((key) => (
                        <label key={key}>
                          {key === "name"
                            ? "För- och efternamn"
                            : key === "phone"
                              ? "Telefon"
                              : "E-post"}
                          <input
                            type={
                              key === "email"
                                ? "email"
                                : key === "phone"
                                  ? "tel"
                                  : "text"
                            }
                            value={ct[key]}
                            required={key === "name"}
                            maxLength={
                              key === "name" ? 150 : key === "phone" ? 40 : 200
                            }
                            onChange={(e) =>
                              setContacts(
                                contacts.map((c, j) =>
                                  j === i ? { ...c, [key]: e.target.value } : c,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        disabled={contacts.length === 1}
                        onClick={() => {
                          setContacts(contacts.filter((c) => c.id !== ct.id));
                          setDirty(true);
                        }}
                      >
                        Ta bort kontakt
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setContacts([
                        ...contacts,
                        { id: id(), name: "", phone: "", email: "" },
                      ]);
                      setDirty(true);
                    }}
                  >
                    + Kontaktperson
                  </button>
                </>
              )}
              {editor.type === "project" && (
                <>
                  <Fields
                    fields={(() => {
                      const p = editor.value as Project | undefined;
                      return [
                        {
                          key: "customer",
                          label: "Beställare",
                          value:
                            p?.customer ||
                            bankSelected ||
                            s.companies.find((c) => !c.archived)?.id,
                          required: true,
                          options: s.companies
                            .filter((c) => !c.archived)
                            .map((c) => ({ value: c.id, label: c.name })),
                        },
                        {
                          key: "customerNumber",
                          label: "Beställarens projektnummer",
                          value: p?.customerNumber,
                          required: true,
                          max: 100,
                        },
                        {
                          key: "number",
                          label: "Eget projektnummer",
                          value: p?.number,
                          required: true,
                          max: 100,
                        },
                        {
                          key: "name",
                          label: "Projektnamn",
                          value: p?.name,
                          required: true,
                        },
                        {
                          key: "address",
                          label: "Adress",
                          value: p?.address,
                          max: 300,
                        },
                      ];
                    })()}
                  />
                  <h3>Anknytningar</h3>
                  {connections.map((cn, i) => (
                    <div className="subform" key={cn.id}>
                      <label>
                        Företag
                        <select
                          value={cn.company}
                          onChange={(e) =>
                            setConnections(
                              connections.map((c, j) =>
                                i === j
                                  ? {
                                      ...c,
                                      company: e.target.value,
                                      contact: "",
                                      person: "",
                                    }
                                  : c,
                              ),
                            )
                          }
                        >
                          <option value="">Välj företag…</option>
                          {s.companies
                            .filter((c) => !c.archived)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Kontaktperson
                        <select
                          value={cn.contact}
                          onChange={(e) =>
                            setConnections(
                              connections.map((c, j) =>
                                i === j ? { ...c, contact: e.target.value } : c,
                              ),
                            )
                          }
                        >
                          <option value="">Ingen vald</option>
                          {s.companies
                            .find((c) => c.id === cn.company)
                            ?.contacts.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Enskild person
                        <select
                          value={cn.person || ""}
                          onChange={(e) =>
                            setConnections(
                              connections.map((c, j) =>
                                i === j
                                  ? {
                                      ...c,
                                      person: e.target.value,
                                      company: "",
                                      contact: "",
                                    }
                                  : c,
                              ),
                            )
                          }
                        >
                          <option value="">Ingen vald</option>
                          {people
                            .filter((p) => p.active)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Funktion
                        <input
                          value={cn.function}
                          placeholder="Exempelvis elektriker"
                          maxLength={150}
                          onChange={(e) =>
                            setConnections(
                              connections.map((c, j) =>
                                i === j
                                  ? { ...c, function: e.target.value }
                                  : c,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setConnections(
                            connections.filter((c) => c.id !== cn.id),
                          );
                          setDirty(true);
                        }}
                      >
                        Ta bort anknytning
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setConnections([
                        ...connections,
                        { id: id(), company: "", contact: "", function: "" },
                      ]);
                      setDirty(true);
                    }}
                  >
                    + Anknytning
                  </button>
                </>
              )}
              <div className="form-actions">
                <button type="button" onClick={closeEditor}>
                  Avbryt
                </button>
                <button className="primary" type="submit">
                  {busy ? "Sparar…" : "Spara"}
                </button>
              </div>
            </fieldset>
          </form>
        </Sheet>
      )}
    </div>
  );
}
function Profile({
  person,
  self,
  busy,
  onChange,
  onSave,
  onEmail,
  onEdit,
}: {
  person: Member;
  self: boolean;
  busy: boolean;
  onChange: (dirty: boolean) => void;
  onSave: (phone: string) => Promise<boolean>;
  onEmail: (email: string) => Promise<void>;
  onEdit?: () => void;
}) {
  const [phone, setPhone] = useState(person.phone);
  const [email, setEmail] = useState(person.email);
  useEffect(() => {
    setPhone(person.phone);
  }, [person.phone, person.id]);
  useEffect(() => {
    setEmail(person.email);
  }, [person.email, person.id]);
  useEffect(() => {
    onChange(self && (phone !== person.phone || email !== person.email));
  }, [phone, email, person.phone, person.email, self]);
  return (
    <section className="panel content-panel narrow" key={person.id}>
      <div className="section-heading">
        <h1>{self ? "Min profil" : person.name}</h1>
        {onEdit && <button onClick={onEdit}>Redigera</button>}
      </div>
      <dl className="profile-details">
        <dt>Namn</dt>
        <dd>{person.name}</dd>
        <dt>Yrkesroll</dt>
        <dd>{person.job}</dd>
        <dt>Företag</dt>
        <dd>{person.employer}</dd>
        <dt>Roll</dt>
        <dd>{roles[person.role]}</dd>
      </dl>
      {self ? (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onSave(String(new FormData(e.currentTarget).get("phone")));
            }}
          >
            <label>
              Telefon
              <input
                type="tel"
                name="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                maxLength={40}
              />
            </label>
            <button className="primary" disabled={busy}>
              Spara telefon
            </button>
          </form>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onEmail(String(new FormData(e.currentTarget).get("email")));
              setEmail(person.email);
            }}
          >
            <label>
              E-post
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <p className="muted">
              Ny e-postadress måste bekräftas innan den börjar gälla.
            </p>
            <button disabled={busy}>Byt e-postadress</button>
          </form>
          <p className="muted">
            Yrkesroll och företag kan bara rättas av en högre behörig roll.
            Systemrollen är låst.
          </p>
        </>
      ) : (
        <>
          <p>
            <a href={"tel:" + person.phone}>{person.phone}</a>
          </p>
          <p>
            <a href={"mailto:" + person.email}>{person.email}</a>
          </p>
        </>
      )}
    </section>
  );
}

function ControlRow({
  item,
  disabled,
  onSave,
  memberName,
  onDirty,
}: {
  item: import("../lib/beta").ControlItem;
  disabled: boolean;
  onSave: (done: boolean, comment: string) => Promise<boolean>;
  memberName: (id: string) => string;
  onDirty: () => void;
}) {
  const [comment, setComment] = useState(item.comment);
  const [done, setDone] = useState(item.done);
  useEffect(() => {
    setComment(item.comment);
    setDone(item.done);
  }, [item.comment, item.done]);
  return (
    <form
      className="control-row"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(done, comment);
      }}
    >
      <label className="check-label">
        <input
          type="checkbox"
          checked={done}
          disabled={disabled}
          onChange={(e) => {
            setDone(e.target.checked);
            onDirty();
          }}
        />
        {item.label}
      </label>
      <textarea
        aria-label={"Kommentar till " + item.label}
        placeholder="Kommentar eller hänvisning till bild i dagboken"
        value={comment}
        maxLength={2000}
        disabled={disabled}
        onChange={(e) => {
          setComment(e.target.value);
          onDirty();
        }}
      />
      <div className="actions">
        <small>
          {item.at
            ? memberName(item.author || "") + " · " + date(item.at)
            : "Ej dokumenterad"}
        </small>
        {!disabled && (
          <button disabled={comment === item.comment && done === item.done}>
            Spara kontroll
          </button>
        )}
      </div>
    </form>
  );
}
