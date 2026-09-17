// The master switch is a lifetime contract, not a class toggle: switching the
// skin off must withdraw the token layer and detach the skin stylesheet, and
// switching it back on must restore both for the armed team.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { TEAMS, makeTeamTokens } from "../../src/teams.mjs";

const SETTINGS_SHEET = "dsh-f1-skin/settings.css";
const SKIN_SHEET = "dsh-f1-skin/skin.css";
const team = (id) => TEAMS.find((candidate) => candidate.id === id);

// The host supplies React at runtime, so these tests bring the smallest possible
// stand-in: enough to execute the real component function once and read the
// element tree it returns. Real rendering stays the browser suite's job.
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {}
};

/** Every element in a rendered tree, depth first, flattening child arrays. */
function elements(tree, found = []) {
  for (const node of Array.isArray(tree) ? tree : [tree]) {
    if (Array.isArray(node)) { elements(node, found); continue; }
    if (node === null || typeof node !== "object" || node.type === undefined) continue;
    found.push(node);
    elements(node.children, found);
  }
  return found;
}

/** Every text node in a rendered tree, in order. */
function texts(tree, found = []) {
  for (const node of Array.isArray(tree) ? tree : [tree]) {
    if (Array.isArray(node)) { texts(node, found); continue; }
    if (typeof node === "string") { found.push(node); continue; }
    if (node === null || typeof node !== "object" || node.type === undefined) continue;
    texts(node.children, found);
  }
  return found;
}

/** Boot the client fragment against a fake DOM that actually runs its effects. */
function client(stored = {}) {
  const storage = new Map(Object.entries(stored));
  const attrs = new Map();
  const vars = new Map();
  const sheets = [];
  // One layer per source, like the theme service: re-overriding a source
  // replaces its layer and turns the older disposer into a no-op.
  const layers = new Map();
  const cleanups = [];
  let onDispose = null;
  let component = null;

  const element = () => {
    const node = {
      dataset: {},
      textContent: "",
      remove() {
        const index = sheets.indexOf(node);
        if (index >= 0) sheets.splice(index, 1);
      }
    };
    return node;
  };
  const root = {
    style: { setProperty: (key, value) => vars.set(key, value), removeProperty: (key) => vars.delete(key) },
    setAttribute: (key, value) => attrs.set(key, value),
    getAttribute: (key) => attrs.get(key),
    removeAttribute: (key) => attrs.delete(key)
  };
  const sandbox = vm.createContext({
    require: () => react,
    exports: {},
    TEAMS,
    makeTeamTokens,
    F1_PANEL_CSS: "/* settings */",
    F1_SKIN_CSS: "/* skin */",
    document: {
      documentElement: root,
      body: { hasAttribute: () => false },
      head: { appendChild: (node) => { sheets.push(node); } },
      createElement: () => element()
    },
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value)
    },
    fetch: () => new Promise(() => {})
  });
  // Capture the runtime without disturbing the section factory; the slot
  // registration below hands back the real component the plugin rendered.
  vm.runInContext(
    readFileSync(new URL("../../src/plugin-fragment.js", import.meta.url), "utf8") +
      "\nconst __createSettingsSection = createSettingsSection;\n" +
      "createSettingsSection = (runtime) => { globalThis.runtime = runtime; return __createSettingsSection(runtime); };",
    sandbox
  );
  sandbox.exports.apply({
    get: () => ({
      overrideTokens: (source, tokens) => {
        const layer = { source, tokens };
        layers.set(source, layer);
        return () => {
          if (layers.get(source) === layer) layers.delete(source);
        };
      }
    }),
    effect: (callback) => { cleanups.push(callback()); },
    slots: {
      inject: (name, callback) => callback(),
      register: (descriptor, section) => { component = section; return () => {}; }
    },
    on: (event, handler) => { if (event === "dispose") onDispose = handler; }
  });
  return {
    runtime: sandbox.runtime,
    storage,
    attrs,
    vars,
    layers,
    render: () => component(),
    attached: () => sheets.map((sheet) => sheet.dataset.pluginCss).sort(),
    dispose: () => {
      for (const cleanup of cleanups) cleanup();
      onDispose();
    }
  };
}

test("an untouched profile keeps the skin on with both stylesheets mounted", () => {
  const app = client();
  assert.equal(app.runtime.enabled, true);
  assert.deepEqual(app.attached(), [SETTINGS_SHEET, SKIN_SHEET]);
  assert.equal(app.attrs.get("data-f1-enabled"), "true");
  assert.equal(app.attrs.get("data-f1-team"), TEAMS[0].id);
  assert.equal(app.layers.size, 1);
});

test("switching off withdraws the token layer and the skin stylesheet", () => {
  const app = client();
  app.runtime.setEnabled(false);

  assert.equal(app.runtime.enabled, false);
  assert.equal(app.runtime.snapshot().enabled, false);
  assert.equal(app.storage.get("dsh-f1-skin:enabled"), "off");
  assert.equal(app.attrs.get("data-f1-enabled"), "false");
  assert.deepEqual(app.attached(), [SETTINGS_SHEET], "the settings sheet must survive the off switch");
  assert.equal(app.layers.size, 0, "no token layer may outlive the skin");
});

test("a team switch while off arms the team without restacking the withdrawn layer", () => {
  const app = client();
  app.runtime.setEnabled(false);
  app.runtime.selectTeam("ferrari");

  assert.equal(app.attrs.get("data-f1-team"), "ferrari");
  assert.equal(app.storage.get("dsh-f1-skin:team"), "ferrari");
  assert.equal(app.attrs.get("data-f1-enabled"), "false");
  assert.equal(app.layers.size, 0, "selecting a team must not paint the host while off");
  assert.deepEqual(app.attached(), [SETTINGS_SHEET]);
});

test("switching back on restores the armed team's layer and stylesheet", () => {
  const app = client();
  app.runtime.selectTeam("ferrari");
  app.runtime.setEnabled(false);
  app.runtime.setEnabled(true);

  assert.equal(app.storage.get("dsh-f1-skin:enabled"), "on");
  assert.equal(app.attrs.get("data-f1-enabled"), "true");
  assert.deepEqual(app.attached(), [SETTINGS_SHEET, SKIN_SHEET]);
  assert.equal(app.layers.size, 1);
  assert.deepEqual(app.layers.get("dsh-f1-skin").tokens, makeTeamTokens(team("ferrari")));
});

test("a profile stored as off boots inert and can still be switched back on", () => {
  const app = client({ "dsh-f1-skin:enabled": "off", "dsh-f1-skin:team": "mclaren" });

  assert.equal(app.runtime.enabled, false);
  assert.equal(app.attrs.get("data-f1-enabled"), "false");
  assert.equal(app.attrs.get("data-f1-team"), "mclaren");
  assert.deepEqual(app.attached(), [SETTINGS_SHEET]);
  assert.equal(app.layers.size, 0);

  app.runtime.setEnabled(true);
  assert.deepEqual(app.attached(), [SETTINGS_SHEET, SKIN_SHEET]);
  assert.equal(app.layers.size, 1);
  assert.deepEqual(app.layers.get("dsh-f1-skin").tokens, makeTeamTokens(team("mclaren")));
});

test("the settings section renders a master switch that gates every other control", () => {
  const app = client();
  const on = elements(app.render());

  const band = on.filter((node) => node.props.className === "dsh-f1-master");
  assert.equal(band.length, 1);
  assert.equal(band[0].props["data-f1-enabled"], "true");

  const switches = on.filter((node) => node.props.role === "switch");
  assert.equal(switches.length, 1);
  assert.equal(switches[0].type, "input");
  assert.equal(switches[0].props["aria-label"], "启用 F1 车队皮肤");
  assert.equal(switches[0].props.checked, true);
  assert.equal(switches[0].props.disabled, undefined, "the way back must never be disabled");

  const cards = on.filter((node) => node.props.className === "dsh-f1-team-card");
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((card) => card.props.disabled), [false, false, false, false]);
  assert.deepEqual(
    on.filter((node) => node.props.type === "range").map((node) => node.props.disabled),
    [false, false, false]
  );

  // The off render is the same tree with the switch closed and the rest inert.
  app.runtime.setEnabled(false);
  const off = elements(app.render());

  assert.equal(off.find((node) => node.props.className === "dsh-f1-master").props["data-f1-enabled"], "false");
  const closed = off.find((node) => node.props.role === "switch");
  assert.equal(closed.props.checked, false);
  assert.equal(closed.props.disabled, undefined);
  assert.deepEqual(
    off.filter((node) => node.props.className === "dsh-f1-team-card").map((card) => card.props.disabled),
    [true, true, true, true]
  );
  assert.deepEqual(
    off.filter((node) => node.props.type === "range").map((node) => node.props.disabled),
    [true, true, true]
  );
  assert.equal(off.find((node) => node.props.type === "checkbox" && node.props.role !== "switch").props.disabled, true);
  assert.equal(off.find((node) => node.props.type === "file").props.disabled, true);
  assert.match(
    texts(off).join(" "),
    /已关闭/,
    "the panel must say which state it is in"
  );
  assert.match(texts(on).join(" "), /已启用/);
});

test("visual preferences stay editable while the skin is off", () => {
  const app = client();
  app.runtime.setEnabled(false);
  app.runtime.setPreference("blur", 4);

  assert.equal(app.runtime.snapshot().blur, 4);
  assert.equal(app.storage.get("dsh-f1-skin:blur"), "4");
  assert.equal(app.vars.get("--f1-blur"), "4px");
  assert.equal(app.layers.size, 0);
  assert.deepEqual(app.attached(), [SETTINGS_SHEET]);
});

test("disposal cleans up identically whether the skin is on or off", () => {
  for (const enabled of [true, false]) {
    const app = client();
    if (!enabled) app.runtime.setEnabled(false);
    app.dispose();
    assert.equal(app.attached().length, 0, `stylesheets must be released (enabled=${enabled})`);
    assert.equal(app.attrs.size, 0, `root attributes must be released (enabled=${enabled})`);
    assert.equal(app.vars.size, 0, `inline custom properties must be released (enabled=${enabled})`);
    assert.equal(app.layers.size, 0, `token layers must be released (enabled=${enabled})`);
  }
});
