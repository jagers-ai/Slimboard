import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleViewportBounds as bounds } from '../lib/visible-viewport.ts';

test('stale keyboard offset cannot move a full-height frame below the screen',()=>{
  assert.deepEqual(bounds(800,800,800,48),{height:800,top:0});
});
test('uses the smaller viewport when measurements disagree',()=>{
  assert.deepEqual(bounds(800,752,800,0),{height:752,top:0});
  assert.deepEqual(bounds(752,800,800,0),{height:752,top:0});
});
test('keyboard viewport can pan without extending past layout bounds',()=>{
  assert.deepEqual(bounds(800,800,400,60),{height:400,top:60});
  assert.deepEqual(bounds(800,800,400,500),{height:400,top:400});
  assert.deepEqual(bounds(400,400,400,60),{height:400,top:0});
});
test('missing visual viewport and negative offsets have usable bounds',()=>{
  assert.deepEqual(bounds(800,800,0,-40),{height:800,top:0});
});
