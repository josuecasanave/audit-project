#!/usr/bin/env node
/**
 * Paquete de traspaso / handoff package: convierte la auditoría en contexto reutilizable por OTRO
 * agente. Genera, de forma determinista (sin tokens), a partir de detect.mjs + los hallazgos:
 *
 *   PROYECTO.md / PROJECT.md    mapa del proyecto para agentes: qué es, dónde vive cada cosa,
 *                               comandos, puntos de entrada, invariantes, estado de salud.
 *                               Se lee ANTES de explorar el repo: ahí está el ahorro de tokens.
 *   PENDIENTES.md / TODO.md     checklist accionable por bloques (Hoy / Esta semana / Cuando
 *                               puedas), cada ítem con id, severidad, archivo:línea, fix y
 *                               criterio de "listo cuando".
 *   estado.json                 lo mismo pero para máquinas. Su nombre, sus claves y sus valores
 *                               enumerados son IDÉNTICOS en los dos idiomas: es el contrato.
 *
 * Uso / usage:
 *   node handoff.mjs <ruta-proyecto> [--lang es|en] [--out <dir>] [--findings <hallazgos.json>]
 *                    [--anchor <ancla.txt>] [--discarded <descartados.json>]
 *                    [--resumen "qué es el producto" | --resumen-file <archivo.txt>] [--force]
 *
 * `--lang en` genera PROJECT.md y TODO.md en inglés. El análisis, los ids, las rutas, los comandos
 * y estado.json no cambian: el idioma solo cambia la prosa.
 *
 * Por defecto escribe en <proyecto>/.audit/ y NUNCA pisa un archivo existente (usá --force).
 * `--out .` los deja en la raíz del repo.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const root = path.resolve(argv[0] && !argv[0].startsWith("--") ? argv[0] : ".");
const opt = (n, def) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const force = argv.includes("--force");
const outDir = path.resolve(root, opt("--out", ".audit"));
const findingsPath = opt("--findings", null);
const anchorPath = opt("--anchor", null);
const discardedPath = opt("--discarded", null);
const resumenFile = opt("--resumen-file", null);
const resumen = resumenFile && fs.existsSync(resumenFile)
  ? fs.readFileSync(resumenFile, "utf8").trim() || null
  : opt("--resumen", null);
const LANG = String(opt("--lang", "es")).toLowerCase().startsWith("en") ? "en" : "es";
const EN = LANG === "en";

// ---------------------------------------------------------------- entradas
const here = path.dirname(fileURLToPath(import.meta.url));
let info;
try {
  info = JSON.parse(execFileSync(process.execPath, [path.join(here, "detect.mjs"), root], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
} catch (e) {
  console.error((EN ? "FAIL could not detect the stack: " : "FAIL no pude detectar el stack: ") + e.message);
  process.exit(1);
}
// Un archivo de hallazgos roto o mal apuntado NO puede terminar en un informe que dice "cero
// pendientes": eso es peor que fallar. Si lo pediste y no se puede leer, corta acá.
const readJson = (p, etiqueta) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) {
    console.error((EN ? `FAIL could not read ${etiqueta} (${p}): ` : `FAIL no pude leer ${etiqueta} (${p}): `) + e.message);
    console.error(EN ? "FAIL refusing to write a handoff package that would report zero pending work."
                     : "FAIL me niego a escribir un traspaso que diría que no hay pendientes.");
    process.exit(1);
  }
};
const raw = findingsPath ? readJson(findingsPath, EN ? "the findings file" : "el archivo de hallazgos") : null;
const findings = Array.isArray(raw) ? raw : Array.isArray(raw?.findings) ? raw.findings : Array.isArray(raw?.confirmados) ? raw.confirmados : null;
if (findingsPath && findings === null) {
  console.error(EN ? `FAIL ${findingsPath} parsed but holds no findings array (expected an array, or {findings:[...]}, or {confirmados:[...]}).`
                   : `FAIL ${findingsPath} se pudo parsear pero no trae un array de hallazgos (esperaba un array, o {findings:[...]}, o {confirmados:[...]}).`);
  process.exit(1);
}
const rawDisc = discardedPath ? readJson(discardedPath, EN ? "the discarded file" : "el archivo de descartados") : null;
const descartados = Array.isArray(rawDisc) ? rawDisc : Array.isArray(rawDisc?.descartados) ? rawDisc.descartados : [];
const findingsList = findings ?? [];
const anchorLines = anchorPath && fs.existsSync(anchorPath)
  ? fs.readFileSync(anchorPath, "utf8").trim().split("\n").filter(Boolean)
  : [];

const nombre = path.basename(root);
const hoy = new Date().toISOString().slice(0, 10);
const ORDEN = { critica: 0, alta: 1, media: 2, baja: 3 };
const ORDEN_KEYS = Object.keys(ORDEN);
findingsList.sort((a, b) => (ORDEN[a.severity] ?? 9) - (ORDEN[b.severity] ?? 9));
findingsList.forEach((f, i) => { f.id = f.id ?? `P-${String(i + 1).padStart(2, "0")}`; });

const cuenta = (s) => findingsList.filter((f) => f.severity === s).length;
const pl = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`;
const lentes = [...new Set([...findingsList, ...descartados].map((f) => f.lens).filter(Boolean))].sort();
const porLente = lentes.map((k) => ({
  lens: k,
  confirmados: findingsList.filter((f) => f.lens === k).length,
  descartados: descartados.filter((f) => f.lens === k).length,
  ...ORDEN_KEYS.reduce((o, s2) => ({ ...o, [s2]: findingsList.filter((f) => f.lens === k && f.severity === s2).length }), {}),
}));
const presentes = (info.platform ?? []).filter((p) => p.status === "presente");
const ausentes = (info.platform ?? []).filter((p) => p.status === "ausente");
const donde = (p) => {
  const rutas = [...(p.dirs ?? []).slice(0, 2), ...(p.files ?? []).slice(0, 2)];
  const base = rutas.length ? [...(p.packages ?? []).slice(0, 1), ...rutas] : [...(p.packages ?? []), ...(p.deps ?? []).slice(0, 2)];
  return base.slice(0, 3).join(", ") || "—";
};

// ---------------------------------------------------------------- idioma (solo prosa)
// Las claves de severidad y de área NO se traducen: son el contrato de estado.json.
const SEV_EN = { critica: "critical", alta: "high", media: "medium", baja: "low" };
const sevLabel = (s) => (EN ? SEV_EN[s] ?? s : s);
const AREA_EN = {
  auth: "Authentication", payments: "Payments / billing", database: "Database / schema", api: "Typed API",
  mail: "Transactional email", jobs: "Background jobs & cron", admin: "Admin UI / superadmin",
  blog: "Marketing blog", docs: "Documentation", analytics: "Analytics", storage: "File storage",
  notifications: "Notifications", seo: "SEO (meta, OG, sitemap)", monitoring: "Monitoring / errors",
  e2e: "E2E tests", "dev-offline": "Offline development (docker)", onboarding: "User onboarding",
  contact: "Contact form", legal: "Legal pages", i18n: "Internationalization", ai: "AI integration",
  ui: "Shared UI", deployment: "Deployment",
};
const areaLabel = (p) => (EN ? AREA_EN[p.area] ?? p.label ?? p.area : p.label ?? p.area);
const sevCounts = () => (EN
  ? `${pl(cuenta("critica"), "critical", "critical")}, ${pl(cuenta("alta"), "high", "high")}, ${pl(cuenta("media"), "medium", "medium")}, ${pl(cuenta("baja"), "low", "low")}`
  : `${pl(cuenta("critica"), "crítico", "críticos")}, ${pl(cuenta("alta"), "alto", "altos")}, ${pl(cuenta("media"), "medio", "medios")}, ${pl(cuenta("baja"), "bajo", "bajos")}`);

const FILES = EN
  ? { map: "PROJECT.md", todo: "TODO.md" }
  : { map: "PROYECTO.md", todo: "PENDIENTES.md" };

// ---------------------------------------------------------------- invariantes (según el stack real)
const inv = [];
const tiene = (a) => presentes.some((p) => p.area === a);
const push = (es, en) => inv.push(EN ? en : es);
if (info.monorepo) push(
  "Las apps **no se importan entre sí**. Lo compartido va a `packages/*`, y un paquete nunca importa desde una app.",
  "Apps **never import each other**. Shared code lives in `packages/*`, and a package never imports from an app.");
if (tiene("auth") && tiene("database")) push(
  "Toda consulta a datos del negocio filtra por el usuario o la organización dueña. Un endpoint que recibe un id y no verifica pertenencia es un IDOR.",
  "Every business-data query filters by the owning user or organization. An endpoint that takes an id without checking ownership is an IDOR.");
if (tiene("admin") || tiene("auth")) push(
  "Los permisos se verifican **en el servidor**. Esconder un botón en el front no es autorización.",
  "Permissions are checked **on the server**. Hiding a button in the UI is not authorization.");
if (tiene("payments")) push(
  "Los webhooks de pago se verifican con firma y son idempotentes (el mismo evento puede llegar dos veces). El plan del usuario se lee de la base, nunca de lo que manda el cliente.",
  "Payment webhooks are signature-verified and idempotent (the same event can arrive twice). The user's plan is read from the database, never from what the client sends.");
if (tiene("storage")) push(
  "Las subidas van por URL prefirmada con expiración y validación de tipo y tamaño. El bucket no es público.",
  "Uploads go through a presigned URL with expiry plus type and size validation. The bucket is not public.");
if (tiene("jobs")) push(
  "Los endpoints de cron y los handlers de jobs están protegidos por un secreto y son idempotentes, con límite de reintentos.",
  "Cron endpoints and job handlers are protected by a secret and are idempotent, with a retry limit.");
if (tiene("i18n")) push(
  "Una cadena nueva se agrega en **todos** los archivos de mensajes, no solo en el idioma que estás tocando.",
  "A new string is added to **all** message files, not just the language you happen to be editing.");
if (info.frameworks?.includes("nextjs")) push(
  "El código de servidor (base, secretos, SDKs con keys privadas) no se importa desde un componente `\"use client\"`.",
  "Server-only code (database, secrets, SDKs holding private keys) is never imported from a `\"use client\"` component.");
if (info.orm?.length) push(
  `Todo cambio de schema va con migración versionada (${info.orm.join("/")}). Nada de sincronizar el schema a mano contra producción.`,
  `Every schema change ships as a versioned migration (${info.orm.join("/")}). Never push a schema by hand against production.`);
if (info.files?.envExample) push(
  `Toda variable de entorno nueva se agrega a \`${info.files.envExample}\` con un valor de ejemplo falso.`,
  `Every new environment variable is added to \`${info.files.envExample}\` with a fake example value.`);
if (info.tests?.length) push(
  `Los cambios en auth, pagos o permisos van con test (${info.tests.join(", ")}).`,
  `Changes to auth, payments or permissions ship with a test (${info.tests.join(", ")}).`);
push("El `.env` no se commitea. Ninguna key real entra al repo.",
     "`.env` is never committed. No real key enters the repo.");
if ((info.flags ?? []).some((f) => f.startsWith("ALERTA"))) push(
  `⚠️ Alertas activas de la detección: ${info.flags.filter((f) => f.startsWith("ALERTA")).join(" · ")}`,
  `⚠️ Active detection alerts: ${info.flags.filter((f) => f.startsWith("ALERTA")).join(" · ")}`);

// ---------------------------------------------------------------- mapa del proyecto
const cmdRows = Object.entries(info.commands ?? {}).map(([k, v]) => `| ${k} | \`${v}\` |`).join("\n");
const wsRows = (info.workspaces ?? []).map((w) => `| \`${w.name}\` | \`${w.dir}\` | ${(info.platform ?? []).filter((p) => (p.packages ?? []).includes(w.name) || (p.dirs ?? []).some((d) => d.startsWith(w.dir))).map((p) => areaLabel(p)).slice(0, 3).join(", ") || "—"} |`).join("\n");

const M = EN ? {
  title: `# ${nombre} — map for agents`,
  intro: `> Generated by \`audit-project\` on ${hoy}. Regenerate with \`node <skill>/scripts/handoff.mjs . --lang en\`.
> **Read this file before exploring the repo.** It exists so you don't have to walk the tree:
> it says where everything lives, which commands exist, and what must not break.
> If anything here contradicts the code, the code wins — and say so, because this file went stale.`,
  what: "## What this is",
  whatEmpty: "_(not filled in: write one paragraph on what the product does and for whom)_",
  structure: "## Structure",
  kind: "Kind", single: "single application", monorepo: (k, r, n) => `${k} monorepo${r ? ` with ${r}` : ""}, ${n} packages`,
  languages: "Languages", frameworks: "Frameworks", data: "Data", auth: "Auth", payments: "Payments",
  tests: "Tests", ci: "CI", size: "Size", sizeTail: (f, l) => `${f} source files, ~${l} lines`,
  pm: "Package manager",
  wsH: "### Workspaces", wsCols: "| Package | Folder | What it handles |",
  whereH: "## Where everything lives", whereCols: "| Area | Where |", whereEmpty: "| _(nothing detected)_ | — |",
  missing: (l) => `**No trace in the repo:** ${l}.
Don't assume they're missing: they may live outside the code (provider dashboard, environment variables). Check before building something new.`,
  allPresent: "Every area in the catalog has a trace in the repo.",
  cmdH: "## Commands", cmdCols: "| For | Command |", cmdEmpty: "| _(none detected)_ | — |",
  cmdTail: (r) => `Always run from the root${r ? ` — ${r} takes care of the packages` : ""}.`,
  entryH: "## Where to start", entryEmpty: "- _(no hotspots detected)_",
  invH: "## Invariants — do not break these",
  healthH: "## Health", healthEmpty: "_(the anchor did not run in this pass)_",
  todoH: "## Open work", byLens: (s) => `By lens: ${s}.`,
  todoLine: (n, c) => `${pl(n, "open item", "open items")}: ${c}. They're in \`${FILES.todo}\` with file, fix and acceptance criteria. **Before proposing new work, check whether it's already there.**`,
  todoEmpty: "No open items recorded in this pass.",
  convH: "## Detected conventions",
  convAgents: (l) => `- The repo already declares its conventions in ${l} — that outranks this file.`,
  convLock: (f) => `- Lockfile: \`${f}\`. Don't switch package manager.`, convNoLock: "- ⚠️ No lockfile.",
  convVal: (v) => `- Input validation with \`${v}\`: use the same one, don't mix libraries.`,
  convRuntime: (v) => `- Pinned runtime: ${v}`,
  convCi: (v) => `- CI: ${v}. If you break the build, it shows before the merge.`,
  convNoCi: "- ⚠️ No CI detected: nothing validates changes automatically.",
  unknownH: "## What this map does not know",
  unknown: `It was generated by reading the repo, not running it. It doesn't know what is actually configured in
provider dashboards (Stripe, the mail provider, the host), which variables are set in production, or how the
app behaves with real data. Ask before assuming.`,
} : {
  title: `# ${nombre} — mapa para agentes`,
  intro: `> Generado por \`audit-project\` el ${hoy}. Regenerá con \`node <skill>/scripts/handoff.mjs .\`.
> **Leé este archivo antes de explorar el repo.** Está para que no tengas que recorrer el árbol:
> acá está dónde vive cada cosa, qué comandos existen y qué no se puede romper.
> Si algo acá contradice al código, gana el código — y avisá, porque este archivo quedó viejo.`,
  what: "## Qué es",
  whatEmpty: "_(sin completar: escribí en un párrafo qué hace el producto y para quién)_",
  structure: "## Estructura",
  kind: "Tipo", single: "aplicación única", monorepo: (k, r, n) => `monorepo ${k}${r ? ` con ${r}` : ""}, ${n} paquetes`,
  languages: "Lenguajes", frameworks: "Frameworks", data: "Datos", auth: "Auth", payments: "Pagos",
  tests: "Tests", ci: "CI", size: "Tamaño", sizeTail: (f, l) => `${f} archivos de código, ~${l} líneas`,
  pm: "Package manager",
  wsH: "### Workspaces", wsCols: "| Paquete | Carpeta | De qué se ocupa |",
  whereH: "## Dónde vive cada cosa", whereCols: "| Área | Dónde |", whereEmpty: "| _(nada detectado)_ | — |",
  missing: (l) => `**Sin rastro en el repo:** ${l}.
No asumas que faltan: puede que vivan fuera del código (panel del proveedor, variables de entorno). Verificá antes de construir algo nuevo.`,
  allPresent: "Todas las áreas del catálogo tienen rastro en el repo.",
  cmdH: "## Comandos", cmdCols: "| Para | Comando |", cmdEmpty: "| _(ninguno detectado)_ | — |",
  cmdTail: (r) => `Corré siempre desde la raíz${r ? ` — ${r} se encarga de los paquetes` : ""}.`,
  entryH: "## Por dónde entrar", entryEmpty: "- _(sin hotspots detectados)_",
  invH: "## Invariantes — no romper esto",
  healthH: "## Estado de salud", healthEmpty: "_(el ancla no corrió en esta pasada)_",
  todoH: "## Pendientes", byLens: (s) => `Por lente: ${s}.`,
  todoLine: (n, c) => `${pl(n, "abierto", "abiertos")}: ${c}. Están en \`${FILES.todo}\` con archivo, fix y criterio de aceptación. **Antes de proponer trabajo nuevo, mirá si ya está ahí.**`,
  todoEmpty: "Sin pendientes registrados en esta pasada.",
  convH: "## Convenciones detectadas",
  convAgents: (l) => `- El repo ya declara sus convenciones en ${l} — eso manda por encima de este archivo.`,
  convLock: (f) => `- Lockfile: \`${f}\`. No cambies de package manager.`, convNoLock: "- ⚠️ No hay lockfile.",
  convVal: (v) => `- Validación de entrada con \`${v}\`: usá lo mismo, no mezcles librerías.`,
  convRuntime: (v) => `- Runtime fijado: ${v}`,
  convCi: (v) => `- CI: ${v}. Si rompés el build, se nota antes del merge.`,
  convNoCi: "- ⚠️ Sin CI detectada: nada valida los cambios automáticamente.",
  unknownH: "## Lo que este mapa no sabe",
  unknown: `Se generó leyendo el repo, no ejecutándolo. No sabe qué está realmente configurado en los paneles
de los proveedores (Stripe, el proveedor de mail, el hosting), qué variables están cargadas en
producción, ni cómo se comporta la app con datos reales. Preguntá antes de asumir.`,
};

const proyectoMd = `${M.title}

${M.intro}

${M.what}

${resumen ?? M.whatEmpty}

${M.structure}

- **${M.kind}:** ${info.monorepo ? M.monorepo(info.monorepo.kind, info.monorepo.runner, info.monorepo.packages) : M.single}
- **${M.languages}:** ${(info.languages ?? []).join(", ") || "—"}
- **${M.frameworks}:** ${(info.frameworks ?? []).join(", ") || "—"}
- **${M.data}:** ${[...(info.orm ?? []), ...(info.db ?? [])].join(", ") || "—"}
- **${M.auth}:** ${(info.auth ?? []).join(", ") || "—"} · **${M.payments}:** ${(info.payments ?? []).join(", ") || "—"}
- **${M.tests}:** ${(info.tests ?? []).join(", ") || "—"} · **${M.ci}:** ${(info.ci ?? []).slice(0, 4).join(", ") || "—"}
- **${M.size}:** ${M.sizeTail(info.size?.files ?? "?", info.size?.loc ?? "?")}
${info.packageManager ? `- **${M.pm}:** ${info.packageManager}` : ""}
${wsRows ? `
${M.wsH}

${M.wsCols}
|---|---|---|
${wsRows}
` : ""}
${M.whereH}

${M.whereCols}
|---|---|
${presentes.map((p) => `| ${areaLabel(p)} | \`${donde(p)}\` |`).join("\n") || M.whereEmpty}

${ausentes.length ? M.missing(ausentes.map((p) => areaLabel(p)).join(", ")) : M.allPresent}

${M.cmdH}

${M.cmdCols}
|---|---|
${cmdRows || M.cmdEmpty}

${M.cmdTail(info.monorepo?.runner)}

${M.entryH}

${(info.hotspots ?? []).map((h) => `- \`${h}\``).join("\n") || M.entryEmpty}

${M.invH}

${inv.map((i) => `- ${i}`).join("\n")}

${M.healthH}

${anchorLines.length ? "```\n" + anchorLines.join("\n") + "\n```" : M.healthEmpty}

${M.todoH}

${porLente.length ? M.byLens(porLente.map((l) => `${l.lens} ${l.confirmados}`).join(" · ")) + "\n\n" : ""}${findingsList.length ? M.todoLine(findingsList.length, sevCounts()) : M.todoEmpty}

${M.convH}

${[
  info.files?.agentsMd?.length ? M.convAgents(info.files.agentsMd.map((f) => `\`${f}\``).join(", ")) : null,
  info.files?.lock ? M.convLock(info.files.lock) : M.convNoLock,
  (info.flags ?? []).find((f) => f.startsWith("validacion:")) ? M.convVal((info.flags.find((f) => f.startsWith("validacion:")) ?? "").split(":")[1]) : null,
  (info.flags ?? []).find((f) => f.startsWith("engines.node:") || f.startsWith("nvmrc:")) ? M.convRuntime(info.flags.filter((f) => f.startsWith("engines.node:") || f.startsWith("nvmrc:")).join(", ")) : null,
  info.ci?.length ? M.convCi(info.ci.slice(0, 4).join(", ")) : M.convNoCi,
].filter(Boolean).join("\n")}

${M.unknownH}

${M.unknown}
`;

// ---------------------------------------------------------------- pendientes / to-do
const P = EN ? {
  title: `# Open work — ${nombre}`,
  head: (n, c) => `> Generated by \`audit-project\` on ${hoy} · ${pl(n, "open item", "open items")}
> (${c}).
>
> **For the agent picking this up:** one item at a time, each with its own verification, without
> bundling unrelated changes. Tick \`[x]\` only when the "done when" criterion is genuinely met.
> If the problem is already gone when you open the file, mark the item obsolete instead of inventing
> a fix. Project context: \`${FILES.map}\`.`,
  b1: "## Today — critical and high", b1e: "_Nothing critical or high open._",
  b2: "## This week — medium", b2e: "_Nothing medium open._",
  b3: "## When you can — low", b3e: "_Nothing low open._",
  verifyH: "### How to check you didn't break anything",
  noCmd: "# no commands detected",
  where: "Where", why: "Why", fix: "Fix", done: "Done when", noLoc: "_(no location)_", evidence: "Evidence",
  doneDefault: (c) => `the fix is applied, a test or check covers it, and ${c} passes.`,
  buildWord: "the build",
} : {
  title: `# Pendientes — ${nombre}`,
  head: (n, c) => `> Generado por \`audit-project\` el ${hoy} · ${pl(n, "ítem abierto", "ítems abiertos")}
> (${c}).
>
> **Para el agente que tome esto:** un ítem por vez, con su verificación, sin agrupar cambios no
> relacionados. Marcá \`[x]\` solo cuando el criterio de "listo cuando" se cumple de verdad.
> Si al abrir el archivo el problema ya no está, marcá el ítem como obsoleto en vez de inventar un
> arreglo. Contexto del proyecto: \`${FILES.map}\`.`,
  b1: "## Hoy — críticos y altos", b1e: "_Nada crítico ni alto abierto._",
  b2: "## Esta semana — medios", b2e: "_Nada medio abierto._",
  b3: "## Cuando puedas — bajos", b3e: "_Nada bajo abierto._",
  verifyH: "### Cómo verificar que no rompiste nada",
  noCmd: "# sin comandos detectados",
  where: "Dónde", why: "Por qué", fix: "Fix", done: "Listo cuando", noLoc: "_(sin ubicación)_", evidence: "Evidencia",
  doneDefault: (c) => `el fix está aplicado, hay un test o una verificación que lo cubre, y ${c} pasa.`,
  buildWord: "el build",
};

const bloque = (t) => findingsList.filter((f) => t.includes(f.severity));
const item = (f) => {
  const loc = f.file ? `\`${f.file}${f.line ? ":" + f.line : ""}\`` : P.noLoc;
  const KIND_EN = { riesgo: "risk", endurecimiento: "hardening", incompleto: "incomplete", ausente: "missing" };
  const kind = f.kind ? (EN ? KIND_EN[f.kind] ?? f.kind : f.kind) : null;
  const tipo = kind ? ` · _${kind}_` : "";
  const lente = f.lens ? ` · \`${f.lens}\`` : "";
  const cmd = info.commands?.test ? `\`${info.commands.test}\`` : info.commands?.build ? `\`${info.commands.build}\`` : P.buildWord;
  return `- [ ] **${f.id}** \`${sevLabel(f.severity)}\`${tipo}${lente}${f.area ? ` · ${f.area}` : ""} — ${f.title}
  - **${P.where}:** ${loc}
  - **${P.why}:** ${f.why ?? "—"}
  - **${P.fix}:** ${f.fix ?? "—"}
  - **${P.done}:** ${f.done ?? P.doneDefault(cmd)}${f.evidence ? `
  - <details><summary>${P.evidence}</summary>

    \`\`\`
    ${String(f.evidence).split("\n").join("\n    ")}
    \`\`\`
    </details>` : ""}`;
};

const pendientesMd = `${P.title}

${P.head(findingsList.length, sevCounts())}

${P.b1}

${bloque(["critica", "alta"]).map(item).join("\n\n") || P.b1e}

${P.b2}

${bloque(["media"]).map(item).join("\n\n") || P.b2e}

${P.b3}

${bloque(["baja"]).map(item).join("\n\n") || P.b3e}

---

${P.verifyH}

\`\`\`bash
${Object.entries(info.commands ?? {}).filter(([k]) => ["install", "typecheck", "lint", "build", "test"].includes(k)).map(([, v]) => v).join("\n") || P.noCmd}
\`\`\`
`;

// ---------------------------------------------------------------- estado.json
// Contrato para máquinas: mismo nombre, mismas claves y mismos valores enumerados en los dos
// idiomas. Solo `lang` dice en qué idioma quedaron los .md, y los textos libres (title/why/fix)
// siguen el idioma en el que los escribieron las lentes.
const estado = {
  generadoPor: "audit-project/handoff.mjs", fecha: hoy, lang: LANG, proyecto: nombre, root,
  estructura: { monorepo: info.monorepo, workspaces: info.workspaces, packageManager: info.packageManager },
  stack: { languages: info.languages, frameworks: info.frameworks, orm: info.orm, auth: info.auth, payments: info.payments, db: info.db, tests: info.tests, ci: info.ci, infra: info.infra },
  comandos: info.commands, hotspots: info.hotspots, flags: info.flags,
  cobertura: (info.platform ?? []).map((p) => ({ area: p.area, label: p.label, labelEn: AREA_EN[p.area] ?? p.label, status: p.status, donde: donde(p) })),
  invariantes: inv,
  salud: anchorLines,
  pendientes: findingsList.map((f) => ({ id: f.id, severity: f.severity, kind: f.kind, lens: f.lens, area: f.area, file: f.file, line: f.line, title: f.title, why: f.why, fix: f.fix, evidence: f.evidence })),
  descartados: descartados.map((f) => ({ lens: f.lens, severity: f.severity, title: f.title, file: f.file, why: f.why })),
  porLente,
  resumenPendientes: { total: findingsList.length, critica: cuenta("critica"), alta: cuenta("alta"), media: cuenta("media"), baja: cuenta("baja"), descartados: descartados.length },
};

// ---------------------------------------------------------------- escribir
fs.mkdirSync(outDir, { recursive: true });
const salidas = [[FILES.map, proyectoMd], [FILES.todo, pendientesMd], ["estado.json", JSON.stringify(estado, null, 2) + "\n"]];
const escritos = [], omitidos = [];
for (const [name, content] of salidas) {
  const p = path.join(outDir, name);
  if (fs.existsSync(p) && !force) { omitidos.push(name); continue; }
  fs.writeFileSync(p, content, "utf8");
  escritos.push(name);
}
const rel = path.relative(root, outDir) || ".";
for (const n of escritos) console.log(`OK ${path.join(rel, n)}`);
for (const n of omitidos) console.log(`SKIP ${path.join(rel, n)} ` + (EN ? "already exists (use --force to overwrite)" : "ya existe (usá --force para pisarlo)"));
if (escritos.length) {
  const target = info.files?.agentsMd?.length ? info.files.agentsMd[0] : "AGENTS.md / CLAUDE.md";
  console.log(EN
    ? `\nSUGGESTION for ${target} (add it by hand, this script never touches it):`
    : `\nSUGERENCIA para ${target} (agregalo a mano, este script no lo toca):`);
  console.log(EN
    ? `> Before exploring the repo, read \`${path.join(rel, FILES.map)}\` (project map) and \`${path.join(rel, FILES.todo)}\` (open work).`
    : `> Antes de explorar el repo, leé \`${path.join(rel, FILES.map)}\` (mapa del proyecto) y \`${path.join(rel, FILES.todo)}\` (trabajo abierto).`);
}
