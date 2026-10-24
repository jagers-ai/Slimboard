import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { prepareImage } from '../lib/image.ts';
import { openRecovery, sealRecovery, saveAnalysisResult } from '../lib/analysis-recovery.ts';
import { safeAuthNext } from '../lib/auth-navigation.ts';
import { deleteOwnedNote } from '../lib/note-mutations.ts';
import { readDraft, writeDraft, clearAllDrafts } from '../lib/session-drafts.ts';

test('new photo output has one JPEG, keeps aspect ratio, removes original and EXIF', async () => {
  const bytes = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: '#fafafa' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await prepareImage(new File([bytes], 'camera.jpg', { type: 'image/jpeg' }));
  assert.deepEqual(Object.keys(result), ['analysis']);
  const info = await sharp(result.analysis.buffer).metadata();
  assert.equal(info.format, 'jpeg');
  assert.equal(info.width, 1280); assert.equal(info.height, 2560);
  assert.equal(info.exif, undefined);
});
test('invalid and oversized images fail without producing stored bytes', async () => {
  await assert.rejects(prepareImage(new File(['bad'], 'photo.jpg', { type: 'image/jpeg' })));
  await assert.rejects(prepareImage(new File(['bad'], 'raw.dng', { type: 'image/x-adobe-dng' })));
  await assert.rejects(prepareImage(new File([new Uint8Array(21 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' })));
});
test('recovery receipts are encrypted and reject altered bytes or another key', () => {
  const value = { owner: 'A', note: 'note1', attempt: 'attempt', update: { title: 'private note' } };
  const token = sealRecovery(value, 'server-only-test-key');
  assert.deepEqual(openRecovery(token, 'server-only-test-key'), value);
  assert(!Buffer.from(token, 'base64url').includes(Buffer.from('private note')));
  assert.throws(() => openRecovery(token, 'different-key'));
  const bytes = Buffer.from(token, 'base64url'); bytes[35] ^= 1;
  assert.throws(() => openRecovery(bytes.toString('base64url'), 'server-only-test-key'));
});
test('database failure returns retained result receipt; retry only writes DB', async () => {
  let writes = 0;
  const failed = await saveAnalysisResult(async () => { writes++; throw Error('private database error'); }, 'encrypted-result');
  assert.equal(writes, 2); assert.equal(failed.recovery, 'encrypted-result');
  assert(!JSON.stringify(failed).includes('private database error'));
  const retry = await saveAnalysisResult(async () => ({ id: 'same-note' }), failed.recovery);
  assert.deepEqual(retry, { note: { id: 'same-note' } });
});
test('transient DB failure retries the same result without another analysis', async () => {
  let calls = 0;
  const result = await saveAnalysisResult(async () => { if (++calls === 1) throw Error('temporary'); return 'saved'; }, 'receipt');
  assert.deepEqual(result, { note: 'saved' }); assert.equal(calls, 2);
});
test('single-image deletion and legacy deletion both work', async () => {
  for (const original of [null, 'legacy.jpg']) {
    let removed;
    await deleteOwnedNote('note', 'A', { load: async () => ({ owner_user_id: 'A', original_image_path: original, analysis_image_path: 'analysis.jpg' }), deleteRow: async () => true, removeImages: async paths => { removed = paths; }, onCleanupFailure() {} });
    assert.deepEqual(removed, original ? [original, 'analysis.jpg'] : ['analysis.jpg']);
  }
});
test('OAuth next rejects external/protocol-relative/backslash and auth-loop targets', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/auth/callback', null]) assert.equal(safeAuthNext(value, 'https://slimboard.test'), '/');
  assert.equal(safeAuthNext('/notes?q=ok', 'https://slimboard.test'), '/notes?q=ok');
});
test('drafts remain account scoped and are dropped on logout', () => {
  writeDraft('A:capture', { photo: 'A' }); writeDraft('B:capture', { photo: 'B' });
  assert.deepEqual(readDraft('A:capture'), { photo: 'A' });
  clearAllDrafts(); assert.equal(readDraft('A:capture'), undefined); assert.equal(readDraft('B:capture'), undefined);
});
