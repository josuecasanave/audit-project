# Lentes de plataforma: ¿está la pieza, y está cableada?

Estas tres lentes no preguntan "¿esto es explotable?" sino "¿esto existe, funciona de punta a punta
y está configurado?". `scripts/detect.mjs` ya resolvió de forma determinista qué áreas tienen rastro
en el repo (`platform[].status`), con las dependencias, carpetas y archivos que lo prueban. La lente
parte de ahí y verifica el cableado; no vuelve a buscar lo que el script ya encontró.

## Tres tipos de hallazgo

| kind | Qué es | Qué tiene que traer |
|---|---|---|
| `riesgo` | algo escrito está mal | archivo:línea + evidencia literal |
| `incompleto` | la pieza existe pero le falta algo | archivo:línea del punto donde falta |
| `ausente` | la pieza no está | la ruta donde **debería** estar según la convención del repo, terminada en `(no existe)`, + el comando de búsqueda que devolvió vacío |

Un `ausente` sin búsqueda hecha no vale, y el verificador tiene instrucción explícita de buscar por
su cuenta en todos los workspaces (y en `.env.example`, por si la pieza vive en configuración
externa) antes de aceptarlo.

## Severidad de una ausencia

Una ausencia es grave solo si el proyecto **ya la necesita**:

- **alta**: cobra en producción y no hay webhook de suscripción; hay usuarios reales y no hay
  monitoring; vende en la UE y no hay páginas legales; hay uploads públicos sin control de acceso.
- **media**: pieza que el roadmap obviamente pide y que va a doler retrofitear (i18n, jobs,
  onboarding con creación de organización).
- **baja**: pieza que un MVP pre-lanzamiento todavía no necesita (notificaciones in-app, blog,
  analytics de producto).

Nunca reportes "falta X" porque X está en una lista de features. Reportalo porque este proyecto,
como está hoy, se rompe o pierde plata sin X.

---

## `plat-core` — el núcleo del SaaS

| Área | Qué se verifica |
|---|---|
| **auth** | registro, login (y social si está declarado), reset, verificación de email, organizaciones/equipos, invitaciones, cambio de rol, sesión del lado servidor usable desde las apps |
| **payments** | planes definidos en un solo lugar, checkout, portal de cliente, webhooks de suscripción (creada/actualizada/cancelada/pago fallido), upgrade y downgrade, estado del plan leído de la DB y no del cliente, período de gracia |
| **database** | schema, migraciones versionadas y aplicables, seed, índices en FKs y en las columnas por las que se filtra, columna de tenant en las tablas del negocio, borrado en cascada coherente |
| **api** | contratos tipados de punta a punta, errores uniformes, cliente generado o inferido, versionado si hay consumidores externos |
| **storage** | proveedor S3-compatible configurado, subida por URL prefirmada (no por el servidor), lectura protegida, límite de tamaño y tipo, borrado del archivo cuando se borra el recurso |
| **ai** | proveedor y modelo configurables, streaming, límite de uso y de costo por usuario, manejo de rate limit del proveedor |

## `plat-ops` — lo que sostiene producción

| Área | Qué se verifica |
|---|---|
| **mail** | proveedor configurado, plantillas reales (no placeholders), los mails del ciclo de vida (verificación, reset, invitación, recibo y cambio de plan), preview en desarrollo, remitente y dominio, salida a consola cuando no hay credenciales |
| **jobs / cron** | runner (trigger.dev, QStash, inngest, cron de la plataforma), handlers tipados, **endpoint de cron protegido con secreto**, reintentos con límite, y las tareas que el proyecto obviamente necesita: limpiar sesiones, reintentar mails, sincronizar suscripciones |
| **notifications** | centro in-app, preferencias por usuario, canal email conectado al de mail, marcado de leídas |
| **monitoring** | Sentry u otro inicializado en cliente **y** servidor, source maps subidos, scrubbing de datos personales, alertas configuradas |
| **e2e** | Playwright/Cypress configurado y cubriendo los flujos que dan plata (signup, checkout, invitar a un equipo), corriendo en CI, con datos de prueba propios |
| **dev-offline** | compose con la base, storage local (MinIO), mails a consola, README que explique arrancar sin cuentas de terceros |
| **deployment** | target claro (Vercel/Docker/otro), variables documentadas y sincronizadas con `.env.example`, healthcheck, build reproducible |

## `plat-growth` — marketing, contenido y administración

| Área | Qué se verifica |
|---|---|
| **blog** | fuente de contenido (MDX/CMS), listado **y** detalle, multi-idioma si el proyecto lo es, feed |
| **docs** | buscador, navegación, contenido real y no el de ejemplo del template |
| **seo** | metadata por página (no una global repetida), Open Graph con imagen, sitemap, robots, canonical, hreflang si hay idiomas |
| **legal** | privacidad y términos con contenido propio (no lorem ni el template sin completar), enlazados desde el footer, en todos los idiomas |
| **contact** | el formulario efectivamente envía a algún lado (mail/CRM), con anti-spam y rate limit |
| **analytics** | proveedor cargado, eventos de producto además de pageviews, consentimiento respetado |
| **i18n** | ruteo por idioma, fallback, y **claves faltantes entre archivos de mensajes** (comparar los idiomas entre sí es un hallazgo concreto y barato) |
| **onboarding** | flujo multi-paso, creación de organización, foto de perfil, estado persistido para poder retomarlo, y qué pasa si el usuario lo abandona |
| **admin** | superadmin verificado **en el servidor**, gestión de usuarios y organizaciones, impersonación con audit log |
| **ui** | sistema de componentes compartido y realmente usado; no el mismo botón duplicado en cada app |

## Lo que estas lentes no hacen

No juzgan si una feature "vale la pena" ni proponen roadmap. No revisan el contenido legal desde lo
jurídico. No verifican lo que vive fuera del repo: si el webhook está dado de alta en el panel de
Stripe, si el dominio de mail está verificado, si las variables están cargadas en el hosting. Eso va
a la sección "Lo que no revisamos" del informe.
