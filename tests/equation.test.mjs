import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: (k) => (k === 'rhwp.debug.noEquationFace' ? '1' : null) };
const { decodeEquationText, fixEquationSvg } = await import('../src/ui/equation-fallback.js');

test('수식 PUA → 원래 문자: 쉼표·숫자·기울인 글자', () => {
  assert.deepEqual(decodeEquationText('HyhwpEQ', ''), { ch: ',', italic: false });
  assert.deepEqual(decodeEquationText('HyhwpEQ', ''), { ch: '30', italic: false });
  assert.deepEqual(decodeEquationText('HyhwpEQ', ''), { ch: 'cm', italic: true });
  assert.equal(decodeEquationText('HyhwpEQ', 'AB'), null);
  // HyhwpEQ는 그리스 문자 PUA를 쓰지 않는다(엔진 표와 같게 HancomEQN만)
  assert.equal(decodeEquationText('HyhwpEQ', ''), null);
  assert.deepEqual(decodeEquationText('HancomEQN', ''), { ch: 'α', italic: false });
});

test('글꼴이 없는 PC: SVG의 수식 글자를 바꾸고 수학 글꼴·기울임 지정', () => {
  const svg = '<svg><text x="0" font-size="12" font-family="HyhwpEQ">&#xe052;</text><text x="1" font-family="HyhwpEQ"></text><text font-family="맑은 고딕">가</text></svg>';
  const out = fixEquationSvg(svg);
  assert.match(out, /font-family="'Latin Modern Math'[^"]*">,<\/text>/);
  assert.match(out, /font-style="italic">c<\/text>/);
  assert.match(out, /font-family="맑은 고딕">가<\/text>/);
  assert.doesNotMatch(out, /HyhwpEQ/);
});
