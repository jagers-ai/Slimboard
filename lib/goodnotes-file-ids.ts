// 결정적 식별자: SHA-1, UUIDv5, 시드에서 뽑는 정수, 페이지 순서 키.
//
// 규칙 출처
// - UUIDv5(NAMESPACE_URL, "<접두어>:<다이제스트>:<역할>")를 대문자로 쓰는 것: natural-ink 관찰, 공식 아님.
//   natural-ink는 다이제스트에 SHA-256을 쓴다. 여기서는 동기 SHA-1 하나만 구현해 다이제스트도 SHA-1로 만든다.
// - 굿노트 UUID 문자열은 대문자(goodparse, goodnotes-codec, natural-ink 공통 관찰).
// - 페이지 노드 ID와 잉크 파일 ID는 1 차이(notes/<page id + 1>): goodnotes-codec는 실제 문서 206개 중 192개에서,
//   natural-ink도 같은 관찰을 기록했다. natural-ink는 페이지 ID 마지막 비트를 0으로 만든 뒤 +1 한다. 공식 아님.
// - 페이지 순서 키: goodnotes-codec PR #16 규칙(첫 키 "40", 다음 키는 마지막 자리를 한 단계 올림). 공식 아님.

const textEncoder = new TextEncoder();

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** SHA-1 (FIPS 180-4). UUIDv5와 결정적 난수에만 쓴다. */
export function sha1(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getInt32(off + t * 4, false);
    for (let t = 16; t < 80; t += 1) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t += 1) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h >>> 0, false));
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function sha1Hex(text: string): string {
  return toHex(sha1(textEncoder.encode(text)));
}

/** RFC 4122 NAMESPACE_URL */
export const UUID_NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`ID_BAD_UUID ${uuid}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function formatUuid(bytes: Uint8Array): string {
  const h = toHex(bytes).toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** RFC 4122 UUID 버전 5(SHA-1), 대문자. */
export function uuidV5(name: string, namespace = UUID_NAMESPACE_URL): string {
  const ns = uuidBytes(namespace);
  const nameBytes = textEncoder.encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const hash = sha1(input).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return formatUuid(hash);
}

/** UUID에 n을 더한다(128비트 정수로, 2^128에서 순환). goodnotes-codec의 notes ID 규칙. */
export function uuidPlus(uuid: string, n = 1): string {
  const bytes = uuidBytes(uuid);
  let carry = n;
  for (let i = 15; i >= 0 && carry !== 0; i -= 1) {
    const sum = bytes[i] + carry;
    bytes[i] = sum & 0xff;
    carry = Math.floor(sum / 256);
  }
  return formatUuid(bytes);
}

/** 마지막 비트를 0으로 만든다(natural-ink의 페이지 ID 규칙). 그 뒤 uuidPlus(…, 1)은 자리올림 없이 마지막 비트만 바뀐다. */
export function uuidEven(uuid: string): string {
  const bytes = uuidBytes(uuid);
  bytes[15] &= 0xfe;
  return formatUuid(bytes);
}

/** 시드 문자열에서 결정적으로 bits(1~53)비트 정수를 뽑는다. */
export function seededInt(seed: string, label: string, bits: number): number {
  if (bits < 1 || bits > 53) throw new Error("ID_BAD_BITS");
  const h = sha1(textEncoder.encode(`${seed}:${label}`));
  // 해시 앞쪽 bits비트를 쓴다. 48비트까지는 6바이트로, 그 위는 7번째 바이트 위쪽 비트를 더한다(2^53 안에서 정확).
  let hi = 0;
  for (let i = 0; i < 6; i += 1) hi = hi * 256 + h[i];
  if (bits <= 48) return Math.floor(hi / 2 ** (48 - bits));
  const extra = bits - 48;
  return hi * 2 ** extra + (h[6] >> (8 - extra));
}

// ---------------------------------------------------------------------------
// 페이지 순서 키(goodnotes-codec 관찰 규칙)

/** 실제 키에서 관찰된 문자 전부(ASCII 순서). goodnotes-codec 관찰. */
export const ORDER_KEY_ALPHABET = "!-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

/**
 * 마지막 키 뒤에 붙일 키. 처음은 "40", 그다음은 마지막 자리를 한 단계 올리고,
 * 그 자리가 "~"면 앞자리로 올림하며 뒤는 "-"로 채운다(끝이 "!"가 되지 않게). 모두 "~"면 가운데 문자를 붙인다.
 * 첫 글자가 "~"인 키를 만들지 않아야 굿노트의 "끝에 페이지 추가"가 동작한다고 PR #16이 보고했다.
 */
export function orderKeyAfter(previous: string | null): string {
  const A = ORDER_KEY_ALPHABET;
  if (!previous) return "40";
  const digits = Array.from(previous, ch => Math.max(0, A.indexOf(ch)));
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    if (digits[i] < A.length - 1) {
      return digits.slice(0, i).map(d => A[d]).join("") + A[digits[i] + 1] + A[1].repeat(digits.length - i - 1);
    }
  }
  return previous + A[Math.floor(A.length / 2)];
}

/** n개의 증가하는 순서 키(goodnotes-codec 규칙). */
export function orderKeys(n: number): string[] {
  const keys: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i += 1) {
    prev = orderKeyAfter(prev);
    keys.push(prev);
  }
  return keys;
}

/** natural-ink의 순서 키 "A000000", "A000001", … (natural-ink 관찰 규칙, 공식 아님). */
export function naturalInkOrderKey(index: number): string {
  return `A${String(index).padStart(6, "0")}`;
}
