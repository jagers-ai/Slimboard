import { isCodexLabEnabled, isSameOriginLabRequest } from "@/lib/codex-lab";
import { analyzeWithOpenAI, OpenAIOcrError } from "@/lib/openai-ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
let analyzing = false;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  if (!isCodexLabEnabled(request.headers.get("host"))) {
    return json({ error: "Not found" }, 404);
  }
  return json({ ready: Boolean(process.env.OPENAI_API_KEY?.trim()) });
}

export async function POST(request: Request) {
  if (!isCodexLabEnabled(request.headers.get("host"))) {
    return json({ error: "Not found" }, 404);
  }
  if (!isSameOriginLabRequest(request)) {
    return json({ error: "화면을 새로고침한 뒤 다시 시도해주세요." }, 403);
  }
  if (analyzing) {
    return json({ error: "앞선 사진을 분석 중이에요. 완료 후 다시 시도해주세요." }, 409);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > MAX_IMAGE_BYTES + 1024 * 1024) {
    return json({ error: "10MB 이하 사진을 선택해주세요." }, 413);
  }

  analyzing = true;
  try {
    // Bound the request while reading, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "사진을 선택해주세요." }, 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_IMAGE_BYTES + 1024 * 1024) {
        await reader.cancel();
        return json({ error: "10MB 이하 사진을 선택해주세요." }, 413);
      }
      chunks.push(chunk.value);
    }
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body: Buffer.concat(chunks),
    });
    let form: FormData;
    try {
      form = await boundedRequest.formData();
    } catch {
      return json({ error: "사진 업로드 형식을 확인해주세요." }, 400);
    }
    const image = form.get("image");
    if (!(image instanceof File) || !image.size || image.size > MAX_IMAGE_BYTES) {
      return json({ error: "10MB 이하 사진을 선택해주세요." }, 400);
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) {
      return json({ error: "JPG, PNG, WebP 사진을 선택해주세요." }, 400);
    }

    const result = await analyzeWithOpenAI(Buffer.from(await image.arrayBuffer()), image.type);
    return json(result);
  } catch (error) {
    if (error instanceof OpenAIOcrError) {
      const status = error.code === "INVALID_IMAGE" ? 400 : error.code === "TIMEOUT" ? 504 : 502;
      return json({ error: error.message }, status);
    }
    return json({ error: "사진을 정리하지 못했어요. 다시 시도해주세요." }, 502);
  } finally {
    analyzing = false;
  }
}
