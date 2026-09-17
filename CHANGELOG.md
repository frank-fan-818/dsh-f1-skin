# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A master switch at the top of the Formula One 车队 settings page that turns the
  skin off without uninstalling it. Switching off withdraws the token layer and
  detaches the skin stylesheet, so DSH returns to its native appearance rather
  than having the skin overruled; switching on restores both for the armed team.
  The state is stored locally and survives reloads and restarts, and the settings
  page stays mounted in both states so the skin can always be switched back on.

### Changed

- The stylesheet is now injected in two parts: a settings sheet that stays mounted
  for the whole session and a skin sheet that exists only while the skin is on.
  `scripts/check.mjs` rejects any host-painting rule in the settings sheet.
- `lib/client.js` is generated with normalized line endings, so a Windows checkout
  and a Linux CI run produce the same committed bundle.

### Fixed

- The sidebar's DeepSeek whale mark was painted twice and looked smudged. DSH
  renders the official lockup as two slots — the whale mark and a wordmark SVG
  whose artwork still contains the whale, cropped away by its viewBox — and the
  skin's `overflow: visible` on that SVG un-clipped the viewport, repainting the
  cropped whale on top of the slotted one.
- The sidebar brand row was pinned to fixed widths (202px + 188px + a 156px
  wordmark), which made it a fixed-width line: because DSH packs that row to the
  right, it overflowed leftwards on any sidebar narrower than ~280px and dragged
  the whale over the panel border and the team accent bar. The brand and its
  identity now keep the host's flex behaviour, and only the wordmark is pinned.

## [0.3.0] - 2026-09-01

### Added

- Four distinct Red Bull Racing, Scuderia Ferrari, McLaren Racing, and
  Mercedes-AMG Petronas Formula One Team presentation systems.
- Vector team marks, locally embedded 2024 racing photographs, and full team
  names without synthetic garage numbers or unexplained abbreviations.
- Native DSH settings controls for team, photograph strength, reading surface,
  blur, and motion.
- Third-party notices, deterministic package checks, CI, browser smoke tests,
  and release automation scaffolding.

### Changed

- Rebuilt the sidebar, conversation header, tool states, reading surfaces, and
  settings integration around a race-control visual system.
- Increased local text surfaces and control spacing while keeping the racing
  photograph prominent.
- Hardened the DeepSeek/HARNESS brand area and settings overlay against theme,
  viewport, and stacking-context regressions.

### Compatibility

- Verified against DeepSeek Harness Web `0.1.1-rc.2`.
- Requires Node.js 20 or newer for development and packaging.

[Unreleased]: https://github.com/frank-fan-818/dsh-f1-skin/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/frank-fan-818/dsh-f1-skin/compare/v0.2.0...v0.3.0
