# Schulplaner komplett auf Cloudflare (Website + Sync)

Alles läuft auf **Cloudflare Pages** – kostenlos, eine URL, kein Render, kein
„Aufwachen". Die Website sind statische Dateien; die WebUntis-Sync läuft als
**Pages Function** (Ordner `functions/`) auf derselben Adresse.

## Ordnerinhalt
```
index.html                         ← die Website (der Schulplaner)
privacy.html                       ← Datenschutzhinweis
functions/api/untis/[[path]].js    ← die WebUntis-Sync (läuft bei Cloudflare)
```
> Wichtig: Der Ordner `functions/` MUSS mit hochgeladen werden – daraus macht
> Cloudflare automatisch die Sync-Endpunkte `/api/untis/sync` und `/api/untis/schools`.

## In wenigen Schritten live
### Variante A – direkt hochladen (am schnellsten)
1. Diesen Ordner (`schulplaner-cloudflare`) als **ZIP** packen.
2. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets**.
3. Projektnamen vergeben (z. B. `schulplaner`), das ZIP hochladen → **Deploy**.
4. Du bekommst eine URL wie `https://schulplaner.pages.dev`. Fertig – Website
   und Sync laufen dort zusammen.

### Variante B – über GitHub (Updates deployen sich automatisch)
1. Ordnerinhalt in ein GitHub-Repo laden.
2. Cloudflare → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → Repo wählen.
3. Build-Einstellungen leer lassen (kein Framework, kein Build-Befehl,
   Output-Verzeichnis `/`). **Deploy**.

## Test
1. `https://…pages.dev/` öffnen → Reiter **Stundenplan**.
2. Schule suchen, Benutzername/Passwort, **Datenschutz-Häkchen**,
   **Jetzt synchronisieren**.
3. Es sollten kommen: **Fächer**, **Stundenplan**, **Prüfungen** und – falls die
   Schule sie über WebUntis freigibt – **Hausübungen**.

## Sicherheit
- Passwörter werden **einmal** benutzt und verworfen – nie gespeichert, nie geloggt.
- Nur `*.webuntis.com` wird angesprochen (kein SSRF); Anfragen sind größenbegrenzt.
- **Empfohlen:** in Cloudflare unter *Security → WAF → Rate limiting rules* eine
  Regel für den Pfad `/api/untis/sync` anlegen (z. B. max. 20 Anfragen / 5 Min
  pro IP), da einzelne Function-Aufrufe keinen gemeinsamen Speicher haben.
- Inoffizielles Projekt, nicht mit Untis verbunden. Datenschutzhinweis aktuell
  halten; bei Wunsch von Untis/Schule abschaltbar.

## Lokal weiterarbeiten
Zum lokalen Testen brauchst du `wrangler` (Cloudflares CLI, via Node):
`npx wrangler pages dev .` – dann läuft alles unter `http://localhost:8788/`.
(Für den reinen App-Test ohne Sync reicht weiterhin `start-planner.bat`.)
