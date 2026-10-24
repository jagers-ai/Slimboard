import assert from 'node:assert/strict';
import test from 'node:test';
import { photoView } from '../lib/photo-view.ts';

test('portrait opens at viewport width and can scroll vertically', () => {
  const p=photoView(700,1500,400,600,'width');
  assert.ok(Math.abs(p.width-400)<.001); assert.ok(p.height>600);
});
test('fit shows the entire photo in portrait and landscape viewports', () => {
  for (const [w,h] of [[700,1500],[2000,800]]) for(const [vw,vh] of [[400,600],[800,250]]) {
    const p=photoView(w,h,vw,vh,'fit');
    assert.ok(p.width<=vw+.001&&p.height<=vh+.001);
    assert.ok(Math.abs(p.width/p.height-w/h)<.0001);
  }
});
test('zoom is bounded without distorting the photo', () => {
  const fit=photoView(700,1500,400,600,'fit');
  assert.deepEqual(photoView(700,1500,400,600,.1),fit);
  const max=photoView(700,1500,400,600,99);
  assert.equal(max.zoom,6); assert.equal(max.width,fit.width*6);
});
test('loading and collapsed viewports do not produce invalid dimensions', () => {
  for(const n of [0,-1,NaN,Infinity]) assert.deepEqual(photoView(n,1500,400,600,'width'),{width:0,height:0,zoom:1});
  assert.equal(photoView(700,1500,400,0,'fit').width,0);
});
