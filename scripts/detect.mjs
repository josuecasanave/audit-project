#!/usr/bin/env node
/**
 * Detecta el stack de un proyecto (cualquier lenguaje/framework, monorepo o no) y qué comandos de
 * verificación tiene disponibles. Determinista, sin dependencias, sin tokens. Imprime JSON compacto.
 *
 * Novedades v2:
 *  - Monorepo-aware: pnpm-workspace.yaml / package.json "workspaces" / turbo.json / nx.json / lerna.
 *    Une las dependencias de TODOS los workspaces y recuerda en qué paquete vive cada cosa.
 *  - Índice de archivos único (un solo walk) → deteccion de rutas en cualquier profundidad.
 *  - Catálogo de plataforma SaaS: 18 áreas (mail, jobs, admin, blog, analytics, storage,
 *    notificaciones, seo, monitoring, e2e, dev-offline, onboarding, docs, contacto, legales,
 *    deployment, i18n, api) con evidencia de archivos y paquetes.
 *  - Alias de scripts (type-check / check-types / types / test:e2e ...).
 *
 * Uso: node detect.mjs <ruta-proyecto> [--pretty]
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const pretty = process.argv.includes("--pretty");

// ---------------------------------------------------------------- helpers
const abs = (p) => path.join(root, p);
const has = (p) => fs.existsSync(abs(p));
const read = (p) => { try { return fs.readFileSync(abs(p), "utf8"); } catch { return ""; } };
const json = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const first = (...ps) => ps.find(has) ?? null;

const out = {
  root, monorepo: null, workspaces: [], languages: [], frameworks: [], orm: [], auth: [],
  payments: [], db: [], infra: [], ci: [], tests: [], commands: {}, files: {}, size: {},
  flags: [], hotspots: [], platform: [], depsBy: {},
};

// ---------------------------------------------------------------- 1. índice de archivos (un walk)
const SKIP = new Set(["node_modules", ".git", ".next", ".turbo", ".nx", "dist", "build", "out",
  "vendor", "__pycache__", ".venv", "venv", "target", "coverage", ".cache", ".vercel", ".output",
  ".svelte-kit", "storybook-static", ".pnpm-store"]);
const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".php", ".rb", ".go",
  ".rs", ".sql", ".vue", ".svelte", ".astro"]);
const MAX_FILES = 60000;

/** @type {string[]} rutas relativas con "/" */
const index = [];
const dirs = new Set();
let codeFiles = 0, loc = 0, truncated = false;

(function walk(dirAbs, rel, depth) {
  if (depth > 10 || index.length > MAX_FILES) { if (index.length > MAX_FILES) truncated = true; return; }
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { dirs.add(r); walk(path.join(dirAbs, e.name), r, depth + 1); }
    else {
      index.push(r);
      if (CODE.has(path.extname(e.name))) {
        codeFiles++;
        try { loc += fs.readFileSync(path.join(dirAbs, e.name), "utf8").split("\n").length; } catch {}
      }
    }
  }
})(root, "", 0);

const idxSet = new Set(index);
/** archivo exacto en cualquier lado */
const hasFile = (p) => idxSet.has(p);
/** primer archivo que matchea un regex sobre la ruta relativa */
const findFile = (re) => index.find((p) => re.test(p)) ?? null;
/** todos los que matchean (limitado) */
const findFiles = (re, limit = 8) => index.filter((p) => re.test(p)).slice(0, limit);
const findDirs = (re, limit = 8) => [...dirs].filter((p) => re.test(p)).slice(0, limit);

// ---------------------------------------------------------------- 2. workspaces
function globToRe(g) {
  // soporta "apps/*", "packages/**", "tooling/*", literales; ignora negaciones
  const esc = g.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + esc.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]+").replace(/\u0000/g, ".+") + "$");
}
function parsePnpmWorkspace(txt) {
  // parser mínimo del bloque `packages:` (lista YAML) sin dependencias externas
  const globs = [];
  const lines = txt.split("\n");
  let inPkgs = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "");
    if (/^packages\s*:/.test(line)) {
      inPkgs = true;
      const inline = line.split(":").slice(1).join(":").trim();
      if (inline.startsWith("[")) { for (const m of inline.matchAll(/["']([^"']+)["']/g)) globs.push(m[1]); inPkgs = false; }
      continue;
    }
    if (!inPkgs) continue;
    const m = line.match(/^\s*-\s*["']?([^"'#\s]+)["']?\s*$/);
    if (m) globs.push(m[1]);
    else if (line.trim() && !/^\s/.test(line)) inPkgs = false;
  }
  return globs;
}

const rootPkg = json("package.json");
let wsGlobs = [];
let wsKind = null;
if (has("pnpm-workspace.yaml") || has("pnpm-workspace.yml")) {
  wsKind = "pnpm-workspaces";
  wsGlobs = parsePnpmWorkspace(read(has("pnpm-workspace.yaml") ? "pnpm-workspace.yaml" : "pnpm-workspace.yml"));
} else if (rootPkg?.workspaces) {
  wsKind = "npm/yarn-workspaces";
  wsGlobs = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : (rootPkg.workspaces.packages ?? []);
}
const runner = has("turbo.json") ? "turbo" : has("nx.json") ? "nx" : has("lerna.json") ? "lerna" : null;
if (runner && !wsKind) wsKind = runner + "-workspaces";

// todos los package.json que no son la raíz ni node_modules
const pkgJsonPaths = index.filter((p) => p.endsWith("package.json") && p !== "package.json");
const wsRes = wsGlobs.filter((g) => !g.startsWith("!")).map(globToRe);
const workspacePkgPaths = wsRes.length
  ? pkgJsonPaths.filter((p) => wsRes.some((re) => re.test(path.posix.dirname(p))))
  // sin declaración explícita: aceptamos apps/*/ packages/*/ tooling/*/ services/*/ libs/*/
  : pkgJsonPaths.filter((p) => /^(apps|packages|tooling|services|libs|modules)\/[^/]+\/package\.json$/.test(p));

if (wsKind || workspacePkgPaths.length) {
  out.monorepo = { kind: wsKind ?? "convención de carpetas", runner, globs: wsGlobs, packages: workspacePkgPaths.length };
}

// ---------------------------------------------------------------- 3. dependencias unidas
/** name -> { version, where: [nombre de workspace] } */
const deps = {};
function addDeps(pkg, label) {
  if (!pkg) return;
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [n, v] of Object.entries(pkg[field] ?? {})) {
      if (!deps[n]) deps[n] = { version: String(v), where: [] };
      if (!deps[n].where.includes(label)) deps[n].where.push(label);
    }
  }
}
addDeps(rootPkg, "(raíz)");
const wsInfo = [];
for (const p of workspacePkgPaths) {
  const pj = json(p);
  if (!pj) continue;
  const dir = path.posix.dirname(p);
  const label = pj.name || dir;
  addDeps(pj, label);
  wsInfo.push({ name: label, dir, scripts: Object.keys(pj.scripts ?? {}) });
}
out.workspaces = wsInfo;

const d = (n) => n in deps;
const dAny = (...ns) => ns.filter(d);
const whereOf = (n) => deps[n]?.where?.[0] ?? null;
const anyDepMatch = (re) => Object.keys(deps).filter((n) => re.test(n));

// ---------------------------------------------------------------- 4. archivos clave (en todo el árbol)
const files = {
  packageJson: !!rootPkg,
  lock: ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"].find(has) ?? null,
  workspaceFile: first("pnpm-workspace.yaml", "pnpm-workspace.yml"),
  turbo: has("turbo.json"), nx: has("nx.json"),
  requirements: has("requirements.txt") || has("pyproject.toml") || has("Pipfile"),
  composer: has("composer.json"), gemfile: has("Gemfile"), goMod: has("go.mod"), cargo: has("Cargo.toml"),
  dockerfile: findFile(/(^|\/)Dockerfile$/),
  compose: findFile(/(^|\/)(docker-)?compose\.ya?ml$/),
  envExample: findFile(/(^|\/)\.env\.(example|sample|template)$/),
  envCommitted: findFiles(/(^|\/)\.env(\.local|\.production|\.development)?$/, 5),
  gitignore: has(".gitignore"), readme: has("README.md"),
  agentsMd: findFiles(/(^|\/)(AGENTS|CLAUDE)\.md$/, 5),
  securityMd: has("SECURITY.md"),
  githubWorkflows: findFiles(/^\.github\/workflows\/.+\.ya?ml$/, 12),
  dependabot: has(".github/dependabot.yml") || has(".github/dependabot.yaml"),
  renovate: has("renovate.json") || has(".github/renovate.json"),
  supabaseMigrations: findDirs(/(^|\/)supabase\/migrations$/, 2),
  prismaSchema: findFiles(/(^|\/)schema\.prisma$/, 4),
  drizzleConfig: findFile(/(^|\/)drizzle\.config\.[cm]?[jt]s$/),
  migrations: findDirs(/(^|\/)(migrations|migrate)$/, 4),
  nextConfig: findFiles(/(^|\/)next\.config\.[cm]?[jt]s$/, 6),
  middleware: findFiles(/(^|\/)(middleware|proxy)\.[cm]?ts$/, 6),
  vercel: findFile(/(^|\/)vercel\.json$/),
  netlify: has("netlify.toml"),
  tsconfigs: findFiles(/(^|\/)tsconfig\.json$/, 10).length,
};
out.files = files;

// ---------------------------------------------------------------- 5. stack por lenguaje
if (rootPkg || workspacePkgPaths.length) {
  out.languages.push(files.tsconfigs ? "typescript" : "javascript");

  const push = (arr, pairs) => { for (const [k, v] of pairs) if (d(k) && !arr.includes(v)) arr.push(v); };
  push(out.frameworks, [["next", "nextjs"], ["nuxt", "nuxt"], ["@remix-run/react", "remix"],
    ["react-router", "react-router"], ["astro", "astro"], ["@sveltejs/kit", "sveltekit"], ["svelte", "svelte"],
    ["vue", "vue"], ["express", "express"], ["fastify", "fastify"], ["@nestjs/core", "nestjs"], ["hono", "hono"],
    ["elysia", "elysia"], ["koa", "koa"], ["react", "react"], ["@angular/core", "angular"], ["gatsby", "gatsby"],
    ["expo", "expo"], ["react-native", "react-native"], ["@shopify/hydrogen", "shopify-hydrogen"], ["electron", "electron"]]);
  push(out.orm, [["prisma", "prisma"], ["@prisma/client", "prisma"], ["drizzle-orm", "drizzle"],
    ["typeorm", "typeorm"], ["sequelize", "sequelize"], ["mongoose", "mongoose"], ["knex", "knex"],
    ["kysely", "kysely"], ["@supabase/supabase-js", "supabase-js"], ["@mikro-orm/core", "mikro-orm"]]);
  push(out.auth, [["better-auth", "better-auth"], ["next-auth", "next-auth"], ["@auth/core", "authjs"],
    ["@clerk/nextjs", "clerk"], ["@supabase/ssr", "supabase-auth"],
    ["@supabase/auth-helpers-nextjs", "supabase-auth-helpers(DEPRECADO)"], ["passport", "passport"],
    ["jsonwebtoken", "jwt-manual"], ["jose", "jose"], ["lucia", "lucia"], ["firebase", "firebase"],
    ["@auth0/nextjs-auth0", "auth0"], ["@kinde-oss/kinde-auth-nextjs", "kinde"], ["@workos-inc/node", "workos"],
    ["@stack-auth/stack", "stack-auth"]]);
  push(out.payments, [["stripe", "stripe"], ["@stripe/stripe-js", "stripe-js"], ["mercadopago", "mercadopago"],
    ["@lemonsqueezy/lemonsqueezy.js", "lemonsqueezy"], ["@polar-sh/sdk", "polar"], ["creem", "creem"],
    ["@paddle/paddle-node-sdk", "paddle"], ["@paypal/checkout-server-sdk", "paypal"], ["rebill", "rebill"],
    ["chargebee", "chargebee"], ["dodopayments", "dodopayments"]]);
  push(out.db, [["pg", "postgres"], ["postgres", "postgres"], ["mysql2", "mysql"], ["mongodb", "mongodb"],
    ["better-sqlite3", "sqlite"], ["@planetscale/database", "planetscale"], ["@neondatabase/serverless", "neon"],
    ["redis", "redis"], ["ioredis", "redis"], ["@upstash/redis", "upstash-redis"], ["@libsql/client", "turso"]]);
  push(out.tests, [["vitest", "vitest"], ["jest", "jest"], ["@playwright/test", "playwright"],
    ["cypress", "cypress"], ["mocha", "mocha"], ["@testing-library/react", "testing-library"], ["bun:test", "bun-test"]]);

  const val = ["zod", "valibot", "yup", "joi", "arktype", "@sinclair/typebox"].filter(d);
  if (val.length) out.flags.push("validacion:" + val.join("+"));
  if (d("helmet")) out.flags.push("helmet");
  if (dAny("express-rate-limit", "@upstash/ratelimit", "rate-limiter-flexible", "hono-rate-limiter").length) out.flags.push("rate-limit-lib");
  if (anyDepMatch(/^@sentry\//).length) out.flags.push("sentry");
  if (rootPkg?.engines?.node) out.flags.push("engines.node:" + rootPkg.engines.node);
  if (has(".nvmrc")) out.flags.push("nvmrc:" + read(".nvmrc").trim());

  // package manager + comandos raíz (con alias)
  const pm = files.lock === "pnpm-lock.yaml" ? "pnpm"
    : files.lock === "yarn.lock" ? "yarn"
    : (files.lock === "bun.lockb" || files.lock === "bun.lock") ? "bun"
    : rootPkg?.packageManager?.split("@")[0] ?? "npm";
  out.packageManager = pm;
  const s = rootPkg?.scripts ?? {};
  const pick = (...names) => names.find((n) => s[n] && !/no test specified/.test(s[n])) ?? null;
  const run = (name) => (pm === "npm" ? `npm run ${name}` : `${pm} run ${name}`);
  out.commands.install = pm === "npm" ? (files.lock ? "npm ci" : "npm install")
    : pm === "pnpm" ? "pnpm install --frozen-lockfile" : `${pm} install`;
  const build = pick("build");
  const test = pick("test", "test:unit", "test:ci");
  const lint = pick("lint", "lint:check", "check");
  const tc = pick("typecheck", "type-check", "check-types", "types", "tsc");
  const e2e = pick("test:e2e", "e2e", "playwright");
  const fmt = pick("format:check", "fmt:check");
  if (build) out.commands.build = run(build);
  if (test) out.commands.test = run(test);
  if (lint) out.commands.lint = run(lint);
  if (e2e) out.commands.e2e = run(e2e);
  if (fmt) out.commands.format = run(fmt);
  if (tc) out.commands.typecheck = run(tc);
  else if (files.tsconfigs && !out.monorepo) out.commands.typecheck = "npx tsc --noEmit";
  out.commands.audit = pm === "npm" ? "npm audit --audit-level=high"
    : pm === "pnpm" ? "pnpm audit --audit-level high"
    : pm === "yarn" ? "yarn npm audit --severity high" : "bun audit";
  // node:test no es una dependencia, vive en el runtime: sin esto un repo con tests propios
  // aparece como "sin tests".
  if (Object.values(s).some((v) => /node\s+--test|node:test/.test(String(v)))) out.tests.push("node:test");
  out.scriptsRaiz = Object.keys(s);
}

// --- Python / PHP / Ruby / Go / Rust ---
// Un repo poliglota (un front JS con un pyproject.toml en la raiz, por ejemplo) no puede perder los
// comandos que ya detecto el bloque de JS: los lenguajes que siguen SOLO rellenan lo que falta.
const setCmd = (k, v) => { if (v && !out.commands[k]) out.commands[k] = v; };
if (files.requirements) {
  out.languages.push("python");
  const req = read("requirements.txt") + read("pyproject.toml") + read("Pipfile");
  for (const [k, v] of [["django", "django"], ["fastapi", "fastapi"], ["flask", "flask"], ["starlette", "starlette"]])
    if (new RegExp(k, "i").test(req)) out.frameworks.push(v);
  if (/sqlalchemy/i.test(req)) out.orm.push("sqlalchemy");
  if (/pytest/i.test(req)) out.tests.push("pytest");
  setCmd("install", has("pyproject.toml") && /\[tool\.poetry\]/.test(read("pyproject.toml")) ? "poetry install"
    : has("uv.lock") ? "uv sync" : "pip install -r requirements.txt");
  setCmd("test", /pytest/i.test(req) || has("pytest.ini") ? "pytest -q" : (has("manage.py") ? "python manage.py test" : null));
  setCmd("audit", "pip-audit");
  if (has("ruff.toml") || /ruff/i.test(req)) setCmd("lint", "ruff check .");
}
if (files.composer) {
  out.languages.push("php");
  const c = json("composer.json") ?? {};
  const req = { ...(c.require ?? {}), ...(c["require-dev"] ?? {}) };
  if ("laravel/framework" in req) out.frameworks.push("laravel");
  if ("symfony/framework-bundle" in req) out.frameworks.push("symfony");
  if ("phpunit/phpunit" in req) out.tests.push("phpunit");
  if ("pestphp/pest" in req) out.tests.push("pest");
  setCmd("install", "composer install");
  setCmd("test", out.frameworks.includes("laravel") ? "php artisan test" : "vendor/bin/phpunit");
  setCmd("audit", "composer audit");
}
if (files.gemfile) { out.languages.push("ruby"); if (/rails/.test(read("Gemfile"))) out.frameworks.push("rails"); setCmd("install", "bundle install"); setCmd("test", "bundle exec rspec"); setCmd("audit", "bundle audit"); }
if (files.goMod) { out.languages.push("go"); setCmd("build", "go build ./..."); setCmd("test", "go test ./..."); setCmd("audit", "govulncheck ./..."); }
if (files.cargo) { out.languages.push("rust"); setCmd("build", "cargo build"); setCmd("test", "cargo test"); setCmd("audit", "cargo audit"); }

// ---------------------------------------------------------------- 6. infra / ci / flags
if (files.dockerfile) out.infra.push("docker");
if (files.compose) out.infra.push("docker-compose");
if (files.vercel || files.nextConfig.length) out.infra.push("vercel?");
if (files.netlify) out.infra.push("netlify");
if (findFile(/(^|\/)fly\.toml$/)) out.infra.push("fly.io");
if (findFile(/(^|\/)railway\.(json|toml)$/)) out.infra.push("railway");
if (findFile(/(^|\/)render\.ya?ml$/)) out.infra.push("render");
if (files.supabaseMigrations.length) out.db.push("supabase");
if (files.githubWorkflows.length) out.ci.push("github-actions", ...files.githubWorkflows.map((p) => path.posix.basename(p)));
if (findFile(/(^|\/)\.gitlab-ci\.ya?ml$/)) out.ci.push("gitlab-ci");
if (files.dependabot) out.ci.push("dependabot");
if (files.renovate) out.ci.push("renovate");
if (files.envCommitted.length) out.flags.push("ALERTA:.env-en-el-arbol:" + files.envCommitted.join(","));
if (!files.gitignore) out.flags.push("sin-.gitignore");
if (!files.envExample) out.flags.push("sin-.env.example");
if (!files.lock && (rootPkg || workspacePkgPaths.length)) out.flags.push("ALERTA:sin-lockfile");
if (out.monorepo && !runner) out.flags.push("monorepo-sin-task-runner");
if (truncated) out.flags.push("arbol-truncado(>60k archivos)");
out.size = { files: codeFiles, loc, allFiles: index.length, dirs: dirs.size };

// ---------------------------------------------------------------- 7. hotspots (monorepo-aware)
const HOT = [
  /^(src\/)?app\/api$/, /^(src\/)?pages\/api$/, /^apps\/[^/]+\/(src\/)?app\/api$/,
  /^apps\/[^/]+\/(src\/)?app$/, /^apps\/[^/]+\/(src\/)?modules$/, /^apps\/[^/]+\/(src\/)?components$/,
  /^packages\/[^/]+\/src$/, /^tooling\/[^/]+$/,
  /^(src\/)?(routes|server|lib|middleware|auth|db|api|jobs|tasks|workers|emails|actions)$/,
  /(^|\/)supabase\/migrations$/, /(^|\/)prisma$/, /(^|\/)migrations$/,
  /^app\/(Http|Models)$/, /^config$/,
];
out.hotspots = [...dirs].filter((p) => HOT.some((re) => re.test(p))).sort().slice(0, 40);

// ---------------------------------------------------------------- 8. catálogo de plataforma SaaS
const AREAS = [
  { area: "auth", label: "Autenticación", deps: /^(better-auth|next-auth|@auth\/core|@clerk\/|@supabase\/ssr|lucia|@workos-inc|@auth0\/|@kinde-oss)/, paths: /(^|\/)(auth)(\/|$)/ },
  { area: "payments", label: "Pagos / billing", deps: /^(stripe|@stripe\/|mercadopago|@lemonsqueezy\/|@polar-sh\/|@paddle\/|creem|rebill|chargebee|dodopayments)/, paths: /(^|\/)(payments|billing)(\/|$)/ },
  { area: "database", label: "Base de datos / schema", deps: /^(prisma|@prisma\/client|drizzle-orm|kysely|mongoose|typeorm)$/, paths: /(^|\/)(database|db|prisma|drizzle)(\/|$)/, fileRe: /(schema\.prisma|drizzle\.config|\/migrations\/)/ },
  { area: "api", label: "API tipada", deps: /^(@trpc\/server|@orpc\/|hono|ts-rest|@ts-rest\/|zsa|next-safe-action)/, paths: /^packages\/api(\/|$)/ },
  { area: "mail", label: "Mails transaccionales", deps: /^(resend|nodemailer|postmark|@sendgrid\/mail|mailgun\.js|@aws-sdk\/client-ses|react-email|@react-email\/|plunk|loops)/, paths: /(^|\/)(mail|email|emails)(\/|$)/, fileRe: /(^|\/)(emails?)\/.+\.(tsx?|html)$/ },
  { area: "jobs", label: "Background jobs & cron", deps: /^(@trigger\.dev\/|@upstash\/qstash|inngest|bullmq|node-cron|graphile-worker|agenda|croner|@vercel\/cron)/, paths: /(^|\/)(jobs|tasks|workers|queues)(\/|$)/, fileRe: /(trigger\.config\.[cm]?[jt]s|(^|\/)app\/api\/cron\/|(^|\/)vercel\.json$)/ },
  { area: "admin", label: "Admin UI / superadmin", paths: /(^|\/)(admin|superadmin|back-?office)(\/|$)/, fileRe: /(^|\/)(admin)\/.+\.tsx?$/ },
  { area: "blog", label: "Blog de marketing", deps: /^(content-collections|@content-collections\/|contentlayer|next-mdx-remote|@next\/mdx|velite|@sanity\/client|contentful|@payloadcms\/)/, paths: /(^|\/)(blog|posts)(\/|$)/, fileRe: /(^|\/)content\/(posts|blog)\//},
  { area: "docs", label: "Documentación", deps: /^(fumadocs-|nextra|@mintlify\/|@docusaurus\/)/, paths: /^apps\/docs(\/|$)|(^|\/)(docs|documentation)(\/|$)/, fileRe: /(^|\/)content\/docs\// },
  { area: "analytics", label: "Analytics", deps: /^(posthog-js|posthog-node|@vercel\/analytics|plausible-tracker|next-plausible|@segment\/analytics|mixpanel|@openpanel\/|@umami\/|fathom-client|react-ga4)/, paths: /(^|\/)(analytics)(\/|$)/ },
  { area: "storage", label: "File storage", deps: /^(@aws-sdk\/client-s3|@aws-sdk\/s3-request-presigner|minio|uploadthing|@uploadthing\/|@supabase\/storage-js|@vercel\/blob|cloudinary)/, paths: /^packages\/storage(\/|$)|(^|\/)(storage|uploads)(\/|$)/ },
  { area: "notifications", label: "Notificaciones", deps: /^(@novu\/|@knocklabs\/|web-push|@pusher\/|pusher-js|ably)/, paths: /(^|\/)(notifications?)(\/|$)/ },
  { area: "seo", label: "SEO (meta, OG, sitemap)", deps: /^(next-sitemap|next-seo|schema-dts)/, fileRe: /(^|\/)(sitemap|robots|opengraph-image|twitter-image)\.[cm]?(tsx?|xml|ts)$/ },
  { area: "monitoring", label: "Monitoring / errores", deps: /^(@sentry\/|@highlight-run\/|@baselime\/|@axiomhq\/|bugsnag|rollbar|@opentelemetry\/)/, fileRe: /(sentry\.(client|server|edge)\.config\.[cm]?ts|instrumentation\.[cm]?ts)$/ },
  { area: "e2e", label: "Tests E2E", deps: /^(@playwright\/test|cypress|@testing-library\/)/, fileRe: /(playwright\.config\.[cm]?[jt]s|cypress\.config\.[cm]?[jt]s|(^|\/)e2e\/)/ },
  { area: "dev-offline", label: "Desarrollo offline (docker)", fileRe: /(^|\/)(docker-)?compose\.ya?ml$/ },
  { area: "onboarding", label: "Onboarding de usuario", paths: /(^|\/)(onboarding)(\/|$)/, fileRe: /(^|\/)onboarding[^/]*\.tsx?$/ },
  { area: "contact", label: "Formulario de contacto", paths: /(^|\/)(contact|contacto)(\/|$)/, fileRe: /(^|\/)contact[^/]*\.tsx?$/ },
  { area: "legal", label: "Páginas legales", paths: /(^|\/)(legal|privacy|terms)(\/|$)/, fileRe: /(privacy-policy|terms-of-service|terminos|politica-de-privacidad)/i },
  { area: "i18n", label: "Internacionalización", deps: /^(next-intl|next-i18next|react-i18next|i18next|@lingui\/|paraglide|@inlang\/)/, paths: /(^|\/)(messages|locales|i18n|translations)(\/|$)/ },
  { area: "ai", label: "Integración de IA", deps: /^(ai|@ai-sdk\/|@anthropic-ai\/|openai|langchain|@langchain\/)$|^@ai-sdk\//, paths: /^packages\/ai(\/|$)/ },
  { area: "ui", label: "UI compartida", deps: /^(tailwindcss|@radix-ui\/|shadcn|class-variance-authority)/, paths: /^packages\/ui(\/|$)/, fileRe: /(^|\/)components\.json$/ },
  { area: "deployment", label: "Deployment", fileRe: /(^|\/)(vercel\.json|Dockerfile|fly\.toml|railway\.(json|toml)|render\.ya?ml|netlify\.toml|\.github\/workflows\/.*deploy)/i },
];

for (const a of AREAS) {
  const evDeps = a.deps ? anyDepMatch(a.deps) : [];
  const evDirs = a.paths ? findDirs(a.paths, 4) : [];
  const evFiles = a.fileRe ? findFiles(a.fileRe, 4) : [];
  const present = evDeps.length || evDirs.length || evFiles.length;
  out.platform.push({
    area: a.area, label: a.label, status: present ? "presente" : "ausente",
    deps: evDeps.slice(0, 4), dirs: evDirs, files: evFiles,
    packages: [...new Set(evDeps.map(whereOf).filter(Boolean))].slice(0, 3),
  });
}
out.platformMissing = out.platform.filter((p) => p.status === "ausente").map((p) => p.area);

// resumen de dónde vive cada dependencia clave (para que las lentes sepan a qué carpeta ir)
for (const n of [...out.auth, ...out.payments, ...out.orm].slice(0, 12)) {
  const key = Object.keys(deps).find((k) => k.includes(n.split("(")[0]));
  if (key) out.depsBy[key] = deps[key].where.slice(0, 3);
}

console.log(JSON.stringify(out, null, pretty ? 2 : 0));
