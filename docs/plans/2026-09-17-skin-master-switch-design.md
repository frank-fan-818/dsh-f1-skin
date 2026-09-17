# Skin Master Switch — Design

**Goal:** Let a user turn the skin off without uninstalling it, and turn it back on
again from the same place.

**Problem:** The plugin had exactly one lifetime — mounted or uninstalled. A user who
wanted a native DSH for an afternoon had to remove the package and restart `dsh web`,
and reinstalling meant another restart. DSH's own 「设置 → 插件」 surface does not
help: `dsh-client-ui-settings-plugins` configures host-plane plugins, and
`dsh-client-ui-settings-plugin-inventory` is a read-only list. There is no host-level
"disable this client plugin" control, so the entry point has to live in the skin.

**Architecture:** The plugin touches the host in exactly three ways, and "off" is the
reversal of all three:

| Host-facing effect | Owned by | Off | On |
|---|---|---|---|
| 79 design tokens, stacked through `theme.overrideTokens(source, …)` | `syncTokenLayer` | call the layer disposer | restack the armed team's layer |
| One stylesheet of host-painting CSS | `syncSkinSheet` | detach the `<style>` tag | reattach it |
| `data-f1-*` attributes and `--f1-*` custom properties on `<html>` | `applyTeam` | kept — plugin-namespaced, no host consumer once the sheet is gone | kept |

`applyTeam` is the single "sync the document to the armed state" function; it calls
`syncTokenLayer` and `syncSkinSheet` before writing the armed team's variables, so a
team switch, a wallpaper change, and a switch flip all converge on one path.

**Two stylesheets:** The settings page must stay styled and operable while the skin is
off — it owns the only way back, so an unstyled or unreachable panel would be a dead
end. The stylesheet therefore ships in two parts:

- `settings.css` (always mounted): `tokens.css` (plugin custom properties), `teams.css`
  (per-team custom properties), `controls.css` (the panel).
- `skin.css` (mounted only while on): `foundation.css`, `background.css`,
  `materials.css`, `components.css`, `sidebar-teams.css`, `responsive.css`.

This split is what makes "off" a fact rather than a promise: no rule that can paint a
host element is present in the document at all, instead of being present but
overruled. Panel responsive rules moved from `responsive.css` into `controls.css` so
the panel keeps its narrow-viewport layout in both states.

**Invariant (checked, not merely documented):** in the always-on sheet, every
declaration outside a `.dsh-f1-*` rule must be a `--f1-*` custom property, and no
DSH host class (`pI_x6G_`, `hHd-Xa_`, `wSkVaW_`, …) may appear. The skin sheet, in
turn, may not style `.dsh-f1-*`. `scripts/check.mjs` parses the settings sheet rule by
rule and fails the build on either violation.

**State:** `localStorage["dsh-f1-skin:enabled"]` is `"on"` or `"off"`; anything else —
including unreadable storage — means on, so upgrading never silently disables an
installed skin. The armed team, visual preferences, and per-team wallpapers are
untouched by the switch: they keep working and keep persisting, so switching back on
restores exactly the configuration the user had.

**Entry point:** a `MASTER SWITCH` band at the top of 「设置 → Formula One 车队」 with a
`role="switch"` control labelled 启用 F1 车队皮肤, plus a state chip in the panel header
(`<团队名> · 已启用 / 已关闭`). The switch is never disabled; every other control in the
panel is, and dims to 50% opacity, so a disabled control never looks live. Team cards
stay clickable-but-inert through the native `disabled` attribute, which also keeps
assistive technology honest.

**Alternatives rejected:**

- *Prefix every host rule with `html[data-f1-skin="on"]`.* One stylesheet, but dozens
  of rules to rewrite by hand and a silent regression whenever a new rule forgets the
  prefix. The two-sheet split makes the mistake impossible instead of unlikely.
- *Toggle `style.disabled` on one stylesheet.* One line, but the panel loses its styling
  together with the skin, so the recovered UI is bare native controls.
- *Hide the settings entry while off.* Then the off state is unrecoverable without
  uninstalling.

**Testing:**

- `tests/unit/skin-toggle.test.mjs` boots the client fragment against a fake DOM that
  runs its effects and models the theme service's one-layer-per-source rule: default
  on, off withdraws the layer and detaches exactly the skin sheet, a team switch while
  off arms without restacking, back on restores the armed team's tokens, a profile
  stored as off boots inert and can still be switched on, preferences stay editable,
  and disposal releases everything in both states.
- `tests/e2e/f1-skin.spec.mjs` drives the real switch: panel state, `data-f1-enabled`,
  the skin sheet leaving the document, the photograph layer disappearing, the native
  brand token coming back, skin-only controls disabled, survival across a reload, and
  a byte-identical restore on the way back.
- `scripts/check.mjs` enforces the two-sheet composition and the paint invariant, and
  fails if the bundle's embedded stylesheets drift from their sources.

**Compatibility:** verified against DeepSeek Harness Web `0.1.1-rc.2` (the version CI
installs). The switch itself uses only plugin-owned selectors plus the host's
`--dsw-alias-*` tokens and `theme.overrideTokens`, so it is independent of the host's
CSS-module class names.
