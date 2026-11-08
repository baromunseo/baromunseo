// 앱 창과 무관한 순수 동작: 실행 인자에서 문서 찾기, 저장 전 백업, 오래된 백업 정리.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DOC_EXT = /\.(hwp|hwpx)$/i;
const BACKUP_DAYS = 30;

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// 더블클릭으로 열 때 윈도우가 넘기는 인자 중 실제로 있는 한글 문서 경로만 고른다.
// 두 번째 실행에서 온 상대 경로는 그 실행의 작업 폴더 기준으로 푼다.
function findDocArgs(argv, cwd) {
  const base = cwd || process.cwd();
  return argv
    .filter((a) => typeof a === 'string' && DOC_EXT.test(a))
    .map((a) => path.resolve(base, a))
    .filter((p) => fs.existsSync(p));
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 덮어쓰기 전에 원본을 백업 폴더로 복사한다. 원본이 없으면(새 파일) 아무것도 안 한다.
// 같은 초·같은 이름이어도 기존 백업을 덮어쓰지 않게 번호를 붙인다.
async function backupBeforeSave(filePath, backupDir, now = new Date()) {
  if (!fs.existsSync(filePath)) return null;
  await fsp.mkdir(backupDir, { recursive: true });
  const base = `${stamp(now)}_${path.basename(filePath)}`;
  for (let i = 0; i < 1000; i++) {
    const target = path.join(backupDir, i ? base.replace(DOC_EXT, (m) => ` (${i})${m}`) : base);
    try {
      await fsp.copyFile(filePath, target, fs.constants.COPYFILE_EXCL);
      // 복사본은 원본의 수정 시각을 물려받는다. 오래된 문서의 백업이 '30일 지남'으로 바로 지워지지 않게 백업 시각으로 바꾼다.
      await fsp.utimes(target, now, now);
      return target;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('백업 이름을 만들 수 없습니다');
}

// 같은 파일 저장은 한 번에 하나씩(여러 창에서 동시에 눌러도 섞이지 않게).
const saving = new Map();
function serial(key, fn) {
  const prev = saving.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  saving.set(key, next);
  next.finally(() => { if (saving.get(key) === next) saving.delete(key); }).catch(() => {});
  return next;
}

// 백신·OneDrive·탐색기 미리보기가 잠깐 파일을 잡고 있으면 바꿔치기가 실패할 수 있어 몇 번 다시 시도한다.
async function renameRetry(from, to, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fsp.rename(from, to);
    } catch (e) {
      if (i >= tries || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 100 * i));
    }
  }
}

// 저장: 백업이 성공해야만 덮어쓴다(백업 실패 시 원본을 건드리지 않음). 임시 파일에 쓴 뒤 바꿔치기.
function saveWithBackup(filePath, bytes, backupDir, now = new Date()) {
  return serial(path.resolve(filePath).toLowerCase(), async () => {
    const backup = await backupBeforeSave(filePath, backupDir, now);
    const tmp = `${filePath}.~${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fsp.writeFile(tmp, bytes);
      await renameRetry(tmp, filePath);
    } catch (e) {
      await fsp.unlink(tmp).catch(() => {});
      throw e;
    }
    return backup;
  });
}

async function pruneBackups(backupDir, now = Date.now(), days = BACKUP_DAYS) {
  let names;
  try { names = await fsp.readdir(backupDir); } catch { return 0; }
  let removed = 0;
  for (const n of names) {
    const p = path.join(backupDir, n);
    const st = await fsp.stat(p).catch(() => null);
    if (st?.isFile() && now - st.mtimeMs > days * 86400000) {
      await fsp.unlink(p).catch(() => {});
      removed++;
    }
  }
  return removed;
}

// 인쇄 HTML: 쪽마다 자기 용지 크기를 쓰도록 크기별 이름 붙은 @page를 만든다(A4·A3 섞임, 여러 문서 인쇄).
function pagesHtml(svgs, sizes) {
  const mm = (px) => ((Number(px) > 0 ? Number(px) : 0) * 25.4 / 96).toFixed(2);
  const names = new Map();
  const pageName = (s) => {
    const k = `${mm(s.w)}x${mm(s.h)}`;
    if (!names.has(k)) names.set(k, { name: `sz${names.size}`, w: mm(s.w), h: mm(s.h) });
    return names.get(k).name;
  };
  const body = svgs.map((svg, i) => {
    const s = sizes[i] || { w: 794, h: 1123 };
    return `<div class="p" style="page:${pageName(s)};width:${mm(s.w)}mm;height:${mm(s.h)}mm">${svg}</div>`;
  }).join('');
  const rules = [...names.values()].map((n) => `@page ${n.name} { size: ${n.w}mm ${n.h}mm; margin: 0 }`).join('\n');
  const first = names.values().next().value || { w: '210.00', h: '297.00' };
  // 스크립트·바깥 자원 금지(쪽 SVG 안의 그림은 data: 로만 들어온다)
  return `<!doctype html><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
  <style>
    @page { size: ${first.w}mm ${first.h}mm; margin: 0 }
    ${rules}
    html,body { margin:0; padding:0 }
    .p { break-after: page; overflow:hidden }
    .p:last-child { break-after: auto }
    .p svg { display:block; width:100%; height:100% }
  </style>${body}`;
}

module.exports = { isInside, findDocArgs, backupBeforeSave, saveWithBackup, pruneBackups, pagesHtml, stamp, DOC_EXT };
