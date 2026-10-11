# Projektanslutningar

Företagskopplingar ger enbart kontaktåtkomst. En separat projektinbjudan skickas från Projekt till ett anslutet företag. Mottagande Admin, Platschef eller Arbetsledare godkänner inbjudan och anger företagets eget projektnummer. Numret måste vara ledigt inom det egna företaget och kan ändras senare.

En accepterad projektinbjudan ger ansvariga tillgång till just det projektets namn, adress och beställarnummer. Den delar inte projektets övriga kontakter, byggdagbok eller arbetsordrar. Ägarföretaget kopplar varje arbetsorder till namngivna mottagare. Endast dessa personer får läsåtkomst till den arbetsordern och dess bifogade anteckningsfiler. Ägarföretaget hanterar ändringar. Återkallad projektkoppling tar bort samtliga underliggande orderkopplingar.

Tabellerna bb_project_links och bb_order_links har RLS, inga klientgrants och nås genom roll- och företagskontrollerade RPC:er. Befintliga interna behörigheter behålls. Migreringen påverkar inga befintliga företag, projekt, ordrar eller konton.

Verifiering: tests/project-sharing.test.cjs kontrollerar kontaktkoppling utan projektåtkomst, obligatoriskt eget projektnummer, nummerkonflikter, personbunden orderåtkomst, nekade ändringar, isolerade byggdagboksfiler samt återkallande. tests/changes-browser.cjs kontrollerar benämning, avsaknad av kategorirubriker och layout på mobil/dator.
