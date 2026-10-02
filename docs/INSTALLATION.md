# Brief v1 Beta – installation på Supabase och Vercel

Paketet är komplett källkod. Det är inte en färdig driftsättning och innehåller inga kontonycklar. Börja med en testmiljö och gå igenom checklistan innan Brief.nu uppdateras.

## 1. Välj ny eller befintlig Supabase-databas

### Ny databas

1. Öppna ditt Supabase-projekt och SQL Editor.
2. Klistra in och kör hela `supabase/migrations/001_brief_v1_beta.sql`.
3. Kör inte den gamla filen `brief.sql` från tidigare versioner.

### Uppgradera befintlig Brief

1. Ta en databasbackup/export och dokumentera dina Auth- och Storage-inställningar. Behåll gamla källkoden för återställning.
2. Testa uppgraderingen i en separat miljö med kopierade data först.
3. Kör `001_brief_v1_beta.sql`, därefter `002_import_legacy.sql`.
4. Det andra skriptet kopierar befintliga arbetsytor, profiler, beställare, projekt, order, kommentarer och historik. Gamla bilagor behåller sin Storage-bucket och sina sökvägar.
5. De gamla API-funktionerna stängs för webbläsaren. Planera därför bytet av webbversion samtidigt som migreringen; den gamla appen fungerar inte efter steg 3.
6. Befintliga profiler saknar ofta yrkesroll och telefon. Vid första inloggningen visas ett formulär för att komplettera uppgifterna. Företaget hämtas från den gamla arbetsytan. Därefter är yrkesroll och företag låsta för egen redigering.
7. Gamla order saknade separata ordernummer. Importen skapar `AO-` följt av åtta tecken ur orderns ID. Befintliga projektnummer behålls. Avslutsdatum uppskattas från senaste historikhändelsen när ett separat datum saknas.
8. Gamla profiler med rollen `admin` förblir Admin; `employee` blir Utförare. En arbetsledarprofil skapas som en ny profil, inte genom rollbyte.
9. Importen lämnar gamla tabeller som en tillfällig migrationsbackup. När du har kontrollerat importen och sparat en separat backup, kör `supabase/RETIRE_LEGACY_AFTER_VERIFICATION.sql` för att ta bort de gamla tabellerna. Fram till dess kan redan importerad information finnas kvar i den gamla databaskopian trots radering i nya appen.

Skripten kan köras om. Importen skriver inte över befintliga nya poster. Skriptet tar inte bort data på eget initiativ.

## 2. Supabase Auth

1. Aktivera e-post/lösenord som inloggningsmetod.
2. Aktivera Confirm email. Appen kräver bekräftad e-post även om denna inställning skulle råka vara av.
3. Låt Secure email change vara aktiverat. Då behöver ett e-postbyte bekräftas innan nya adressen används.
4. Under URL Configuration, sätt Site URL till `https://www.brief.nu/`, den adress som Brief.nu omdirigerar till.
5. Tillåt `https://www.brief.nu`, `https://www.brief.nu/` och `https://www.brief.nu/#/password` för appens bekräftelse- och återställningsflöden. Lägg till utvecklings- och preview-adresser separat när de faktiskt används. Undvik breda wildcard-regler över andra projekts domäner.
6. Kontrollera e-postmallarna för registrering, e-postbyte och lösenordsåterställning. Vid egen HTML-mall ska Supabases `{{ .ConfirmationURL }}` användas.
7. Konfigurera egen SMTP för e-postleverans när betan används av riktiga kollegor; kontrollera aktuella gränser i ditt Supabase-konto.

Ett oinbjudet nytt konto skapar en separat arbetsyta och blir dess Admin. Admin lägger till lägre rollers profiler under Personal. Personen registrerar sig sedan med exakt den angivna e-postadressen. Profilen ansluts först efter bekräftad e-post. Appen skickar ingen separat personalinbjudan via e-post; dela registreringsadressen själv.

Externa personer läggs till med valet Extern användare. Om de redan har ett Brief-konto ansluts den nya profilen vid nästa inloggning. De kan då välja mellan sina arbetsytor längst ned på sidan. Den externa profilen i din arbetsyta är Utförare och får bara orderåtkomst via tilldelning eller orderinbjudan.

## 3. Lägg upp källkoden

Packa upp ZIP-filen. Projektroten är mappen som innehåller `package.json`, `app`, `lib`, `public` och `supabase`.

Ersätt gamla projektfiler med paketets filer i ditt GitHub-repository. Behåll eventuella verkliga hemligheter utanför repositoryt. Se till att Vercel använder rätt projektrot, inte ZIP-filens överordnade mapp.

Om du arbetar lokalt:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

För att prova appen utan Supabase:

```sh
npm run dev
```

Öppna `http://localhost:3000` och välj Öppna demonstration. Demonstrationen finns bara när Supabase-variabler saknas; den sparar inte verklig data. Filuppladdning och e-postbekräftelse testas med Supabase.

## 4. Vercel

Brief.nu är kopplad till projektet `brief-beta-v1-beta-final` och källan `Hafflarn/Brief-Beta-v1-beta-final`, grenen `main`. Det äldre repot `Hafflarn/Brief-app` är en annan version. Publicera inte äldre kod eller kör dess SQL som reparation av Beta.

Sidans metadata `brief-source` och `brief-commit` visar vilken källa och commit bygget kommer från. Jämför dem på dator och mobil före cacheåtgärder. Appen registrerar ingen service worker; behåll Next.js standardcache för versionsmärkta resurser.

1. Importera eller öppna GitHub-projektet i Vercel.
2. Framework Preset: Next.js. Node.js: 22.x eller senare kompatibel version.
3. Root Directory: mappen med `package.json`.
4. Build Command: `npm run build`. Install Command: `npm ci`. Output Directory: låt Next.js-standard gälla.
5. Lägg in följande Environment Variables. Använd dina egna värden, inte platshållarna i `.env.example`.

| Variabel | Innehåll | Synlighet |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase Project URL | Webbläsare |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Supabase publishable key, alternativt äldre anon key | Webbläsare |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service_role secret | Endast server |
| CRON_SECRET | Lång slumpmässig hemlighet | Endast server |

De publika variablerna behövs när appen byggs. Lägg dem på rätt Vercel-miljö och bygg om efter ändringar. Lägg aldrig service_role-nyckeln i en `NEXT_PUBLIC_`-variabel. Ingen serverhemlighet följer med till klientkoden.

Produktionsbygget avbryts om publik konfiguration saknas. Kontrollen verifierar format, inte nyckelns giltighet: kopiera nyckeln från rätt Supabase-projekt, aldrig från ett äldre exempel. Bygg om efter ändringar. Lokala byggen utan konfiguration behåller det uttryckliga demoläget.

För ett lokalt nätverkstest finns `npm run dev:lan`. Lokal HTTP på en LAN-adress kan sakna säkra webbläsar-API:er; använd HTTPS-preview för fullständiga mobiltester. Logga in på samma kanoniska adress och konto på båda enheterna. Lokal demo och lagrade sessioner delas inte mellan enheter.

6. Deploy. Testa Vercel-adressen före domänbytet.
7. Lägg till `brief.nu` under Domains och följ DNS-posterna som Vercel faktiskt visar. Kontrollera HTTPS och eventuell omdirigering mellan www och utan www.

## 5. Automatisk radering

`vercel.json` innehåller ett dagligt Cron-jobb för `/api/cleanup` kl. 03:00 UTC. Vercel skickar `Authorization: Bearer <CRON_SECRET>` till funktionen. Kontrollera att Cron är aktivt och tillgängligt på ditt konto.

- Order löper ut 14 dagar efter flytt till papperskorgen.
- Varje dataladdning rensar utgångna order i arbetsytan. Ingen kan återställa dem därefter.
- Cron rensar även utan aktiva användare, och tar bort tillhörande Storage-filer via Supabases Storage API.
- Radering under Admin köar bilagor för fysisk radering. De blir omedelbart oåtkomliga i appen; Cron tar bort filobjekten vid nästa körning.
- Cron återförsöker misslyckade filraderingar. Föräldralösa uppladdningar äldre än ett dygn städas också.
- Eftersom Cron kör dagligen kan fysisk städning ske upp till ett dygn efter 14-dagarsgränsen. Databasbackuper omfattas av leverantörens separata lagringstid.

Kontrollera jobbloggen efter installationen. Ett manuellt test med serverhemligheten görs från din egen dator, inte i webbläsaren:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://brief.nu/api/cleanup
```

## 6. Verifiera med verkliga testkonton

- Registrera första Admin och bekräfta e-post.
- Skapa företagsbank med minst en kontaktperson, och ett projekt med fria nummer.
- Lägg till arbetsledare och två interna utförare. Registrera dem med sina inbjudna e-postadresser.
- Kontrollera att arbetsledare inte kan se Admins tilldelade order, och att utförare inte kan se arbetsledares order.
- Kontrollera att utförare kan läsa varandras tillgängliga order men behöver ansluta för att uppdatera.
- Kontrollera extern tilldelning/inbjudan med ett konto från ett annat företag.
- Prova kommentarer och bilagor, även åtkomst från otillåtet konto.
- Prova avslut utan kommentar, återöppning, återställning och permanent radering.
- Prova egen e-poständring med bekräftelse, företagskontaktkoppling och utloggning.
- Prova mobilens bakåtknapp och osparade formulär.
- Kontrollera Cron-jobbet.

Lokala tester ersätter inte detta sista test mot din faktiska Auth-, SMTP- och Storage-konfiguration.

## Officiell dokumentation

- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/passwords
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/cron-jobs
- https://vercel.com/docs/frameworks/full-stack/nextjs
