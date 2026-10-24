import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteOwnedNote, getOwnedNote } from '../lib/note-mutations.ts';

const note = { owner_user_id: 'owner', original_image_path: 'original', analysis_image_path: 'analysis' };
function setup(overrides = {}) {
  const calls = [];
  return { calls, dependencies: {
    load: async () => note,
    deleteRow: async (id, userId) => { calls.push(['delete', id, userId]); return true; },
    removeImages: async paths => { calls.push(['images', paths]); },
    onCleanupFailure: () => { calls.push(['cleanup-warning']); },
    ...overrides,
  }};
}

test('read access alone never grants note mutation or analysis ownership', async () => {
  assert.equal(await getOwnedNote('note', 'viewer', async () => note), null);
  assert.equal(await getOwnedNote('note', 'owner', async () => null), null);
  assert.equal(await getOwnedNote('note', 'owner', async () => note), note);
});

test('non-owner deletion performs no database or storage side effects', async () => {
  const { calls, dependencies } = setup();
  assert.equal(await deleteOwnedNote('note', 'viewer', dependencies), false);
  assert.deepEqual(calls, []);
});

test('database error or absent owner-filtered row leaves photos intact', async () => {
  const failed = setup({ deleteRow: async () => { throw new Error('database unavailable'); } });
  await assert.rejects(deleteOwnedNote('note', 'owner', failed.dependencies), /database unavailable/);
  assert.deepEqual(failed.calls, []);
  const absent = setup({ deleteRow: async () => false });
  assert.equal(await deleteOwnedNote('note', 'owner', absent.dependencies), false);
  assert.deepEqual(absent.calls, []);
});

test('successful owner deletion confirms row removal before deleting images', async () => {
  const { calls, dependencies } = setup();
  assert.equal(await deleteOwnedNote('note', 'owner', dependencies), true);
  assert.deepEqual(calls, [['delete', 'note', 'owner'], ['images', ['original', 'analysis']]]);
});

test('storage cleanup failure is reported without undoing successful row deletion', async () => {
  const { calls, dependencies } = setup({ removeImages: async () => { throw new Error('private storage details'); } });
  assert.equal(await deleteOwnedNote('note', 'owner', dependencies), true);
  assert.deepEqual(calls, [['delete', 'note', 'owner'], ['cleanup-warning']]);
});
