import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import vm from "node:vm";
import test from "node:test";
import { mountRoutes } from "../../lib/routes.js";
import { TEAMS, makeTeamTokens } from "../../src/teams.mjs";

function client() {
  const storage = new Map();
  const attrs = new Map();
  const styles = new Map();
  let resolveRequest;
  let dispose;
  const root = {
    style: { setProperty: (k, v) => styles.set(k, v), removeProperty: (k) => styles.delete(k) },
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k),
    removeAttribute: (k) => attrs.delete(k)
  };
  const sandbox = vm.createContext({
    require: () => ({ createElement() {} }), exports: {}, TEAMS, makeTeamTokens,
    document: { documentElement: root, body: { hasAttribute: () => false } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    fetch: () => new Promise((resolve) => { resolveRequest = resolve; })
  });
  vm.runInContext(readFileSync(new URL("../../src/plugin-fragment.js", import.meta.url), "utf8") +
    "\ncreateSettingsSection = (runtime) => { globalThis.runtime = runtime; return () => null; };", sandbox);
  sandbox.exports.apply({
    get: () => ({ overrideTokens: () => () => {} }),
    effect() {}, slots: { inject() {} },
    on: (event, callback) => { if (event === "dispose") dispose = callback; }
  });
  return {
    runtime: sandbox.runtime, styles, attrs, storage,
    dispose: () => dispose(),
    finish: (payload) => resolveRequest({ ok: true, json: async () => payload })
  };
}

test("an upload stays assigned to its original team after a team switch", async () => {
  const app = client();
  const upload = app.runtime.uploadWallpaper({});
  app.runtime.selectTeam("ferrari");
  app.finish({ url: "/plugin-assets/dsh-f1-skin-custom/test.jpg" });
  await upload;
  assert.equal(app.runtime.wallpapers.redbull, "/plugin-assets/dsh-f1-skin-custom/test.jpg");
  assert.equal(app.runtime.wallpapers.ferrari, undefined);
  assert.equal(app.attrs.get("data-f1-team"), "ferrari");
});

for (const operation of ["upload", "delete"]) {
  test(`pending ${operation} cannot restore a disposed skin`, async () => {
    const app = client();
    const url = "/plugin-assets/dsh-f1-skin-custom/test.jpg";
    app.runtime.applyWallpaperUrl(url);
    const pending = operation === "upload"
      ? app.runtime.uploadWallpaper({}) : app.runtime.deleteWallpaper(url);
    app.dispose();
    const saved = app.storage.get("dsh-f1-skin:wallpapers");
    app.finish({ url: "/plugin-assets/dsh-f1-skin-custom/new.jpg" });
    await pending;
    assert.equal(app.styles.size, 0);
    assert.equal(app.attrs.size, 0);
    assert.equal(app.storage.get("dsh-f1-skin:wallpapers"), saved);
  });
}

test("photo routes return the requested bytes and reject empty ranges", async (t) => {
  const routes = [];
  const dispose = mountRoutes({ webServer: { register: (route) => {
    routes.push(route);
    return () => {};
  } } });
  const server = createServer(routes[0].handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { dispose(); server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/plugin-assets/dsh-f1-skin/redbull-broadcast.jpg`;
  const photo = readFileSync(new URL("../../lib/cockpits/redbull-broadcast.jpg", import.meta.url));
  for (const [range, start, end] of [["bytes=-10", photo.length - 10, photo.length - 1], ["bytes=0-9", 0, 9]]) {
    const response = await fetch(url, { headers: { range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${photo.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), photo.subarray(start, end + 1));
  }
  for (const range of ["bytes=-", "bytes=-0", `bytes=${photo.length}-`]) {
    const response = await fetch(url, { headers: { range } });
    assert.equal(response.status, 416);
    await response.arrayBuffer();
  }
});
