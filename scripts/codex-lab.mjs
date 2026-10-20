import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (!["login", "status", "start"].includes(command)) {
  console.error("Use npm run lab:login, npm run lab:status, or npm run lab:start.");
  process.exit(1);
}
const sessionHome = process.env.SLIMBOARD_CODEX_HOME ?? join(homedir(), ".slimboard", "codex-local");
await mkdir(sessionHome, { recursive: true, mode: 0o700 });
const env = { ...process.env, SLIMBOARD_CODEX_HOME: sessionHome };
delete env.OPENAI_API_KEY;
delete env.CODEX_API_KEY;
delete env.CODEX_ACCESS_TOKEN;

if (command === "status") {
  const { checkCodexAuth } = await import("./codex-ocr.mjs");
  const status = await checkCodexAuth();
  console.log(status.message);
  process.exit(status.authenticated && status.mode === "chatgpt" ? 0 : 1);
}
const project = fileURLToPath(new URL("..", import.meta.url));
const program = command === "start" ? process.execPath : env.SLIMBOARD_CODEX_BIN ?? "codex";
const args = command === "start"
  ? [join(project, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1"]
  : ["login", "-c", 'forced_login_method="chatgpt"', "-c", 'cli_auth_credentials_store="file"', ...process.argv.slice(3)];
if (command === "start") {
  env.SLIMBOARD_ENABLE_CODEX_LAB = "1";
  console.log("Slimboard local AI experiment: http://localhost:3000/lab/codex");
} else {
  env.CODEX_HOME = sessionHome;
}
const child = spawn(program, args, { cwd: project, env, stdio: "inherit", shell: false });
child.on("error", () => {
  console.error(command === "login" ? "Codex CLI가 필요합니다: npm install -g @openai/codex" : "먼저 npm ci를 실행해주세요.");
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
