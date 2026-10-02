"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>Brief kunde inte öppnas</h1>
        <p role="alert">
          Försök igen. Om problemet kvarstår, ladda om sidan för att hämta den
          senaste versionen.
        </p>
        <button onClick={reset}>Försök igen</button>{" "}
        <button onClick={() => window.location.reload()}>Ladda om</button>
      </section>
    </main>
  );
}
