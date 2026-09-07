#!/usr/bin/env node
/**
 * Ancla: corre los comandos de verificación PROPIOS del proyecto (los que detectó detect.mjs o los
 * que pases) y devuelve una línea PASS/FAIL/WARN/SKIP por comando + las últimas líneas del error.
 * No opina. No arregla. Solo ejecuta y reporta.
 *
 * v2: instala por defecto (un build de monorepo sin node_modules falla siempre y ensucia el
 * informe), timeouts por comando, `audit` como WARN (es informativo, no rompe el build), soporte
 * de e2e opcional y aviso explícito cuando falta node_modules.
 *
 * EJECUTA CODIGO DEL PROYECTO AUDITADO. Los scripts de un repo ajeno (postinstall, build, test)
 * corren en tu maquina, asi que el ancla NO arranca sin --yes explicito, y corre con un entorno
 * minimo: no hereda tus variables (tokens, credenciales de nube, claves de npm).
 *
 * Uso: node anchor.mjs <ruta-proyecto> --yes [--only build,test] [--skip-install] [--with-e2e]
 *                      [--timeout 900] [--cmd "make check"] [--keep-env]
 */
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] ?? ".");
const args = process.argv.slice(3);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const only = opt("--only")?.split(",").map((s) => s.trim());
const skipInstall = args.includes("--skip-install");
const withE2E = args.includes("--with-e2e");
const globalTimeout = opt("--timeout") ? Number(opt("--timeout")) : null;
const extraCmds = args.reduce((acc, a, i) => (a === "--cmd" && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
const consent = args.includes("--yes");
const keepEnv = args.includes("--keep-env");

if (!consent) {
  console.log("SKIP ancla: correr los comandos del proyecto ejecuta SU codigo en esta maquina (postinstall, build, test).");
  console.log("SKIP     Si confias en este repo, volve a correr con --yes. Sin eso, el resto de la auditoria sigue igual.");
  process.exit(0);
}

const detectPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "detect.mjs");
let info;
try {
  info = JSON.parse(execFileSync(process.execPath, [detectPath, root], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
} catch (e) {
  console.log(`FAIL detect · no pude detectar el stack: ${e.message}`);
  process.exit(1);
}

// timeouts por comando (segundos) — un build de monorepo tarda mucho más que un lint
const TIMEOUT = { install: 1200, typecheck: 600, lint: 480, build: 1200, test: 900, e2e: 1200, audit: 300 };
const BLOCKING = new Set(["install", "typecheck", "lint", "build", "test"]); // audit/e2e no marcan el run como fallido
const order = ["install", "typecheck", "lint", "build", "test", ...(withE2E ? ["e2e"] : []), "audit"];

const cmds = order
  .filter((k) => info.commands[k])
  .filter((k) => !only || only.includes(k))
  .filter((k) => !(k === "install" && skipInstall));

if (info.monorepo) {
  console.log(`INFO monorepo ${info.monorepo.kind}${info.monorepo.runner ? " + " + info.monorepo.runner : ""} · ${info.monorepo.packages} paquetes · los comandos corren desde la raíz`);
}
const nodeModules = fs.existsSync(path.join(root, "node_modules"));
if (!nodeModules && (skipInstall || !info.commands.install)) {
  console.log("WARN node_modules ausente y no se instala: build/test/typecheck van a fallar por dependencias, no por el código");
}
if (!cmds.length && !extraCmds.length) {
  console.log("SKIP sin comandos detectados (agregá scripts build/test/lint o pasá --cmd \"...\")");
  process.exit(0);
}

// Entorno minimo: lo que un build necesita y nada mas. Un postinstall de un repo ajeno no tiene por
// que ver tus tokens. Con --keep-env heredas todo, bajo tu responsabilidad.
function buildEnv() {
  const base = {
    CI: "1", NEXT_TELEMETRY_DISABLED: "1", TURBO_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
    FORCE_COLOR: "0", NODE_ENV: process.env.NODE_ENV ?? "test",
  };
  if (keepEnv) return { ...process.env, ...base };
  const PASS = ["PATH", "HOME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot",
    "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA"];
  const passed = Object.fromEntries(PASS.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]));
  return { ...passed, ...base };
}

let failed = false;
function run(key, cmd) {
  const secsLimit = globalTimeout ?? TIMEOUT[key] ?? 600;
  const t0 = Date.now();
  const r = spawnSync(cmd, {
    cwd: root, shell: true, encoding: "utf8", timeout: secsLimit * 1000, maxBuffer: 64 * 1024 * 1024,
    env: buildEnv(),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.status === 0) { console.log(`PASS ${key} (${secs}s) · ${cmd}`); return true; }
  const timedOut = r.error && /ETIMEDOUT|timed out/i.test(r.error.message ?? "");
  const tail = ((r.stdout ?? "") + "\n" + (r.stderr ?? "")).trim().split("\n").filter((l) => l.trim()).slice(-14).join("\n");
  const level = BLOCKING.has(key) ? "FAIL" : "WARN";
  console.log(`${level} ${key} (${secs}s)${timedOut ? ` TIMEOUT a los ${secsLimit}s` : ""} · ${cmd}\n${tail}${r.error && !timedOut ? "\n" + r.error.message : ""}`);
  return level !== "FAIL";
}

for (const k of cmds) {
  const ok = run(k, info.commands[k]);
  if (!ok) {
    failed = true;
    if (k === "install") { console.log("SKIP resto de comandos: sin dependencias instaladas no tiene sentido seguir"); break; }
  }
}
for (const c of extraCmds) if (!run("extra", c)) failed = true;

process.exit(failed ? 1 : 0);
