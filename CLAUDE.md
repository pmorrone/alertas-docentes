# Alertas APD: bot de Telegram para docentes

Bot que avisa por Telegram a profesores (principalmente **suplentes**) cuando la DGCyE de la Provincia de Buenos Aires publica en **Actos Públicos Digitales (APD)** una oferta que coincide con sus criterios.

Este proyecto también es portfolio personal (búsqueda laboral en Node.js). Priorizar código claro, tipado, testeado y un README que explique las decisiones.

## Stack

- **Node.js (LTS) + TypeScript** (strict).
- **grammY** para el bot de Telegram (conversaciones y teclados inline para cargar criterios).
- **SQLite** (better-sqlite3 o similar), con acceso encapsulado en un repositorio para poder migrar a Postgres.
- Scheduler simple dentro del mismo proceso (setInterval o node-cron).
- `fetch` nativo para la API.
- **Vitest** para tests, ESLint + Prettier, Dockerfile y GitHub Actions (lint + test).
- Configuración por variables de entorno (`TELEGRAM_BOT_TOKEN`, `POLL_INTERVAL_MIN`, `DB_PATH`). Nunca commitear secretos; usar `.env` + `.env.example`.

## Fuente de datos (descubierta el 2026-11-12)

La web pública es `https://misservicios.abc.gob.ar/actos.publicos.digitales/`. Por detrás consulta un **Solr público, sin login, cookie ni token**.

### Listado de ofertas

```
GET https://servicios3.abc.gob.ar/valoracion.docente/api/apd.oferta.encabezado/select
    ?q=*:*
    &fq=estado:publicada
    &rows=500&start=0
    &sort=iniciooferta desc
    &wt=json
```

- Filtros adicionales con `fq` (se pueden repetir): `fq=descdistrito:tandil`, `fq=descnivelmodalidad:secundaria`, etc. Los valores van en minúscula.
- La web agrega `json.wrf=jQuery...` (JSONP) y `_=timestamp`. **No usarlos**: sin ellos la respuesta es JSON puro.
- Respuesta: `response.numFound`, `response.start` y `response.docs[]`.
- El 12/11/2026 había **2670 ofertas publicadas** en toda la provincia.
- Para traer solo lo nuevo: `fq=iniciooferta:[<ISO del último visto> TO *]`, o paginar todo y deduplicar por `iddetalle`.

### Estado de ofertas puntuales

```
GET https://servicios3.abc.gob.ar/valoracion.docente/api/apd.oferta.encabezado/check/offer/?idop=<base64("iddetalle1|iddetalle2|...")>
```

Devuelve `[{estado, iddetalle, idoferta, ...}]`. Sirve para saber si una oferta ya fue designada, anulada o quedó desierta.

### Estados posibles

`Publicada`, `Designada`, `Anulada`, `Renunciada`, `Desierta` (y posiblemente otros). Solo se notifica sobre **Publicada**.

### Campos útiles de cada doc

| Campo                                            | Ejemplo                                    | Uso                                                  |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------- |
| `iddetalle` / `id`                               | 4402588                                    | **ID único** de la oferta (deduplicación)            |
| `idoferta`, `ige`                                | 4418871                                    | Identificadores mostrados en la web                  |
| `estado`                                         | "Publicada"                                | Filtro                                               |
| `descdistrito`, `numdistrito`                    | "PILAR", 83                                | Criterio: distrito                                   |
| `descnivelmodalidad`, `nivelmodalidad`           | "SECUNDARIA" / "ARTISTICA"                 | Criterio: nivel                                      |
| `cargo`, `descripcionarea`, `descripcioncargo`   | "Maestro de Danza Primaria (MDP)"          | Criterio: cargo/materia                              |
| `areaincumbencia`                                | "MDP", "MCS", "IGS"                        | Código de área (matching exacto)                     |
| `turno`                                          | "M" / "T" / "N"                            | Criterio: turno                                      |
| `supl_revista`                                   | "S"                                        | Suplencia (filtro "solo suplencias")                 |
| `jornada`, `hsmodulos`                           | "JS", 2                                    | Info para el aviso                                   |
| `escuela`, `domiciliodesempeno`, `cursodivision` | "0083PP0032", ...                          | Info para el aviso                                   |
| `supl_desde`, `supl_hasta`, `tomaposesion`       | ISO date                                   | Info para el aviso                                   |
| `iniciooferta`, `finoferta`                      | ISO datetime UTC                           | Publicación y **cierre** (mostrar en hora Argentina) |
| `lunes` … `sabado`                               | "15 A 17", "8.40 a 9.40", "7,30 A 9,40 HS" | Horarios en texto libre (v2)                         |
| `observaciones`                                  | texto                                      | Info para el aviso                                   |

### Datos personales: NO guardar ni mostrar

`cuilautor`, `reemp_apeynom`, `reemp_cuil`, `reemp_motivo`, `nombreganador`, `cuilganador`, `postulacion_idganador`. Descartarlos al normalizar, antes de persistir o loguear nada.

### Problemas conocidos

- Hay texto con encoding roto: `cursodivision: "2�B"` (debería ser `2°B`). Normalizar.
- Los horarios por día no siguen un formato fijo.
- La API no es oficial ni está documentada. Consultar con baja frecuencia (cada 15–30 min), con un User-Agent identificable, timeouts, reintentos con backoff y tolerancia a cambios de esquema (validar con zod o similar).

## Arquitectura

```
src/
  collector/   cliente Solr + normalización (doc crudo -> Oferta, descartando datos personales)
  matcher/     lógica pura: (Oferta, Criterios) -> boolean. Sin I/O, 100% testeable
  notifier/    formateo del mensaje + envío por Telegram
  bot/         comandos y conversaciones de grammY
  db/          repositorios: docentes, criterios, ofertas_vistas, notificaciones_enviadas
  scheduler.ts ciclo: collect -> guardar nuevas -> match -> notify
  index.ts
```

Flujo de cada ciclo:

1. Traer las ofertas `Publicada` (paginadas, toda la provincia).
2. Upsert por `iddetalle`; quedarse con las nuevas.
3. Para cada oferta nueva y cada docente activo, si hay match y no existe ya (docente, iddetalle) en `notificaciones_enviadas`, enviar el aviso y registrarlo.

### Criterios por docente (v1)

- Distritos (uno o varios)
- Niveles/modalidades
- Cargos/áreas (por `areaincumbencia` o texto)
- Turnos (M/T/N, opcional)
- Solo suplencias (sí/no)

### v2

- Franjas horarias libres por día: parsear `lunes`..`sabado` y descartar las ofertas que se superpongan. Si no se puede parsear un horario, avisar igual con la nota "horario no reconocido".
- Avisar cuando una oferta notificada cambia de estado (vía `check/offer`).

### Comandos del bot

`/start`, `/criterios` (alta/edición guiada), `/ver`, `/pausar`, `/reanudar`, `/baja` (borra los datos del docente).

### Ejemplo de aviso

> 🆕 **Matemática – Ciclo Superior (MCS)**, Secundaria, Tandil
> 4to B · Turno M · Suplencia del 16/11 al 24/11
> Lun 8.40 a 9.40 · Mar 7.30 a 9.40
> ⏰ Cierra: 13/11 07:30
> 🔗 misservicios.abc.gob.ar/actos.publicos.digitales/

## Plan inicial

1. Scaffold: TS, ESLint/Prettier, Vitest, estructura de carpetas.
2. Collector + normalización, con tests sobre `fixtures/oferta-publicada.json`.
3. Matcher con tests.
4. DB + scheduler.
5. Bot de Telegram (crear el bot con @BotFather).
6. Dockerfile, CI y README.
7. Prueba piloto en un distrito con 10–20 docentes.
