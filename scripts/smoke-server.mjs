import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "astroblog-server-"));
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const selected = typeof address === "object" && address ? address.port : 0;
    server.close((error) => (error ? reject(error) : resolve(selected)));
  });
});

const serverFile = path.join(process.cwd(), ".next", "standalone", "server.js");
const child = spawn(process.execPath, [serverFile], {
  cwd: path.dirname(serverFile),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    ASTROBLOG_DATA_DIR: temp,
    ASTROBLOG_ADMIN_USERNAME: "server-check",
    ASTROBLOG_ADMIN_PASSWORD: "server-check-password",
    ASTROMETRY_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => (output += chunk.toString()));
child.stderr.on("data", (chunk) => (output += chunk.toString()));

try {
  const deadline = Date.now() + 30_000;
  let readiness;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early.\n${output}`);
    try {
      const live = await fetch(`http://127.0.0.1:${port}/api/health/live`);
      const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
      if (live.ok && ready.ok) {
        readiness = await ready.json();
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert.equal(readiness?.ok, true, `Server did not become ready.\n${output}`);
  const login = await fetch(`http://127.0.0.1:${port}/admin/login`);
  assert.equal(login.ok, true);
  const loginHtml = await login.text();
  assert.match(loginHtml, /Sign in/i);
  const assetPath = loginHtml.match(/(?:src|href)="([^"]*_next\/static\/[^"]+)"/)?.[1];
  assert.ok(assetPath, "Login page did not reference a static asset.");
  const asset = await fetch(new URL(assetPath, `http://127.0.0.1:${port}`));
  assert.equal(asset.ok, true, "Standalone server did not serve its static assets.");

  const upload = await fetch(`http://127.0.0.1:${port}/admin/upload`, {
    method: "POST",
  });
  assert.equal(upload.status, 401);

  const solve = await fetch(`http://127.0.0.1:${port}/admin/solve?frameId=1`);
  assert.equal(solve.status, 401);
  console.log("PRODUCTION SERVER SMOKE CHECK PASSED");
} finally {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
  await fs.rm(temp, { recursive: true, force: true });
}
