import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraSessionReducer as reduce, createCameraNote, filterCameraNotes, initialCameraSession } from '../lib/camera-session.ts';
import { analyzeCameraPhoto, checkCameraReady } from '../lib/camera-api.ts';

const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' });
const analysis = { title: '회의', summary: '샘플 준비', rawText: '담당자 민수', keywords: ['SB-1024'] };
const signal = () => new AbortController().signal;

function withNote() {
  return reduce(initialCameraSession, { type: 'analyzed', note: createCameraNote(analysis, first) });
}

test('unfinished photo survives visiting an existing note and returning to review', () => {
  let state = withNote();
  const noteId = state.notes[0].id;
  state = reduce(state, { type: 'prepared', photo: second });
  state = reduce(state, { type: 'navigate', view: { kind: 'list' } });
  state = reduce(state, { type: 'navigate', view: { kind: 'note', id: noteId } });
  assert.equal(state.draft, second);
  assert.equal(state.notes[0].photo, first);
  state = reduce(state, { type: 'navigate', view: { kind: 'list' } });
  state = reduce(state, { type: 'navigate', view: { kind: 'photo' } });
  assert.equal(state.view.kind, 'photo');
  assert.equal(state.draft, second);
});

test('failed preparation and analysis preserve both records and draft', () => {
  let state = reduce(withNote(), { type: 'prepared', photo: second });
  const notes = state.notes;
  for (const operation of ['preparing', 'analyzing']) {
    state = reduce(state, { type: 'start', operation });
    state = reduce(state, { type: 'failed', message: 'retry' });
    assert.equal(state.draft, second);
    assert.equal(state.notes, notes);
    assert.equal(state.operation, 'idle');
  }
});

test('busy state rejects navigation and another operation; success clears only draft', () => {
  let state = reduce(withNote(), { type: 'prepared', photo: second });
  state = reduce(state, { type: 'start', operation: 'analyzing' });
  assert.equal(reduce(state, { type: 'navigate', view: { kind: 'list' } }), state);
  assert.equal(reduce(state, { type: 'start', operation: 'preparing' }), state);
  state = reduce(state, { type: 'analyzed', note: createCameraNote(analysis, second) });
  assert.equal(state.notes.length, 2);
  assert.equal(state.draft, null);
  assert.equal(state.notes[0].photo, second);
  assert.equal(state.notes[1].photo, first);
});

test('navigation cannot create a blank review or missing note view', () => {
  assert.equal(reduce(initialCameraSession, { type: 'navigate', view: { kind: 'photo' } }), initialCameraSession);
  for (const id of ['missing', '']) {
    assert.equal(reduce(initialCameraSession, { type: 'navigate', view: { kind: 'note', id } }), initialCameraSession);
  }
});

test('indexed search includes raw text and keywords; whitespace means all records', () => {
  const notes = withNote().notes;
  assert.equal(filterCameraNotes(notes, '   '), notes);
  assert.deepEqual(filterCameraNotes(notes, ' 민수 '), notes);
  assert.deepEqual(filterCameraNotes(notes, 'sb-1024'), notes);
  assert.deepEqual(filterCameraNotes(notes, '없음'), []);
});

test('API client sends exactly one photo request and stores only validated display fields', async () => {
  let calls = 0;
  const abortSignal = signal();
  const result = await analyzeCameraPhoto(first, abortSignal, async (url, options) => {
    calls++;
    assert.equal(url, '/api/lab/codex');
    assert.equal(options.method, 'POST');
    assert.equal(options.signal, abortSignal);
    assert.equal(await options.body.get('image').text(), 'first');
    return Response.json({ analysis, model: 'test-model', accounting: { arbitrary: true } });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, analysis);
});

test('malformed JSON or structurally invalid success response never becomes a note', async () => {
  for (const response of [new Response('<html>gateway error</html>'), Response.json({ analysis: { ...analysis, keywords: null } }), Response.json(null)]) {
    await assert.rejects(analyzeCameraPhoto(first, signal(), async () => response), /잠시 후/);
  }
});

test('invitation and quota failures have stable messages for JSON and HTML responses', async () => {
  for (const status of [401, 410, 429]) {
    for (const body of ['<html>private upstream details</html>', '{"error":"private details"}']) {
      await assert.rejects(analyzeCameraPhoto(first, signal(), async () => new Response(body, { status })), status === 429 ? /횟수/ : /만료/);
    }
  }
});

test('network errors are not retried automatically', async () => {
  let attempts = 0;
  await assert.rejects(analyzeCameraPhoto(first, signal(), async () => { attempts++; throw new TypeError('network'); }));
  assert.equal(attempts, 1);
});

test('ready requires an explicit boolean from a successful response', async () => {
  assert.equal(await checkCameraReady(signal(), async () => Response.json({ ready: true })), true);
  for (const body of [{ ready: 'true' }, {}, null]) {
    assert.equal(await checkCameraReady(signal(), async () => Response.json(body)), false);
  }
  assert.equal(await checkCameraReady(signal(), async () => new Response('denied', { status: 401 })), false);
});
