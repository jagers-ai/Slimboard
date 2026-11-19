import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const noteId = "11111111-1111-4111-8111-111111111111";
const jpeg = Buffer.from("sanitized fixture");
const fixture = {};
const modules = {
  "next/server": "export const NextResponse = Response",
  "@/lib/image": "export async function prepareImage() { return { analysis: { buffer: f.jpeg, contentType: 'image/jpeg' } } }",
  "@/lib/auth": "export async function getCurrentUser() { return f.user }",
  "@/lib/notes": `export async function listNotesForUser() { return [] }
    export class NoteOperationError extends Error {}
    export async function analyzeNoteForUser(id, user, options) {
      f.calls.push(['analyze', id, user.id, options.uploadedImage]);
      return f.result;
    }`,
  "@/lib/storage": `export function buildImagePaths() { return { analysisPath: 'owner/photo.jpg' } }
    export async function uploadImageObject(photo) { f.calls.push(['upload', photo.buffer]); return f.stored }`,
  "@/lib/supabase/admin": "export function createAdminClient() { return f.admin }",
  "@/lib/workspaces": "export async function ensurePersonalWorkspace() { return 'workspace' }",
};
const globalName = "slimboardNoteUploadTest";
globalThis[globalName] = fixture;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(modules, specifier)) {
      const source = `const f = globalThis.${globalName}; ${modules[specifier]}`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/notes/route.ts");
hooks.deregister();

function setup({ stored = true, existing = null, user = { id: "owner" }, result = { note: { id: noteId, status: "completed" } } } = {}) {
  const calls = [];
  const query = {
    eq() { return this; },
    async maybeSingle() { return { data: existing }; },
    async single() { return { data: { id: noteId, image_ready: true } }; },
    then(resolve) { return resolve({}); },
  };
  const admin = { from() { return {
    select: (fields) => fields === "id" ? { ...query, async maybeSingle() { return { data: { id: noteId } }; } } : query,
    upsert: async () => ({}),
    update: () => query,
  }; } };
  Object.assign(fixture, { calls, jpeg, admin, stored, user, result });
  return calls;
}

function request(analyze = true) {
  const form = new FormData();
  form.set("image", new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }));
  form.set("noteId", noteId);
  if (analyze) form.set("analyze", "1");
  return new Request("http://localhost/api/notes", { method: "POST", body: form });
}

test("passes the newly saved sanitized bytes directly into analysis", async () => {
  const calls = setup();
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).usedUploadedImage, true);
  assert.deepEqual(calls, [["upload", jpeg], ["analyze", noteId, "owner", jpeg]]);
});

test("on an existing note or upload conflict, analyzes the stored photo", async () => {
  for (const [options, uploadCalls] of [[{ existing: { image_ready: true } }, []], [{ stored: false }, [["upload", jpeg]]]]) {
    const calls = setup(options);
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).usedUploadedImage, false);
    assert.deepEqual(calls, [...uploadCalls, ["analyze", noteId, "owner", undefined]]);
  }
});

test("preserves upload-only callers and returns the recovery receipt after an interrupted save", async () => {
  const calls = setup();
  assert.equal((await POST(request(false))).status, 201);
  assert.deepEqual(calls, [["upload", jpeg]]);
  setup({ result: { recovery: "receipt", error: "storage failed" } });
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { uploaded: true, usedUploadedImage: true, recovery: "receipt", error: "storage failed" });
});

test("requires an account before storing or analyzing uploaded bytes", async () => {
  const calls = setup({ user: null });
  assert.equal((await POST(request())).status, 401);
  assert.deepEqual(calls, []);
});
