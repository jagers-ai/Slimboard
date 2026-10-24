import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { USAGE_DIRECTORY } from "../lib/openai-usage.ts";

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && args[0] !== "--json")) {
  console.error("Use npm run lab:usage, optionally with -- --json");
  process.exit(1);
}
let names;
try { names = await readdir(USAGE_DIRECTORY); } catch (error) {
  if (error.code !== "ENOENT") throw new Error("사용 기록을 읽지 못했습니다.");
  names = [];
}
const records = [];
let unreadableLines = 0;
for (const name of names.filter((name) => /^openai-\d{4}-\d{2}\.jsonl$/.test(name)).sort()) {
  const path = join(USAGE_DIRECTORY, name);
  if (!(await lstat(path)).isFile()) continue;
  for (const line of (await readFile(path, "utf8")).split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (row.version !== 1 || !["completed", "failed"].includes(row.status)) throw new Error();
      records.push(row);
    } catch { unreadableLines++; }
  }
}
const priced = records.filter((r) => typeof r.cost?.usd === "number" && Number.isFinite(r.cost.usd));
const sum = (rows, fn) => rows.reduce((n, row) => n + fn(row), 0);
const summary = {
  directory: USAGE_DIRECTORY, requests: records.length,
  completed: records.filter((r) => r.status === "completed").length,
  failed: records.filter((r) => r.status === "failed").length,
  usageUnavailable: records.filter((r) => !r.usage).length,
  reasoningUnavailable: records.filter((r) => r.usage && r.usage.reasoningTokens === null).length,
  costUnavailable: records.length - priced.length, unreadableLines,
  inputTokens: sum(records, (r) => r.usage?.inputTokens ?? 0),
  cachedInputTokens: sum(records, (r) => r.usage?.cachedInputTokens ?? 0),
  cacheWriteTokens: sum(records, (r) => r.usage?.cacheWriteTokens ?? 0),
  outputTokens: sum(records, (r) => r.usage?.outputTokens ?? 0),
  reasoningTokens: sum(records, (r) => r.usage?.reasoningTokens ?? 0),
  estimatedUsd: Number(sum(priced, (r) => r.cost.usd).toFixed(9)),
  referenceKrw: Number(sum(priced, (r) => r.cost.krwReference).toFixed(2)),
  averageEstimatedUsd: priced.length ? Number((sum(priced, (r) => r.cost.usd) / priced.length).toFixed(9)) : null,
};
if (args[0] === "--json") console.log(JSON.stringify({ summary, recent: records.slice(-20) }, null, 2));
else {
  console.log(`사용 기록: ${USAGE_DIRECTORY}`);
  console.log(`전체 ${summary.requests}건 / 성공 ${summary.completed}건 / 실패 ${summary.failed}건 / 비용 미확인 ${summary.costUnavailable}건`);
  console.log(`확인된 사용량: 입력 ${summary.inputTokens} / 출력 ${summary.outputTokens} (그중 추론 ${summary.reasoningTokens}) 토큰`);
  console.log(`사용량 기준 계산 비용 합계: $${summary.estimatedUsd.toFixed(6)} / 참고 환산 ${summary.referenceKrw.toFixed(2)}원`);
  console.log("공식 요금표 기반 추정액이며 세금·카드 환율·계약 할인을 포함하지 않습니다. 미확인 비용은 합계에서 제외됩니다.");
  if (unreadableLines) console.log(`읽지 못한 기록 ${unreadableLines}줄은 합계에서 제외했습니다.`);
  if (summary.reasoningUnavailable) console.log(`내부 추론 토큰이 보고되지 않은 요청 ${summary.reasoningUnavailable}건이 있습니다.`);
  console.table(records.slice(-20).map((r) => ({
    시각: new Date(r.timestamp).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    모델: r.responseModel ?? r.requestedModel, 추론: r.reasoningEffort, 상태: r.status,
    입력: r.usage?.inputTokens ?? "미확인", 출력: r.usage?.outputTokens ?? "미확인",
    내부추론: r.usage?.reasoningTokens ?? "미확인", USD: r.cost?.usd ?? "미확인",
    참고원화: r.cost?.krwReference ?? "미확인",
  })));
}
