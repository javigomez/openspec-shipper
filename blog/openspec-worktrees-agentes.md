# Cómo monté un flujo de Git con OpenSpec para que varios agentes programen a la vez

Y para que yo pueda dedicarme a escribir mejores specs.

Si estás usando IA para desarrollar software, seguramente te suene esto:

- Tienes varios agentes capaces de escribir código
- Tienes OpenSpec para convertir ideas en cambios bien definidos
- Tienes GitHub para revisar y mergear
- Tienes tests, linters y validaciones

Todo parece preparado para que el sistema trabaje solo.

Pero entonces aparece una pregunta bastante incómoda:

**¿Cómo haces para que varios agentes trabajen a la vez sin convertir tu repo en una zona de guerra?**

Porque pedirle código a un agente es fácil.

Pedirle código a diez agentes en paralelo, cada uno en su rama, sin pisarse, sin ensuciar `main`, sin olvidarse de hacer commit, sin crear cinco ramas para la misma feature y sin bloquearse en la primera tarea que falla... eso ya es otro deporte.

Yo quería justo eso.

Un pequeño ejército de agentes.

No para que decidieran qué producto construir.

Para que implementaran un backlog de trabajo que yo ya había definido.

La idea era simple:

Yo preparo buenas tareas en OpenSpec.

Los agentes las van cogiendo.

Cada uno trabaja en su propio worktree.

Cuando terminan, me llega una pull request.

Yo reviso, mergeo y sigo con mi vida.

Idealmente desde la playa.

Con una bebida fría.

Y con GitHub mandándome notificaciones como si fuera un camarero trayendo tapas.

Tres días después de ponerlo a funcionar de verdad, el experimento ya no era
teórico.

En tres días se crearon 73 pull requests en el repo.

71 ya estaban mergeadas.

2 se cerraron sin merge.

Y los diffs de esas PRs sumaban 13.289 líneas tocadas en 419 archivos.

No eran sólo renames decorativos.

Había tests e2e web, infraestructura de Detox, mejoras de workers, cleanup de
artefactos nativos, endurecimiento de parsing de estado, errores de dominio,
hooks locales, documentación y una buena pila de refactors pequeños.

La métrica no pretende decir "líneas netas finales".

Cuenta volumen de trabajo revisable en PRs.

Pero precisamente eso es lo interesante: el sistema no sólo generaba código.

Generaba unidades revisables.

Con intención.

Con tests.

Con ramas.

Con historial.

## El problema real

OpenSpec encaja muy bien con desarrollo asistido por IA.

Porque fuerza algo que los agentes necesitan muchísimo:

**intención estructurada.**

Un cambio deja de ser:

> "Añade tests para la pantalla de settings."

Y pasa a ser:

```text
openspec/changes/settings-screen-web-e2e/
  proposal.md
  design.md
  tasks.md
  specs/settings-screen-web-e2e/spec.md
```

Esto es oro para un agente.

Tiene contexto.

Tiene tareas.

Tiene una definición de hecho.

Tiene specs.

Tiene menos excusas para improvisar.

Pero OpenSpec, por sí solo, no resuelve el problema de ejecución paralela.

Si tienes diez cambios activos y diez agentes disponibles, necesitas responder a preguntas muy terrenales:

- ¿Quién coge qué tarea?
- ¿Cómo evita un agente coger una tarea que ya está cogida?
- ¿Dónde escribe el código?
- ¿Cuándo hace commit?
- ¿Cuándo hace push?
- ¿Cuándo se crea la PR?
- ¿Cuándo se archiva el cambio de OpenSpec?
- ¿Qué pasa si un agente falla a mitad?

La primera versión de mi flujo no respondía bien a todo esto.

Y se notó.

## Primer intento: que cada feature viva en su rama desde el principio

Mi intuición inicial fue:

> Cada vez que creo una feature en OpenSpec, que se cree una rama y un worktree.

Suena lógico.

Un cambio, una rama.

Un cambio, un worktree.

Un cambio, una futura PR.

Pero había una trampa.

OpenSpec tiene una operación muy importante: `archive`.

Cuando archivas un cambio, OpenSpec no sólo mueve carpetas. También sincroniza los specs canónicos.

Y eso debería ocurrir con la visión completa de `main`.

Si archivas desde una rama de feature, estás archivando desde una foto incompleta del repo.

Es decir:

Otro agente puede haber mergeado una feature.

`main` puede haber cambiado.

Los specs canónicos pueden haber evolucionado.

Y tu worktree no tiene por qué saberlo.

Resultado:

Conflictos raros.

Specs que no reflejan el estado real.

Agentes seguros de sí mismos haciendo cosas peligrosas.

Lo normal.

Ahí cambié el modelo.

## El modelo que empezó a tener sentido

La regla que acabó funcionando fue esta:

**OpenSpec vive en `main`.**

**La implementación vive en worktrees.**

Más concretamente:

- Proponer cambios: `main`
- Continuar specs o diseño: `main`
- Listar backlog: `main`
- Implementar: `worktrees/<change-name>`
- Verificar implementación: `worktrees/<change-name>`
- Crear PR: desde la rama del worktree
- Archivar OpenSpec: `main`, después del merge

El flujo queda así:

```text
Humano
  ↓
crea backlog OpenSpec en main
  ↓
Apply worker
  ↓
crea/entra en worktrees/<change-name>
  ↓
implementa tareas
  ↓
commit
  ↓
Push worker
  ↓
push de la rama
  ↓
GitHub Action
  ↓
abre PR
  ↓
Humano revisa y mergea
  ↓
Archive worker
  ↓
archive en main
```

Esto cambió todo.

Porque `main` pasó a ser la cola canónica de trabajo.

Y cada worktree pasó a ser una mesa separada donde un agente podía ensuciarse las manos sin romper la cocina.

## La convención lo es casi todo

Para que esto funcione, los agentes no pueden ser creativos con los nombres.

Creatividad en producto, sí.

Creatividad en Git, no.

Las ramas siguen este patrón:

```text
feat/<change-name>
fix/<change-name>
refactor/<change-name>
chore/<change-name>
```

Los worktrees siguen este patrón:

```text
worktrees/<change-name>
```

Nada de:

```text
scratch/worktrees/feature-final
```

Nada de:

```text
feat/settings-screen-web-e2e-2
```

Nada de:

```text
agent-try-again-please-work
```

El nombre del worktree debe coincidir con el nombre del cambio OpenSpec.

Punto.

Esto permite usar Git como estado del sistema.

Si existe la rama, la tarea está reclamada.

Si existe el worktree, la tarea está en marcha.

Si existe una PR, la tarea está esperando revisión.

Si `tasks.md` está al 100%, la tarea está lista para push o archive.

Git deja de ser sólo historial.

Se convierte en parte del protocolo entre humanos y agentes.

## De cron a cola

Mi primera idea fue que esto viviera como tareas cron.

Codex Automations parecía encajar muy bien sobre el papel:

- un worker que aplica cambios
- un worker que empuja ramas
- un worker que sincroniza `main`
- un worker que archiva cambios mergeados

Cada uno se despierta cada cierto tiempo, mira el repo, hace su parte y se va.

Bonito.

Ordenado.

Caro.

Y, sobre todo, demasiado suelto.

El cron no tiene memoria de flujo.

No sabe que primero quieres aplicar una tarea concreta, luego empujar, luego
sincronizar, luego archivar.

No sabe que una tarea bloqueada no debería monopolizar la noche.

No sabe que un fallo de red no debería tener el mismo significado que una spec
mal diseñada.

Y tampoco se responsabiliza realmente del error.

Simplemente vuelve a despertarse.

Ahí apareció la idea de la cola.

Un `queue.md` tonto, deliberadamente aburrido:

```md
- [ ] apply test-18-migrate-cover-background-rntl
- [ ] ship
- [ ] sync
- [ ] archive
```

La diferencia parece pequeña, pero cambia el sistema.

Ahora hay orden.

Hay intención operacional.

Hay un siguiente paso.

Hay una marca de completado.

Hay una marca de bloqueo.

Y si algo falla, la cola se para.

No porque el agente sea dramático.

Porque seguir ejecutando tareas sobre un estado ambiguo es exactamente cómo
conviertes automatización en deuda.

De ahí salió una pieza nueva: una aplicación orquestadora externa.

No vive dentro del repo del producto.

Vive fuera.

Lee la cola.

Decide qué worker lanzar.

Ejecuta OpenCode dentro del repo objetivo.

Guarda logs.

Marca tareas como hechas o bloqueadas.

Y, muy importante, se responsabiliza de no seguir cuando el sistema empieza a
oler raro.

OpenSpec define la intención del producto.

Los workers hacen el trabajo.

El orquestador gobierna el ritmo.

Ese triángulo me está funcionando bastante mejor que el cron.

## Los cuatro workers

Terminé separando el flujo en cuatro workers.

### 1. Apply worker

Este worker mira el backlog de OpenSpec y busca trabajo pendiente.

Su trabajo es:

- leer cambios activos en `main`
- ignorar cambios incompletos
- saltar tareas ya reclamadas
- crear o entrar en `worktrees/<change-name>`
- implementar
- marcar tareas reales como completadas
- hacer commit

No crea PRs.

No archiva.

No empuja si no hace falta.

Sólo implementa.

Y una regla importante:

**No trabaja en producto desde `main`.**

Si va a tocar código, se va al worktree.

### 2. Push worker

Este worker no implementa.

Mira worktrees y pregunta:

> ¿Hay alguna tarea terminada al 100%?

Si la hay:

- entra en el worktree correcto
- valida el cambio
- corre checks razonables
- hace commit si hay cambios finales
- hace push de la rama

Y aquí hay una decisión importante:

**No crea la PR directamente.**

La PR la abre GitHub Actions cuando detecta el push.

Esto evita depender demasiado de `gh`, tokens, keychains y otros pequeños placeres de la vida moderna.

El worker empuja la rama.

GitHub se encarga de abrir o reutilizar la PR.

### 3. Archive worker

Este worker corre sólo en `main`.

Su trabajo es muy específico:

- comprobar que `main` está limpio
- hacer `git pull --ff-only`
- buscar cambios OpenSpec con tareas al 100%
- archivar sólo los cambios ya mergeados
- commitear el archive en `main`

Nada más.

No arregla código.

No crea PRs.

No toca worktrees.

No se pone creativo.

Es el contable del sistema.

Y necesitamos contables.

### 4. Main sync worker

Este worker no implementa ni archiva.

Sólo mira `main` y `origin/main`.

Su trabajo es mantener la raíz sincronizada:

- hacer `fetch`
- hacer `pull --ff-only` si sólo hay commits remotos
- empujar commits locales de proposal o archive si sólo hay commits locales
- rebasear cuando `main` quedó a la vez ahead y behind

Es aburrido a propósito.

Pero sin esta pieza, los demás workers empiezan a trabajar desde una idea vieja
de `main`.

## El primer gran fallo: todos querían la misma tarea

Una de las primeras cosas que pasó fue muy humana.

Había muchas tareas disponibles.

Pero el worker insistía en coger siempre la misma.

Aunque estuviera bloqueada.

Aunque hubiera otras tareas más fáciles.

Aunque yo estuviera mirando la pantalla pensando:

> "Pero si tienes nueve opciones más, criatura."

La solución fue tratar ramas, worktrees y PRs como locks.

Si una rama existe, esa tarea ya está reclamada.

Si un worktree existe, se continúa ese trabajo.

Si una PR existe, se espera al humano.

Si una tarea estuvo bloqueada en la última ejecución, se salta en la siguiente salvo que sea la única disponible.

Esto evitó que un agente se quedara toda la noche mirando la misma pared.

## El segundo gran fallo: `main` se ensuciaba

Otro problema fue más sutil.

Los agentes creaban cambios OpenSpec en `main`, pero no siempre hacían commit.

Entonces llegaba otro worker, veía `main` sucio y se negaba a trabajar.

Y hacía bien.

Un worker que trabaja encima de un `main` sucio no es autónomo.

Es peligroso.

La solución fue dejar una regla clara:

Las propuestas OpenSpec pueden vivir en `main`.

Pero tienen que estar commiteadas.

Si `main` está sucio, los workers paran.

No intentan adivinar.

No mezclan.

No "ya que estoy".

Paran y reportan.

Esto parece aburrido.

Pero es exactamente el tipo de aburrimiento que mantiene vivo un repo.

## El tercer gran fallo: GitHub parecía autenticado, hasta que no

Desde mi terminal:

```bash
gh auth status
```

Todo perfecto.

Desde un agente:

```text
token invalid
could not resolve github.com
keychain unavailable
```

La fiesta.

El problema no era siempre GitHub.

Muchas veces era el sandbox del agente.

O DNS.

O keychain.

O que el entorno de ejecución no tenía los mismos permisos que mi terminal.

La solución práctica fue:

- usar SSH para `origin`
- configurar una identidad Git clara
- hacer push con la cuenta correcta
- hacer que el worker reintente fuera del sandbox cuando sea posible
- no depender de `gh` como única vía para abrir PRs

Por eso acabé delegando la creación de PRs en GitHub Actions.

El worker sólo necesita hacer push.

Y GitHub, que vive en GitHub, se encarga de GitHub.

Sorprendentemente razonable.

## El cuarto fallo: GitHub Actions tampoco podía crear PRs

La primera vez que la action intentó abrir una PR, falló con:

```text
GitHub Actions is not permitted to create or approve pull requests.
```

Esto no era un bug.

Era configuración.

La action necesitaba permisos para crear pull requests.

La solución fue:

- dar permisos `pull-requests: write`
- asegurar que el repo permite a GitHub Actions crear PRs
- hacer la action idempotente

Idempotente significa:

Si no hay PR, la crea.

Si ya hay PR, la reutiliza.

Porque lo último que quieres es un ejército de agentes creando un ejército de PRs duplicadas.

Un ejército está bien.

Una estampida, no.

## El quinto fallo: algunos checks eran demasiado ambiciosos

Yo quería screenshots.

Quería Playwright.

Quería Percy.

Quería que cada PR llegara con validación visual.

Suena muy bien.

Hasta que Chromium no puede arrancar en el sandbox.

O Percy no puede subir archivos a terceros por política.

Entonces tienes un problema:

La app puede estar bien.

El test puede estar bien.

Pero el entorno no puede ejecutar la validación.

Si haces de eso un gate obligatorio, bloqueas todo.

Así que separé:

- checks obligatorios
- checks útiles pero no bloqueantes
- checks que hoy quedan fuera del entorno

Por ahora, Playwright visual, screenshots y Percy no bloquean el push.

Se reportan como validación diferida.

No como fallo de producto.

Esto es importante.

Automatizar no significa meter todos los checks posibles.

Automatizar significa saber qué checks tienen sentido en ese entorno.

## El sexto fallo: OpenSpec hacía ruido de red

OpenSpec funcionaba.

Pero al final intentaba enviar telemetría.

En local, ni lo notas.

En un sandbox sin red, lo ves como errores de PostHog al final del comando.

El comando había terminado bien.

Pero el log parecía roto.

Solución:

```bash
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec ...
```

No es el cambio más espectacular del mundo.

Pero limpiar logs importa.

Si un sistema autónomo genera ruido falso, acabas ignorando sus reportes.

Y si ignoras sus reportes, ya no tienes automatización.

Tienes superstición.

## El prompt del worker como lista de cicatrices

Una cosa curiosa de este flujo es que los prompts de los workers empiezan
pareciendo demasiado largos.

La tentación inicial es pensar:

> "¿De verdad hace falta decirle todo esto?"

Y luego recuerdas que cada frase está ahí porque algo se rompió.

No son instrucciones decorativas.

Son cicatrices.

Por ejemplo:

```text
Verify main is clean. If dirty, stop.
```

Esto existe porque los agentes dejaban scaffolds de OpenSpec sin commitear en
`main`, y entonces el siguiente worker no sabía si estaba viendo backlog real,
trabajo a medias o ruido.

```text
Use worktrees/<change-name>. Do not use scratch.
```

Esto existe porque un agente decidió crear un `scratch/worktrees/...` y de
repente había trabajo vivo en un sitio que nadie esperaba.

```text
If branch or worktree exists, continue it instead of creating a duplicate.
```

Esto existe porque varios agentes pueden mirar el mismo backlog. Si no tratas la
rama y el worktree como locks, acaban trabajando dos veces en la misma tarea.

```text
If one task blocks, mark it blocked and stop the queue.
```

Esto existe porque una tarea bloqueada puede secuestrar toda la noche. Cuando el
flujo vivía en cron, el agente se levantaba cada hora, miraba lo mismo, fallaba
por el mismo motivo y volvía a dormir.

Muy disciplinado.

Muy inútil.

Con la cola, el fallo se vuelve explícito: `[!]`.

Y el orquestador deja de lanzar trabajo nuevo hasta que alguien decide si esa
tarea se reintenta, se corrige a mano o se da por terminada.

```text
Run commitlint before push.
```

Esto existe porque algunos agentes escriben mensajes de commit como si estuvieran
intentando meter una novela rusa en una línea:

```text
chore(openspec): mark A complete; add B and C changes
```

Eso no es un commit.

Es una confesión.

```text
Run web e2e tests in worktrees; keep Detox mostly for main/manual validation.
```

Esto existe porque los tests web dan mucha cobertura de interfaz de forma rápida,
pero Detox abre simuladores, consume disco y puede dejar media docena de iPhones
viviendo su mejor vida dentro de tu Mac.

Los tests nativos siguen siendo valiosos.

Pero no tienen que probar todo lo que ya prueba la web.

Ahora los uso más para cosas propias de app nativa: arranque, crashes,
gestos, diferencias reales entre tap y click, y recorridos que sólo existen en
dispositivo.

```text
Do not treat simulator and test artifacts as product changes.
```

Esto existe porque los tests generan basura.

Y si esa basura ensucia `main`, los workers paran.

Se añadieron scripts de limpieza y reglas para distinguir entre cambio real y
artefacto temporal.

El disco duro también lo agradeció.

```text
When running Jest from a worktree, make sure the root worktrees/ folder is not
ignored accidentally.
```

Esto existe porque algunos tests parecían no encontrarse simplemente porque el
runner heredaba reglas pensadas para no escanear todos los worktrees del repo.

El cambio estaba bien.

La implementación estaba bien.

Pero el entorno de test no estaba mirando donde tocaba.

```text
Old branches from the first workflow must be rebased, completed and pushed
explicitly.
```

Esto existe porque las primeras ramas nacieron antes de estabilizar el flujo.
Algunas tenían sólo la propuesta OpenSpec. Otras tenían tasks sin marcar. Otras
no tenían PR porque el worker todavía no sabía empujar bien.

No estaban mal.

Estaban huérfanas.

Hubo que traerlas a `main`, completar tasks, validar y convertirlas en PRs
normales.

```text
Run Prettier only on selected-change files.
```

Esto existe porque `format:check` puede encontrar deriva histórica en cientos de
archivos. Si el agente intenta "arreglarlo todo", una PR pequeña se convierte en
un incendio de formato.

```text
Fetch/rebase before pushing main.
```

Esto existe porque el archive worker puede commitear en `main` mientras GitHub
recibe merges de otras PRs. Sin rebase, vuelves a tener ramas divergentes y un
humano preguntándose por qué `git pull --ff-only` ha decidido arruinarle el café.

```text
Archive one change per run, then push immediately.
```

Esto existe porque una vez el archive worker archivó quince cambios seguidos en
`main` mientras GitHub recibía merges de PRs. El resultado fue precioso:

```text
main...origin/main [ahead 15, behind 4]
```

Técnicamente era recuperable.

Hicimos `git rebase origin/main`, resolvimos el orden, y empujamos.

Pero el sistema había aprendido una regla nueva:

si el worker no puede empujar `main`, no debe seguir archivando.

Ahora archiva un cambio, rebasea si hace falta, pushea, y se va a dormir.

El siguiente archive vendrá en la siguiente ejecución.

Menos épico.

Más sano.

```text
Keep a separate main sync worker.
```

Esto existe porque proposal y archive viven en `main`, mientras las PRs también
van entrando en `main` desde GitHub. Un worker pequeño que sólo hace
`fetch/pull/rebase/push` mantiene la raíz sincronizada y evita que los demás
workers empiecen su trabajo desde una rama local vieja.

No implementa.

No archiva.

No crea commits.

Sólo mantiene la cinta transportadora alineada.

```text
Let workers inherit the model from the OpenCode invocation.
```

Esto existe porque empecé fijando demasiado comportamiento en los propios
workers. Luego el orquestador necesitaba poder escoger modelo según el coste,
la velocidad o el tipo de tarea.

El worker no debería decidir qué modelo usa.

El orquestador sí.

```text
Skip auto PR creation for empty branches.
```

Esto existe porque una rama puede existir como claim, pero no tener nada útil
que revisar todavía. Si una action abre PRs para ramas vacías, el sistema genera
ruido y el humano deja de confiar en las notificaciones.

```text
Clarify PR ownership.
```

Esto existe porque al principio no estaba claro si la PR debía abrirla el worker,
`gh`, una API, o GitHub Actions. Cada opción arrastraba tokens, permisos,
keychains y estados distintos.

La regla acabó siendo más simple:

el worker empuja la rama; GitHub Actions abre o reutiliza la PR si el repo está
configurado para ello.

```text
Require proposal commits on main.
```

Esto existe porque un backlog no commiteado no es backlog.

Es una intención flotando en el working tree.

Y los agentes no deberían construir encima de intenciones flotantes.

```text
Archive one completed change, then stop.
```

Esto existe porque archivar quince cambios seguidos parecía eficiente hasta que
`main` quedó por delante y por detrás de `origin/main` a la vez.

Una automatización que hace mucho trabajo antes de comprobar si puede publicarlo
no es rápida.

Es optimista.

Y el optimismo en Git suele acabar en rebase.

```text
Archive only after PR merge.
```

Esto existe porque archivar desde una rama de feature significa sincronizar specs
contra una visión incompleta de `main`.

```text
Clean the worktree and local branch only after archive push succeeds.
```

Esto existe porque limpiar antes de tiempo te deja sin la mesa de trabajo justo
cuando todavía necesitas reintentar el archive.

La gracia es que, cuando ves el prompt final, parece burocracia.

Pero en realidad es memoria operacional.

Cada línea reduce una clase de fallo.

Cada condición evita que el agente tenga que "interpretar" un estado ambiguo.

Y cuanto menos interpreta el agente el estado del repo, mejor duerme todo el
mundo.

## El resultado

El flujo actual se parece bastante a lo que quería al principio.

Yo puedo crear un backlog de cambios OpenSpec en `main`.

Los agentes van cogiendo tareas.

Cada agente trabaja en su worktree.

Cuando una tarea está terminada, se pushea la rama.

GitHub Actions abre la PR.

Yo reviso.

Mergeo.

El archive worker limpia OpenSpec en `main`.

Y vuelta a empezar.

En esos tres primeros días, el ritmo fue bastante absurdo en el mejor sentido:

- 73 PRs creadas
- 71 PRs mergeadas
- 13.289 líneas tocadas en diffs de PR
- 419 archivos modificados en esos diffs
- 12.847 líneas tocadas sólo contando PRs ya mergeadas

El día más intenso tuvo 34 PRs y 6.721 líneas tocadas.

En una jornada laboral normal, eso habría sido una mezcla de "no llego" y "ya lo
miraré mañana".

Con el flujo, se convirtió en una cinta continua de PRs pequeñas o medianas,
con checks y contexto suficiente para revisar rápido.

No todas fueron perfectas.

Algunas fallaron por GitHub.

Otras por sandbox.

Otras por tests nativos.

Otras por ramas viejas que venían de un flujo anterior.

Pero el sistema empezó a hacer algo muy importante:

fallar de forma diagnosticable.

Y eso cambia la conversación.

Porque cuando un agente falla diciendo:

```text
main is dirty
```

o:

```text
branch already has an open PR
```

o:

```text
format drift is advisory and not caused by this change
```

ya no estás mirando magia negra.

Estás mirando un proceso.

Mi trabajo como humano se mueve hacia arriba:

- definir intención
- escribir mejores specs
- partir tareas grandes en tareas pequeñas
- revisar PRs
- decidir prioridades

El trabajo de los agentes se queda donde tienen más valor:

- implementar cambios acotados
- seguir instrucciones
- hacer commits
- ejecutar validaciones
- preparar ramas

No es magia.

Es una línea de montaje.

Pero una línea de montaje bastante agradable.

## La nota honesta sobre equipos

Este flujo, tal como lo tengo hoy, está pensado para un repo de un solo
developer.

Eso importa.

La parte de OpenSpec se escribe directamente en `main`.

Para mí tiene sentido porque soy la única persona decidiendo backlog, proposal y
archive. Puedo aceptar que `main` sea la cola canónica de intención y que los
workers la usen como fuente de verdad.

En un equipo, yo no lo copiaría tal cual.

Lo adaptaría.

Probablemente:

- propuestas OpenSpec por PR
- branch protection en `main`
- archive también por PR o con un bypass muy explícito
- locks más formales que "existe una rama"
- quizá un índice de worktrees/claims generado por script
- reglas de ownership para que dos personas no escriban specs incompatibles a la vez

La idea de fondo sí me parece compartible:

OpenSpec define intención.

Git worktrees aíslan implementación.

GitHub PRs dan revisión.

Los workers conectan las piezas.

Pero el nivel de confianza en `main` tiene que cambiar si pasas de "yo solo con
agentes" a "un equipo entero con agentes".

## OpenSpec no es un orquestador de agentes

Otra cosa que aprendí rápido:

OpenSpec no está diseñado para esto como orquestador.

Y eso no es una crítica injusta.

OpenSpec está pensado para spec-driven development.

Para definir cambios.

Para validar specs.

Para archivar.

Para mantener intención y requisitos cerca del código.

Y eso lo hace bien.

Pero la mayoría de comandos del CLI asumen que todos los cambios activos están
en el mismo checkout.

`list` mira un sitio.

`archive` trabaja desde el checkout actual.

`validate` valida desde esa vista.

No viene de fábrica con una idea de:

- varios worktrees vivos
- varios agentes reclamando cambios
- ramas como locks
- PRs como estado intermedio
- workers que saltan tareas bloqueadas
- limpieza post-merge

Para eso necesitas una capa de workflow encima.

Puede ser un set de prompts muy estrictos.

Puede ser un script.

Puede ser una action.

Puede ser un pequeño comando propio.

Pero conviene decirlo claro:

OpenSpec te da la disciplina de la intención.

No te da, por sí solo, la fábrica multiagente.

La fábrica hay que montarla alrededor.

## La parte de la playa

La imagen mental es esta:

Yo preparo bien el backlog.

Me voy a la playa.

Los agentes trabajan.

Me llegan notificaciones de GitHub:

```text
Pull request opened: feat/settings-screen-web-e2e
Pull request opened: refactor/rename-page3-zone-ids-const
Pull request opened: fix/notebook-completion-overlay
```

Abro una.

Veo:

- qué cambió
- qué tareas se completaron
- qué tests corrieron
- qué checks pasaron

Si todo está bien:

Merge.

Y vuelvo a mirar al mar.

Obviamente esto no elimina la responsabilidad humana.

La cambia de sitio.

Menos "picar código".

Más "diseñar trabajo verificable".

Menos "¿qué ha hecho este agente?".

Más "¿esta PR cumple la intención?".

Eso, para mí, es el cambio importante.

## Qué recomendaría si quieres probarlo

Si estás usando OpenSpec y quieres montar algo parecido, empezaría por aquí:

1. Usa `main` como cola canónica de OpenSpec.
2. Usa worktrees sólo para implementación.
3. Nombra ramas y worktrees de forma determinista.
4. Trata rama, worktree y PR como locks.
5. No archives desde ramas de feature.
6. Empuja la rama y deja que GitHub Actions cree o reutilice la PR.
7. Archiva sólo después del merge.
8. No permitas que un worker trabaje con `main` sucio.
9. Desactiva telemetría en comandos automatizados.
10. No conviertas checks imposibles en gates obligatorios.

Y una más:

**Haz las tareas pequeñas.**

Un ejército de agentes no arregla un mal backlog.

Sólo lo ejecuta más rápido.

Si tus specs son ambiguas, tendrás caos ambiguo.

Si tus tasks son enormes, tendrás PRs enormes.

Si tus validaciones son vagas, tendrás confianza vaga.

La calidad del sistema depende muchísimo de la calidad de la intención.

## El cierre

Creo que el desarrollo con agentes no va de tener una IA gigante que haga todo.

Va de tener muchos agentes suficientemente buenos trabajando sobre unidades pequeñas, claras y verificables.

OpenSpec me da la intención.

Git worktrees me dan aislamiento.

GitHub PRs me dan revisión.

Los workers me dan continuidad.

Y yo puedo dedicar más energía a lo que realmente importa:

decidir qué hay que construir.

El código sigue siendo importante.

Pero cada vez tengo más claro que, cuando trabajas con IA, la habilidad diferencial no es escribir más código.

Es escribir mejores instrucciones para que el código correcto aparezca.

Y si eso además me permite revisar pull requests desde la playa, tampoco voy a fingir que me parece mal.
