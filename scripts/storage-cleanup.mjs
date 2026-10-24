// Run with Node 24 --env-file=.env.local. Dry-run unless --apply is explicit.
// Only consumes deletion work already committed by the DB trigger; never prunes
// historical originals or scans unrelated objects. No paths or secrets in logs.
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase server configuration is required.');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.from('note_image_cleanup').select('note_id,paths').order('created_at').limit(100);
if (error) throw new Error('Could not read cleanup queue.');
let cleaned = 0, failed = 0;
if (process.argv.includes('--apply')) for (const row of data) {
  const { error: storageError } = await admin.storage.from('whiteboard-images').remove([...new Set(row.paths)]);
  if (storageError) { failed++; continue; }
  const { error: rowError } = await admin.from('note_image_cleanup').delete().eq('note_id', row.note_id);
  if (rowError) failed++; else cleaned++;
}
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', queued: data.length, cleaned, failed }));
if (failed) process.exitCode = 1;
