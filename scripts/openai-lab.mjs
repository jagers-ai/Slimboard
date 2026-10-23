import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import nextEnv from "@next/env";

const project = fileURLToPath(new URL("..", import.meta.url));
nextEnv.loadEnvConfig(project, true);
const [command, flag, envFile, ...extra] = process.argv.slice(2);
if (!["start", "status"].includes(command) || extra.length || (flag && (flag !== "--env-file" || !envFile))) {
  console.error("Use npm run lab:start (or lab:status), optionally with -- --env-file /path/to/existing.env");
  process.exit(1);
}

// Reuse an explicitly selected existing key in memory, without copying it.
if (envFile) {
  try {
    const key = parseEnv(await readFile(envFile, "utf8")).OPENAI_API_KEY;
    if (!key?.trim()) throw new Error();
    process.env.OPENAI_API_KEY = key;
  } catch {
    console.error("선택한 환경 파일에서 OPENAI_API_KEY를 읽지 못했습니다.");
    process.exit(1);
  }
}
if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("OPENAI_API_KEY가 연결되지 않았습니다.");
  process.exit(1);
}
if (command === "status") {
  console.log("OpenAI API 키가 연결되어 있습니다. 실제 사용 가능 여부는 분석 요청으로 확인합니다.");
  process.exit(0);
}
const env = { ...process.env, SLIMBOARD_ENABLE_CODEX_LAB: "1" };
console.log("Slimboard: http://localhost:3000/lab/codex");
const child = spawn(process.execPath, [join(project, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", "3000"], {
  cwd: project, env, stdio: "inherit", shell: false,
});
child.on("error", () => { console.error("개발 서버를 시작하지 못했습니다."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
