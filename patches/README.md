# studio/ 만드는 법 (rhwp-studio 0.9.0 + 우리 수정)

`studio/`는 rhwp(MIT, Edward Kim)의 편집 화면 rhwp-studio를 빌드한 결과물이다. 다시 만들 때는 아래 순서를 따른다.

1. rhwp를 v0.9.0 태그로 받는다: `git clone --depth 1 --branch v0.9.0 https://github.com/edwardkim/rhwp.git`
2. 엔진은 Rust로 빌드하지 않고 npm 패키지를 쓴다. `npm pack @rhwp/core@0.9.0`으로 받아 압축을 풀고, `package/` 내용을 저장소 루트의 `pkg/`에 넣는다.
3. **윈도우에서 받으면 `rhwp-studio/public/fonts`가 바로가기 흔적(18바이트 텍스트)으로만 들어온다.** 그 파일을 지우고 `assets/fonts` 폴더를 통째로 `rhwp-studio/public/fonts`로 복사한다. 이걸 빼먹으면 기본 글꼴 48개(수학 글꼴 Latin Modern Math 포함)가 빠져서 일부 기호가 깨진다.
4. 우리 수정을 적용한다: `git apply hwp-viewer/patches/rhwp-studio-equation-pua-fallback.patch`
5. `cd rhwp-studio && npm ci && RHWP_WITHOUT_AI=1 npx vite build` (AI 도우미는 빼고 빌드한다)
6. `rhwp-studio/dist`를 이 프로젝트의 `studio/`로 복사한다.

## 우리 수정: 수식 글자가 □로 나오던 문제

- **원인:** 엔진은 수식의 기울인 글자, 숫자, 쉼표, 괄호를 한컴 수식 글꼴(HyhwpEQ)의 사설 코드(PUA)로 그린다. 그런데 편집 화면의 캔버스 글꼴 치환(`wasm-bridge.ts`의 `substituteCssFontFamily`)이 그 글꼴 이름을 지워서, 다른 글꼴로 그리면서 □가 나왔다. 인쇄용 SVG는 이 치환을 거치지 않아 정상이었다.
- **수정:**
  - 수식 글꼴이 이 PC에 있으면 이름을 그대로 둔다(SVG와 같은 동작).
  - 없으면(한컴 없는 PC) 사설 코드를 원래 문자로 되돌려 수학 글꼴로 그린다. 기울인 소문자는 italic으로 그린다.
  - 되돌리기 표는 엔진의 `src/renderer/equation/hancom_glyphs.rs` `glyph()`와 같은 규칙이다.
- **인쇄 쪽:** 같은 처리를 `src/ui/equation-fallback.js`에서 쪽 SVG에 한다.
- **시험용 스위치:** 해당 주소의 localStorage에 `rhwp.debug.noEquationFace=1`을 넣으면 글꼴이 없는 PC처럼 동작한다.
- 원작자에게 보고할 내용이다(이슈·PR 후보).
