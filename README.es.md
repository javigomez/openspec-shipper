**Idiomas:** [English](README.md) | Español | [Català](README.ca.md) | [简体中文](README.zh.md)

# openspec-shipper

**Entrega cambios de OpenSpec en piloto automático.** Tú escribes la especificación; `openspec-shipper` la añade a la cola, se la pasa a un agente de programación con IA, abre la PR y archiva el cambio cuando se fusiona.

Gratuito, con licencia MIT y de código abierto. Haz un fork, modifícalo, envía un PR.

## Qué hace

Ya usas [OpenSpec](https://github.com/Fission-AI/OpenSpec) para escribir propuestas de cambio y tareas. `openspec-shipper` se encarga del resto:

1. Añade un cambio a la cola de entrega.
2. Shipper crea un worktree aislado y pasa el cambio al ejecutor de IA que elijas: [OpenCode](https://opencode.ai), [Codex CLI](https://github.com/openai/codex) o [Claude Code](https://claude.com/product/claude-code).
3. El agente lo implementa; Shipper hace push de la rama y abre una PR con `gh`.
4. Tú revisas la PR y haces merge.
5. Shipper archiva el cambio en OpenSpec y limpia el worktree, sin que tengas que gestionar ramas a mano.
6. Pasa al siguiente elemento de la cola.

Tu checkout principal no se modifica. Todo ocurre en worktrees dedicados, así que puedes seguir planificando el siguiente cambio mientras Shipper entrega el actual.

## Míralo en acción (1 minuto)

Echa un vistazo a **[clean-repo-for-openspec-shipper-demo](https://github.com/javigomez/clean-repo-for-openspec-shipper-demo)**: un repositorio pequeño preparado con cambios de OpenSpec listos para entregar. Clónalo y sigue los pasos de su README para ver el flujo completo, de principio a fin, en aproximadamente un minuto.

## Pruébalo tú mismo

```bash
npm install -D openspec-shipper
npx openspec-shipper init
npx openspec-shipper doctor
```

`init` te guía para elegir un ejecutor de IA (OpenCode, Codex CLI o Claude Code) y un gestor de paquetes; después instala todo lo que necesita la cola. `doctor` comprueba que `git`, `gh` y el ejecutor elegido estén listos.

Cuando tengas un cambio de OpenSpec listo para entregar:

```bash
npx openspec-shipper queue add <nombre-de-tu-cambio>
npx openspec-shipper queue run
```

Eso es todo. Shipper se ocupa del proceso desde la cola hasta el merge.

## Requisitos

- `git`
- [`gh`](https://cli.github.com/) (GitHub CLI), autenticado
- Uno de: OpenCode, Codex CLI o suscripción a Claude Code

## Contribuir

Soy Javi Gómez, desarrollador independiente y un enamorado de OpenSpec. Creé este paquete para ahorrarme tareas que aportan poco valor y poder centrarme en definir cambios y escribir especificaciones. Decidí compartirlo para que también os ayude a ahorrar tiempo.

Los issues, las PRs y los forks son bienvenidos. Es un proyecto joven y la hoja de ruta está totalmente abierta. Si construyes algo sobre él o lo adaptas a tu flujo de trabajo, me encantará conocer tu experiencia.

## Documentación completa

La referencia de comandos, las opciones de configuración, el funcionamiento interno de la cola, la configuración de los proveedores y todo lo demás está en el sitio de documentación:

**https://javigomez.github.io/openspec-shipper/**
