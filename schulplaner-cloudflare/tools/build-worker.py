#!/usr/bin/env python3
"""
Erzeugt aus functions/api/untis/[[path]].js die beiden Fassungen für die
anderen Hosts:

  _worker.js                    → Cloudflare (Pages "Advanced mode" und
                                  Workers mit wrangler.jsonc)
  netlify/functions/untis.mjs   → Netlify

Warum beides?
  * functions/…  ist der normale Weg. Cloudflare baut den Ordner, wenn das
    Projekt über Git angebunden ist oder mit `wrangler pages deploy`
    hochgeladen wird.
  * _worker.js   ist der „Advanced mode". Diese Datei wird auch beim reinen
    Datei-Upload im Dashboard als Worker übernommen — dort wird der Ordner
    functions/ nämlich nicht kompiliert, und genau daher kommt der 404.

Damit die beiden nicht auseinanderlaufen, wird _worker.js immer aus der
Function erzeugt und nie von Hand bearbeitet.
"""
import io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "functions", "api", "untis", "[[path]].js")
OUT = os.path.join(ROOT, "_worker.js")
OUT_NETLIFY = os.path.join(ROOT, "netlify", "functions", "untis.mjs")

src = io.open(SRC, encoding="utf-8").read()

# Die beiden Einstiegspunkte werden hier lokal aufgerufen, nicht exportiert.
for name in ("onRequestPost", "onRequestGet"):
    marker = "export async function %s(" % name
    if src.count(marker) != 1:
        sys.exit("Erwartet genau ein '%s' in der Function." % marker)
    src = src.replace(marker, "async function %s(" % name)

router = '''

/* ------------------------------------------------------------------ *
 *  Pages „Advanced mode": diese Datei bedient das ganze Projekt.
 *  /api/untis/* geht an den Code oben, alles andere an die statischen
 *  Dateien (env.ASSETS).
 * ------------------------------------------------------------------ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/untis/")) {
      const ctx = { request };
      if (request.method === "POST") return onRequestPost(ctx);
      if (request.method === "GET") return onRequestGet(ctx);
      return new Response(
        JSON.stringify({ ok: false, error: "Diesen Endpunkt gibt es nur per POST." }),
        { status: 405, headers: { "content-type": "application/json; charset=utf-8", "allow": "POST, GET" } }
      );
    }
    return env.ASSETS.fetch(request);
  },
};
'''

netlify = '''

/* ------------------------------------------------------------------ *
 *  Netlify Functions (v2). Arbeitet wie Cloudflare mit Request und
 *  Response; die Pfade stehen unten in `config`, eine Umleitungsregel
 *  braucht es dadurch nicht.
 * ------------------------------------------------------------------ */
export default async (request) => {
  const ctx = { request };
  if (request.method === "POST") return onRequestPost(ctx);
  if (request.method === "GET") return onRequestGet(ctx);
  return new Response(
    JSON.stringify({ ok: false, error: "Diesen Endpunkt gibt es nur per POST." }),
    { status: 405, headers: { "content-type": "application/json; charset=utf-8", "allow": "POST, GET" } }
  );
};

export const config = {
  path: ["/api/untis/health", "/api/untis/schools", "/api/untis/sync"],
};
'''

header = ("/* AUTOMATISCH ERZEUGT aus functions/api/untis/[[path]].js — "
          "nicht von Hand bearbeiten.\n"
          "   Neu erzeugen mit:  python3 tools/build-worker.py           */\n")

io.open(OUT, "w", encoding="utf-8").write(header + src + router)
print("geschrieben:", os.path.relpath(OUT, ROOT), "(%d Bytes)" % os.path.getsize(OUT))

os.makedirs(os.path.dirname(OUT_NETLIFY), exist_ok=True)
io.open(OUT_NETLIFY, "w", encoding="utf-8").write(header + src + netlify)
print("geschrieben:", os.path.relpath(OUT_NETLIFY, ROOT), "(%d Bytes)" % os.path.getsize(OUT_NETLIFY))
