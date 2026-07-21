**Idiomes:** [English](https://github.com/javigomez/openspec-shipper/blob/main/README.md) | [Español](https://github.com/javigomez/openspec-shipper/blob/main/README.es.md) | Català | [简体中文](https://github.com/javigomez/openspec-shipper/blob/main/README.zh.md)

# openspec-shipper

**Lliura canvis d'OpenSpec en pilot automàtic.** Tu escrius l'especificació; `openspec-shipper` l'afegeix a la cua, la passa a un agent de programació amb IA, obre la PR i arxiva el canvi quan es fusiona.

![openspec-shipper en acció](https://raw.githubusercontent.com/javigomez/openspec-shipper/main/docs/images/openspec-shipper-teaser.gif)

Gratuït, amb llicència MIT i de codi obert. Fes un fork, modifica'l, envia un PR.

## Què fa

Ja fas servir [OpenSpec](https://github.com/Fission-AI/OpenSpec) per escriure propostes de canvi i tasques. `openspec-shipper` s'encarrega de la resta:

1. Afegeix un canvi a la cua de lliurament.
2. Shipper crea un worktree aïllat i passa el canvi a l'executor d'IA que triïs: [OpenCode](https://opencode.ai), [Codex CLI](https://github.com/openai/codex) o [Claude Code](https://claude.com/product/claude-code).
3. L'agent l'implementa; Shipper fa push de la branca i obre una PR amb `gh`.
4. Tu revises la PR i fas merge.
5. Shipper arxiva el canvi a OpenSpec i neteja el worktree, sense que hagis de gestionar branques manualment.
6. Passa al següent element de la cua.

El teu checkout principal no es modifica. Tot passa en worktrees dedicats, així que pots continuar planificant el canvi següent mentre Shipper lliura l'actual.

## Construït amb Codex i GPT-5.6

He construït `openspec-shipper` amb [Codex](https://github.com/openai/codex) com a company d'enginyeria. GPT-5.6 m'ha ajudat a raonar sobre l'arquitectura, qüestionar decisions de disseny, investigar errors, revisar casos límit i convertir un problema personal de flux de treball en una eina que altres desenvolupadors poden fer servir.

Codex m'ha ajudat a convertir aquestes decisions en codi TypeScript, tests, integracions amb proveïdors, empaquetatge npm, documentació i repositoris de demostració. Ha participat en tot el cicle de desenvolupament: planificació, implementació, depuració, proves, refactorització i preparació de releases.

Codex també és una peça central del producte. Shipper pot lliurar cada canvi d'OpenSpec de la cua a Codex CLI dins d'un worktree aïllat, mentre que el runner s'encarrega dels passos mecànics de Git i GitHub. El projecte s'ha construït amb Codex i ara ajuda altres desenvolupadors a fer-lo servir de manera més efectiva: dedicant tokens a implementar feina valuosa en lloc de gastar-los en coordinació repetitiva.

## Mira-ho en acció (1 minut)

Fes un cop d'ull a **[clean-repo-for-openspec-shipper-demo](https://github.com/javigomez/clean-repo-for-openspec-shipper-demo)**: un repositori petit preparat amb canvis d'OpenSpec llestos per lliurar. Clona'l i segueix els passos del README per veure el flux complet, de principi a fi, en aproximadament un minut.

## Prova-ho tu mateix

```bash
npm install -D openspec-shipper
npx openspec-shipper init
npx openspec-shipper doctor
```

`init` et guia per triar un executor d'IA (OpenCode, Codex CLI o Claude Code) i un gestor de paquets; després instal·la tot el que necessita la cua. `doctor` comprova que `git`, `gh` i l'executor triat estiguin a punt.

Quan tinguis un canvi d'OpenSpec llest per lliurar:

```bash
npx openspec-shipper queue add <nom-del-teu-canvi>
npx openspec-shipper queue run
```

Això és tot. Shipper s'ocupa del procés des de la cua fins al merge.

## Requisits

- `git`
- [`gh`](https://cli.github.com/) (GitHub CLI), autenticat
- Un de: OpenCode, Codex CLI o subscripció a Claude Code

## Contribuir

Soc en Javi Gómez, desenvolupador independent i un enamorat d'OpenSpec. Vaig crear aquest paquet per estalviar-me tasques que aporten poc valor i poder centrar-me a definir canvis i escriure especificacions. Vaig decidir compartir-lo perquè també us ajudi a estalviar temps.

Els issues, les PRs i els forks són benvinguts. És un projecte jove i el full de ruta està totalment obert. Si hi construeixes alguna cosa o l'adaptes al teu flux de treball, m'encantarà conèixer la teva experiència.

## Documentació completa

La referència d'ordres, les opcions de configuració, el funcionament intern de la cua, la configuració dels proveïdors i tota la resta és al lloc de documentació:

**https://javigomez.github.io/openspec-shipper/**
