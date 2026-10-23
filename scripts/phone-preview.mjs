// Expose only the invitation gateway, never Next or its server environment.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewConfig, startPreviewServer } from "./codex-share.mjs";

export function tunnelEnvironment(env = process.env) {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "SystemRoot"].filter((key) => env[key]).map((key) => [key, env[key]]));
}

export async function startPhonePreview() {
  const status = await fetch("http://127.0.0.1:3000/api/lab/codex", { signal: AbortSignal.timeout(5000) });
  if (!status.ok || !(await status.json()).ready) throw new Error("Start npm run lab:start first.");
  // Reserve the port before starting a tunnel, so another local service can
  // never be exposed accidentally. Reject every request until its URL is known.
  const config = { origin: "", previewHost: "", labOnly: true };
  const { server, session } = await startPreviewServer(config, { announce: false });
  const child = spawn("cloudflared", ["tunnel", "--url", "http://127.0.0.1:3001", "--http-host-header", "127.0.0.1:3001", "--no-autoupdate"], {
    env: tunnelEnvironment(), stdio: ["ignore", "pipe", "pipe"], shell: false,
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    child.kill("SIGTERM");
    server.close(); server.closeAllConnections();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("exit", stop);
  server.once("close", stop);
  try {
    const origin = await new Promise((done, fail) => {
      let buffer = "";
      const timer = setTimeout(() => { cleanup(); fail(new Error("HTTPS tunnel timed out.")); }, 45_000);
      const cleanup = () => { clearTimeout(timer); child.stdout.off("data", read); child.stderr.off("data", read); };
      const read = (data) => {
        buffer = (buffer + data.toString()).slice(-8192);
        const match = buffer.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/);
        if (match) { cleanup(); done(match[0]); }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("error", () => { cleanup(); fail(new Error("Install cloudflared before starting phone preview.")); });
      child.once("exit", () => { cleanup(); fail(new Error("HTTPS tunnel stopped.")); });
    });
    if (stopped) throw new Error("HTTPS tunnel stopped.");
    Object.assign(config, previewConfig({ NODE_ENV: "development", SLIMBOARD_ENABLE_CODEX_SHARE: "1", SLIMBOARD_SHARE_ORIGIN: origin }));
    // Drain tunnel output without retaining URLs or request details in logs.
    child.stdout.resume(); child.stderr.resume();
    console.log("Phone preview: expires in 4 hours, maximum 10 analyses. Keep this invitation private.");
    console.log(`${config.origin}/#invite=${session.inviteToken}`);
    return server;
  } catch (error) {
    stop();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPhonePreview().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
