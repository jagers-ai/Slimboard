// Explicit live integration check. Creates disposable accounts and synthetic
// photos, never calls AI, and removes ONLY its own UUID-tagged fixtures.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import sharp from 'sharp';
import { sealRecovery } from '../lib/analysis-recovery.ts';
if (!process.argv.includes('--run')) throw new Error('Pass --run to create and clean live test fixtures.');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const origin = process.env.SLIMBOARD_TEST_ORIGIN ?? 'http://127.0.0.1:3000';
if (!url || !key || !anon) throw new Error('Supabase configuration required.');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = [], noteIds = [], workspaces = [];
let checks = 0;
async function account() {
  const password = randomBytes(24).toString('hex');
  const email = `slimboard-test-${randomUUID()}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error('Test account setup failed.');
  const result = { id: data.user.id, cookies: [] };
  accounts.push(result);
  const auth = createServerClient(url, anon, { cookies: { getAll: () => result.cookies, setAll: values => { result.cookies = values; } } });
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error('Test sign-in failed.');
  return result;
}
async function api(who, path, options = {}) {
  return fetch(origin + path, { ...options, headers: { Origin: origin, Cookie: who.cookies.map(c => `${c.name}=${c.value}`).join('; '), ...options.headers } });
}
function pass(value, expected) { assert.equal(value, expected); checks++; }
try {
  const a = await account(), b = await account();
  const id = randomUUID(); noteIds.push(id);
  const bytes = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#dddddd' } }).jpeg().toBuffer();
  const upload = () => { const form = new FormData(); form.set('noteId', id); form.set('image', new File([bytes], 'synthetic-test.jpg', { type: 'image/jpeg' })); return api(a, '/api/notes', { method: 'POST', body: form }); };
  const first = await upload(); pass(first.status, 201);
  const { note } = await first.json(); workspaces.push(note.workspace_id);
  pass(note.original_image_path, null); pass(note.image_ready, true);
  pass((await upload()).status, 200);
  const objects = await admin.storage.from('whiteboard-images').list(`${a.id}/${id}`);
  pass(objects.data?.length, 1); pass(objects.data?.[0]?.name, 'analysis.jpg');
  pass((await api(a, `/api/notes/${id}/image`)).status, 200);
  const download = await api(a, `/api/notes/${id}/image?download=1`);
  pass(download.status, 200);
  pass(download.headers.get('content-disposition'), `attachment; filename="slimboard-${id}.jpg"`);
  pass((await api(b, `/api/notes/${id}/image?download=1`)).status, 404);
  pass((await fetch(origin + `/api/notes/${id}/image?download=1`)).status, 401);
  pass((await api(b, `/api/notes/${id}/image`)).status, 404);
  pass((await api(b, `/api/notes/${id}`)).status, 404);
  pass((await api(b, `/api/notes/${id}`, { method: 'DELETE' })).status, 404);
  const attempt = randomUUID();
  const claimed = await admin.from('whiteboard_notes').update({ analysis_attempt: attempt, status: 'processing' }).eq('id', id);
  if (claimed.error) throw new Error('Recovery test setup failed.');
  const recovery = sealRecovery({ owner: a.id, note: id, attempt, expires: Date.now() + 60000, update: { title: 'Synthetic recovery test', raw_text: 'test', summary: 'test', keywords: ['hidden-search-fixture'], search_text: 'test hidden-search-fixture', status: 'completed' } }, key);
  const save = () => api(a, `/api/notes/${id}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recovery }) });
  pass((await save()).status, 200);
  pass((await api(a, `/api/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Human edit', rawText: 'edited', summary: 'edited' }) })).status, 200);
  const search = await api(a, '/api/notes?query=hidden-search-fixture');
  pass(search.status, 200); pass((await search.json()).notes.some(n => n.id === id), true);
  const retry = await save(); pass(retry.status, 200); pass((await retry.json()).note.title, 'Human edit');
  const defaultRetry = await api(a, `/api/notes/${id}/analyze`, { method: 'POST' }); pass(defaultRetry.status, 200);
  pass((await api(a, `/api/notes/${id}`, { method: 'DELETE' })).status, 200);
  const after = await admin.storage.from('whiteboard-images').list(`${a.id}/${id}`); pass(after.data?.length, 0);
  console.log(JSON.stringify({ passed: checks, liveStorage: true, paidAnalysisCalls: 0 }));
} catch (error) {
  // Do not dump credentials, cookies, private rows, or raw network errors.
  console.error('Cloud HTTP integration failed:', error instanceof assert.AssertionError ? `expected ${error.expected}, got ${error.actual}; check ${checks + 1}` : 'setup or request failure');
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  for (const id of noteIds) {
    for (const who of accounts) {
      const removed = await admin.storage.from('whiteboard-images').remove([`${who.id}/${id}/analysis.jpg`]);
      if (removed.error) cleanupFailed = true;
    }
    const row = await admin.from('whiteboard_notes').delete().eq('id', id);
    if (row.error) cleanupFailed = true;
    const queue = await admin.from('note_image_cleanup').delete().eq('note_id', id);
    if (queue.error) cleanupFailed = true;
  }
  for (const who of accounts) {
    const removed = await admin.auth.admin.deleteUser(who.id);
    if (removed.error) cleanupFailed = true;
  }
  console.log(JSON.stringify({ testFixtureCleanup: cleanupFailed ? 'needs-attention' : 'complete' }));
  if (cleanupFailed) process.exitCode = 1;
}
