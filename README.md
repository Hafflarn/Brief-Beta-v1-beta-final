# Brief v1 Beta

Keep it brief, get it done.

Next.js + Supabase. Mobilanpassad arbetsorderapp med interna och externa deltagare, låsta systemroller, företagsbank, projekt, gemensam orderhistorik, papperskorg, teman och korrekt bakåtnavigering.

## Börja här

Läs [installationsguiden](docs/INSTALLATION.md). Den beskriver ny installation, migrering av tidigare Brief, Supabase Auth/Storage, Vercel, DNS och Cron.

```sh
npm ci
npm run dev
```

Utan miljövariabler går det att öppna en demonstration från inloggningssidan. För riktig data: kopiera `.env.example` till `.env.local` och fyll i Supabase-värden.

```sh
npm run typecheck
npm test
npm run build
```

SQL-installationen finns i `supabase/migrations/001_brief_v1_beta.sql`. Kör endast `002_import_legacy.sql` om du redan har databasen från tidigare Brief-version.

## Behörigheter

| Roll | Orderåtkomst | Profilhantering |
|---|---|---|
| Admin | Alla order i arbetsytan | Arbetsledare och utförare |
| Arbetsledare | Order tilldelade arbetsledare/utförare, samt otilldelade | Utförare |
| Utförare | Interna: läser order tilldelade utförare; uppdaterar efter tilldelning/anslutning | Egen telefon och e-post |
| Extern utförare | Bara tilldelade/inbjudna order, fortfarande inom rollgränsen | Egen telefon och e-post |

Admin/arbetsledare kan redigera orderuppgifter, duplicera, återöppna och hantera företagsbanken. Tilldelning till egen roll eller lägre. Bara Admin raderar permanent. Systemrollen ändras aldrig; ny roll kräver en ny profil. Yrkesroll och systemroll är separata.

## Data och radering

Avslutade order lämnar startsidan efter 14 dagar men finns kvar i sökningen. Papperskorgen är ett separat flöde: där löper order ut efter 14 dagar och raderas. Daglig Vercel Cron städar databas och bilagor; se guide för hemligheter och tidsfördröjning.

Projekt har fritt eget och beställarens nummer. Kontaktlänkar matchas via normaliserad telefon eller e-post, aldrig namn. Telefonnummer +46, 0046 och svensk inledande nolla normaliseras. Tvetydiga matchningar ger ingen profil-länk. Länken ger ingen orderbehörighet.

## Beta och verifiering

Se [verifieringsrapporten](docs/VERIFICATION.md) och [kundinformationen](docs/ROLLER.md). Appen är testad lokalt, inklusive SQL i en PostgreSQL-kompatibel testdatabas. Slutligt test av verklig Supabase Auth/Storage/SMTP och Vercel Cron krävs i din miljö.
