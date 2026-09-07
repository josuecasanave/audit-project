# Audit-project

A Claude skill that audits an **in-progress** software project — any stack — **without touching a
single line of code**, and hands the result to whoever (or whatever) works on the repo next.

It asks one question first: **English or Español?** The report, the handoff files and the cards come
out in that language. The analysis is identical either way — same lenses, same ids, same severities,
same numbers.

> Skill de Claude que audita un proyecto **en curso**, en cualquier stack, **sin tocar el código**.
> Pregunta el idioma al inicio y entrega el mismo análisis en inglés o español.

---

## Why this instead of "review my repo"

A single agent reading a whole repo produces a plausible list. This produces a *checked* one:

1. **Deterministic detection.** A script (`detect.mjs`) maps the stack, the monorepo, the commands
   and 23 platform areas — no tokens, no guessing.
2. **11 to 14 lenses in parallel.** Each one has its own context and looks at exactly one thing:
   authn, authz, input, secrets, http, deps, errors, quality, three platform lenses, and — with
   `focus: profundo` — business logic, feature abuse and attack chains.
3. **A fresh skeptic per finding.** It never saw the audit. It opens the file, tries to refute the
   finding, and lowers inflated severities. Whatever it kills never reaches the report.
4. **An anchor that executes.** The repo's own `install / typecheck / lint / build / test`. The only
   part of the report that is not opinion. It is **opt-in**: running those commands runs the audited
   repo's code on your machine, so it never happens unless you ask for it (see Safety below).
5. **A handoff package**, so the work outlives the report.

Two rules decide whether something is a risk at all: a **concrete attack scenario** (who, what steps,
what they get — no "could" or "theoretically"), and **defense in depth is not a vulnerability**
(a missing second layer is `hardening`, filed separately so it doesn't compete with what is actually
exploitable).

## What you get

| File (es / en) | What it is |
|---|---|
| `auditoria-<project>.md` / `audit-<project>.md` | the report: executive summary, coverage table, reconciliation line, findings index, detail, hardening, what was dropped and why |
| `PROYECTO.md` / `PROJECT.md` | project map for the next agent: where each of the 23 areas lives, commands, entry points, invariants, health |
| `PENDIENTES.md` / `TODO.md` | open work as a checklist, each item with id, severity, `file:line`, fix and a "done when" criterion tied to a real command |
| `estado.json` | the same, structured for machines — same name, keys and enums in both languages, plus `lang` |
| `tarjetas/lentes.png` | one card per lens, ordered by severity, with the anchor on top |

## Safety

This skill is meant to be pointed at repositories you did not write, so the boundaries are explicit:

- **It never writes to your code.** The only files it creates are the report and the handoff package,
  and it refuses to overwrite an existing file without `--force`.
- **It does not execute the audited repo by default.** The anchor is the one part that runs that
  repo's own scripts, and it will not start without an explicit `--yes` (`runAnchor: true` from the
  workflow). Without it you still get the full audit, minus the "what actually ran" section.
- **When you do say yes, it runs with a minimal environment.** `PATH`, `HOME` and a few build flags —
  not your tokens or cloud credentials. `--keep-env` restores the old behavior if you need it.
- **Repo content is treated as data, never as instructions.** Every lens and verifier prompt says so
  explicitly, and a file that tries to give the auditor orders is reported as a finding.

## Install

Drop the folder into your skills directory (rename it `audit-project`), or install it however your
Claude client takes skills. It needs **Node 18+** and no dependencies. Playwright/Chromium is
optional — without it the cards are still written as HTML.

The scripts have their own test suite (`npm test`, Node's built-in runner, no packages to install),
which runs on CI against Node 18, 20 and 22.

## Use

Just ask, in either language:

```
audit this project          ·  auditá este proyecto
what's missing before prod  ·  ¿qué le falta antes de producción?
how safe is this?           ·  ¿qué tan seguro es esto?
```

The scripts also run standalone, no agents involved:

```bash
node scripts/detect.mjs   <project> --pretty        # stack + 23 platform areas, as JSON
node scripts/handoff.mjs  <project> --out .audit    # add --lang en for PROJECT.md / TODO.md
node scripts/tarjetas.mjs <project> --out .audit    # lens cards (inherits the language)
node scripts/anchor.mjs   <project> --yes           # run the repo's own commands (opt-in)
```

`--force` is required to overwrite anything that already exists. The skill never writes to your
`README.md` or `AGENTS.md`; it prints the line to add and leaves the decision to you.

## Scope

Static analysis of a repository, plus the repo's own test suite. It does **not** run your app with
real data, does not test infrastructure (DNS, WAF, backups, cloud permissions), is not a dynamic
pentest, and does not review provider accounts (MFA, key rotation, webhooks configured in a
dashboard) or legal content from a legal standpoint. Every report ends with that list.

And it never fixes anything. Applying fixes is a separate job, one change at a time, with approval.

## License

MIT — see [`LICENSE`](LICENSE).

The two rules for what counts as a risk, and the attack classes used by the deep lenses, are
inspired by [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)
(also MIT).
