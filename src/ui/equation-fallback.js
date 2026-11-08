// 인쇄용 SVG의 한컴 수식 글자 처리. 편집 화면 쪽 rhwp-studio/src/core/equation-pua-fallback.ts와 같은 표다
// (원본: rhwp src/renderer/equation/hancom_glyphs.rs의 glyph()).
// 수식은 HyhwpEQ 글꼴의 사설 코드(PUA)로 나온다. 그 글꼴이 없는 PC(한컴 없는 학원 PC)에서는 어떤 글꼴로도
// 그 코드를 그릴 수 없어 □가 되므로, 글꼴이 없을 때만 코드를 원래 문자로 되돌리고 수학 글꼴로 그린다.

const FALLBACK = "'Latin Modern Math', 'Cambria Math', 'STIX Two Math', 'Times New Roman', serif";

function buildTable(extended) {
  const map = new Map();
  const put = (code, ch, italic = false) => { if (!map.has(code)) map.set(code, { ch, italic }); };
  for (let i = 0; i < 26; i++) {
    put(0xe000 + i, String.fromCharCode(65 + i));
    put(0xe0e5 + i, String.fromCharCode(97 + i), true);
  }
  put(0xe03d, '0');
  for (let d = 1; d <= 9; d++) put(0xe033 + d, String(d));
  for (const [code, ch] of [[0xe048, '+'], [0xe046, '-'], [0xe047, '='], [0xe04f, ':'], [0xe055, '<'], [0xe056, '>'],
    [0xe052, ','], [0xe044, '('], [0xe045, ')'], [0xe050, "'"], [0xe042, '%']]) put(code, ch);
  if (extended) {
    [...'αβγδεζηθικλμνξοπρστυφχψω'].forEach((c, i) => put(0xe09d + i, c));
    [...'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'].forEach((c, i) => put(0xe085 + i, c));
    put(0xe067, '∑');
  }
  return map;
}
const TABLES = { hyhwpeq: buildTable(false), hancomeqn: buildTable(true) };

export function decodeEquationText(family, text) {
  const table = TABLES[family.toLowerCase()];
  if (!table) return null;
  let changed = false;
  let italic = false;
  let out = '';
  for (const c of text) {
    const d = table.get(c.codePointAt(0));
    if (d) { changed = true; italic ||= d.italic; out += d.ch; } else out += c;
  }
  return changed ? { ch: out, italic } : null;
}

const known = new Map();
export function equationFaceAvailable(family) {
  const key = family.toLowerCase();
  if (known.has(key)) return known.get(key);
  let ok = false;
  try {
    if (localStorage.getItem('rhwp.debug.noEquationFace') !== '1') {
      const ctx = document.createElement('canvas').getContext('2d');
      const probe = '';
      ctx.font = `100px "${family}", "__rhwp_missing_face__"`;
      const withFace = ctx.measureText(probe).width;
      ctx.font = '100px "__rhwp_missing_face__"';
      ok = Math.abs(withFace - ctx.measureText(probe).width) > 0.5;
    }
  } catch {
    ok = false;
  }
  known.set(key, ok);
  return ok;
}

const unescapeXml = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 쪽 SVG에서 수식 글꼴이 이 PC에 없을 때만 <text font-family="HyhwpEQ">…</text>를 의미 문자로 바꾼다.
export function fixEquationSvg(svg) {
  return svg.replace(/<text\b([^>]*?)\sfont-family="(HyhwpEQ|HancomEQN)"([^>]*)>([^<]*)<\/text>/gi, (m, pre, family, post, body) => {
    if (equationFaceAvailable(family)) return m;
    const d = decodeEquationText(family, unescapeXml(body));
    if (!d) return m;
    const style = d.italic ? ' font-style="italic"' : '';
    return `<text${pre} font-family="${FALLBACK.replace(/"/g, '')}"${style}${post}>${escapeXml(d.ch)}</text>`;
  });
}
