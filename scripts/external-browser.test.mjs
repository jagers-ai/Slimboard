import assert from 'node:assert/strict';
import test from 'node:test';
import { detectKakaoMobile, externalBrowserLinks } from '../lib/external-browser.ts';

const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK/26.5.0';
const android = 'Mozilla/5.0 (Linux; Android 15; SM-S936N; wv) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36 KAKAOTALK/26.5.0 (INAPP)';

test('Kakao iPhone and Android receive the correct browser choice', () => {
  assert.equal(detectKakaoMobile(ios), 'ios');
  assert.equal(detectKakaoMobile(android), 'android');
  assert.equal(detectKakaoMobile(android.toLowerCase()), 'android');
});
test('normal browsers, other in-app browsers and desktop Kakao are not gated', () => {
  assert.equal(detectKakaoMobile(ios.replace(/ KAKAOTALK.*/, ' Safari/604.1')), null);
  assert.equal(detectKakaoMobile(android.replace(/ KAKAOTALK.*/, '')), null);
  assert.equal(detectKakaoMobile(android.replace(/KAKAOTALK/, 'Instagram')), null);
  assert.equal(detectKakaoMobile('Mozilla/5.0 (Macintosh) KAKAOTALK/26'), null);
});
test('desktop-mode iPad is recognized only with Kakao and touch capability', () => {
  assert.equal(detectKakaoMobile('Mozilla/5.0 (Macintosh) KAKAOTALK/26', 'MacIntel', 5), 'ios');
  assert.equal(detectKakaoMobile('Mozilla/5.0 (Macintosh) Safari/605', 'MacIntel', 5), null);
});
test('Safari handoff starts at HTTPS home without credentials or OAuth callback data', () => {
  const links = externalBrowserLinks('https://name:secret@slimboard.example/auth/callback?code=private&next=https://other.example/#access_token=private', 'ios');
  assert.equal(links.home, 'https://slimboard.example/');
  assert.equal(links.primary, 'x-safari-https://slimboard.example/');
  assert.equal(decodeURIComponent(links.external.split('?url=')[1]), links.home);
  assert.ok(!JSON.stringify(links).includes('private'));
  assert.ok(!JSON.stringify(links).includes('secret'));
});
test('Android explicitly targets Chrome with a same-origin manual-help fallback', () => {
  const { primary } = externalBrowserLinks('https://slimboard.example/notes/private-note?redirect=https://other.example', 'android');
  assert.ok(primary.startsWith('intent://slimboard.example/#Intent;scheme=https;package=com.android.chrome;'));
  const fallback = primary.match(/S.browser_fallback_url=([^;]+)/)[1];
  assert.equal(decodeURIComponent(fallback), 'https://slimboard.example/?externalBrowser=help');
  assert.ok(!primary.includes('private-note'));
});
test('unsupported URL schemes cannot become external-browser links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/example']) {
    assert.throws(() => externalBrowserLinks(url, 'android'));
  }
});
test('local HTTP previews use Kakao external fallback instead of inventing a Safari HTTP scheme', () => {
  const links = externalBrowserLinks('http://127.0.0.1:5173/?authError=1', 'ios');
  assert.equal(links.primary, links.external);
  assert.equal(links.home, 'http://127.0.0.1:5173/');
});
