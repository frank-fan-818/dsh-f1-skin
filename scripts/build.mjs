// build.mjs — assemble lib/client.js (the web2 lazy-CJS bundle) from
// src/teams.mjs data, the plugin fragment, and the embedded team logos;
// cockpit photographs are staged into lib/cockpits/ and referenced by HTTP
// URL so the host half can serve them at full resolution (no inlining cap).
// Every text source is read with normalized newlines: the bundle is committed,
// so a Windows checkout and a Linux CI run must produce identical bytes.
// Zero dependencies: node scripts/build.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as data from "../src/teams.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Host route prefix that lib/routes.js registers — keep the two in sync.
const ASSET_URL_PREFIX = "/plugin-assets/dsh-f1-skin";

// Two stylesheets with two lifetimes. The settings sheet must stay mounted even
// while the skin is switched off (its page owns the switch that turns it back
// on, and a dead end would be unrecoverable), so it is limited to
// plugin-namespaced custom properties and `.dsh-f1-*`-scoped panel rules. Every
// rule that can paint a host element belongs to the skin sheet, which the
// runtime detaches the moment the master switch goes off.
const PANEL_STYLE_FILES = [
  "tokens.css",
  "teams.css",
  "controls.css"
];

const SKIN_STYLE_FILES = [
  "foundation.css",
  "background.css",
  "materials.css",
  "components.css",
  "sidebar-teams.css",
  "responsive.css"
];

const COCKPIT_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".svg"];

/** Copy one cockpit photograph into lib/cockpits/ and return its served URL. */
function stageCockpit(id) {
  let fileName = null;
  for (const ext of COCKPIT_EXTS) {
    const candidate = `${id}-broadcast${ext}`;
    if (existsSync(join(root, "assets", "cockpits", candidate))) {
      fileName = candidate;
      break;
    }
  }
  if (fileName === null) throw new Error(`dsh-f1-skin build: no broadcast asset for team "${id}"`);
  mkdirSync(join(root, "lib", "cockpits"), { recursive: true });
  copyFileSync(
    join(root, "assets", "cockpits", fileName),
    join(root, "lib", "cockpits", fileName)
  );
  return `${ASSET_URL_PREFIX}/${fileName}`;
}

function loadTeamLogo(id) {
  const file = join(root, "assets", "team-logos", `${id}.svg`);
  const buf = readFileSync(file);
  return `data:image/svg+xml;base64,${buf.toString("base64")}`;
}

const teams = data.TEAMS.map((team) => ({
  ...team,
  cockpit: stageCockpit(team.id),
  logo: loadTeamLogo(team.id)
}));

const tokenMapSrc = "{\n" + Object.entries(data.TOKEN_MAP)
  .map(([name, spec]) => `    ${JSON.stringify(name)}: ${typeof spec === "function" ? spec.toString() : JSON.stringify(spec)}`)
  .join(",\n") + "\n  }";

const fragment = readFileSync(join(root, "src", "plugin-fragment.js"), "utf8").replace(/\r\n/g, "\n");
const readStyles = (files) => files
  .map((file) => readFileSync(join(root, "src", "styles", file), "utf8").trim().replace(/\r\n/g, "\n"))
  .join("\n\n");
const panelStyles = readStyles(PANEL_STYLE_FILES);
const skinStyles = readStyles(SKIN_STYLE_FILES);

const bundle = `window.__ModuleLoader__.load({
  id: "dsh-f1-skin",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    const ALL_TOKENS = ${JSON.stringify(data.ALL_TOKENS)};
    const TOKEN_MAP = ${tokenMapSrc};
    ${data.hexToRgb.toString()}
    ${data.rgbToHex.toString()}
    ${data.mix.toString()}
    ${data.lighten.toString()}
    ${data.darken.toString()}
    ${data.alpha.toString()}
    ${data.resolveSpec.toString()}
    ${data.makeTeamTokens.toString()}
    const TEAMS = ${JSON.stringify(teams)};
    const F1_PANEL_CSS = ${JSON.stringify(panelStyles)};
    const F1_SKIN_CSS = ${JSON.stringify(skinStyles)};
${fragment}
    return module.exports;
  }
});
`;

const out = join(root, "lib", "client.js");
mkdirSync(join(root, "lib"), { recursive: true });
writeFileSync(out, bundle, "utf8");
console.log(`built lib/client.js (${Math.round(bundle.length / 1024)} KB, ${teams.length} teams, ${PANEL_STYLE_FILES.length} settings + ${SKIN_STYLE_FILES.length} skin style modules, cockpit photos staged under lib/cockpits/)`);
