# Lentes de riesgo: qué es hallazgo y qué no

Cada lente corre en su propio agente con el stack detectado y el mapa de workspaces como entrada.
Un hallazgo válido tiene **archivo, línea, evidencia literal (≤3 líneas), por qué importa en este
proyecto y fix concreto**. Lo demás es opinión y no pasa el verificador.

| Lente | Hallazgo real (ejemplos) | No es hallazgo |
|---|---|---|
| authn | JWT en `localStorage` (`auth.ts:42`); login que responde distinto si el email existe; sin rate limit en `/api/auth/sign-in`; contraseñas con MD5/SHA1; sesión sin expiración; `getSession()` en vez de `getUser()` (Supabase); reset de contraseña con token sin expirar | "conviene usar OAuth"; "faltaría MFA" sin contexto de riesgo |
| authz | `DELETE /api/items/[id]` que no chequea dueño; query sin filtrar por `organizationId` en un SaaS multi-tenant; rol leído del cliente (`req.body.role`); tabla sin RLS con anon key; superadmin protegido solo por ocultar el link en el front; impersonar sin audit log | "los permisos podrían ser más granulares" |
| input | `db.query("... " + req.query.q)`; `dangerouslySetInnerHTML={{__html: user.bio}}`; `fetch(req.body.url)` sin allowlist; upload sin límite ni validación de tipo; body sin schema en endpoint que escribe; MDX que ejecuta componentes de contenido no confiable | "usar zod en todos lados" si ya hay validación equivalente |
| secrets | `sk_live_` en un archivo; `.env` trackeado en cualquier workspace; `NEXT_PUBLIC_SERVICE_ROLE`; `packages/database` importado desde un componente `"use client"`; `console.log(token)`; `cors({ origin: "*" })` con credenciales; `DEBUG=True` en settings de prod; el código lee `RESEND_API_KEY` pero no está en `.env.example` | keys en `.env.example` con valores obviamente falsos |
| http | sin CSP/HSTS en prod; server action que muta sin origin check ni SameSite; cookie de sesión sin `HttpOnly`; `redirect(searchParams.next)` sin validar; webhook de Stripe sin `constructEvent`; sin idempotencia en webhook de pago; URL prefirmada sin expiración o con bucket público | "agregar helmet" si los headers ya están puestos a mano |
| deps | sin lockfile; dos lockfiles distintos; `next@12` en 2026; `react` en versiones distintas entre workspaces; `pnpm audit` con criticals; postinstall que baja binarios; sin Dependabot/Renovate; Dockerfile `FROM node:latest` como root | dependencias una minor atrás |
| errors | `catch (e) {}`; promesa sin `await` en handler; 500 que devuelve `err.stack`; llamada a Stripe/Resend/OpenAI sin timeout; dos writes que deberían ser una transacción; webhook o job que reprocesa el mismo evento; job sin límite de reintentos | "faltaría Sentry" si hay otro sistema de errores |
| quality | cero tests sobre checkout/auth/permisos/tenant; CI que no corre tests; `any` en la capa de datos; `apps/web` importando `apps/marketing/src/...`; `packages/ui` importando de una app; función de 400 líneas con 6 responsabilidades; README o `AGENTS.md` que describe scripts que no existen | estilo, nombres, preferencias de arquitectura |

## Las dos reglas que deciden si algo es riesgo

Prestadas de [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) (MIT).
Son el filtro más barato que tiene esta skill y el que más sube la señal del informe.

**1. Escenario de ataque concreto.** Un hallazgo `kind: "riesgo"` trae el campo `attack` con quién es
el atacante (anónimo, usuario logueado, admin de otro tenant, empleado), qué hace paso a paso, y qué
obtiene. Si para escribirlo hace falta "podría", "teóricamente" o "en algún caso", no es riesgo.

**2. Defensa en profundidad no es vulnerabilidad.** Si la capa A ya previene el ataque, que falte la
capa B es `kind: "endurecimiento"`: se reporta, con severidad baja y sin `attack`, en su propia
sección del informe. No compite con lo que sí se explota.

*Ejemplo real:* "la app no emite ninguna cabecera de seguridad" en un informe que además dice "hoy no
hay camino explotable que estas cabeceras estén conteniendo" es endurecimiento, no una media. Antes
ocupaba una fila con la misma jerarquía visual que una escalada a superadmin.

**Severidad, con un solo criterio: ¿esto derrota una frontera de seguridad explícita del proyecto?**
Si sí, alta o crítica. Si no, media o baja.

## Lentes profundas (solo con `focus: profundo`)

| Lente | Qué mira | Por qué no la cubren las otras |
|---|---|---|
| `logica` | máquinas de estado (saltear pasos, repetir flujos), carreras (doble gasto, doble aprobación), números (negativos, overflow, coerción), tiempo (expiraciones, ventanas, clock skew), defaults y fallbacks inseguros | las demás preguntan si el código está mal escrito; esta pregunta si la regla de negocio se puede doblar |
| `abuso` | export/backup como exfiltración, import como bypass de validación, búsqueda y filtros de oráculo, enumeración por diferencias de tiempo o mensaje, borradores filtrados por sitemap o caché, webhooks salientes como SSRF | son features que funcionan como fueron escritas: no hay bug que encontrar, hay un uso que nadie previó |
| `cadena` | combina los hallazgos ya confirmados en escenarios peores que sus partes | corre DESPUÉS de las demás y toma su salida como entrada. Una cadena solo vale si es más grave que su peor eslabón; si no, son dos hallazgos separados que ya están reportados |

## Severidad (el verificador la ajusta)

- **crítica**: explotación directa con impacto alto (RCE, secretos en el repo, IDOR sobre datos de terceros, fuga entre tenants, pagos sin verificar firma).
- **alta**: fallo de control de seguridad que requiere una condición extra, o pérdida de datos/dinero plausible.
- **media**: debilidad real que facilita ataques o incidentes (sin rate limit, cookies laxas, errores tragados en flujo crítico).
- **baja**: higiene y mantenibilidad con impacto acotado.

## La lente viaja con el hallazgo

Cada hallazgo confirmado lleva `lens` (la clave de la lente que lo encontró) de punta a punta:
columna en la tabla del informe, etiqueta en `PENDIENTES.md`, campo en `estado.json`, y criterio de
agrupación de `scripts/tarjetas.mjs`. Un informe sin ese campo no puede generar las tarjetas.

El informe además abre la tabla con la reconciliación: *brutos → refutados → confirmados →
duplicados fusionados → los que quedan*, y el número del encabezado tiene que coincidir con la
cantidad de filas. Si no cierran entre sí, el informe pierde toda su autoridad.

## El ancla

`scripts/anchor.mjs` corre lo que el proyecto ya tiene (`install`, `typecheck`, `lint`, `build`,
`test`, `audit`, y `e2e` con `--with-e2e`), según `detect.mjs`, y reporta PASS/FAIL/WARN/SKIP. Es lo
único del informe que no es opinión.

- **Instala por defecto.** En un monorepo sin `node_modules` todo falla por dependencias y el
  informe queda inútil. Solo pasá `--skip-install` si el repo ya está instalado.
- `audit` y `e2e` reportan **WARN**, no FAIL: son informativos y no deberían teñir el veredicto.
- Timeouts por comando (build e install hasta 20 min). Si algo corta, la línea lo dice.
- Si el usuario tiene otros comandos (`make check`), pasalos con `--cmd "make check"`.
