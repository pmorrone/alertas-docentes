# Alertas APD: bot de Telegram para docentes

Bot que avisa por Telegram a profesores (principalmente **suplentes**) cuando la DGCyE de la Provincia de Buenos Aires publica en **Actos Públicos Digitales (APD)** una oferta que coincide con sus criterios.

Este proyecto también es portfolio personal (búsqueda laboral en Node.js). Priorizar código claro, tipado, testeado y un README que explique las decisiones.

## Convenciones

- **Idioma**: código, nombres, comentarios, commits y PRs en **inglés**. Mensajes del bot para docentes en **español**.
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`).
- Una rama + PR por paso del plan; nunca commitear directo a `main`.

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
- **Valores con espacios van entre comillas** (y URL-encoded): `fq=descdistrito:"general pueyrredon"`. Sin comillas Solr interpreta la segunda palabra como otro término y el filtro falla.
- Varios valores: `fq=descnivelmodalidad:(primaria OR secundaria)`.
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

| Campo | Ejemplo | Uso |
|---|---|---|
| `iddetalle` / `id` | 4402588 | **ID único** de la oferta (deduplicación) |
| `idoferta`, `ige` | 4418871 | Identificadores mostrados en la web |
| `estado` | "Publicada" | Filtro |
| `descdistrito`, `numdistrito` | "PILAR", 83 | Criterio: distrito |
| `descnivelmodalidad`, `nivelmodalidad` | "SECUNDARIA" / "ARTISTICA" | Criterio: nivel |
| `cargo`, `descripcionarea`, `descripcioncargo` | "Maestro de Danza Primaria (MDP)" | Criterio: cargo/materia |
| `areaincumbencia` | "MDP", "MCS", "IGS" | Código de área (matching exacto) |
| `turno` | "M" / "T" / "N" / "MT" (combinados) | Criterio: turno (tratar como conjunto de letras) |
| `supl_revista` | "S" | Suplencia (filtro "solo suplencias") |
| `jornada`, `hsmodulos` | "JS", 2 | Info para el aviso |
| `escuela`, `domiciliodesempeno`, `cursodivision` | "0083PP0032", ... | Info para el aviso |
| `supl_desde`, `supl_hasta`, `tomaposesion` | ISO date | Info para el aviso |
| `iniciooferta`, `finoferta` | ISO datetime UTC | Publicación y **cierre** (mostrar en hora Argentina) |
| `lunes` … `sabado` | "15 A 17", "8.40 a 9.40", "7,30 A 9,40 HS" | Horarios en texto libre (v2) |
| `observaciones` | texto | Info para el aviso |

### Datos personales: NO guardar ni mostrar

`cuilautor`, `reemp_apeynom`, `reemp_cuil`, `reemp_motivo`, `nombreganador`, `cuilganador`, `postulacion_idganador`. Descartarlos al normalizar, antes de persistir o loguear nada.

### Problemas conocidos

- **Encoding**: la API responde en **Windows-1252** sin declararlo (confirmado con iconv), y al leerla como UTF-8 aparece `�` (`2�B`, `ca�uelas`, `TECNOL�GICO`). La web oficial muestra bien los acentos. En el collector, leer la respuesta como bytes y decodificar con `new TextDecoder('windows-1252')` (verificar con un test que `cursodivision` quede `2°B`). Si al final la API devuelve `�` literal, el dato ya viene roto y solo queda normalizar.
- Los horarios por día no siguen un formato fijo.
- La API no es oficial ni está documentada. Consultar con baja frecuencia (cada 15–30 min), con un User-Agent identificable, timeouts, reintentos con backoff y tolerancia a cambios de esquema (validar con zod o similar).

## Arquitectura

```
src/
  collector/   cliente Solr + normalización (doc crudo -> Oferta, descartando datos personales)
  matcher/     lógica pura: (Oferta, Criterios) -> boolean. Sin I/O, 100% testeable
  notifier/    formateo del mensaje + envío por Telegram
  bot/         comandos y conversaciones de grammY
  db/          repositorios: docentes, alertas (N por docente), ofertas_vistas, notificaciones_enviadas
  scheduler.ts ciclo: collect -> guardar nuevas -> match -> notify
  index.ts
```

Flujo de cada ciclo:
1. Traer las ofertas `Publicada` (paginadas, toda la provincia).
2. Upsert por `iddetalle`; quedarse con las nuevas.
3. Para cada oferta nueva y cada docente activo, si hay match y no existe ya (docente, iddetalle) en `notificaciones_enviadas`, enviar el aviso y registrarlo.

### Alertas por docente (v1)

Cada docente puede tener **varias alertas** (relación docente 1—N alertas, tope configurable `MAX_ALERTS_PER_USER`; piloto: **3**). Ejemplo: "Historia · Tandil · Mañana" y "Geografía · Ayacucho y Rauch · Tarde".
- Dentro de una alerta, cada campo acepta varios valores y se combinan con OR (Tandil **o** Ayacucho); entre campos, AND (distrito **y** área **y** turno).
- Si una oferta coincide con dos alertas del mismo docente, se avisa **una sola vez** (dedup por `(docente, iddetalle)`), indicando qué alerta(s) coincidieron.
- Cada alerta se puede ver, pausar o borrar por separado ("Mis alertas"; por voz: "borrá la de geografía").

Campos de una alerta:
- Distritos (uno o varios)
- Niveles/modalidades
- Cargos/áreas (por `areaincumbencia` o texto)
- Turnos (M/T/N, opcional)
- Solo suplencias (sí/no)

### v2

- Franjas horarias libres por día: parsear `lunes`..`sabado` y descartar las ofertas que se superpongan. Si no se puede parsear un horario, avisar igual con la nota "horario no reconocido".
- Avisar cuando una oferta notificada cambia de estado (vía `check/offer`).

### UX del bot (requisito de Pablo)

**Principio (actualizado 2026-11-13): voice-first.** El docente no debería tener que navegar menús: toca "Iniciar" una vez y desde ahí configura todo hablando (nota de voz) o escribiendo libre. El bot responde guiando ("Contame por audio qué cargos buscás"). Los botones quedan solo para confirmar ([Confirmar] [Editar]) y como alternativa para quien no quiera hablar. Límites de Telegram: el usuario tiene que tocar Iniciar la primera vez (un bot no puede escribir primero) y tiene que mantener apretado el micrófono para grabar (el bot no puede activar la grabación). Ver "Fase 2".

Flujo alternativo con botones (fallback):

El docente NO escribe comandos ni texto libre para configurar: todo con **botones (inline keyboards)**. Solo escribe `/start`.
Flujo: /start -> elegir distrito(s) (buscador por texto con sugerencias o lista paginada) -> nivel (botones) -> materias/áreas (botones con las más comunes de ese nivel + buscar) -> turno (M/T/N, multi-selección) -> ¿solo suplencias? (Sí/No) -> resumen con [Confirmar] [Editar].
Un menú principal persistente con botones: "Mis criterios", "Pausar avisos", "Darme de baja". Cada aviso trae botón "Ver en ABC".
Las opciones (distritos, niveles, áreas) se obtienen de facets de Solr (`facet=true&facet.field=descdistrito`), no hardcodeadas.
v2 opcional: Telegram Mini App (formulario web dentro de Telegram) para la carga de horarios.

### Comandos del bot

`/start`, `/criterios` (alta/edición guiada), `/ver`, `/pausar`, `/reanudar`, `/baja` (borra los datos del docente).

### Ejemplo de aviso

> 🆕 **Matemática – Ciclo Superior (MCS)**, Secundaria, Tandil
> 4to B · Turno M · Suplencia del 16/11 al 24/11
> Lun 8.40 a 9.40 · Mar 7.30 a 9.40
> ⏰ Cierra: 13/11 07:30
> 🔗 misservicios.abc.gob.ar/actos.publicos.digitales/

## Plan inicial

1. Scaffold: TS, ESLint/Prettier, Vitest, estructura de carpetas. ✅
2. Collector + normalización, con tests sobre `fixtures/oferta-publicada.json`. ✅
3. Matcher con tests. ✅
4. DB + scheduler. ✅
5. Bot de Telegram conversacional en texto libre con intérprete propio (reglas + fuzzy sobre catálogos) + confirmación con botón (crear el bot con @BotFather). ✅
6. Notas de voz: transcripción (interfaz `Transcriber`).
7. Dockerfile, CI y README. ✅
8. Prueba piloto en un distrito con 10–20 docentes. Acceso por **códigos de invitación** de un solo uso vía deep link (`t.me/<bot>?start=<codigo>`); sin código válido el bot responde "estamos en etapa de prueba" y anota en lista de espera. Tope global de usuarios configurable (`MAX_USERS`) y comando de admin (solo el chat_id de Pablo) para generar códigos y ver uso/costo.
9. (Opcional) Menús con botones como alternativa, horarios disponibles, aviso de cambio de estado.

## Asistente conversacional (texto y voz) — pasos 5 y 6

Diferencial frente a otros bots: el docente puede escribir o mandar un audio ("buscame cargos de historia en Tandil, turno mañana") y el bot lo entiende.

**Decisión (2026-11-14): por ahora NO se usa la API de Claude ni ninguna API paga de LLM.** El entendimiento del lenguaje se hace con un **intérprete propio** (reglas + búsqueda aproximada sobre los catálogos). El LLM queda detrás de una interfaz opcional para más adelante.

Pipeline:
1. **Voz → texto**: Telegram entrega las notas de voz en OGG/Opus. Se transcriben con **whisper.cpp local** (gratis, sin API key, el audio no sale del servidor; rápido en Apple Silicon). Convertir a WAV 16 kHz mono con ffmpeg. Interfaz `Transcriber` para poder cambiar de proveedor.
2. **Texto → criterios con el intérprete propio** (`src/nlu/`):
   - Normalizar: minúsculas, sin tildes, sin signos.
   - Buscar distritos, niveles y áreas en los catálogos (`fixtures/catalogo-*.json`, campo `normalizado`) con búsqueda aproximada (fuzzy, p. ej. Levenshtein o fuse.js) que tolere errores de tipeo/transcripción.
   - Palabras clave: mañana→M, tarde→T, noche→N, vespertino/vespertina→T o N según corresponda, suplencia/suplente→S, provisional→P.
   - Diccionario de sinónimos editable (`data/sinonimos.json`): "mardel"/"mar del plata"→General Pueyrredon, "mate"→Matemática, "ingles"→IGS, etc.
   - Intenciones simples por palabras clave: crear alerta, ver mis alertas, borrar alerta ("borrá la de geografía"), buscar ahora ("¿qué hay hoy…?"), ayuda.
   - Si falta un dato obligatorio o hay ambigüedad (dos áreas parecidas), **preguntar** con botones de opciones.
   - Determinístico y 100 % testeable: tests con frases reales de ejemplo (incluidas transcripciones con errores).
3. **Confirmación**: el bot muestra el resumen ("Historia · Tandil · Mañana") con [✅ Sí] [✏️ Cambiar]; recién al confirmar se guarda en SQLite.
4. **LLM opcional (futuro)**: interfaz `LlmClient` usada solo como respaldo cuando el intérprete no entiende. Implementación candidata: Ollama local (gratis). Claude API solo si Pablo lo decide más adelante. Desactivado por defecto (`LLM_PROVIDER=none`).

Reglas:
- Voice-first: el docente configura hablando o escribiendo libre. Los botones se usan para confirmar ([✅ Sí] [✏️ Cambiar]) y como plan B si el asistente no está disponible.
- Si en el futuro se activa un LLM, no mandarle datos personales (ya se descartan en el collector).
- Claves (Telegram y, si algún día se usan, LLM/STT por API) solo en `.env`.
- Tests del intérprete con frases de ejemplo; si se activa un LLM, con respuestas simuladas (mock), sin llamar a APIs en CI.
- Costo cero: no se usa ningún LLM pago. El intérprete propio corre local y nunca en el ciclo del collector ni del matcher. Si en el futuro se activa un LLM (`LLM_PROVIDER`), poner límite por docente (p. ej. 20 mensajes/día), tope de gasto y fallback al intérprete propio.

