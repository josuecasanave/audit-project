#!/usr/bin/env node
/**
 * Tarjetas por lente: convierte estado.json en imágenes que se entienden solas.
 *
 *   lentes.html / lentes.png        hoja de contacto: todas las lentes, ordenadas por severidad,
 *                                   con el ancla arriba y la tarjeta de método al final.
 *   lente-<key>.html / .png         una tarjeta por lente, 16:9, lista para compartir.
 *
 * Determinista: no hay agentes acá. Todo sale de estado.json (que a su vez sale de detect.mjs
 * + los hallazgos ya confirmados). El PNG necesita un navegador; si no hay, deja los HTML y avisa.
 *
 * Diseño: cada lente tiene un ÍCONO propio (identidad) y el color de su tile sale de su peor
 * severidad (significado). Identidad por forma, estado por color: así ningún color de la hoja
 * quiere decir dos cosas distintas.
 *
 * Uso:
 *   node tarjetas.mjs <ruta-proyecto> [--lang es|en] [--out .audit] [--estado <estado.json>]
 *                     [--only <lente>] [--no-png] [--tema noche|claro] [--force]
 *
 * --lang solo cambia los textos de las tarjetas. Si no se pasa, hereda el idioma de estado.json.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const root = path.resolve(argv[0] && !argv[0].startsWith("--") ? argv[0] : ".");
const opt = (n, def) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const outDir = path.resolve(root, opt("--out", ".audit"));
const estadoPath = path.resolve(opt("--estado", path.join(outDir, "estado.json")));
const only = opt("--only", null);
const wantPng = !argv.includes("--no-png");
const force = argv.includes("--force");
const tema = opt("--tema", "noche");
let LANG = String(opt("--lang", "es")).toLowerCase().startsWith("en") ? "en" : "es";

if (!fs.existsSync(estadoPath)) {
  console.log(LANG === "en"
  ? `SKIP cards: could not find ${path.relative(root, estadoPath)} (run handoff.mjs first)`
  : `SKIP tarjetas: no encontré ${path.relative(root, estadoPath)} (corré handoff.mjs primero)`);
  process.exit(0);
}
let E;
try { E = JSON.parse(fs.readFileSync(estadoPath, "utf8")); }
catch (e) {
  console.log(`SKIP tarjetas/cards: ${path.relative(root, estadoPath)} no se puede leer o no es JSON valido (${e.message.split("\n")[0]}). Volve a correr handoff.mjs.`);
  process.exit(0);
}
if (!E || typeof E !== "object") { console.log("SKIP tarjetas/cards: estado.json no tiene la forma esperada."); process.exit(0); }
if (!argv.includes("--lang") && E.lang) LANG = String(E.lang).toLowerCase().startsWith("en") ? "en" : "es";
const EN = LANG === "en";
// Traduce solo prosa. Claves de lente, severidades de estado.json, rutas y comandos no se tocan.
const L = (es, en) => (EN ? en : es);

// ---------------------------------------------------------------- catálogo de lentes
// Tiene que coincidir con el de assets/workflows/auditar.js.
const I = {
  usuario: '<circle cx="12" cy="8.2" r="3.3"/><path d="M5.5 19.6c0-3.6 2.9-6.4 6.5-6.4s6.5 2.8 6.5 6.4"/>',
  escudo: '<path d="M12 3.4 19 6.4v5.1c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.4Z"/><path d="m9 12 2.2 2.2 4.3-4.6"/>',
  codigo: '<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/>',
  candado: '<rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.2"/><path d="M8.4 10.4V7.9a3.6 3.6 0 0 1 7.2 0v2.5"/>',
  globo: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.2 2.4 3.3 5.1 3.3 8.2s-1.1 5.8-3.3 8.2c-2.2-2.4-3.3-5.1-3.3-8.2S9.8 6.2 12 3.8Z"/>',
  cubo: '<path d="M12 3.4 19.8 8v8L12 20.6 4.2 16V8Z"/><path d="M4.2 8 12 12.6 19.8 8"/><path d="M12 12.6v8"/>',
  alerta: '<path d="M12 4.4 21 20H3Z"/><path d="M12 10.2v4.4"/><circle cx="12" cy="17.4" r=".95" fill="currentColor" stroke="none"/>',
  check: '<circle cx="12" cy="12" r="8.2"/><path d="m8.2 12.2 2.7 2.7 4.9-5.4"/>',
  base: '<ellipse cx="12" cy="6.6" rx="7" ry="3.1"/><path d="M5 6.6v10.8c0 1.7 3.1 3.1 7 3.1s7-1.4 7-3.1V6.6"/><path d="M5 12c0 1.7 3.1 3.1 7 3.1s7-1.4 7-3.1"/>',
  pulso: '<path d="M3 12h3.8l2.6-6.2 5.2 12.4 2.5-6.2H21"/>',
  megafono: '<path d="M5 10.2v3.6h3l7.2 4.4V5.8L8 10.2Z"/><path d="M18.4 9.4a4.2 4.2 0 0 1 0 5.2"/>',
  flujo: '<circle cx="6" cy="7" r="2.4"/><circle cx="6" cy="17.4" r="2.4"/><circle cx="18" cy="12.2" r="2.4"/><path d="M8.4 7h3.4a3.7 3.7 0 0 1 3.7 3.7v.3"/><path d="M8.4 17.4h3.4a3.7 3.7 0 0 0 3.7-3.7v-.3"/>',
  fuga: '<path d="M13.8 4.6h4.4a1.7 1.7 0 0 1 1.7 1.7v11.4a1.7 1.7 0 0 1-1.7 1.7h-4.4"/><path d="m8.8 15.6 3.6-3.6-3.6-3.6"/><path d="M12.4 12H3.7"/>',
  eslabon: '<path d="M10.1 13.8a3.7 3.7 0 0 0 5.5.4l2.2-2.2a3.7 3.7 0 0 0-5.2-5.2l-1.3 1.2"/><path d="M13.9 10.2a3.7 3.7 0 0 0-5.5-.4l-2.2 2.2a3.7 3.7 0 0 0 5.2 5.2l1.2-1.2"/>',
};
const CAT = {
  authn:         { n: "AUTENTICACIÓN", i: I.usuario, t: "Sesiones, tokens, fuerza bruta, contraseñas", g: "riesgo",
                   m: "cómo se loguea la gente · dónde viven las sesiones · expiración y logout · enumeración de usuarios · rate limit · hash de contraseñas" },
  authz:         { n: "AUTORIZACIÓN", i: I.escudo, t: "IDOR, roles, multi-tenant, acciones peligrosas", g: "riesgo",
                   m: "¿cada endpoint verifica que el usuario puede tocar ESE recurso? · filtro por organización · roles centralizados · superadmin chequeado en el servidor" },
  input:         { n: "ENTRADA", i: I.codigo, t: "Validación, inyección, XSS, SSRF, uploads", g: "riesgo",
                   m: "validación de body y query · SQL crudo · XSS · SSRF · path traversal · límites de tamaño y tipo" },
  secrets:       { n: "SECRETOS", i: I.candado, t: "Secretos y configuración", g: "riesgo",
                   m: "keys hardcodeadas · .env en el árbol · variables públicas · código de servidor en el cliente · logs con tokens · CORS · debug en prod" },
  http:          { n: "HTTP", i: I.globo, t: "Headers, CSRF, cookies, rate limit, webhooks", g: "riesgo",
                   m: "CSP y HSTS · CSRF y SameSite · cookies · redirects abiertos · rate limit · webhooks firmados · URLs prefirmadas" },
  deps:          { n: "DEPENDENCIAS", i: I.cubo, t: "Lockfile, versiones, audit en CI, runtime, Docker", g: "riesgo",
                   m: "lockfile · versiones viejas · audit en CI · runtime fijado · imágenes Docker · scripts postinstall" },
  errors:        { n: "ERRORES", i: I.alerta, t: "Errores tragados, timeouts, transacciones, idempotencia", g: "riesgo",
                   m: "catch mudos · promesas sin await · 500 con stack · timeouts en llamadas externas · transacciones · idempotencia en pagos y jobs" },
  quality:       { n: "CALIDAD", i: I.check, t: "Tests, CI, tipado, deuda, documentación", g: "riesgo",
                   m: "tests de lo crítico · CI que los corre · tipado · límites del monorepo · README y AGENTS.md contra la realidad" },
  "plat-core":   { n: "PLATAFORMA · NÚCLEO", i: I.base, t: "auth · pagos · database · API · storage · IA", g: "plataforma",
                   m: "¿la pieza existe, está cableada de punta a punta y configurada?" },
  "plat-ops":    { n: "PLATAFORMA · OPERACIÓN", i: I.pulso, t: "mail · jobs y cron · notificaciones · monitoring · E2E · dev offline · deploy", g: "plataforma",
                   m: "lo que sostiene producción: ¿está puesto y funcionando?" },
  logica:        { n: "LÓGICA DE NEGOCIO", i: I.flujo, t: "Máquinas de estado, carreras, números, tiempo, defaults", g: "profundo",
                   m: "saltear pasos o repetir flujos · doble gasto y doble aprobación · negativos y overflow · expiraciones y clock skew · qué postura queda cuando falta config" },
  abuso:         { n: "ABUSO DE FEATURES", i: I.fuga, t: "Export, import, búsqueda como oráculo, previews, webhooks", g: "profundo",
                   m: "export que se lleva datos de más · import que saltea validación · filtros que revelan lo inaccesible · borradores que aparecen en el sitemap · webhooks con URL del usuario" },
  cadena:        { n: "CADENAS DE ATAQUE", i: I.eslabon, t: "Hallazgos chicos que combinados dan uno grave", g: "profundo",
                   m: "compone los hallazgos ya confirmados · una cadena vale solo si es más grave que su peor eslabón" },
  "plat-growth": { n: "PLATAFORMA · MARKETING", i: I.megafono, t: "blog · docs · SEO · legales · contacto · analytics · i18n · onboarding · admin · UI", g: "plataforma",
                   m: "marketing, contenido y administración: ¿está y tiene contenido real?" },
};
// Overlay en ingles: mismas claves de lente, misma forma, solo la prosa cambia.
const CAT_EN = {
  authn:         { n: "AUTHENTICATION", t: "Sessions, tokens, brute force, passwords", g: "risk",
                   m: "how people log in · where sessions live · expiry and logout · user enumeration · rate limit · password hashing" },
  authz:         { n: "AUTHORIZATION", t: "IDOR, roles, multi-tenant, dangerous actions", g: "risk",
                   m: "does every endpoint check the user may touch THAT resource? · filtering by organization · centralized roles · superadmin checked on the server" },
  input:         { n: "INPUT", t: "Validation, injection, XSS, SSRF, uploads", g: "risk",
                   m: "body and query validation · raw SQL · XSS · SSRF · path traversal · size and type limits" },
  secrets:       { n: "SECRETS", t: "Secrets and configuration", g: "risk",
                   m: "hardcoded keys · .env in the tree · public variables · server code on the client · logs with tokens · CORS · debug in prod" },
  http:          { n: "HTTP", t: "Headers, CSRF, cookies, rate limit, webhooks", g: "risk",
                   m: "CSP and HSTS · CSRF and SameSite · cookies · open redirects · rate limit · signed webhooks · presigned URLs" },
  deps:          { n: "DEPENDENCIES", t: "Lockfile, versions, audit in CI, runtime, Docker", g: "risk",
                   m: "lockfile · stale versions · audit in CI · pinned runtime · Docker images · postinstall scripts" },
  errors:        { n: "ERRORS", t: "Swallowed errors, timeouts, transactions, idempotency", g: "risk",
                   m: "silent catches · un-awaited promises · 500s with stack traces · timeouts on external calls · transactions · idempotency in payments and jobs" },
  quality:       { n: "QUALITY", t: "Tests, CI, typing, debt, documentation", g: "risk",
                   m: "tests for what matters · CI that runs them · typing · monorepo boundaries · README and AGENTS.md against reality" },
  "plat-core":   { n: "PLATFORM · CORE", t: "auth · payments · database · API · storage · AI", g: "platform",
                   m: "does the piece exist, is it wired end to end, and is it configured?" },
  "plat-ops":    { n: "PLATFORM · OPERATIONS", t: "mail · jobs and cron · notifications · monitoring · E2E · offline dev · deploy", g: "platform",
                   m: "what keeps production up: is it in place and working?" },
  "plat-growth": { n: "PLATFORM · MARKETING", t: "blog · docs · SEO · legal · contact · analytics · i18n · onboarding · admin · UI", g: "platform",
                   m: "marketing, content and administration: is it there and does it hold real content?" },
  logica:        { n: "BUSINESS LOGIC", t: "State machines, races, numbers, time, defaults", g: "deep",
                   m: "skipping steps or replaying flows · double spend and double approval · negatives and overflow · expiry and clock skew · what posture is left when config is missing" },
  abuso:         { n: "FEATURE ABUSE", t: "Export, import, search as an oracle, previews, webhooks", g: "deep",
                   m: "export that takes too much · import that skips validation · filters that reveal the inaccessible · drafts in the sitemap · webhooks with a user-supplied URL" },
  cadena:        { n: "ATTACK CHAINS", t: "Small findings that combine into a serious one", g: "deep",
                   m: "composes already-confirmed findings · a chain counts only if it is worse than its worst link" },
};
if (EN) for (const [k, v] of Object.entries(CAT_EN)) if (CAT[k]) Object.assign(CAT[k], v);

// ---------------------------------------------------------------- paleta
// Superficie navy verificada: los cuatro colores de estado pasan 3:1 sobre #131a2a.
const T = tema === "claro"
  ? { BG: "radial-gradient(1100px 620px at 18% -12%, #ffffff, #f2f2ef)", SURF: "#ffffff", SURF2: "#f6f6f3",
      INK: "#0b0b0b", INK2: "#43423f", MUTED: "#6f6e69", HAIR: "rgba(11,11,11,.10)", RING: "rgba(11,11,11,.06)" }
  : { BG: "radial-gradient(1100px 620px at 18% -12%, #18213a, #080b14)", SURF: "#131a2a", SURF2: "#161e30",
      INK: "#ffffff", INK2: "#c2c9da", MUTED: "#8d95a8", HAIR: "rgba(255,255,255,.09)", RING: "rgba(255,255,255,.05)" };
const SEV = {
  critica: { c: "#d03b3b", l: L("crítica", "critical") }, alta: { c: "#ec835a", l: L("alta", "high") },
  media: { c: "#fab219", l: L("media", "medium") }, baja: { c: "#9aa4bd", l: L("baja", "low") },
};
const GOOD = "#0ca30c";
const ORDER = ["critica", "alta", "media", "baja"];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ---------------------------------------------------------------- agrupar por lente
const pend = E.pendientes ?? [];
const desc = E.descartados ?? [];
const claves = [...new Set([...pend, ...desc].map((f) => f.lens).filter(Boolean))];
if (!claves.length) {
  console.log(L("SKIP tarjetas: los hallazgos no traen el campo 'lens' (informe viejo). Volvé a correr la auditoría.",
                "SKIP cards: findings carry no 'lens' field (old report). Run the audit again."));
  process.exit(0);
}
const lente = (k) => {
  const c = CAT[k] ?? { n: k.toUpperCase(), i: I.check, t: "", g: "riesgo", m: "" };
  const hs = pend.filter((f) => f.lens === k);
  const conteo = ORDER.reduce((o, s) => ({ ...o, [s]: hs.filter((f) => f.severity === s).length }), {});
  return { key: k, ...c, hallazgos: hs, conteo, total: hs.length, descartados: desc.filter((f) => f.lens === k).length };
};
const peso = (l) => l.conteo.critica * 1000 + l.conteo.alta * 100 + l.conteo.media * 10 + l.conteo.baja;
const peor = (l) => ORDER.find((s) => l.conteo[s] > 0) ?? "baja";
const LENTES = [...Object.keys(CAT).filter((k) => claves.includes(k)), ...claves.filter((k) => !CAT[k])]
  .map(lente).sort((a, b) => peso(b) - peso(a));

const st = E.stack ?? {};
const STACK = [...new Set([...(st.frameworks ?? []), ...(st.languages ?? []).slice(0, 1), ...(st.orm ?? []),
  ...(st.db ?? []), ...(st.auth ?? []), ...(st.payments ?? [])])].slice(0, 6).join(" · ")
  + (E.estructura?.monorepo ? ` · monorepo ${E.estructura.monorepo.packages} paquetes` : "");
const MONO = String(E.proyecto ?? "??").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toLowerCase() || "au";
const GLOBAL = ORDER.reduce((o, s) => ({ ...o, [s]: pend.filter((f) => f.severity === s).length }), {});
const SUMA = pend.length, DESC = desc.length;

// ---------------------------------------------------------------- piezas
// Dona: parte-sobre-todo de un vistazo, 4 segmentos, con los números al lado. Nunca sola.
const dona = (conteo, r = 46, w = 15) => {
  const C = 2 * Math.PI * r, tot = ORDER.reduce((a, s) => a + conteo[s], 0) || 1;
  const gap = 3; let off = 0;
  const arcos = ORDER.filter((s) => conteo[s] > 0).map((s) => {
    const largo = Math.max((conteo[s] / tot) * C - gap, 1);
    const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${SEV[s].c}" stroke-width="${w}"
      stroke-dasharray="${largo} ${C - largo}" stroke-dashoffset="${-off}" stroke-linecap="butt"/>`;
    off += (conteo[s] / tot) * C; return el;
  }).join("");
  return `<svg class="dona" viewBox="0 0 120 120" width="120" height="120">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${T.RING}" stroke-width="${w}"/>
    <g transform="rotate(-90 60 60)">${arcos}</g></svg>`;
};

// Conteos: punto + número + palabra. El color nunca carga el significado solo.
const conteos = (conteo, cls = "") => `<div class="conteo ${cls}">` + ORDER.map((s) =>
  `<span class="c ${conteo[s] ? "" : "cero"}"><i style="background:${SEV[s].c}"></i><b>${conteo[s]}</b><em>${SEV[s].l}</em></span>`
).join("") + `</div>`;

const loc = (f) => `${f.file ?? ""}${f.line ? ":" + f.line : ""}`;
const item = (f, detalle) => {
  const c = SEV[f.severity]?.c ?? SEV.baja.c;
  return `<li class="h" style="--sev:${c}">
    <div class="hb">
      <p class="ht">${esc(f.title)}</p>
      <p class="hl">${esc(loc(f))}</p>
      ${detalle && f.why ? `<p class="hd">${esc(f.why)}</p>` : ""}
    </div>
    <span class="hsev">${SEV[f.severity]?.l ?? esc(f.severity)}</span>
  </li>`;
};

const icono = (d, c) => `<span class="tile" style="--tint:${c}"><svg viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`;

const tarjeta = (l) => {
  const c = SEV[peor(l)].c;
  return `<section class="card" style="--sev:${c}">
    <div class="cbody">
      <header>
        ${icono(l.i, c)}
        <div class="ctit"><p class="kicker">${esc(l.n)}</p><span class="tag">${esc(l.g)}</span></div>
        <div class="cnum"><b>${l.total}</b><em>${l.total ? SEV[peor(l)].l + L(" máx.", " max") : L("sin hallazgos", "no findings")}</em></div>
      </header>
      <p class="mira">${esc(l.t)}</p>
      ${conteos(l.conteo)}
      <ul class="lista">${l.hallazgos.slice(0, 3).map((f) => item(f, false)).join("")}</ul>
      ${l.total > 3 || l.descartados ? `<p class="pie">${[
        l.total > 3 ? L(`+${l.total - 3} más en PENDIENTES.md`, `+${l.total - 3} more in TODO.md`) : null,
        l.descartados ? L(`${l.descartados} descartado${l.descartados > 1 ? "s" : ""} por el verificador`, `${l.descartados} dropped by the verifier`) : null,
      ].filter(Boolean).join(" · ")}</p>` : ""}
    </div>
  </section>`;
};

const metodo = `
<section class="card metodo" style="--sev:${T.MUTED}"><div class="cbody">
  <p class="kicker">${L("CÓMO SE LEYÓ ESTO", "HOW THIS WAS READ")}</p>
  <ol class="pasos">
    <li><span>1</span><div><b>${L("Detección determinista", "Deterministic detection")}</b><p>${L("Un script mapea el stack, no un agente.", "A script maps the stack, not an agent.")}</p></div></li>
    <li><span>2</span><div><b>${LENTES.length} ${L("lentes en paralelo", "lenses in parallel")}</b><p>${L("Cada una con su propio contexto, mirando una cosa.", "Each with its own context, looking at one thing.")}</p></div></li>
    <li><span>3</span><div><b>${L("Un escéptico por hallazgo", "One skeptic per finding")}</b><p>${L(`Contexto limpio, abre el archivo e intenta refutarlo. Tiró ${DESC}.`, `Clean context, opens the file and tries to refute it. Dropped ${DESC}.`)}</p></div></li>
    <li><span>4</span><div><b>${L("Un ancla que ejecuta", "An anchor that executes")}</b><p>${L("Los comandos del propio repo. Lo único que no es opinión.", "The repo's own commands. The only part that is not opinion.")}</p></div></li>
  </ol>
  <div class="nota"><p class="lk">${L("LO QUE NO REVISAMOS", "OUT OF SCOPE")}</p>
    <p>${L(`Análisis estático más la suite del repo. No corrimos la app con datos reales ni tocamos
    infraestructura: DNS, certificados, backups, permisos de nube ni las cuentas de los proveedores.`,
    `Static analysis plus the repo's own suite. We did not run the app with real data and did not touch
    infrastructure: DNS, certificates, backups, cloud permissions or the provider accounts.`)}</p></div>
  <div class="leyenda"><p class="lk">${L("SEVERIDAD", "SEVERITY")}</p>
    ${ORDER.map((s) => `<span class="lg"><i style="background:${SEV[s].c}"></i>${SEV[s].l}</span>`).join("")}</div>
</div></section>`;

const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const CRUZ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
const chips = (E.salud ?? []).filter((l) => /^(PASS|FAIL|WARN|SKIP)\b/.test(l)).slice(0, 8).map((l) => {
  // Con "·" la linea trae comando; sin "·" (SKIP/WARN sueltos) todo lo que sigue es la nota, y
  // cortarla en la primera palabra dejaba chips ilegibles del tipo "SKIP sin".
  const m = l.match(/^(\w+)\s+(\S+)[^·]*·\s*(.*)$/);
  const libre = l.match(/^(\w+)\s+(.*)$/) ?? [];
  const est = (m ? m[1] : libre[1]) ?? "?";
  const k = m ? m[2] : "";
  const nota = ((m ? m[3] : libre[2]) ?? "").split("\n")[0].slice(0, 52);
  const ok = est === "PASS";
  const col = ok ? GOOD : est === "FAIL" ? SEV.critica.c : SEV.media.c;
  return `<span class="chip" style="--tint:${col}"><i>${ok ? TICK : CRUZ}</i><b>${esc(est)}</b><code>${esc(k)}</code><em>${esc(nota)}</em></span>`;
}).join("");

const cabecera = `
<header class="top">
  <div class="marca">
    <span class="logo">${esc(MONO)}</span>
    <div><p class="eyebrow">${L("AUDITORÍA DE PROYECTO", "PROJECT AUDIT")}</p>
      <h1>${esc(E.proyecto)}</h1>
      <p class="stack">${esc(STACK)}</p></div>
  </div>
  <div class="panel resumen">
    <div class="rn"><b>${SUMA}</b><em>${L("HALLAZGOS CONFIRMADOS", "CONFIRMED FINDINGS")}</em></div>
    ${dona(GLOBAL)}
    <div class="rleg">${ORDER.map((s) =>
      `<span><i style="background:${SEV[s].c}"></i><b>${GLOBAL[s]}</b><em>${SEV[s].l}</em></span>`).join("")}</div>
  </div>
</header>
${chips ? `<div class="panel ancla">
  <p class="lk"><span class="dot"></span>${L("LO QUE CORRIÓ DE VERDAD", "WHAT ACTUALLY RAN")}</p>
  <div class="chips">${chips}</div>
  <p class="anota">${L("El detalle completo del run está en <code>PENDIENTES.md</code> y <code>estado.json</code>.", "The full run detail is in <code>TODO.md</code> and <code>estado.json</code>.")}</p>
</div>` : ""}`;

const pie = `<footer class="bot">
  <span>${esc(E.fecha)} · ${LENTES.length} ${L("lentes", "lenses")} · ${SUMA} ${L("confirmados", "confirmed")} · ${DESC} ${L("descartados por el verificador", "dropped by the verifier")}</span>
  <span class="brand">audit-project</span></footer>`;

const CSS = `
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:${T.INK}}
.hoja{width:1760px;padding:52px;background:${T.BG};display:flex;flex-direction:column;gap:26px}
.kicker{font-size:13px;letter-spacing:.13em;font-weight:700;color:${T.INK}}
.lk{font-size:11.5px;letter-spacing:.16em;font-weight:700;color:${T.INK2};display:flex;align-items:center;gap:9px}
.dot{width:8px;height:8px;border-radius:99px;background:${GOOD};display:block}
.brand{font-size:13px;color:${T.MUTED};letter-spacing:.03em}
.panel{background:${T.SURF};border:1px solid ${T.HAIR};border-radius:20px}

/* cabecera */
.top{display:flex;justify-content:space-between;align-items:center;gap:48px}
.marca{display:flex;align-items:center;gap:22px}
.logo{width:76px;height:76px;border-radius:20px;flex:none;display:flex;align-items:center;justify-content:center;
  font-size:30px;font-weight:700;letter-spacing:-.02em;color:#fff;
  background:linear-gradient(145deg,#5b6ef5,#3b3fb8);box-shadow:0 10px 30px rgba(66,80,220,.28)}
.eyebrow{font-size:11.5px;letter-spacing:.2em;font-weight:700;color:${T.MUTED}}
.top h1{font-size:46px;font-weight:650;letter-spacing:-.03em;margin:6px 0 4px}
.stack{color:${T.INK2};font-size:15px}
.resumen{flex:none;display:flex;align-items:center;gap:34px;padding:24px 36px}
.rn{text-align:right}
.rn b{font-size:56px;font-weight:650;letter-spacing:-.035em;line-height:1;display:block}
.rn em{font-style:normal;font-size:11px;letter-spacing:.13em;font-weight:700;color:${T.MUTED};display:block;margin-top:8px}
.dona{display:block;flex:none}
.rleg{display:flex;flex-direction:column;gap:9px}
.rleg span{display:flex;align-items:center;gap:9px}
.rleg i{width:9px;height:9px;border-radius:99px;display:block;flex:none}
.rleg b{font-size:16px;font-weight:650;min-width:22px;text-align:right}
.rleg em{font-style:normal;font-size:13.5px;color:${T.INK2}}

/* ancla */
.ancla{padding:22px 26px;display:flex;flex-direction:column;gap:15px}
.chips{display:flex;gap:11px;flex-wrap:wrap}
.chip{display:flex;align-items:center;gap:9px;background:${T.SURF2};border:1px solid ${T.HAIR};
  border-radius:12px;padding:11px 17px 11px 13px}
.chip i{width:17px;height:17px;flex:none;color:var(--tint);display:block}
.chip i svg{width:100%;height:100%;display:block}
.chip b{font-size:12px;letter-spacing:.08em;font-weight:700;color:${T.INK}}
.chip code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:${T.INK}}
.chip em{font-style:normal;font-size:12.5px;color:${T.MUTED}}
.anota{font-size:12.5px;color:${T.MUTED}}
.anota code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${T.INK2}}

/* tarjetas */
.grid{columns:3;column-gap:20px}
.card{position:relative;border-radius:20px;break-inside:avoid;margin-bottom:20px;width:100%;overflow:hidden;
  background:
    radial-gradient(300px 150px at 8% 0%, color-mix(in srgb, var(--sev) 24%, transparent), transparent 72%),
    radial-gradient(700px 300px at 0% 0%, color-mix(in srgb, var(--sev) 9%, transparent), transparent 68%),
    ${T.SURF};
  border:1px solid color-mix(in srgb, var(--sev) 18%, ${T.HAIR});
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.card::before{content:"";position:absolute;inset:0 0 auto 0;height:2.5px;
  background:linear-gradient(90deg, var(--sev), color-mix(in srgb, var(--sev) 30%, transparent) 45%, transparent 70%);
  box-shadow:0 0 26px 2px color-mix(in srgb, var(--sev) 32%, transparent)}
.cbody{padding:24px 26px 22px;display:flex;flex-direction:column;gap:14px}
.card header{display:flex;align-items:center;gap:14px}
.tile{width:46px;height:46px;border-radius:14px;flex:none;display:flex;align-items:center;justify-content:center;
  color:var(--tint);background:color-mix(in srgb, var(--tint) 16%, transparent);
  border:1px solid color-mix(in srgb, var(--tint) 34%, transparent);
  box-shadow:0 6px 18px color-mix(in srgb, var(--tint) 16%, transparent)}
.tile svg{width:23px;height:23px;display:block}
.ctit{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.tag{font-size:10px;letter-spacing:.1em;font-weight:700;text-transform:uppercase;padding:3px 8px;
  border-radius:6px;color:${T.MUTED};background:${T.SURF2};border:1px solid ${T.HAIR}}
.cnum{text-align:right;flex:none}
.cnum b{font-size:30px;font-weight:650;letter-spacing:-.025em;line-height:1;display:block}
.cnum em{font-style:normal;font-size:11px;color:var(--sev);font-weight:600;display:block;margin-top:4px}
.mira{font-size:13px;color:${T.MUTED};line-height:1.45}
.conteo{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.conteo .c{display:flex;align-items:center;gap:7px}
.conteo i{width:9px;height:9px;border-radius:99px;display:block;flex:none}
.conteo b{font-size:16px;font-weight:650;color:${T.INK}}
.conteo em{font-style:normal;font-size:12.5px;color:${T.INK2}}
.conteo .cero{opacity:.34}
.lista{list-style:none;padding:0;display:flex;flex-direction:column;gap:9px}
.h{display:flex;gap:14px;align-items:flex-start;padding:13px 15px;border-radius:12px;
  background:${T.SURF2};border-left:3px solid var(--sev)}
.hb{flex:1;min-width:0}
.ht{font-size:14.5px;line-height:1.35;color:${T.INK};font-weight:500}
.hl{font-size:11.5px;color:${T.MUTED};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:5px;word-break:break-all}
.hd{font-size:13px;color:${T.INK2};line-height:1.5;margin-top:8px}
.hsev{font-size:11px;font-weight:700;flex:none;padding-top:2px;color:var(--sev)}
.pie{font-size:12px;color:${T.MUTED};padding-top:4px}

/* método */
.metodo{background:${T.SURF2}}
.pasos{list-style:none;padding:0;display:flex;flex-direction:column;gap:15px;margin-top:3px}
.pasos li{display:flex;gap:13px;align-items:flex-start}
.pasos span{width:23px;height:23px;border-radius:99px;border:1px solid ${T.HAIR};flex:none;display:flex;
  align-items:center;justify-content:center;font-size:11.5px;font-weight:700;color:${T.INK2}}
.pasos b{font-size:14px;font-weight:600;display:block}
.pasos p{font-size:12.5px;color:${T.MUTED};line-height:1.4;margin-top:3px}
.nota{border-top:1px solid ${T.HAIR};padding-top:15px;margin-top:4px}
.nota p:last-child{font-size:12.5px;color:${T.MUTED};line-height:1.55;margin-top:8px}
.leyenda{padding-top:16px;border-top:1px solid ${T.HAIR};display:flex;align-items:center;gap:15px;flex-wrap:wrap}
.lg{display:flex;align-items:center;gap:6px;font-size:12px;color:${T.INK2}}
.lg i{width:9px;height:9px;border-radius:99px;display:block}
.bot{display:flex;justify-content:space-between;padding-top:6px;font-size:13px;color:${T.MUTED}}

/* tarjeta individual 16:9 */
.solo{width:1600px;height:900px;padding:56px 60px 46px;background:${T.BG};display:flex;flex-direction:column;gap:26px}
.solo .sh{display:flex;justify-content:space-between;align-items:flex-start;gap:48px}
.solo .sl{display:flex;gap:20px;align-items:flex-start}
.solo .tile{width:62px;height:62px;border-radius:18px}
.solo .tile svg{width:30px;height:30px}
.solo h1{font-size:40px;font-weight:650;letter-spacing:-.025em;margin:8px 0 12px}
.solo .mira{font-size:16px;color:${T.INK2};max-width:920px;line-height:1.5}
.solo .meta{text-align:right;flex:none}
.solo .meta b{font-size:26px;font-weight:650;display:block}
.solo .meta p{font-size:13.5px;color:${T.MUTED};margin-top:5px}
.solo .conteo{gap:26px}
.solo .conteo i{width:12px;height:12px}
.solo .conteo b{font-size:34px;font-weight:640;letter-spacing:-.02em}
.solo .conteo em{font-size:15px}
.solo .lista{flex:1;justify-content:center;gap:14px}
.solo .h{padding:20px 22px;border-left-width:4px}
.solo .ht{font-size:18px;font-weight:520}
.solo .hl{font-size:13.5px}
.solo .hsev{font-size:12.5px}
.solo footer{display:flex;justify-content:space-between;border-top:1px solid ${T.HAIR};padding-top:18px;font-size:14px;color:${T.INK2}}
`;

const page = (id, cls, body) => `<style>${CSS}</style><body style="background:${T.BG}"><section id="${id}" class="${cls}">${body}</section></body>`;
const hojaHtml = page("hoja", "hoja", `${cabecera}<div class="grid">${LENTES.map(tarjeta).join("")}${metodo}</div>${pie}`);
const soloHtml = (l) => {
  const c = SEV[peor(l)].c;
  return page("solo", "solo", `
  <div class="sh" style="--sev:${c}">
    <div class="sl">${icono(l.i, c)}
      <div><p class="kicker">${L("LENTE", "LENS")} ${esc(l.n)}</p><h1>${esc(l.t)}</h1><p class="mira">${esc(l.m)}</p></div></div>
    <div class="meta"><b>${esc(E.proyecto)}</b><p>${esc(STACK)}</p><p>${esc(E.fecha)}</p></div>
  </div>
  ${conteos(l.conteo)}
  <ul class="lista">${l.hallazgos.slice(0, 3).map((f) => item(f, true)).join("")}</ul>
  <footer><span>${L(`${l.total} confirmado${l.total === 1 ? "" : "s"}`, `${l.total} confirmed`)}${l.descartados ? L(` · ${l.descartados} descartado${l.descartados > 1 ? "s" : ""} por el verificador escéptico`, ` · ${l.descartados} dropped by the skeptical verifier`) : ""}</span>
    <span class="brand">audit-project</span></footer>`);
};

// ---------------------------------------------------------------- escribir
const dir = path.join(outDir, "tarjetas");
fs.mkdirSync(dir, { recursive: true });
const escritos = [], omitidos = [];
const write = (name, content) => {
  const p = path.join(dir, name);
  if (fs.existsSync(p) && !force) { omitidos.push(name); return; }
  fs.writeFileSync(p, content, "utf8"); escritos.push(name);
};

const objetivo = only ? LENTES.filter((l) => l.key === only) : LENTES;
if (only && !objetivo.length) { console.log(L(`SKIP tarjetas: no hay una lente "${only}" en estado.json`, `SKIP cards: there is no "${only}" lens in estado.json`)); process.exit(0); }

const trabajos = [];
if (!only) trabajos.push({ sel: "#hoja", html: hojaHtml, base: "lentes" });
for (const l of objetivo) trabajos.push({ sel: "#solo", html: soloHtml(l), base: `lente-${l.key}` });
for (const t of trabajos) write(`${t.base}.html`, t.html);

// ---------------------------------------------------------------- PNG (opcional)
function cargarChromium() {
  const req = createRequire(import.meta.url);
  const c = [];
  for (const id of ["playwright", "playwright-core"]) { try { c.push(req(id)); } catch {} }
  for (const raiz of [process.env.NPM_CONFIG_PREFIX, "/usr/lib/node_modules", "/usr/local/lib/node_modules",
    path.join(process.env.HOME ?? "", ".npm-global/lib/node_modules")]) {
    if (!raiz) continue;
    for (const n of ["playwright", "playwright-core"]) { try { c.push(req(path.join(raiz, n))); } catch {} }
  }
  return c.find((x) => x?.chromium)?.chromium ?? null;
}
function buscarChrome() {
  for (const b of [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"].filter(Boolean)) {
    let dirs = [];
    try { dirs = fs.readdirSync(b).filter((d) => d.startsWith("chromium")); } catch { continue; }
    for (const d of dirs) for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const p = path.join(b, d, rel); if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

let pngs = 0;
if (wantPng && trabajos.length) {
  const chromium = cargarChromium();
  if (!chromium) {
    console.log(L("WARN sin playwright instalado: dejo los HTML (abrilos y exportá a imagen)",
                  "WARN playwright not installed: leaving the HTML files (open them and export to image)"));
  } else {
    const exe = buscarChrome();
    let browser = null;
    try { browser = await chromium.launch(exe ? { executablePath: exe } : {}); }
    catch (e) { console.log(L(`WARN no pude abrir un navegador (${String(e.message).split("\n")[0]}): dejo los HTML`, `WARN could not open a browser (${String(e.message).split("\n")[0]}): leaving the HTML files`)); }
    if (browser) {
      const pg = await browser.newPage({ viewport: { width: 1800, height: 1400 }, deviceScaleFactor: 2 });
      for (const t of trabajos) {
        const dest = path.join(dir, `${t.base}.png`);
        if (fs.existsSync(dest) && !force) { omitidos.push(`${t.base}.png`); continue; }
        await pg.setContent(t.html, { waitUntil: "load" });
        await pg.locator(t.sel).screenshot({ path: dest });
        escritos.push(`${t.base}.png`); pngs++;
      }
      await browser.close();
    }
  }
}

const rel = path.relative(root, dir) || ".";
for (const n of escritos) console.log(`OK ${path.join(rel, n)}`);
for (const n of omitidos) console.log(`SKIP ${path.join(rel, n)} ` + L("ya existe (usá --force)", "already exists (use --force)"));
console.log(L(`\n${LENTES.length} lentes · ${SUMA} hallazgos · ${pngs} PNG${pngs === 1 ? "" : "s"} generado${pngs === 1 ? "" : "s"}`,
              `\n${LENTES.length} lenses · ${SUMA} findings · ${pngs} PNG${pngs === 1 ? "" : "s"} generated`));
