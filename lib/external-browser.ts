export type KakaoMobile = "ios" | "android";

// Presentation hint only; never use the user agent for authorization.
export function detectKakaoMobile(userAgent: string, platform = "", maxTouchPoints = 0): KakaoMobile | null {
  if (!/KAKAOTALK/i.test(userAgent)) return null;
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)) return "ios";
  return null;
}

export function externalBrowserLinks(pageUrl: string, device: KakaoMobile) {
  const page = new URL(pageUrl);
  if (page.protocol !== "https:" && page.protocol !== "http:") throw new Error("웹 주소만 열 수 있습니다.");
  // Restart login in the external browser. Never transfer OAuth codes, tokens,
  // callback URLs, note contents or a caller-provided redirect target.
  const home = new URL("/", page.origin).href;
  const fallback = `${home}?externalBrowser=help`;
  const external = `kakaotalk://web/openExternal?url=${encodeURIComponent(home)}`;
  const primary = device === "ios"
    ? (page.protocol === "https:" ? home.replace(/^https:/, "x-safari-https:") : external)
    : `intent://${new URL(home).host}/#Intent;scheme=${page.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  return { home, primary, external };
}
