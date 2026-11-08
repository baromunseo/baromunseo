const { app, BrowserWindow, ipcMain, dialog, session, shell, Menu } = require('electron');
const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { isInside, findDocArgs, saveWithBackup, pruneBackups, pagesHtml, DOC_EXT } = require('./lib');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};
// 버튼 화면(shell)과 편집 화면(studio)을 서로 다른 주소(포트)에 둔다. 같은 주소면 문서 속 스크립트가
// 편집 화면에서 버튼 화면의 저장·열기 기능을 직접 부를 수 있어서다. 포트를 고정하는 이유는 화면 설정
// (PC 글꼴 허용, 확대 비율 등)이 주소별로 저장되기 때문. 쓰고 있으면 아무 포트나 쓴다.
const SITES = {
  studio: { dir: path.join(ROOT, 'studio'), port: 47812, blocked: new Set(['sw.js', 'registersw.js']) },
  shell: { dir: path.join(__dirname, 'ui'), port: 47813, blocked: new Set() },
};
const ALLOWED_PERMS = new Set(['local-fonts', 'clipboard-sanitized-write']);
const RECENT_MAX = 10;

const origins = {};
let markReady;
const ready = new Promise((r) => { markReady = r; });
const userFile = (name) => path.join(app.getPath('userData'), name);
const backupDir = () => userFile('backup');
const templateDir = () => path.join(app.getPath('documents'), '바로문서 양식');

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const isShell = (u) => !!origins.shell && originOf(u) === origins.shell;
const isStudio = (u) => !!origins.studio && originOf(u) === origins.studio;
const isOurs = (u) => isShell(u) || isStudio(u);

function startSite(site) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        if (rel.endsWith('/')) rel += 'index.html';
        const file = path.normalize(path.join(site.dir, rel));
        if (!isInside(site.dir, file)) { res.writeHead(403).end(); return; }
        // 차단 목록은 정규화한 경로를 소문자로 비교(윈도우는 대소문자를 가리지 않음)
        if (site.blocked.has(path.relative(site.dir, file).replace(/\\/g, '/').toLowerCase())) { res.writeHead(404).end(); return; }
        const body = await fsp.readFile(file).catch(() => null);
        if (!body) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      }
    });
    const done = () => resolve(`http://127.0.0.1:${server.address().port}`);
    server.once('error', () => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', done);
    });
    server.listen(site.port, '127.0.0.1', done);
  });
}

// 창마다 확정된 문서 경로(null = 새 문서). 화면 쪽은 경로를 모르고, 고른 파일은 '열기 성공'을 알려야 확정된다.
const docOf = new Map();
const pending = new Map(); // token -> { id, path, kind: 'open' | 'save' }

function offer(evt, p, kind) {
  const token = crypto.randomUUID();
  pending.set(token, { id: evt.sender.id, path: p, kind });
  return token;
}

// 표는 발급받은 창이 발급 용도로만 한 번 쓴다. 다른 창·다른 용도면 버리지 않고 거절만 한다.
function take(evt, token, kind) {
  const t = pending.get(token);
  if (!t || t.id !== evt.sender.id || t.kind !== kind) return null;
  pending.delete(token);
  return t;
}

const sameDoc = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function guardNavigation(wc) {
  wc.on('will-navigate', (e, url) => {
    if (isOurs(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  wc.on('will-frame-navigate', (e) => {
    if (isOurs(e.url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(e.url)) shell.openExternal(e.url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isOurs(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createWindow(docPath = null) {
  const win = new BrowserWindow({
    width: 1400, height: 920, minWidth: 900, minHeight: 600,
    title: docPath ? path.basename(docPath) : '바로문서',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = win.webContents;
  const id = wc.id;
  docOf.set(id, docPath);
  win.on('closed', () => {
    docOf.delete(id);
    for (const [k, t] of pending) if (t.id === id) pending.delete(k);
  });
  guardNavigation(wc);
  // Ctrl+S·Ctrl+Shift+S·Ctrl+P·Ctrl+O는 편집 화면에 초점이 있어도 우리 명령으로 보낸다
  // (편집 화면의 자체 저장은 백업 없이 다운로드 방식이라).
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt) return;
    // 한컴처럼 Ctrl+F10으로 문자표를 연다(편집 화면의 문자표 단축키는 Alt+F10).
    if (input.key === 'F10') {
      e.preventDefault();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'F10', modifiers: ['alt'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'F10', modifiers: ['alt'] });
      return;
    }
    const k = input.key.toLowerCase();
    if (!['s', 'p', 'o'].includes(k)) return;
    e.preventDefault();
    wc.send('shortcut', input.shift && k === 's' ? 'S' : k);
  });
  // 화면이 '저장 안 한 수정'으로 닫기를 막으면 그대로 묻는다(안 물으면 창이 말없이 안 닫힘).
  let asking = false;
  wc.on('will-prevent-unload', (e) => {
    if (asking) return;
    asking = true;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['저장하지 않고 닫기', '취소'], defaultId: 1, cancelId: 1,
      title: '닫기', message: '저장하지 않은 수정이 있습니다. 닫을까요?',
    });
    asking = false;
    if (choice === 0) e.preventDefault();
  });
  win.loadURL(`${origins.shell}/index.html?studio=${encodeURIComponent(origins.studio + '/')}`);
  return win;
}

// 이미 열려 있는 문서를 또 더블클릭하면 새 창 대신 그 창을 앞으로(두 창에서 따로 고쳐 덮어쓰는 일 방지).
function openDocs(paths) {
  if (!paths.length) { createWindow(null); return; }
  for (const p of paths) {
    const openId = [...docOf].find(([, d]) => sameDoc(d, p))?.[0];
    const win = openId != null && BrowserWindow.getAllWindows().find((w) => w.webContents.id === openId);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else {
      createWindow(p);
    }
  }
}

// IPC는 버튼 화면(창의 맨 위 프레임, shell 주소)에서 온 것만 받는다. 편집 화면(studio 주소)은 다른 주소라 이 기능에 손댈 수 없다.
function handle(channel, fn) {
  ipcMain.handle(channel, (evt, ...args) => {
    const f = evt.senderFrame;
    if (!f || f.parent || !isShell(f.url)) throw new Error('허용되지 않은 요청');
    return fn(evt, ...args);
  });
}

const winOf = (evt) => BrowserWindow.fromWebContents(evt.sender);

async function readRecent() {
  try { return JSON.parse(await fsp.readFile(userFile('recent.json'), 'utf8')).filter((x) => typeof x === 'string'); } catch { return []; }
}
async function pushRecent(p) {
  const list = [p, ...(await readRecent()).filter((x) => !sameDoc(x, p))].slice(0, RECENT_MAX);
  await fsp.writeFile(userFile('recent.json'), JSON.stringify(list), 'utf8').catch(() => {});
}

async function docPayload(evt, p) {
  return { token: offer(evt, p, 'open'), hasPath: true, name: path.basename(p), bytes: await fsp.readFile(p) };
}

handle('doc:initial', async (evt) => {
  const p = docOf.get(evt.sender.id);
  return p ? docPayload(evt, p) : null;
});

handle('doc:open', async (evt) => {
  const r = await dialog.showOpenDialog(winOf(evt), {
    title: '문서 열기', properties: ['openFile'], filters: [{ name: 'HWP 문서', extensions: ['hwp', 'hwpx'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return docPayload(evt, r.filePaths[0]);
});

// 최근 문서: 화면에는 이름만 보내고, 여는 것은 순번으로만 받는다(경로를 화면에 넘기지 않음).
handle('recent:list', async () => (await readRecent()).map((p, i) => ({ i, name: path.basename(p), dir: path.basename(path.dirname(p)) })));
handle('doc:openRecent', async (evt, i) => {
  const p = (await readRecent())[Number(i)];
  return p ? docPayload(evt, p).catch(() => null) : null;
});

// 화면이 문서를 실제로 연 뒤에만 이 창의 저장 경로로 확정한다(열기 실패 시 이전 경로 유지).
handle('doc:commit', async (evt, token) => {
  const t = take(evt, token, 'open');
  if (!t) return false;
  docOf.set(evt.sender.id, t.path);
  if (t.path) await pushRecent(t.path);
  return true;
});

// 덮어쓰기 저장(이전 판은 백업). 경로는 이 창에서 확정된 문서로만 정한다.
handle('doc:save', async (evt, bytes) => {
  const p = docOf.get(evt.sender.id);
  if (!p) return { ok: false, reason: 'no-path' };
  try {
    const backup = await saveWithBackup(p, Buffer.from(bytes), backupDir());
    return { ok: true, backup };
  } catch (e) {
    return { ok: false, reason: 'error', message: String(e?.message || e) };
  }
});

// 다른 이름으로 저장: 먼저 저장할 곳을 고르고, 고른 확장자 형식으로 화면이 내보낸 뒤 쓴다.
handle('doc:pickSaveAs', async (evt, suggestedName) => {
  const r = await dialog.showSaveDialog(winOf(evt), {
    title: '다른 이름으로 저장', defaultPath: String(suggestedName || '새 문서.hwp'),
    filters: [{ name: 'HWP 문서', extensions: ['hwp'] }, { name: 'HWPX 문서', extensions: ['hwpx'] }],
  });
  if (r.canceled || !r.filePath) return null;
  let p = r.filePath;
  if (!DOC_EXT.test(p)) p += '.hwp';
  return { token: offer(evt, p, 'save'), name: path.basename(p), ext: /\.hwpx$/i.test(p) ? 'hwpx' : 'hwp' };
});

handle('doc:saveTo', async (evt, token, bytes) => {
  const t = take(evt, token, 'save');
  if (!t) return { ok: false, reason: 'error', message: '저장 위치를 다시 골라 주세요' };
  try {
    await saveWithBackup(t.path, Buffer.from(bytes), backupDir());
    docOf.set(evt.sender.id, t.path);
    await pushRecent(t.path);
    return { ok: true, name: path.basename(t.path) };
  } catch (e) {
    return { ok: false, reason: 'error', message: String(e?.message || e) };
  }
});

handle('ui:confirm', async (evt, message) => {
  const r = await dialog.showMessageBox(winOf(evt), {
    type: 'question', buttons: ['계속', '취소'], defaultId: 1, cancelId: 1, title: '확인', message: String(message),
  });
  return r.response === 0;
});

// 인쇄·PDF: 화면에서 받은 쪽별 SVG를 숨은 창에 펼친다. 이 창은 스크립트·바깥 파일·네트워크를 쓰지 못하게 막는다.
// 쪽 범위·모아찍기·양면은 윈도우 인쇄 창과 프린터 설정에서 고른다.
// 인쇄용 숨은 창은 별도 세션을 쓴다. 그 세션은 우리가 만든 인쇄용 임시 HTML 말고는 아무것도(바깥 파일·네트워크) 불러오지 못한다.
const PRINT_PARTITION = 'hwp-viewer-print';
const PRINT_PREFIX = 'hwp-viewer-print-';
function lockPrintSession() {
  session.fromPartition(PRINT_PARTITION).webRequest.onBeforeRequest((d, cb) => {
    let ok = false;
    try {
      const u = new URL(d.url);
      ok = u.protocol === 'file:' && path.basename(decodeURIComponent(u.pathname)).startsWith(PRINT_PREFIX)
        && isInside(app.getPath('temp'), path.normalize(decodeURIComponent(u.pathname).replace(/^\/(?=[a-zA-Z]:)/, '')));
    } catch { ok = false; }
    cb({ cancel: !ok });
  });
}

async function withPagesWindow(svgs, sizes, parent, fn) {
  const tmp = path.join(app.getPath('temp'), `${PRINT_PREFIX}${process.pid}-${crypto.randomUUID()}.html`);
  await fsp.writeFile(tmp, pagesHtml(svgs, sizes), 'utf8');
  const w = new BrowserWindow({ show: false, parent: parent || undefined, webPreferences: { sandbox: true, javascript: false, partition: PRINT_PARTITION } });
  try {
    await w.loadFile(tmp);
    return await fn(w);
  } finally {
    w.destroy();
    fsp.unlink(tmp).catch(() => {});
  }
}

handle('print:pages', (evt, svgs, sizes) => withPagesWindow(svgs, sizes, winOf(evt), (w) => new Promise((resolve) => {
  w.webContents.print({ silent: false, printBackground: true }, (ok, reason) =>
    resolve({ ok, reason: ok ? null : (/cancel/i.test(String(reason)) ? 'cancelled' : String(reason)) }));
})));

const makePdf = (svgs, sizes, parent) =>
  withPagesWindow(svgs, sizes, parent, (w) => w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));

handle('print:pdf', async (evt, svgs, sizes, suggestedName) => {
  const r = await dialog.showSaveDialog(winOf(evt), {
    title: 'PDF로 저장', defaultPath: String(suggestedName || '문서.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, reason: 'cancelled' };
  await fsp.writeFile(r.filePath, await makePdf(svgs, sizes, winOf(evt)));
  return { ok: true };
});

// 인쇄 미리보기: PDF로 만들어 보기 창에 띄운다. 그 창의 인쇄 버튼으로 바로 인쇄할 수도 있다.
handle('print:preview', async (evt, svgs, sizes, title) => {
  const pdfPath = path.join(app.getPath('temp'), `hwp-viewer-preview-${crypto.randomUUID()}.pdf`);
  await fsp.writeFile(pdfPath, await makePdf(svgs, sizes, winOf(evt)));
  let pv;
  try {
    pv = new BrowserWindow({
      width: 1000, height: 900, parent: winOf(evt), title: `미리보기 — ${String(title)}`,
      webPreferences: { plugins: true, sandbox: true },
    });
    pv.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pv.webContents.on('will-navigate', (e) => e.preventDefault());
    pv.on('closed', () => fsp.unlink(pdfPath).catch(() => {}));
    await pv.loadFile(pdfPath);
    return { ok: true };
  } catch (e) {
    if (pv && !pv.isDestroyed()) pv.destroy();
    await fsp.unlink(pdfPath).catch(() => {});
    throw e;
  }
});

// 여러 문서 한 번에 인쇄: 파일 고르기만 여기서 하고, 쪽 그리기는 화면 쪽 편집기가 한다.
handle('batch:pick', async (evt) => {
  const r = await dialog.showOpenDialog(winOf(evt), {
    title: '한 번에 인쇄할 문서 고르기', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'HWP 문서', extensions: ['hwp', 'hwpx'] }],
  });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(async (p) => ({ name: path.basename(p), bytes: await fsp.readFile(p) })));
});

// 양식에서 시작: 양식 폴더의 파일을 사본(경로 없음)으로 연다. 양식 원본은 덮어쓰지 않는다.
handle('template:pick', async (evt) => {
  await fsp.mkdir(templateDir(), { recursive: true });
  const r = await dialog.showOpenDialog(winOf(evt), {
    title: '양식 고르기', defaultPath: templateDir(), properties: ['openFile'],
    filters: [{ name: 'HWP 문서', extensions: ['hwp', 'hwpx'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { token: offer(evt, null, 'open'), hasPath: false, name: path.basename(p).replace(DOC_EXT, (m) => `_새 문서${m}`), bytes: await fsp.readFile(p) };
});

// 빈 문서: rhwp 저장소의 빈 HWP 서식(saved/blank2010.hwp, MIT)을 경로 없는 새 문서로 연다.
handle('doc:blank', async (evt) => ({
  token: offer(evt, null, 'open'), hasPath: false, name: '새 문서.hwp', bytes: await fsp.readFile(path.join(__dirname, 'blank.hwp')),
}));

handle('app:info', () => ({ version: app.getVersion() }));
handle('app:openFolder', async (_evt, which) => {
  const dir = which === 'backup' ? backupDir() : templateDir();
  await fsp.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
});

// 자동 업데이트: 켤 때 깃허브 릴리스에서 새 버전을 확인해 조용히 받아 두고, 프로그램을 닫을 때 설치한다
// (다음 실행부터 새 버전). 인터넷이 없거나 실패하면 지금 버전 그대로 쓴다. 설치판에서만 동작.
function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdates().catch(() => {});
  } catch {
    // 업데이트 확인 실패는 프로그램 사용에 영향을 주지 않는다
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 이미 켜져 있을 때 두 번째로 연 파일: 서버가 준비된 뒤, 그 실행의 작업 폴더 기준으로 경로를 푼다.
  app.on('second-instance', async (_e, argv, workingDirectory) => {
    await ready;
    openDocs(findDocArgs(argv, workingDirectory));
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // 편집 화면(studio 주소)이 PC에 설치된 글꼴을 쓰는 권한과 복사 권한만 허용한다.
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) =>
      cb(isStudio(details?.requestingUrl) && ALLOWED_PERMS.has(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => isStudio(origin) && ALLOWED_PERMS.has(perm));
    // 편집 화면 자체의 '다운로드식 저장'도 저장 창으로 받는다.
    session.defaultSession.on('will-download', (_e, item) => item.setSaveDialogOptions({ title: '저장' }));

    try {
      origins.studio = await startSite(SITES.studio);
      origins.shell = await startSite(SITES.shell);
    } catch (e) {
      dialog.showErrorBox('바로문서', `프로그램을 시작하지 못했습니다.\n${e?.message || e}`);
      app.quit();
      return;
    }
    lockPrintSession();
    markReady();
    pruneBackups(backupDir()).catch(() => {});
    checkForUpdates();
    openDocs(findDocArgs(process.argv));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(null); });
  });

  app.on('window-all-closed', () => app.quit());
}
