import { createEditor } from './vendor/rhwp-editor/index.js';
import { fixEquationSvg } from './equation-fallback.js';

// 편집 화면은 다른 주소(포트)에서 뜬다. 메인 프로세스가 그 주소를 알려 준다.
const STUDIO = new URLSearchParams(location.search).get('studio');
const FONT_ASKED = 'hwpviewer.fontPromptShown';
// 쪽이 많은 문서는 PC 글꼴을 준비하느라 기본 제한(60초)을 넘길 수 있다.
const EDITOR_OPTS = { studioUrl: STUDIO, requestTimeoutMs: 180000 };
const $ = (id) => document.getElementById(id);
const status = $('status');
const app = window.hwpApp;

let editor;
let current = null; // { name, ext, hasPath } — 실제 경로는 메인 프로세스만 안다
// 편집 화면의 변경 번호(changeSeq)는 타이핑·지우기·서식 등 모든 수정에서 1씩 오른다.
let seq = 0;
let savedSeq = 0;
let working = false; // 열기·저장·인쇄가 도는 동안 다른 명령(단축키 포함)을 받지 않는다
const isDirty = () => !!current && seq !== savedSeq;

const extOf = (name) => (/\.hwpx$/i.test(name) ? 'hwpx' : 'hwp');

function setStatus(text) {
  status.textContent = text;
  status.classList.toggle('dirty', isDirty());
  document.title = current ? `${isDirty() ? '● ' : ''}${current.name} — 바로문서` : '바로문서';
}

// 한 번에 하나의 명령만. 진행 중이면 조용히 무시한다.
async function run(label, fn) {
  if (working) return;
  working = true;
  for (const b of document.querySelectorAll('.bar button')) b.disabled = true;
  if (label) setStatus(label);
  try {
    await fn();
  } finally {
    working = false;
    for (const b of document.querySelectorAll('.bar button')) b.disabled = false;
  }
}

async function readSeq() {
  try {
    const s = await editor.getDocumentState();
    return Number(s.changeSeq) || 0;
  } catch {
    return seq;
  }
}

// 편집 화면에서 키·붙여넣기·클릭이 있으면 잠시 뒤 변경 번호를 다시 읽어 '수정됨' 표시를 맞춘다.
let pollTimer = null;
function scheduleDirtyCheck() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!current || working) return;
    const s = await readSeq();
    if (s !== seq) {
      seq = s;
      setStatus(isDirty() ? `${current.name} · 수정됨` : `${current.name}`);
    }
  }, 700);
}

// 다른 주소의 편집 화면 안 이벤트는 직접 못 보므로, 그쪽에 초점이 가 있는 동안 주기적으로 확인한다.
function watchEditorActivity() {
  setInterval(() => {
    if (document.activeElement?.tagName === 'IFRAME') scheduleDirtyCheck();
  }, 1500);
}

async function confirmDiscard() {
  if (!current) return true;
  seq = await readSeq();
  return !isDirty() || app.confirm('저장하지 않은 수정이 있습니다. 버리고 이 문서를 열까요?');
}

async function load(doc) {
  if (!doc) return;
  if (!(await confirmDiscard())) { setStatus('열기를 취소했습니다'); return; }
  setStatus(`${doc.name} 여는 중…`);
  try {
    // 처음 한 번만 글꼴 안내창을 띄워 'PC 글꼴 사용'을 허용받는다. 허용은 편집 화면에 저장돼 다음부터는 안내창 없이 PC 글꼴로 연다.
    const firstTime = !localStorage.getItem(FONT_ASKED);
    const r = await editor.loadFile(doc.bytes, doc.name, { suppressDialogs: !firstTime, skipUnsavedGuard: true });
    if (firstTime) localStorage.setItem(FONT_ASKED, '1');
    // 화면에 실제로 열린 뒤에만 저장 경로를 이 문서로 바꾼다. 확정이 안 되면 '다른 이름으로 저장'만 되게 한다.
    const committed = await app.commit(doc.token).catch(() => false);
    current = { name: doc.name, ext: extOf(doc.name), hasPath: doc.hasPath && committed };
    seq = savedSeq = await readSeq();
    setStatus(committed ? `${doc.name} · ${r.pageCount}쪽` : `${doc.name} · ${r.pageCount}쪽 (저장은 '다른 이름으로'만 됩니다)`);
  } catch (e) {
    setStatus(`열지 못했습니다: ${e?.message || e}`);
  }
}

const exportBytes = (ext) => (ext === 'hwpx' ? editor.exportHwpx() : editor.exportHwp());

// 내보낸 시점의 변경 번호만 저장된 것으로 친다. 저장 중 더 고쳤으면 '수정됨'으로 남기고 편집 화면에도 저장 완료를 알리지 않는다.
async function markSaved(atSeq) {
  savedSeq = atSeq;
  seq = await readSeq();
  if (seq === atSeq) await editor.notifySaved?.();
}

async function doSaveAs() {
  const pick = await app.pickSaveAs(current.name);
  if (!pick) { setStatus('저장을 취소했습니다'); return; }
  const atSeq = await readSeq();
  // 고른 확장자 형식으로 내보낸다(HWP 내용을 .hwpx 이름으로 저장하지 않게).
  const r = await app.saveTo(pick.token, await exportBytes(pick.ext));
  if (!r.ok) throw new Error(r.message || r.reason);
  current = { name: r.name, ext: pick.ext, hasPath: true };
  await markSaved(atSeq);
  setStatus(`저장했습니다: ${r.name}${isDirty() ? ' (저장 뒤 고친 내용은 아직 저장 안 됨)' : ''}`);
}

const save = () => run('저장 중…', async () => {
  if (!current) return;
  try {
    if (!current.hasPath) return await doSaveAs();
    const atSeq = await readSeq();
    const r = await app.save(await exportBytes(current.ext));
    if (!r.ok) throw new Error(r.message || r.reason);
    await markSaved(atSeq);
    setStatus(`저장했습니다${r.backup ? ' (이전 판 백업)' : ''}${isDirty() ? ' · 저장 뒤 고친 내용은 아직 저장 안 됨' : ''}`);
  } catch (e) {
    setStatus(`저장하지 못했습니다: ${e?.message || e}`);
  }
});

const saveAs = () => run('저장할 곳 고르는 중…', async () => {
  if (!current) return;
  try { await doSaveAs(); } catch (e) { setStatus(`저장하지 못했습니다: ${e?.message || e}`); }
});

// SVG의 width/height를 px로 바꾼다(mm·pt·px 단위 모두). 없으면 viewBox, 그것도 없으면 A4.
const UNIT = { px: 1, '': 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72 };
function svgSize(svg) {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] || '';
  const len = (name) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px|mm|cm|in|pt)?\\s*["']`, 'i').exec(tag);
    return m ? Number(m[1]) * UNIT[(m[2] || '').toLowerCase()] : 0;
  };
  let w = len('width');
  let h = len('height');
  if (!(w > 0 && h > 0)) {
    const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    if (vb) { w = Number(vb[1]); h = Number(vb[2]); }
  }
  return w > 0 && h > 0 ? { w, h } : { w: 793.7, h: 1122.5 };
}

async function collectPages(ed) {
  const n = await ed.pageCount();
  const svgs = [];
  const sizes = [];
  for (let i = 0; i < n; i++) {
    // 한컴 수식 글꼴이 없는 PC면 수식 글자를 원래 문자로 되돌린다(없으면 □로 인쇄됨).
    const svg = fixEquationSvg(await ed.getPageSvg(i, { profile: 'print' }));
    svgs.push(svg);
    sizes.push(svgSize(svg));
  }
  return { svgs, sizes };
}

const printMsg = (r, okText) => (r.ok ? okText : r.reason === 'cancelled' ? '인쇄를 취소했습니다' : `인쇄하지 못했습니다: ${r.reason}`);

const withPages = (label, fn) => run(`${label} 준비 중…`, async () => {
  if (!current) return;
  try {
    const { svgs, sizes } = await collectPages(editor);
    await fn(svgs, sizes);
  } catch (e) {
    setStatus(`${label}하지 못했습니다: ${e?.message || e}`);
  }
});

const print = () => withPages('인쇄', async (svgs, sizes) => setStatus(printMsg(await app.printPages(svgs, sizes), '인쇄를 보냈습니다')));
const preview = () => withPages('미리보기', async (svgs, sizes) => { await app.preview(svgs, sizes, current.name); setStatus('미리보기 창을 열었습니다'); });
const pdf = () => withPages('PDF 저장', async (svgs, sizes) => {
  const r = await app.savePdf(svgs, sizes, current.name.replace(/\.(hwp|hwpx)$/i, '.pdf'));
  setStatus(r.ok ? 'PDF로 저장했습니다' : 'PDF 저장을 취소했습니다');
});

// 여러 문서 인쇄: 화면에 안 보이는 두 번째 편집기에서 차례로 열어 쪽을 모은 뒤 한 번에 인쇄한다.
const batchPrint = () => run('인쇄할 문서 고르는 중…', async () => {
  const files = await app.pickBatch();
  if (!files.length) { setStatus(current ? current.name : ''); return; }
  const host = $('batch-host');
  let hidden;
  try {
    hidden = await createEditor(host, EDITOR_OPTS);
    const all = { svgs: [], sizes: [] };
    for (const [i, f] of files.entries()) {
      setStatus(`${i + 1}/${files.length} ${f.name} 준비 중…`);
      // 숨은 편집기에서 안내창이 뜨면 누를 수 없으니 안내창 없이 연다.
      await hidden.loadFile(f.bytes, f.name, { suppressDialogs: true, skipUnsavedGuard: true });
      const { svgs, sizes } = await collectPages(hidden);
      all.svgs.push(...svgs);
      all.sizes.push(...sizes);
    }
    setStatus(printMsg(await app.printPages(all.svgs, all.sizes), `${files.length}개 문서를 인쇄로 보냈습니다`));
  } catch (e) {
    setStatus(`여러 문서 인쇄 실패: ${e?.message || e}`);
  } finally {
    hidden?.destroy?.();
    host.replaceChildren();
  }
});

// 파일을 먼저 고르고(취소하면 아무것도 묻지 않음), 고른 뒤에 저장 안 한 수정을 확인한다.
const openWith = (picker) => run(null, async () => load(await picker()));

async function renderRecent() {
  const box = $('recent');
  const list = await app.recent();
  box.replaceChildren(...(list.length ? list.map((r) => {
    const b = document.createElement('button');
    b.textContent = r.name;
    b.title = `${r.dir} 폴더`;
    b.onclick = () => { $('more').hidden = true; openWith(() => app.openRecent(r.i)); };
    return b;
  }) : [Object.assign(document.createElement('span'), { textContent: '없음', className: 'muted' })]));
}

async function main() {
  if (!STUDIO) throw new Error('편집 화면 주소가 없습니다');
  editor = await createEditor('#editor', EDITOR_OPTS);
  watchEditorActivity();

  $('b-open').onclick = () => openWith(app.openDoc);
  $('b-save').onclick = save;
  $('b-saveas').onclick = saveAs;
  $('b-preview').onclick = preview;
  $('b-print').onclick = print;
  $('b-pdf').onclick = pdf;
  $('b-batch').onclick = batchPrint;
  $('b-blank').onclick = () => openWith(app.blank);
  $('b-template').onclick = () => openWith(app.pickTemplate);
  $('b-more').onclick = async () => {
    const m = $('more');
    if (m.hidden) await renderRecent();
    m.hidden = !m.hidden;
  };
  for (const b of document.querySelectorAll('[data-folder]')) b.onclick = () => app.openFolder(b.dataset.folder);
  $('b-fontask').onclick = () => { localStorage.removeItem(FONT_ASKED); $('more').hidden = true; setStatus('다음에 문서를 열 때 글꼴 안내를 다시 띄웁니다'); };

  const info = await app.info();
  $('about').textContent = `버전 ${info.version} · 편집 엔진 rhwp 0.9.0 (MIT, Copyright (c) 2025-2026 Edward Kim) · 저장할 때 이전 판은 30일 동안 백업 폴더에 남습니다.`;

  // 단축키는 메인 프로세스가 창 전체(편집 화면 포함)에서 받아 보내 준다.
  app.onShortcut((k) => ({ s: save, S: saveAs, p: print, o: () => openWith(app.openDoc) })[k]?.());
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = false; }
  });

  const first = await app.initialDoc();
  if (first) await run(null, () => load(first));
  else setStatus('열기를 누르거나 한글 파일을 더블클릭하세요');
}

main().catch((e) => setStatus(`시작하지 못했습니다: ${e?.message || e}`));
