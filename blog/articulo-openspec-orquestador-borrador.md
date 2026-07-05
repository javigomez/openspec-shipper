# El placer de volver al ordenador y ver que el proyecto ha avanzado

> **Una capa de automatización sobre OpenSpec para que la IA implemente,
> valide y complete un cambio de principio a fin.**

> _Escribo specs. Arranco la cola. Y mi ordenador se queda haciendo
> avanzar el proyecto mientras yo hago otra cosa._

> **Nota:** Este es un borrador de trabajo. He dejado algunos `TODO`
> para completarlos con ejemplos reales extraídos del histórico del
> repositorio.

---

_(Aquí irá un GIF mostrando la cola avanzando:
`deliver → apply → ship → waiting_for_merge → sync → archive`, la
creación de PRs y la actualización automática de las specs.)_

Hace unos meses empecé a trabajar de forma intensiva con OpenSpec y
agentes.

Como casi todos, mi objetivo era que la IA escribiera más código.

Lo que no esperaba era que el siguiente cuello de botella fuera mi
propia capacidad para coordinar todo lo que ocurría entre una
especificación y la siguiente.

Mientras un agente implementaba una spec, yo ya estaba definiendo la
siguiente. En medio aparecía una Pull Request para revisar. Otro agente
intentaba tocar algo que otro había dejado a medias. Algún worker se
encontraba `main` sucio. Tocaba dejar lo que estaba haciendo para
arreglar Git, volver a sincronizar el repositorio y recuperar el
contexto que acababa de perder.

No era un problema de OpenSpec.

OpenSpec estaba haciendo exactamente lo que debía hacer.

El problema era todo lo que ocurría entre una especificación y la
siguiente.

Y decidí automatizar esa parte.

---

El resultado es `openspec-shipper`, el paquete que acompaña a este
artículo.

No es un framework.

No pretende cambiar cómo usas OpenSpec.

Es una capa de automatización que conecta las distintas fases por las
que pasa un cambio hasta convertirse en software funcionando.

- implementación
- validaciones
- Pull Request
- merge
- sincronización
- archive
- actualización de las especificaciones

Cada fase ocurre cuando toca.

Y cuando hace falta una decisión humana, el flujo simplemente espera.

---

Mientras construía esta herramienta hubo un cambio mental que me resultó
mucho más interesante que el propio código.

**He dejado de pensar en los changes de OpenSpec como artefactos de
documentación y he empezado a tratarlos como unidades de trabajo
ejecutables.**

Cada change ya contiene prácticamente todo lo necesario para que un
agente pueda hacer su trabajo:

- la intención
- el diseño
- las tareas
- la definición de terminado

Lo único que faltaba era automatizar el recorrido entre ese change y el
software funcionando.

---

También cambió mi forma de utilizar los modelos.

Los modelos más potentes (GPT‑5.5, Opus, GLM...) los sigo utilizando
para lo que realmente aporta valor: escribir buenas especificaciones.

Incluso les pido que dividan funcionalidades grandes en cambios pequeños
que puedan implementarse de forma independiente.

Una vez la especificación está bien escrita, el trabajo deja de ser
creativo.

Pasa a ser ejecución.

Y ahí OpenCode me permite utilizar modelos mucho más económicos como
DeepSeek V4 Pro o Qwen 3.7 Plus para hacer la implementación con un
coste muy contenido.

No sólo consigo mantener una buena calidad.

También puedo dejar trabajando la cola durante horas sin preocuparme por
el coste de utilizar continuamente un modelo premium.

Creo que esa separación entre "modelos para pensar" y "modelos para
ejecutar" va a ser cada vez más importante en equipos que quieran
escalar el uso de IA sin disparar el presupuesto.

---

Lo más difícil no ha sido escribir el orquestador.

Ha sido conseguir que el flujo sea suficientemente robusto para que
merezca la pena dejarlo trabajando solo.

**TODO:** Añadir dos o tres casos reales extraídos del histórico del
repositorio.

Por ejemplo:

- cómo aparecieron los locks utilizando ramas, worktrees y PRs;
- por qué el archive sólo puede ejecutarse después del merge;
- cómo cada nueva regla del prompt elimina una clase distinta de fallo
  operativo.

---

No creo que el futuro del desarrollo consista en tener agentes cada vez
más inteligentes.

Creo que consistirá en diseñar mejores sistemas alrededor de ellos.

Sistemas donde los modelos hagan el trabajo repetitivo, las validaciones
ocurran cuando toca y la atención humana se reserve para aquello donde
realmente aporta valor.

En mi caso, eso significa escribir mejores especificaciones, revisar
decisiones y decidir qué construir después.

Todo lo demás intento automatizarlo.

**He construido esta capa de automatización para dejar de gastar
atención coordinando agentes y volver a gastarla decidiendo qué
construir.**

Y al preparar esto para compartirlo me he encontrado con una última
lección importante.

Publicar el runner no era suficiente.

El flujo real no vivía sólo en el código del orquestador. También vivía
en las workflows de GitHub, en los comandos de OpenCode, en las reglas
de Git, en los scripts de validación, en la configuración de OpenSpec y
en pequeñas decisiones operativas como cuándo se puede abrir una PR o
cuándo es seguro archivar un change.

Así que la distribución ha acabado cambiando de forma.

La primera idea era publicar sólo el repositorio del runner. Pero eso
dejaba demasiadas piezas fuera: quien lo probara tendría que copiar a
mano workflows, comandos de OpenCode, reglas, scripts, configuración y
variables de entorno.

Ahora el camino principal es instalar un paquete npm dentro del repo
target:

```bash
npm install -D openspec-shipper
npx openspec-shipper init
npx openspec-shipper doctor
```

Ese `init` prepara el repositorio con todo lo que necesita el flujo:

- comandos, agentes y reglas de OpenCode;
- workflows de GitHub;
- scripts de validación;
- configuración base;
- una cola local en `.openspec-shipper/queue.md`;
- un `.openspec-shipper/.env` propio del shipper.

La cola, los logs y el estado vivo quedan en `.openspec-shipper/` y se
ignoran en Git. No son código de producto. Son estado operacional.

Eso permite algo importante: el `.env` de la aplicación sigue siendo de
la aplicación. `openspec-shipper` no lo carga. Sólo lee su propio
`.openspec-shipper/.env`, así que no mezcla secretos ni configuración
del proyecto con la configuración del orquestador.

El modo híbrido sigue existiendo. Si prefieres ejecutar la herramienta
desde fuera del repo target puedes hacerlo pasando `--project` y
`--queue`. Pero para la mayoría de personas el flujo normal será:

```bash
npx openspec-shipper queue add add-name-greeting
npx openspec-shipper queue dry-run
npx openspec-shipper queue next
```

También he cambiado la arquitectura interna para que OpenCode no sea una
suposición escondida dentro del runner. En la v1, OpenCode es el provider
estable. Pero el contrato deja una puerta abierta a otros ejecutores:
Codex CLI, Claude Code o cualquier otro agente que pueda recibir una
tarea, ejecutarla y devolver una señal clara de éxito o bloqueo.

No quiero prometer más de lo que está probado: Codex CLI queda como
provider experimental hasta validarlo manualmente en el repo de demo.
Pero la dirección ya está marcada.

El paquete mantiene las mismas ideas operativas:

- el modo inicial es conservador: push y archive quedan desactivados
  hasta que una persona los habilita;
- y hay un repo mínimo de demo con un `Hello, world!` y un change de
  OpenSpec pequeño para ver el sistema funcionando sin meterlo
  directamente en un proyecto real.

Creo que esa distinción importa.

No es "clona este repo y ya está".

Es "instala una capa de ejecución alrededor de tu repo".

Para el GIF del artículo quiero enseñar el flujo completo sobre el repo
de demo: clonar, instalar, inicializar, añadir tres changes a la cola,
ver el `dry-run` y lanzar el primer `next`. La gracia no es enseñar magia.
La gracia es enseñar que la coordinación que antes hacía yo a mano ahora
queda escrita como una cola pequeña, visible y auditable.

Si utilizas OpenSpec ---o cualquier flujo de desarrollo basado en
especificaciones--- quizá te resulte útil como punto de partida. Si es
así, aquí tienes el repositorio y un proyecto de demo para probarlo
primero sin miedo.
