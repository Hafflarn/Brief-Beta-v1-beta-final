# Publicering av företagsåtkomst och kontohantering

Status: kod och migration verifieras lokalt. Produktionsdatabasen är ännu inte ändrad.

1. Kontrollera att målprojektet för brief.nu använder Hafflarn/Brief-Beta-v1-beta-final och det avsedda committet.
2. Kontrollera att NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY och servervariabeln SUPABASE_SERVICE_ROLE_KEY finns i målmiljön. Servernyckeln får aldrig vara NEXT_PUBLIC.
3. Granska befintliga arbetsytor/företag. Migreringen kopplar befintliga medlemmar till fasta företags-ID:n baserat på deras nuvarande företag inom respektive arbetsyta. Företag med samma namn i skilda arbetsytor blir separata identiteter. Kundposter länkas bara när företagsnamnet har exakt en matchning; tvetydiga namn ger ingen automatisk åtkomst.
4. Staga ett produktionsbygge utan domänbyte och verifiera API-konfigurationen. Tillämpa 20261008183000_company_access_and_accounts.sql på det verifierade Supabase-projektet, och publicera sedan samma bygge. Migreringen blockerar gamla klienters öppna registrering och invite_member-anrop, så koordinera domänbytet med migreringen.
5. Kontrollera inloggning med befintligt konto, nytt tilldelat konto, lösenordsbyte, olika företags ordraisolering, förfrågan/godkännande/återkallande och kontaktkort i båda riktningarna.
6. Kör Supabases rådgivare efter migreringen. Nya tabeller har RLS och saknar klientgrants; klienter använder avgränsade RPC:er. Kontoprovisioneringens RPC är endast tillgänglig för service_role.

Kontrollkommandon: npm run typecheck; npm test; npm run build; BRIEF_CHROMIUM_EXECUTABLE=<chromium> node tests/changes-browser.cjs.
