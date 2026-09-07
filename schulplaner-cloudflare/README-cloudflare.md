# Schulplaner — Website + WebUntis-Sync auf Cloudflare

Alles läuft auf **Cloudflare Pages**: kostenlos, eine einzige URL, kein zweiter
Server. Die Website sind statische Dateien; die WebUntis-Synchronisierung läuft
als **Pages Function** (Ordner `functions/`) unter derselben Adresse.

Das Design folgt den Apple Human Interface Guidelines im **Liquid-Glass-Stil**
(iOS 26): der Inhalt liegt auf einem weichen Farbverlauf, alle Flächen darüber
sind durchscheinendes Glas mit Lichtsaum. SF-Schrift, System-Farben, Hell/Dunkel
automatisch nach Systemeinstellung. Wer im System „Transparenz reduzieren"
aktiviert hat, bekommt automatisch deckende Flächen.

Die App lässt sich am iPhone auf den Home-Bildschirm legen und öffnet mit einem
**„Heute"-Fokus**: Tagesverlauf mit Zeitachse und Markierung für „jetzt", darüber
die Planänderungen, darunter nur, was heute und morgen fällig ist. Die Zahlen-
Kacheln stehen in dem Reiter, zu dem sie gehören.

## Ordnerinhalt
```
index.html                         ← die Website (der Schulplaner)
privacy.html                       ← Datenschutzhinweis
manifest.webmanifest               ← macht die Seite installierbar
sw.js                              ← Service Worker (Offline-Start)
_headers                           ← Cache-Regeln (sw.js nie zwischenspeichern)
apple-touch-icon.png               ← Symbol für „Zum Home-Bildschirm"
icons/                             ← App-Symbole 120–1024 px (+ Quelle als HTML)
functions/api/untis/[[path]].js    ← die WebUntis-Sync (läuft bei Cloudflare)
```
> Wichtig: `functions/` MUSS mit hochgeladen werden — daraus macht Cloudflare
> automatisch die Endpunkte `/api/untis/sync` und `/api/untis/schools`.

## In wenigen Schritten live
### Variante A — direkt hochladen (am schnellsten)
1. Diesen Ordner (`schulplaner-cloudflare`) als **ZIP** packen.
2. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets**.
3. Projektnamen vergeben (z. B. `schulplaner`), das ZIP hochladen → **Deploy**.
4. Du bekommst eine URL wie `https://schulplaner.pages.dev`. Fertig — Website
   und Sync laufen dort zusammen.

### Variante B — über GitHub (Updates deployen sich automatisch)
1. Ordnerinhalt in ein GitHub-Repo laden.
2. Cloudflare → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → Repo wählen.
3. Build-Einstellungen leer lassen (kein Framework, kein Build-Befehl,
   Output-Verzeichnis `/`). **Deploy**.

## Am iPhone als App einrichten
1. Die Seite in **Safari** öffnen (nicht in Chrome — nur Safari darf das).
2. Unten auf **Teilen** → **Zum Home-Bildschirm**.
3. Ab jetzt startet der Schulplaner im Vollbild, ohne Safari-Leisten, mit
   eigenem Symbol — und **funktioniert offline**, weil der Service Worker die
   Programmdateien lokal behält.

### Erinnerungen
Die Erinnerungen sind **lokal**: Sie erscheinen, während die App offen ist bzw.
beim Öffnen (fällige Hausübungen, Prüfungen in den nächsten 2 Tagen, neue
Entfälle/Vertretungen). Es gibt bewusst keinen Push-Server.

Apple erlaubt Web-Benachrichtigungen **nur für Web-Apps am Home-Bildschirm**
(ab iOS 16.4). Wer sie in Safari antippt, bekommt deshalb eine Anleitung statt
einer Fehlermeldung.

## Was die Sync liefert
* **Fächer** samt WebUntis-Farbe, Hauptlehrer und Hauptraum
* **Stundenplan** der aktuellen Woche mit den echten Stundenzeiten
* **Prüfungen** bis zum Schuljahresende (werden als Prüfungen importiert)
* **Hausübungen**, falls die Schule sie über WebUntis freigibt
* **Entfall & Vertretungen** für zwei Wochen — inklusive „was hat sich seit dem
  letzten Sync geändert" (die App markiert das mit **NEU**) und Hinweisen wie
  „Du hast frei bis zur 3. Stunde".
* **Fehlzeiten** des laufenden Schuljahres, pro Fach aufgeschlüsselt, mit
  entschuldigt/offen und einer einstellbaren Warngrenze. Die Function versucht
  zuerst die offizielle JSON-RPC-Methode und danach den Weg, den die
  WebUntis-Website selbst nimmt; sperrt die Schule beides, bleibt der Bereich leer.

Dazu kommen zwei Dinge, die ohne WebUntis funktionieren:

* **Notenziel** — Zielschnitt pro Fach und die Rechnung, welche Note in der
  nächsten Prüfung (×1/×2/×3) noch reicht.
* **Notenverlauf & Semester** — Diagramm des gewichteten Schnitts über die Zeit
  und ein Umschalter für 1./2. Semester, Schuljahr oder alles. Der
  Semesterwechsel ist einstellbar (Standard 1. Februar), das Schuljahr läuft
  vom 1. September bis 31. August.

## Test
1. `https://…pages.dev/` öffnen → Reiter **Stundenplan**.
2. Schule suchen, Benutzername/Passwort, **Datenschutz-Häkchen**,
   **Jetzt synchronisieren**.
3. Es sollten kommen: **Fächer**, **Stundenplan** (mit Uhrzeiten, rot = entfällt,
   orange = Vertretung), **Prüfungen**, **Fehlstunden** und — falls freigegeben —
   **Hausübungen**.

## Sicherheit
- Passwörter werden **einmal** benutzt und verworfen — nie gespeichert, nie geloggt.
- Nur `*.webuntis.com` wird angesprochen (kein SSRF); Anfragen sind größenbegrenzt.
- Der Service Worker cacht `/api/*` **nicht** — Logins und Stundenpläne landen
  nie im Offline-Speicher.
- **Empfohlen:** in Cloudflare unter *Security → WAF → Rate limiting rules* eine
  Regel für den Pfad `/api/untis/sync` anlegen (z. B. max. 20 Anfragen / 5 Min
  pro IP), da einzelne Function-Aufrufe keinen gemeinsamen Speicher haben.
- Inoffizielles Projekt, nicht mit Untis verbunden. Datenschutzhinweis aktuell
  halten; bei Wunsch von Untis/Schule abschaltbar.

## Lokal weiterarbeiten
Zum lokalen Testen brauchst du `wrangler` (Cloudflares CLI, via Node):
`npx wrangler pages dev .` — dann läuft alles unter `http://localhost:8788/`.

Nach einem Deploy hält sich der Service Worker manchmal an die alte Version.
`_headers` setzt deshalb `Cache-Control: no-cache` für `sw.js` und `index.html`;
am Gerät hilft im Zweifel einmal die App vom Home-Bildschirm löschen und neu
hinzufügen.

## Symbole ändern
`icons/icon-source.html` ist die Vorlage (SVG in HTML). Anpassen und die PNGs
in den Größen 120/152/180/192/512/1024 neu exportieren — z. B. mit einem
Screenshot in genau dieser Fenstergröße oder einem SVG-Konverter. Danach
`apple-touch-icon.png` (180 px) mit austauschen.
