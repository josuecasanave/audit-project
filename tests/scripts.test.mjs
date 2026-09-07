// Tests de los cuatro scripts deterministas. Sin red, sin instalar nada: fixtures chicas y assert.
// Cada bloque nombra el hallazgo de la auditoria que lo motivo, para que no vuelva a entrar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const S = (n) => path.join(repo, "scripts", n);
const F = (n) => path.join(here, "fixtures", n);
const node = process.execPath;
const run = (args, opts = {}) => execFileSync(node, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
const detect = (p) => JSON.parse(run([S("detect.mjs"), p]));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "audit-project-test-"));

const FINDINGS = [
  { severity: "critica", kind: "riesgo", lens: "authz", area: "payments", file: "apps/web/app/api/checkout/route.ts", line: 12,
    title: "Checkout does not check order ownership", why: "Any logged-in user can pay someone else's order", fix: "Filter by organizationId" },
  { severity: "media", kind: "endurecimiento", lens: "http", file: "apps/web/middleware.ts", line: 3,
    title: "No CSP", why: "Defense in depth", fix: "Add headers" },
];

test("detect: npm app - commands, framework and lockfile", () => {
  const d = detect(F("npm-app"));
  assert.equal(d.packageManager, "npm");
  assert.equal(d.commands.install, "npm ci");
  assert.equal(d.commands.build, "npm run build");
  assert.ok(d.frameworks.includes("nextjs"));
});

test("detect: turbo monorepo - workspaces and deps from every package", () => {
  const d = detect(F("turbo-mono"));
  assert.equal(d.monorepo.packages, 2);
  assert.equal(d.packageManager, "pnpm");
  assert.deepEqual(d.workspaces.map((w) => w.name).sort(), ["@mono/auth", "web"]);
  assert.ok(d.auth.length > 0, "auth deps live in the workspaces, not the root");
});

test("detect: a pyproject.toml at the root does not wipe out the JS commands (finding #4)", () => {
  const d = detect(F("python-app"));
  assert.equal(d.commands.build, "npm run build", "the JS build must survive");
  assert.equal(d.commands.install, "npm ci", "the JS install must survive");
  assert.ok(d.languages.includes("python"), "python is still detected");
});

test("detect: platform areas carry a status and never crash on an empty dir", () => {
  const dir = tmp();
  const d = detect(dir);
  assert.ok(Array.isArray(d.platform) && d.platform.length >= 20);
  assert.ok(d.platform.every((p) => p.status === "presente" || p.status === "ausente"));
});

test("anchor: refuses to run the audited repo's code without --yes (findings #1, #2, #5)", () => {
  const out = run([S("anchor.mjs"), F("npm-app")]);
  assert.match(out, /SKIP ancla/);
  assert.doesNotMatch(out, /PASS|FAIL/);
});

test("anchor: with --yes it runs, and does not leak the auditor's environment", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "envtest", scripts: { build: "node -e \"process.stdout.write(String(process.env.MI_TOKEN_SECRETO))\"" } }));
  const out = run([S("anchor.mjs"), dir, "--yes", "--only", "build"], { env: { ...process.env, MI_TOKEN_SECRETO: "no-debe-viajar" } });
  assert.doesNotMatch(out, /no-debe-viajar/, "the audited repo's script must not see the auditor's variables");
});

test("handoff: writes the Spanish package and estado.json", () => {
  const dir = tmp();
  const fp = path.join(dir, "f.json");
  fs.writeFileSync(fp, JSON.stringify(FINDINGS));
  run([S("handoff.mjs"), F("npm-app"), "--out", dir, "--findings", fp, "--force"]);
  assert.ok(fs.existsSync(path.join(dir, "PROYECTO.md")));
  assert.ok(fs.existsSync(path.join(dir, "PENDIENTES.md")));
  const e = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
  assert.equal(e.lang, "es");
  assert.equal(e.pendientes.length, 2);
  assert.equal(e.pendientes[0].id, "P-01");
});

test("handoff: --lang en changes the file names and the prose, never the data", () => {
  const dirEs = tmp(), dirEn = tmp();
  const fp = path.join(dirEs, "f.json");
  fs.writeFileSync(fp, JSON.stringify(FINDINGS));
  run([S("handoff.mjs"), F("npm-app"), "--out", dirEs, "--findings", fp, "--force"]);
  run([S("handoff.mjs"), F("npm-app"), "--lang", "en", "--out", dirEn, "--findings", fp, "--force"]);
  assert.ok(fs.existsSync(path.join(dirEn, "PROJECT.md")));
  assert.ok(fs.existsSync(path.join(dirEn, "TODO.md")));
  const es = JSON.parse(fs.readFileSync(path.join(dirEs, "estado.json"), "utf8"));
  const en = JSON.parse(fs.readFileSync(path.join(dirEn, "estado.json"), "utf8"));
  assert.deepEqual(en.pendientes, es.pendientes, "same findings, same ids, same severities");
  assert.deepEqual(en.resumenPendientes, es.resumenPendientes);
  assert.equal(en.lang, "en");
  const todo = fs.readFileSync(path.join(dirEn, "TODO.md"), "utf8");
  assert.match(todo, /`critical`/);
  assert.match(todo, /_risk_/);
  assert.doesNotMatch(todo, /_riesgo_|_incompleto_|_ausente_/, "no Spanish kind leaks into the English file");
});

test("handoff: a broken findings file fails loudly instead of reporting zero pending (findings #7, #12)", () => {
  const dir = tmp();
  const fp = path.join(dir, "roto.json");
  fs.writeFileSync(fp, "{ esto no es json");
  assert.throws(() => run([S("handoff.mjs"), F("npm-app"), "--out", dir, "--findings", fp, "--force"], { stdio: "pipe" }));
  assert.ok(!fs.existsSync(path.join(dir, "PENDIENTES.md")), "nothing is written when the input is unusable");
});

test("handoff: a missing findings path fails too", () => {
  const dir = tmp();
  assert.throws(() => run([S("handoff.mjs"), F("npm-app"), "--out", dir, "--findings", path.join(dir, "no-existe.json"), "--force"], { stdio: "pipe" }));
});

test("handoff: --resumen-file keeps the summary out of the shell (finding #11)", () => {
  const dir = tmp();
  const fp = path.join(dir, "f.json");
  fs.writeFileSync(fp, JSON.stringify(FINDINGS));
  const rf = path.join(dir, "resumen.txt");
  fs.writeFileSync(rf, 'A "quoted" product; $(echo pwned) & rm -rf /');
  run([S("handoff.mjs"), F("npm-app"), "--out", dir, "--findings", fp, "--resumen-file", rf, "--force"]);
  const md = fs.readFileSync(path.join(dir, "PROYECTO.md"), "utf8");
  assert.match(md, /\$\(echo pwned\)/, "the text lands verbatim, as data");
});

test("handoff: never overwrites without --force", () => {
  const dir = tmp();
  const fp = path.join(dir, "f.json");
  fs.writeFileSync(fp, JSON.stringify(FINDINGS));
  run([S("handoff.mjs"), F("npm-app"), "--out", dir, "--findings", fp, "--force"]);
  fs.writeFileSync(path.join(dir, "PROYECTO.md"), "MIO");
  const out = run([S("handoff.mjs"), F("npm-app"), "--out", dir, "--findings", fp]);
  assert.match(out, /SKIP/);
  assert.equal(fs.readFileSync(path.join(dir, "PROYECTO.md"), "utf8"), "MIO");
});

test("cards: build HTML per lens and inherit the language from estado.json", () => {
  const dir = tmp();
  const fp = path.join(dir, "f.json");
  fs.writeFileSync(fp, JSON.stringify(FINDINGS));
  run([S("handoff.mjs"), F("npm-app"), "--lang", "en", "--out", dir, "--findings", fp, "--force"]);
  const out = run([S("tarjetas.mjs"), F("npm-app"), "--out", dir, "--no-png", "--force"]);
  assert.match(out, /lenses/, "inherits English from estado.json");
  const sheet = fs.readFileSync(path.join(dir, "tarjetas", "lentes.html"), "utf8");
  assert.match(sheet, /PROJECT AUDIT/);
  assert.match(sheet, /AUTHORIZATION/);
  assert.ok(fs.existsSync(path.join(dir, "tarjetas", "lente-authz.html")));
});

test("cards: a corrupt estado.json is skipped, not a stack trace (low finding)", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "estado.json"), "{roto");
  const out = run([S("tarjetas.mjs"), F("npm-app"), "--out", dir, "--no-png"]);
  assert.match(out, /SKIP/);
});

test("cards: findings without a lens are refused with a clear message", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify({ proyecto: "x", fecha: "2026-01-01", pendientes: [{ severity: "alta", title: "sin lente" }], descartados: [] }));
  const out = run([S("tarjetas.mjs"), F("npm-app"), "--out", dir, "--no-png"]);
  assert.match(out, /SKIP/);
});
