# Logi Actions SDK plugin (dead end — kept as narrative context)

This was the first attempt: a plugin for Logitech's official Actions SDK,
hoping Options+ would host our keypad UI. The SDK (v0.1.1) turned out to
have **no dynamic-icon API at all** — icons are static SVGs declared at
build time; there's no `setImage`, no render callback, no state push. So
"green dot when Claude finishes" isn't possible through the official path,
and the project pivoted to driving the HID collections directly (see
`../keypad/` and `../docs/protocol.md`). Full story:
[`docs/journal/2026-05-13-from-sdk-to-col03.md`](../docs/journal/2026-05-13-from-sdk-to-col03.md).

The boilerplate below is as the SDK generator produced it.

## Getting started
*Install dependencies*
```
npm install
```

*Build plugin*
```
npm run build
```

*Link plugin to Logi Plugin Service*
This command will create a symlink from the built plugin to the plugin folder of the Logi Plugin Service. The plugin should now be visible in the "All Actions" section of the device configuration screen in Options+
```
npm run link
```

*Unlink plugin from Logi Plugin Service*
Removes the symlink from the Logi Plugin Service. Plugin will no longer be visible in Options+
```
npm run unlink
```

## Package plugin
Create an .lplug4 file which can be used to distribute the plugin, or submit the plugin for the marketplace
```
npm run build:pack
```
