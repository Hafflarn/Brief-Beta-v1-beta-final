"use client";
import { FormEvent, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import Logo from "./components/logo";
import ThemePicker from "./components/theme";
export default function Login({
  onReady,
  onDemo,
}: {
  onReady: () => Promise<void>;
  onDemo: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "complete" | "reset">(
    "login",
  );
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");
  const [show, setShow] = useState(false);
  const lock = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") || "").trim();
    const password = String(f.get("password") || "");
    const metadata = {
      full_name: f.get("name"),
      job_title: f.get("job"),
      company_name: f.get("employer"),
      phone: f.get("phone"),
    };
    try {
      if (!supabase)
        throw Error(
          "Supabase saknas. Följ installationen eller öppna demonstrationen.",
        );
      if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        await onReady();
        return;
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: metadata, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage("Kontrollera din e-post och bekräfta kontot.");
          return;
        }
      } else if (mode === "complete") {
        const { error } = await supabase.auth.updateUser({ data: metadata });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      setSuccess(true);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          matchMedia("(prefers-reduced-motion: reduce)").matches ? 160 : 950,
        ),
      );
      await onReady();
    } catch (err) {
      setSuccess(false);
      const text =
        err instanceof Error ? err.message : "Inloggningen misslyckades.";
      setMessage(
        text === "Invalid login credentials"
          ? "Fel e-postadress eller lösenord."
          : text,
      );
      if (text.includes("Komplettera")) setMode("complete");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-theme">
        <ThemePicker />
      </div>
      <div className="login-brand">
        <Logo success={success} large />
        <p>Keep it brief, get it done.</p>
        <small>Brief v1 Beta</small>
      </div>
      <section className="login-card" aria-busy={busy}>
        <h1>
          {mode === "login"
            ? "Välkommen tillbaka"
            : mode === "signup"
              ? "Skapa ditt konto"
              : mode === "complete"
                ? "Komplettera din profil"
                : "Nytt lösenord"}
        </h1>
        <p className="muted">
          {mode === "login"
            ? "Logga in till din arbetsyta."
            : mode === "signup"
              ? "Har du en inbjudan? Använd samma e-postadress."
              : "Fyll i dina uppgifter för att fortsätta."}
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {(mode === "signup" || mode === "complete") && (
              <>
                <label>
                  Namn
                  <input
                    name="name"
                    required
                    maxLength={150}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Yrkesroll
                  <input
                    name="job"
                    required
                    maxLength={150}
                    placeholder="Exempelvis snickare"
                  />
                </label>
                <label>
                  Företag
                  <input
                    name="employer"
                    required
                    maxLength={200}
                    autoComplete="organization"
                  />
                </label>
                <label>
                  Telefon
                  <input
                    name="phone"
                    type="tel"
                    required
                    maxLength={40}
                    autoComplete="tel"
                  />
                </label>
              </>
            )}
            {mode !== "complete" && mode !== "reset" && (
              <label>
                E-post
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="namn@foretag.se"
                />
              </label>
            )}
            {mode !== "complete" && (
              <div>
                <label htmlFor="login-password">Lösenord</label>
                <div className="password-field">
                  <input
                    id="login-password"
                    name="password"
                    type={show ? "text" : "password"}
                    required
                    minLength={mode === "login" ? undefined : 8}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                  />
                  <button
                    type="button"
                    aria-label={show ? "Dölj lösenord" : "Visa lösenord"}
                    onClick={() => setShow(!show)}
                  >
                    {show ? "Dölj" : "Visa"}
                  </button>
                </div>
              </div>
            )}
            <button className="primary full" type="submit">
              {success
                ? "Inloggad"
                : busy
                  ? "Kontrollerar…"
                  : mode === "login"
                    ? "Logga in"
                    : mode === "signup"
                      ? "Registrera dig"
                      : "Spara och fortsätt"}
            </button>
          </fieldset>
        </form>
        <p className="login-message" role="status">
          {message || (success ? "Inloggningen lyckades." : "")}
        </p>
        {(mode === "login" || mode === "signup") && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage("");
            }}
          >
            {mode === "login"
              ? "Nytt konto? Registrera dig"
              : "Har du ett konto? Logga in"}
          </button>
        )}
        {mode === "login" && (
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              if (!supabase) {
                setMessage("Supabase är inte konfigurerat.");
                return;
              }
              const email = prompt("Vilken e-postadress har ditt konto?");
              if (!email) return;
              const { error } = await supabase.auth.resetPasswordForEmail(
                email,
                { redirectTo: window.location.origin + "/#/password" },
              );
              setMessage(
                error
                  ? error.message
                  : "Om kontot finns skickas en återställningslänk.",
              );
            }}
          >
            Glömt lösenord?
          </button>
        )}
        {!supabase && (
          <button className="text-button" onClick={onDemo}>
            Öppna demonstration
          </button>
        )}
      </section>
    </main>
  );
}
