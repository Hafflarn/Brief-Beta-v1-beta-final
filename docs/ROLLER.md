# Roller, konton och företagsåtkomst

Admin, Platschef och Arbetsledare kan skapa konton i sitt eget företag, med namn, yrkesroll, telefon, e-post, låst systemroll och tilldelat lösenord. Admin kan tilldela alla systemroller; Platschef och Arbetsledare kan tilldela sin egen behörighetsnivå eller Arbetare. Befintliga regler för redigering av lägre rollers profiler behålls.

Platschef och Arbetsledare har samma behörighetsnivå. Platschef kan visas på antingen beställarnivån eller arbetsledningsnivån i organisationsschemat. Denna placering ändrar inte behörigheten.

Arbetsordrar tillhör ett fast företags-ID, hämtat från upprättaren. Alla läs-, skriv- och bilagevägar kontrollerar detta ID. Samma företag kan läsa företagets aktiva ordrar enligt befintliga rollregler; för skrivning krävs arbetsledning, tilldelning eller godkänt deltagande. Andra företags konton får ingen åtkomst, även efter en godkänd företagsförfrågan. Utförare och deltagare måste tillhöra orderns företag.

Användaren erbjuds lösenordsbyte vid första inloggningen. Byt senare avslutar första-inloggningspåminnelsen; Byt lösenord finns alltid under Ändra din profil. Lösenord uppdateras med användarens egen verifierade session. Öppen registrering saknas både i gränssnittet och i Auths skapandeflöde. Konton skapas av servern efter verifierad chefsbehörighet, med skyddad app_metadata. Om medlemsprofilen inte kan sparas återtas det nyss skapade Auth-kontot.

Mina kollegor visar endast det egna företagets profiler. Företag i Brief visar registrerade företags namn. Admin, Platschef och Arbetsledare kan begära ömsesidig kontaktåtkomst; en aktiv mottagare med samma systemroll måste svara. Båda parter informeras om att anställdas namn, telefon och e-post blir synliga. Godkännande ger kontaktåtkomst i båda riktningarna. Endera företaget kan avsluta åtkomsten. Detta ger aldrig åtkomst till arbetsordrar eller projektdagböcker.

Företags-ID används för behörigheter; det skrivna företagsnamnet används endast för visning. Befintliga profiler får företagskoppling vid migreringen. Organisationsschemat visar registrerade namn, roller och kontaktuppgifter utan rollreglage.
