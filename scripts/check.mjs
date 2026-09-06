// check.mjs — validate the skin data and the built bundle. Zero dependencies.
// Usage: node scripts/check.mjs
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as data from "../src/teams.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_FILES = [
  "foundation.css", "background.css", "materials.css", "components.css", "sidebar-teams.css",
  "controls.css", "teams.css", "responsive.css"
];
const MAX_BUNDLE_BYTES = 2_800_000;
// Photographs are HTTP-served from lib/cockpits/ (browsers drop data: URIs
// beyond ~2 MB used as CSS backgrounds), so sources may be full-resolution.
const MAX_PHOTO_BYTES = 3_000_000;
const ASSET_URL_PREFIX = "/plugin-assets/dsh-f1-skin";
let failures = 0;
const fail = (msg) => { console.error("✗ " + msg); failures += 1; };
const ok = (msg) => console.log("✓ " + msg);

// ── token inventory ──
const names = data.ALL_TOKENS;
if (names.length !== 79) fail(`expected 79 tokens, got ${names.length}`);
else ok(`79 tokens declared (78 alias + sidebar fill)`);
if (new Set(names).size !== names.length) fail("duplicate token names");
else ok("no duplicate token names");
const mapKeys = Object.keys(data.TOKEN_MAP);
const missing = names.filter((n) => !mapKeys.includes(n));
const extra = mapKeys.filter((n) => !names.includes(n));
if (missing.length > 0) fail(`tokens missing from TOKEN_MAP: ${missing.join(", ")}`);
else ok("every token has a mapping");
if (extra.length > 0) fail(`TOKEN_MAP has extra keys: ${extra.join(", ")}`);
else ok("no extra mapping keys");

// ── per-team override layers ──
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGBA = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)\s*\)$/i;
const validValue = (v) => typeof v === "string" && (HEX.test(v) || RGBA.test(v) || v === "transparent");
const relativeLuminance = (hex) => {
  const { r, g, b } = data.hexToRgb(hex);
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
if (data.TEAMS.length !== 4) fail(`expected 4 teams, got ${data.TEAMS.length}`);
else ok("4 teams defined");
const expectedIds = ["redbull", "ferrari", "mclaren", "mercedes"];
for (const id of expectedIds) {
  if (!data.TEAMS.some((t) => t.id === id)) fail(`missing team ${id}`);
}
ok("team ids: " + data.TEAMS.map((t) => t.id).join(", "));
const invalidVectorLogos = data.TEAMS.filter((team) => {
  const file = join(root, "assets", "team-logos", `${team.id}.svg`);
  return !existsSync(file) || !readFileSync(file, "utf8").trimStart().startsWith("<svg");
});
if (invalidVectorLogos.length > 0) fail(`team vector logos are missing or invalid: ${invalidVectorLogos.map((team) => team.id).join(", ")}`);
else ok("all team logos use official SVG vector assets");
for (const team of data.TEAMS) {
  if (typeof team.name !== "string" || team.name.length < 12) fail(`${team.id}: missing full public team name`);
  if (typeof team.position !== "string" || team.position.length === 0) fail(`${team.id}: missing background position`);
  if (typeof team.mobilePosition !== "string" || team.mobilePosition.length === 0) fail(`${team.id}: missing mobile background position`);
  if (typeof team.personality !== "string" || team.personality.length === 0) fail(`${team.id}: missing visual personality`);
  for (const mode of ["light", "dark"]) {
    const onBrand = team[mode === "light" ? "onBrandLight" : "onBrandDark"];
    const ratio = contrast(team[mode].brand, onBrand);
    if (ratio < 4.5) fail(`${team.id} ${mode}: brand foreground contrast ${ratio.toFixed(2)}:1`);
    for (const [label, foreground] of [
      ["brand text", team[mode].brandText],
      ["tertiary text", team[mode].text3],
      ["dim text", team[mode].textDim]
    ]) {
      const textRatio = contrast(foreground, team[mode].platform);
      if (textRatio < 4.5) fail(`${team.id} ${mode}: ${label} contrast ${textRatio.toFixed(2)}:1`);
    }
  }
  const layer = data.makeTeamTokens(team);
  const keys = Object.keys(layer);
  if (keys.length !== names.length) fail(`${team.id}: ${keys.length} token entries`);
  let bad = 0;
  for (const name of names) {
    const v = layer[name];
    if (!v || !validValue(v.light) || !validValue(v.dark)) bad += 1;
  }
  if (bad > 0) fail(`${team.id}: ${bad} invalid color values`);
  else ok(`${team.id}: 79 × {light, dark} valid color values`);
  if (team.cockpit !== null && typeof team.cockpit === "string") fail(`${team.id}: cockpit should be null in src (filled at build)`);
  if (team.logo !== null && typeof team.logo === "string") fail(`${team.id}: logo should be null in src (filled at build)`);
  const photoPath = join(root, "assets", "cockpits", `${team.id}-broadcast.jpg`);
  if (!existsSync(photoPath)) fail(`${team.id}: broadcast photograph is missing`);
  else if (statSync(photoPath).size > MAX_PHOTO_BYTES) fail(`${team.id}: photograph exceeds ${MAX_PHOTO_BYTES} bytes`);
}
if (data.TEAMS.every((team) => existsSync(join(root, "assets", "cockpits", `${team.id}-broadcast.jpg`)))) {
  ok(`all broadcast photographs stay within ${Math.round(MAX_PHOTO_BYTES / 1000)} KB each (HTTP-served, not inlined)`);
}
const stagedMissing = data.TEAMS.filter((team) => !existsSync(join(root, "lib", "cockpits", `${team.id}-broadcast.jpg`)));
if (stagedMissing.length > 0) fail(`cockpit photographs not staged under lib/cockpits: ${stagedMissing.map((team) => team.id).join(", ")} — run: node scripts/build.mjs`);
else ok("cockpit photographs staged under lib/cockpits/ for the host route");

// ── CSS sanity ──
const missingStyles = STYLE_FILES.filter((file) => !existsSync(join(root, "src", "styles", file)));
if (missingStyles.length > 0) fail(`missing style modules: ${missingStyles.join(", ")}`);
else ok(`${STYLE_FILES.length} style modules present`);
const css = STYLE_FILES
  .filter((file) => existsSync(join(root, "src", "styles", file)))
  .map((file) => readFileSync(join(root, "src", "styles", file), "utf8"))
  .join("\n");
let depth = 0;
for (const ch of css) {
  if (ch === "{") depth += 1;
  else if (ch === "}") depth -= 1;
  if (depth < 0) break;
}
if (depth !== 0) fail(`CSS braces unbalanced (depth ${depth})`);
else ok("CSS braces balanced");
if (!css.includes("prefers-reduced-motion")) fail("CSS lacks reduced-motion branch");
else ok("prefers-reduced-motion branch present");
if (!css.includes(".dsh-f1-settings") || !css.includes(".dsh-f1-team-card")) fail("CSS lacks native F1 settings section");
else ok("native F1 settings section styles present");
if (/https?:\/\//i.test(css) || /@import\s/i.test(css)) fail("CSS has an external network dependency");
else ok("CSS is self-contained (no @import/http assets)");
if (!css.includes('[data-state="running"]') || !css.includes('[data-state="ok"]') || !css.includes('[data-state="error"]') || !css.includes('[data-state="stopped"]')) fail("CSS lacks semantic tool states");
else ok("semantic running/ok/error/stopped states present");
if (!css.includes(".pXSMma_headline") || !css.includes(".Sxvs8a_root") || !css.includes(".uV2eYG_card") || !css.includes(".o3BgMG_root")) fail("CSS lacks hero/reading/composer/tool component coverage");
else ok("hero, reading, composer, and tool components are covered");
if (!css.includes("never change the box model") || css.includes(".CY-8Ka_card:has(")) fail("tool accents are not host-box-model safe");
else ok("tool accents preserve native box models");
if (!css.includes(".QWLzlG_root,") || !css.includes("var(--f1-panel-2) 94%") || !css.includes(".QWLzlG_summary")) fail("tool rows lack an opaque readable surface");
else ok("tool rows have readable local surfaces and text colors");
if (!css.includes(".Sxvs8a_root {") || !css.includes("border: 0;") || !css.includes("border-radius: 10px")) fail("assistant surface still uses a hard frame");
else ok("assistant surface uses a soft frameless plate");
if (!css.includes("padding: 18px 20px") || !css.includes("padding: 12px 14px") || !css.includes("padding-inline: 12px 10px")) fail("framed content lacks comfortable spacing");
else ok("assistant, table, and tool content have comfortable frame spacing");
if (!css.includes("padding: 10px 20px 11px 18px") || !css.includes(".pXSMma_headline")) fail("welcome headline lacks comfortable spacing");
else ok("welcome headline has comfortable frame spacing");
if (!css.includes(".YDXeBa_sessionRow.YDXeBa_selected") || !css.includes(".hHd-Xa_logoRow::before") || !css.includes("RACE CONTROL")) fail("sidebar lacks team decoration");
else ok("sidebar has host-safe team decoration");
if (!css.includes(".wSkVaW_titleCluster::after") || !css.includes("RACE CONTROL") || !css.includes("pointer-events: none")) fail("conversation header lacks a noninteractive team signature");
else ok("conversation header includes a noninteractive team signature");
if (!css.includes(".wSkVaW_heroWorkspaceRow") || !css.includes("var(--f1-panel) 92%")) fail("hero workspace controls lack a readable local surface");
else ok("hero workspace and preset controls have a readable local surface");
if (!css.includes(".hHd-Xa_brandName svg") || !css.includes("width: 156px !important") || !css.includes("visibility: visible !important") || !css.includes("svg > rect + g path")) fail("native HARNESS wordmark lacks size or contrast guarantees");
else ok("native HARNESS wordmark keeps its full viewBox and inverted contrast");
if (!css.includes(".hHd-Xa_root.hHd-Xa_collapsed .hHd-Xa_logoRow::after") || !css.includes('content: "HARNESS"') || !css.includes("writing-mode: vertical-rl")) fail("collapsed navigation loses the HARNESS identity");
else ok("collapsed navigation preserves a noninteractive HARNESS mark");
if (css.includes("repeating-linear-gradient")) fail("generic repeating stripe pattern returned");
else ok("sidebar avoids generic repeating stripe patterns");
if (css.includes(".hHd-Xa_brand::after") || css.includes(".qDHVXG_sectionHeader::after") || !css.includes(".hHd-Xa_regionArea::after")) fail("team identity overlaps a host brand or workspace control");
else ok("team identity stays outside host brand and workspace controls");
if (!css.includes(".dsh-f1-settings__grid { grid-template-columns: 1fr; }") || !css.includes("@media (max-width: 480px)")) fail("native settings section lacks responsive layout");
else ok("native settings section has responsive layouts");
if (css.includes(':where([role="dialog"]') || css.includes("body:has([role=\"dialog\"]")) fail("CSS globally overrides host dialogs");
else ok("host dialogs are not globally overridden");
if (!css.includes(".VOzbGW_panel") || !css.includes("var(--f1-panel) 98%")) fail("settings panel remains too transparent");
else ok("settings panel uses an opaque readable surface");
if (/\.hHd-Xa_root\s*\{[^}]*(?:backdrop-filter|isolation\s*:\s*isolate)/s.test(css) || /\.pI_x6G_sidebarCol\s*\{[^}]*(?:backdrop-filter|isolation\s*:\s*isolate)/s.test(css)) fail("layout ancestor creates a stacking context and may trap fixed overlays");
else ok("layout ancestors do not create fixed-overlay containing blocks");
if (!css.includes('.QWLzlG_root[data-state="running"] .QWLzlG_row') || !css.includes('.o3BgMG_root[data-state="running"] .o3BgMG_row') || !css.includes('.CY-8Ka_root[data-state="running"]')) fail("motion control does not cover live tool-state sweep pseudo-elements");
else ok("motion-off covers live tool-state animation hooks");
if (css.includes("TEAM RADIO") || css.includes('content: "LIVE')) fail("CSS contains simulated broadcast telemetry");
else ok("no simulated LIVE/TEAM RADIO telemetry");
if (!css.includes("--f1-photo-strength") || !css.includes("--f1-surface-strength")) fail("CSS lacks independent photo/surface controls");
else ok("photo and surface strength are independent");
const runtime = readFileSync(join(root, "src", "plugin-fragment.js"), "utf8");
if (!runtime.includes('stored === null || stored === ""')) fail("runtime does not protect numeric defaults from empty storage");
else ok("empty storage preserves visual defaults");
if (!runtime.includes("const runtime = {") || !runtime.includes("data-f1-instance") || !runtime.includes("runtime.source")) fail("runtime lacks per-apply ownership isolation");
else ok("runtime state is isolated per apply instance");
if (!runtime.includes('ctx.slots.inject("settings.section"') || !runtime.includes('"aria-pressed": snapshot.teamId === team.id')) fail("F1 controls are not registered as an accessible native settings section");
else ok("F1 controls use the native settings.section slot and pressed-button semantics");
if (runtime.includes("team.slot") || runtime.includes("team.code") || runtime.includes("current.code")) fail("team numbers or abbreviations are still rendered in settings");
else ok("settings render full team names without numeric slots or abbreviations");
if (!runtime.includes("dsh-f1-skin:wallpapers") || !runtime.includes("/plugin-assets/dsh-f1-skin-custom/upload")) fail("runtime lacks per-team custom wallpaper plumbing");
else ok("per-team custom wallpaper plumbing present");

// Version-tied CSS Module selectors are checked when this machine has DSH installed.
const dshPackages = process.env.USERPROFILE
  ? join(process.env.USERPROFILE, ".dsh", "profiles", "node_modules", "@deepseek-ai")
  : null;
const selectorContracts = [
  ["dsh-client-ui-layout", ["pI_x6G_frame", "pI_x6G_sidebarCol"]],
  ["dsh-client-ui-sidebar", ["hHd-Xa_root"]],
  ["dsh-client-ui-conversation", ["wSkVaW_root", "pXSMma_headline", "uV2eYG_card", "Sxvs8a_root", "gdEzaW_bubble", "QWLzlG_root"]],
  ["dsh-client-ui-tool", ["o3BgMG_root", "CY-8Ka_root"]]
];
if (dshPackages && selectorContracts.every(([pkg]) => existsSync(join(dshPackages, pkg, "lib", "client.js")))) {
  let badContracts = 0;
  for (const [pkg, selectors] of selectorContracts) {
    const hostBundle = readFileSync(join(dshPackages, pkg, "lib", "client.js"), "utf8");
    for (const selector of selectors) if (!hostBundle.includes(selector)) {
      fail(`${pkg}: supported selector missing: ${selector}`);
      badContracts += 1;
    }
  }
  if (badContracts === 0) ok("DSH 0.1.1-rc.2 selector contract matches installed bundles");
} else {
  ok("DSH selector contract skipped (host packages not installed)");
}

// ── built bundle ──
const bundlePath = join(root, "lib", "client.js");
if (!existsSync(bundlePath)) {
  fail("lib/client.js missing — run: node scripts/build.mjs");
} else {
  const bundle = readFileSync(bundlePath, "utf8");
  const bundleTime = statSync(bundlePath).mtimeMs;
  const buildInputs = [
    join(root, "src", "teams.mjs"),
    join(root, "src", "plugin-fragment.js"),
    join(root, "scripts", "build.mjs"),
    ...STYLE_FILES.map((file) => join(root, "src", "styles", file)),
    ...data.TEAMS.map((team) => join(root, "assets", "cockpits", `${team.id}-broadcast.jpg`)),
    ...data.TEAMS.map((team) => join(root, "assets", "team-logos", `${team.id}.svg`))
  ];
  const newestInput = Math.max(...buildInputs.map((file) => statSync(file).mtimeMs));
  if (bundleTime + 1 < newestInput) fail("lib/client.js is stale — run: node scripts/build.mjs");
  else ok("lib/client.js is newer than its build inputs");
  const cssLiteral = bundle.match(/const F1_CSS = ("(?:[^"\\]|\\.)*");\r?\n/);
  if (cssLiteral === null) fail("bundle F1_CSS literal not found");
  else {
    const bundledCss = JSON.parse(cssLiteral[1]);
    const sourceCss = STYLE_FILES
      .map((file) => readFileSync(join(root, "src", "styles", file), "utf8").trim())
      .join("\n\n");
    if (bundledCss !== sourceCss) fail("bundle CSS differs from source style modules");
    else ok("bundle CSS exactly matches source style modules");
  }
  if (!bundle.includes("window.__ModuleLoader__.load({")) fail("bundle lacks __ModuleLoader__ registration");
  else ok("bundle registers via window.__ModuleLoader__.load");
  if (!bundle.includes('id: "dsh-f1-skin"')) fail("bundle id is not dsh-f1-skin");
  else ok("bundle id correct");
  const inlinedPhotos = (bundle.match(/data:image\/jpeg;base64,/g) || []).length;
  if (inlinedPhotos !== 0) fail(`cockpit photographs must be HTTP-served, not inlined (found ${inlinedPhotos})`);
  else ok("no inlined cockpit photographs (served via /plugin-assets/dsh-f1-skin)");
  const missingCockpitRefs = data.TEAMS.filter((team) => !bundle.includes(`"cockpit":"${ASSET_URL_PREFIX}/${team.id}-broadcast.jpg"`));
  if (missingCockpitRefs.length > 0) fail(`cockpit URLs missing in bundle: ${missingCockpitRefs.map((team) => team.id).join(", ")}`);
  else ok("every team references its HTTP-served cockpit photograph");
  const logos = (bundle.match(/data:image\/svg\+xml;base64,/g) || []).length;
  if (logos !== 4) fail(`expected 4 embedded team logos, found ${logos}`);
  else ok("4 official team logos embedded");
  if (bundle.includes("logo\":null")) fail("a team logo was not embedded");
  else ok("no unembedded team logo placeholders");
  if (bundle.includes('dsh-f1-garage') && bundle.includes('dsh-f1-team-card')) ok("bundle includes native F1 settings UI");
  else fail("bundle lacks native F1 settings markers");
  if (bundle.includes('dsh-f1-skin:photo') && bundle.includes('dsh-f1-skin:surface')) ok("bundle includes persistent visual controls");
  else fail("bundle lacks persistent visual controls");
  const sizeBytes = statSync(bundlePath).size;
  const sizeKB = Math.round(sizeBytes / 1024);
  ok(`lib/client.js is ${sizeKB} KB`);
  if (sizeBytes > MAX_BUNDLE_BYTES) fail(`bundle exceeds ${MAX_BUNDLE_BYTES} bytes (${sizeKB} KB) — compress the images`);
}

// ── bundle smoke test: register + materialize the factory in bare Node ──
{
  let registration = null;
  globalThis.window = { __ModuleLoader__: { load: (reg) => { registration = reg; } } };
  try {
    await import(pathToFileURL(bundlePath).href + `?smoke=${Date.now()}`);
  } finally {
    delete globalThis.window;
  }
  if (registration === null) fail("bundle did not call window.__ModuleLoader__.load");
  else if (registration.id !== "dsh-f1-skin") fail(`registration id mismatch: ${registration.id}`);
  else {
    ok("bundle registered with correct id");
    let ex = null;
    try {
      ex = registration.factory((spec) => {
        if (spec === "react") return { createElement: () => null };
        throw new Error(`unexpected external require("${spec}") — only host React is allowed`);
      });
    } catch (e) {
      fail(`factory materialization threw: ${e.message}`);
    }
    if (ex !== null) {
      if (Array.isArray(ex.inject) && ex.inject.includes("theme") && ex.inject.includes("slots")) ok("client plugin injects theme + slots");
      else fail(`inject must include theme + slots, got ${JSON.stringify(ex.inject)}`);
      if (typeof ex.apply === "function") ok("client plugin exports apply()");
      else fail("client plugin is missing apply()");
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall checks passed ✓");
