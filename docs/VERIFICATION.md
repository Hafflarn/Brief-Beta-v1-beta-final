# Brief v1 Beta – verifiering

## Genomförda kontroller

- TypeScript: `npm run typecheck` utan fel.
- Produktionsbygge: `npm run build` utan fel, både utan och med publika Supabase-variabler.
- Automatiska tester: `npm test` – två testfall med omfattande assertions för affärsregler och databasfunktioner.
- SQL körd i PGlite, en PostgreSQL-kompatibel lokal testdatabas med simulerade Supabase Auth- och Storage-scheman.
- Schema kan installeras på nytt utan att användardata skrivs över.
- Rollbaserad läsning, skrivning efter anslutning, externa inbjudningar, tilldelningsgränser, låsta roller och profilhantering.
- Arbetsyteisolering, otillåtna direktanrop, stale revisions och krav på bekräftad e-post.
- Bilagesökvägar, uppladdarägande, återkallad filåtkomst och kö för fysisk filradering.
- Papperskorg, återställning, permanent radering och 14-dagarsgränsen.
- Migrering av äldre Brief-projekt, order, profiler och originalhistorik samt avveckling av gamla tabeller efter verifiering.
- Chromium: dator 1440 px och mobil 390 px, ljust/mörkt tema, utan sidöverflöde. Tipsen ryms på en rad.
- Chromium: filterordning, äldre avslutade ordrar i sökningen, bakåtknapp, varning om osparade ändringar, avslut/återöppning, papperskorg/återställning, kontaktprofiler och företagsregistrering.
- Chromium med simulerad Supabase API: fel lösenord startar ingen animation; registrering skickar alla profilfält och inväntar bekräftelse; rätt inloggning spelar bockeffekten på inloggningssidan innan arbetsytan öppnas.
- Återställningslänk med Auth-token i URL kan behandlas innan appnavigationen ändrar URL-fragmentet.
- Cleanup-endpointen avvisar anrop utan rätt serverhemlighet.

## Vad som måste kontrolleras i din miljö

Ingen ändring har publicerats till GitHub, Vercel eller din verkliga Supabase-databas. Riktig e-postleverans, bekräftelsemeddelanden, Auth-redirects, Storage-uppladdning och Vercel Cron ska testas efter installation. Den lokala Storage-kontrollen testar databasens auktorisering, inte leverantörens verkliga HTTP-API.

Vercel Cron kör dagligen. Order är oåtkomliga när de raderats, men fysisk filstädning kan ske senare samma dygn. Migrationsbackup i gamla tabeller behöver avvecklas separat enligt guiden.

## Reproducera kontroller

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Webbläsartester är separata från `npm test`. Installera Chromium för Playwright:

```sh
npx playwright-core install chromium
```

`tests/browser-smoke.cjs` använder demonstrationen. Kör med Supabase-variabler frånkopplade och utan `.env.local` som konfigurerar riktig Supabase:

```sh
npm run test:ui
```

För de simulerade Auth-testerna bygger du med dessa testvärden, sedan kör du testet:

```sh
NEXT_PUBLIC_SUPABASE_URL=https://brief-tests.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=preview-key npm run build
npm run test:auth
```

Alla testanrop till testvärdens Supabase-adress fångas av Playwright och besvaras med testdata. Gör ett nytt normalt produktionsbygge med dina egna miljövariabler efteråt. Om du använder en befintlig Chromium-binär kan du ange dess sökväg via `BRIEF_CHROMIUM_EXECUTABLE`.

Skärmbilder från de lokala UI-testerna finns i `docs/screenshots`. De visar implementerad kod, inte de tidigare genererade designförslagen.
