#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { analyzeWithCodex, checkCodexAuth, CodexOcrError, MAX_IMAGE_BYTES } from "./codex-ocr.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: node scripts/codex-ocr-cli.mjs [image-path | --auth]\nNo image: show sanitized Codex ChatGPT login status. Local personal development only.");
    return;
  }
  if (args.length === 0 || (args.length === 1 && args[0] === "--auth")) {
    const auth = await checkCodexAuth();
    console.log(JSON.stringify(auth, null, 2));
    if (!auth.authenticated) process.exitCode = 1;
    return;
  }
  if (args.length !== 1 || args[0].startsWith("--")) {
    throw new CodexOcrError("INVALID_OPTIONS", "사용법: node scripts/codex-ocr-cli.mjs [image-path | --auth]");
  }
  let buffer;
  try {
    const path = resolve(args[0]);
    const stat = await fs.stat(path);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) throw new Error();
    buffer = await fs.readFile(path);
  } catch {
    throw new CodexOcrError("INVALID_IMAGE", "10MiB 이하의 로컬 이미지 파일을 읽을 수 없습니다.");
  }
  console.log(JSON.stringify(await analyzeWithCodex(buffer), null, 2));
}

main().catch((error) => {
  // Never print raw CLI output, environment, credential data, or stack traces.
  console.error(error instanceof CodexOcrError ? error.message : "로컬 Codex OCR 실험을 실행하지 못했습니다.");
  process.exitCode = 1;
});
