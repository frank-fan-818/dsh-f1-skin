// lib/routes.js — dsh-f1-skin host routes.
//
// Cockpit photographs are no longer base64-inlined into the client bundle
// (browsers drop data: URIs beyond ~2 MB used as CSS backgrounds). Instead
// scripts/build.mjs stages them into lib/cockpits/ and this route serves them
// over HTTP at full resolution — no URL length limit, works for 4K and beyond.
//
// User wallpapers are stored once per unique content hash under
//   $DSH_HOME/dsh-f1-skin/custom/<sha256>.<ext>
// so uploading the same image again (e.g. for another team) reuses the file.
//
// Routes (same-origin, mounted on the host webServer):
//   GET|HEAD /plugin-assets/dsh-f1-skin/<fileName>          built-in cockpit photos
//   GET      /plugin-assets/dsh-f1-skin-custom/list         uploaded wallpaper library
//   POST     /plugin-assets/dsh-f1-skin-custom/upload       store one wallpaper (deduped)
//   POST     /plugin-assets/dsh-f1-skin-custom/delete       remove one wallpaper file
//   GET|HEAD /plugin-assets/dsh-f1-skin-custom/<fileName>   serve an uploaded wallpaper
//
// File names are validated against a strict pattern and joined under their
// owning directory, so requests cannot escape either storage area.
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "/plugin-assets/dsh-f1-skin"; // keep in sync with scripts/build.mjs
const CUSTOM_PREFIX = "/plugin-assets/dsh-f1-skin-custom";
const STAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "cockpits");
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const DELETE_BODY_MAX_BYTES = 16 * 1024;

function customRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "dsh-f1-skin", "custom");
}

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const SAFE_FILE = /^[A-Za-z0-9._-]+$/;

/** Identify the image format from magic bytes; never trusts a client extension. */
function sniffImageExt(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return "png";
  if (buffer.length >= 12 &&
      buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === undefined || host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request, cap) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > cap) throw Object.assign(new Error("body too large"), { code: "TOO_LARGE" });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function serveFile(response, request, filePath) {
  const stat = statSync(filePath);
  const contentType = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const headers = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=300"
  };

  if (request.method === "HEAD") {
    response.writeHead(200, { ...headers, "content-length": stat.size });
    response.end();
    return;
  }

  const range = request.headers.range;
  if (typeof range === "string") {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      response.writeHead(416, { "content-range": `bytes */${stat.size}` });
      response.end();
      return;
    }
    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) {
      response.writeHead(416, { "content-range": `bytes */${stat.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${stat.size}`
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { ...headers, "content-length": stat.size });
  createReadStream(filePath).pipe(response);
}

/**
 * Build a GET/HEAD static-file handler rooted at `dir`.
 * @param dir - directory whose direct children are served.
 * @param urlPrefix - route prefix that maps onto `dir` (stripped before resolving).
 */
function fileHandler(dir, urlPrefix) {
  return (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const rest = pathname.startsWith(`${urlPrefix}/`) ? pathname.slice(urlPrefix.length + 1) : "";
    if (rest === "" || rest.includes("/") || !SAFE_FILE.test(rest)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const filePath = join(dir, rest);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }
    } catch {
      response.writeHead(404);
      response.end();
      return;
    }
    serveFile(response, request, filePath);
  };
}

/**
 * Handler for the user-wallpaper prefix: /list, /upload, /delete and file GETs.
 * @param rootDir - custom wallpaper directory.
 */
function customHandler(rootDir) {
  const safeTarget = (value) => {
    const fileName = typeof value === "string" && value.startsWith(`${CUSTOM_PREFIX}/`)
      ? value.slice(CUSTOM_PREFIX.length + 1)
      : (typeof value === "string" ? value : "");
    if (fileName === "" || fileName.includes("/") || !SAFE_FILE.test(fileName)) return null;
    return fileName;
  };

  return async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }

    if (pathname === `${CUSTOM_PREFIX}/list`) {
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET" });
        response.end();
        return;
      }
      let wallpapers = [];
      try {
        wallpapers = readdirSync(rootDir)
          .filter((name) => SAFE_FILE.test(name))
          .map((name) => {
            const stat = statSync(join(rootDir, name), { throwIfNoEntry: false });
            if (stat === undefined || !stat.isFile()) return null;
            return {
              id: name,
              url: `${CUSTOM_PREFIX}/${name}`,
              size: stat.size,
              modified: stat.mtimeMs
            };
          })
          .filter((entry) => entry !== null);
      } catch { /* directory may not exist yet */ }
      wallpapers.sort((a, b) => b.modified - a.modified);
      sendJson(response, 200, { wallpapers });
      return;
    }

    if (pathname === `${CUSTOM_PREFIX}/upload`) {
      if (request.method !== "POST") {
        response.writeHead(405, { allow: "POST" });
        response.end();
        return;
      }
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: "untrusted origin" });
        return;
      }
      let buffer;
      try {
        buffer = await readBody(request, UPLOAD_MAX_BYTES);
      } catch (error) {
        if (error !== null && typeof error === "object" && error.code === "TOO_LARGE") {
          sendJson(response, 413, { error: "image too large (25 MB max)" });
        } else {
          sendJson(response, 400, { error: "invalid request body" });
        }
        return;
      }
      if (buffer.length === 0) {
        sendJson(response, 400, { error: "empty upload" });
        return;
      }
      const ext = sniffImageExt(buffer);
      if (ext === null) {
        sendJson(response, 415, { error: "unsupported image (jpeg/png/webp only)" });
        return;
      }
      const digest = createHash("sha256").update(buffer).digest("hex");
      const fileName = `${digest}.${ext}`;
      const filePath = join(rootDir, fileName);
      const reused = existsSync(filePath);
      if (!reused) {
        try {
          mkdirSync(rootDir, { recursive: true });
          writeFileSync(filePath, buffer);
        } catch {
          sendJson(response, 500, { error: "failed to store image" });
          return;
        }
      }
      sendJson(response, 200, { url: `${CUSTOM_PREFIX}/${fileName}`, id: fileName, reused, size: buffer.length });
      return;
    }

    if (pathname === `${CUSTOM_PREFIX}/delete`) {
      if (request.method !== "POST") {
        response.writeHead(405, { allow: "POST" });
        response.end();
        return;
      }
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: "untrusted origin" });
        return;
      }
      let body;
      try {
        const raw = await readBody(request, DELETE_BODY_MAX_BYTES);
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(response, 400, { error: "invalid request body" });
        return;
      }
      const target = body !== null && typeof body === "object" ? (body.url ?? body.id ?? "") : "";
      const fileName = safeTarget(target);
      if (fileName === null) {
        sendJson(response, 400, { error: "invalid target" });
        return;
      }
      try {
        const stat = statSync(join(rootDir, fileName), { throwIfNoEntry: false });
        if (stat !== undefined && stat.isFile()) unlinkSync(join(rootDir, fileName));
      } catch { /* treat as already gone */ }
      sendJson(response, 200, { ok: true });
      return;
    }

    // Fall through: GET/HEAD a stored wallpaper file.
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD, POST" });
      response.end();
      return;
    }
    const rest = pathname.startsWith(`${CUSTOM_PREFIX}/`) ? pathname.slice(CUSTOM_PREFIX.length + 1) : "";
    if (rest === "" || rest.includes("/") || !SAFE_FILE.test(rest)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const filePath = join(rootDir, rest);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }
    } catch {
      response.writeHead(404);
      response.end();
      return;
    }
    serveFile(response, request, filePath);
  };
}

/**
 * Mount the asset routes on the host webServer.
 * @param host - host context exposing `webServer`.
 * @returns a disposer removing every route.
 */
export function mountRoutes(host) {
  const disposers = [
    host.webServer.register({ kind: "prefix", path: PREFIX, handler: fileHandler(STAGE_DIR, PREFIX) }),
    host.webServer.register({ kind: "prefix", path: CUSTOM_PREFIX, handler: customHandler(customRoot()) })
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
