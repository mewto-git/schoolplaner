# Schulplaner — Website + WebUntis-Sync auf Cloudflare

Alles läuft auf **Cloudflare Pages**: kostenlos, eine einzige URL, kein zweiter
Server. Die Website sind statische Dateien; die WebUntis-Synchronisierung läuft
als **Pages Function** (Ordner `functions/`) unter derselben Adresse.

Das Design folgt den Apple Human Interface Guidelines im **Liquid-Glass-Stil**
(iOS 26), aber zurückhaltend: der Untergrund ist eine fast neutrale Tönung, die
Flächen darüber sind durchscheinend statt glänzend, Farbe tragen nur Bedien-
elemente und Warnungen. SF-Schrift (Überschriften in der runden Variante),
System-Farben, Hell/Dunkel automatisch nach Systemeinstellung. Wer im System
„Transparenz reduzieren" aktiviert hat, bekommt automatisch deckende Flächen.
Symbole sind Strich-Symbole im Stil von SF Symbols, keine Emoji.

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
_worker.js                         ← die WebUntis-Sync für den Datei-Upload
apple-touch-icon.png               ← Symbol für „Zum Home-Bildschirm"
icons/                             ← App-Symbole 120–1024 px (+ Quelle als HTML)
functions/api/untis/[[path]].js    ← dieselbe Sync für Git/Wrangler-Deploys
tools/build-worker.py              ← erzeugt _worker.js aus der Function
```

## Warum es die Sync zweimal gibt

Cloudflare kennt zwei Wege, eigenen Code auf einer Pages-Seite auszuführen:

| Datei | wird gebaut bei | Datei-Upload im Dashboard |
|---|---|---|
| `functions/…` | Git-Anbindung, `wrangler pages deploy` | **nein** — der Ordner bleibt eine statische Datei |
| `_worker.js` | allen Wegen („Advanced mode") | **ja** |

Beim Drag-and-Drop-Upload im Dashboard wird `functions/` nicht kompiliert.
Die Seite lädt dann normal, aber `/api/untis/…` antwortet mit **404** — genau
das Symptom, wenn die Schulsuche nichts findet. Deshalb liegt dieselbe Sync
zusätzlich als `_worker.js` bei, und die versteht auch der reine Upload.

`_worker.js` hat Vorrang: ist die Datei da, ignoriert Cloudflare `functions/`.
Beide werden aus **einer** Quelle erzeugt, damit sie nicht auseinanderlaufen —
nach jeder Änderung an der Function einmal:

```
python3 tools/build-worker.py
```

**Selbsttest nach dem Deploy:** `https://…pages.dev/api/untis/health` im Browser
öffnen. Kommt dort JSON (`{"ok":true,…}`), läuft die Sync. Kommt die 404-Seite,
lief kein Code — dann prüfen, ob `_worker.js` wirklich **an der Wurzel** des
Uploads liegt (nicht in einem Unterordner) und ob das **ganze ZIP** hochgeladen
wurde, nicht einzelne Dateien.

### Variante C — mit Wrangler (funktioniert sicher)
Klappt der Dashboard-Upload nicht, geht dieser Weg immer. Er braucht Node
auf deinem Rechner:

```
cd schulplaner-cloudflare
npx wrangler pages deploy . --project-name schulplaner
```

Beim ersten Mal öffnet sich ein Browserfenster zum Anmelden. Wrangler lädt
alles hoch und baut dabei sowohl `_worker.js` als auch `functions/` mit.

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

## Schulsuche
Die Suche läuft über die Function, nicht über den Browser — WebUntis erlaubt
keine direkten Anfragen von fremden Seiten. Sie fragt nacheinander

1. `schoolsearch.webuntis.com/schoolquery2`
2. `mobile.webuntis.com/ms/schoolquery2`

und nimmt den ersten Dienst, der antwortet; jede Anfrage bricht nach 12 s ab.
Antwortet keiner, nennt die Fehlermeldung beide Dienste samt Statuscode, statt
nur „Serverfehler" zu sagen.

**Es geht auch ohne Suche:** In dasselbe Feld kannst du den Link deiner
WebUntis-Seite einfügen, etwa
`https://neilo.webuntis.com/WebUntis/?school=brg-linz#/basic/login`.
Server und Schul-Anmeldename werden daraus gelesen — ohne Netzaufruf. Beide
Felder lassen sich auch direkt ausfüllen; der Anmeldename steht in der
WebUntis-Adresse hinter `school=`.

## Test
1. `https://…pages.dev/` öffnen → Reiter **Stundenplan**.
2. Schule suchen (oder WebUntis-Link einfügen), Benutzername/Passwort,
   **Datenschutz-Häkchen**, **Jetzt synchronisieren**.
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
