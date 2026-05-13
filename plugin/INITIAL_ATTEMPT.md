# Plugin — initial attempt (abandoned)

This directory contains a scaffolded Logi Actions SDK plugin from `@logitech/plugin-toolkit`. It was our first attempt at the controller before we discovered the SDK's limits.

## Why it's here

This is the official, documented path: write a plugin against `@logitech/plugin-sdk`, register `CommandAction`s, package as `.lplug4`, install into Logi Options+.

## Why we abandoned it

The SDK as of v0.1.1 (released 2026, the first public release after the Loupedeck → Logitech Actions SDK rebrand) exposes only:

```ts
declare enum ActionType { None = 0, Command = 1 }
declare abstract class CommandAction { onKeyDown(): void | Promise<void> }
declare abstract class AdjustmentAction { execute(event): void }
```

No dynamic-icon API. No `setImage`, no per-key render callback, no state push. Icons are static SVGs in `package/actionicons/<name>.svg`, declared at build time. The Loupedeck-era SDK4 supported bitmap pushing — that capability didn't survive the rewrite, at least not yet.

That makes the SDK unfit for our goal: showing live Claude state (project name, "thinking"/"done" dot, model) on the LCDs.

## Moved on to

Direct HID access via `@logitech-mx-creative-console/node` (Path B). See [`docs/journal/2026-05-13-from-sdk-to-col03.md`](../docs/journal/2026-05-13-from-sdk-to-col03.md) for the full story.

## What's in here

Standard toolkit scaffold:
- `index.ts` — plugin entry, registers `HelloWorldAction`
- `src/test-actions.ts` — the hello-world command action
- `package/metadata/LoupedeckPackage.yaml` — plugin manifest
- `package/actionicons/`, `package/actionsymbols/` — static SVG icons
- `package.json` — uses `logitoolkit pack` / `link` / `unlink` scripts

If the Actions SDK ever gains a dynamic-icon API, this is the starting point.
