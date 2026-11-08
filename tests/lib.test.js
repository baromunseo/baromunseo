const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isInside, findDocArgs, saveWithBackup, pruneBackups, pagesHtml } = require('../src/lib');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hwpv-'));

test('isInside: 서버가 폴더 밖 파일을 내주지 않음', () => {
  const root = path.resolve('/a/studio');
  assert.ok(isInside(root, path.join(root, 'index.html')));
  assert.ok(!isInside(root, path.normalize(path.join(root, '..', 'secret.txt'))));
  assert.ok(!isInside(root, path.resolve('/a/studio-evil/x')));
});

test('findDocArgs: 실제로 있는 hwp/hwpx만 고름', () => {
  const d = tmp();
  const a = path.join(d, '안내문.hwp');
  fs.writeFileSync(a, 'x');
  assert.deepEqual(findDocArgs(['--flag', a, path.join(d, '없음.hwp'), path.join(d, 'x.txt')]), [a]);
});

test('saveWithBackup: 이전 판을 백업한 뒤 덮어씀', async () => {
  const d = tmp();
  const f = path.join(d, '문서.hwp');
  const bk = path.join(d, 'backup');
  fs.writeFileSync(f, 'old');
  const backup = await saveWithBackup(f, Buffer.from('new'), bk, new Date(2026, 10, 9, 9, 5, 7));
  assert.equal(fs.readFileSync(f, 'utf8'), 'new');
  assert.equal(path.basename(backup), '20261109-090507_문서.hwp');
  assert.equal(fs.readFileSync(backup, 'utf8'), 'old');
});

test('saveWithBackup: 새 파일이면 백업 없이 저장', async () => {
  const d = tmp();
  const f = path.join(d, '새.hwp');
  assert.equal(await saveWithBackup(f, Buffer.from('x'), path.join(d, 'backup')), null);
  assert.equal(fs.readFileSync(f, 'utf8'), 'x');
});

test('saveWithBackup: 백업이 실패하면 원본을 건드리지 않음', async () => {
  const d = tmp();
  const f = path.join(d, '문서.hwp');
  fs.writeFileSync(f, 'old');
  const notADir = path.join(d, 'file-not-dir');
  fs.writeFileSync(notADir, 'x');
  await assert.rejects(saveWithBackup(f, Buffer.from('new'), notADir));
  assert.equal(fs.readFileSync(f, 'utf8'), 'old');
});

test('pruneBackups: 30일 지난 백업만 지움', async () => {
  const d = tmp();
  const oldF = path.join(d, 'old.hwp');
  const newF = path.join(d, 'new.hwp');
  fs.writeFileSync(oldF, 'o');
  fs.writeFileSync(newF, 'n');
  const now = Date.now();
  fs.utimesSync(oldF, new Date(now - 31 * 86400000), new Date(now - 31 * 86400000));
  assert.equal(await pruneBackups(d, now), 1);
  assert.ok(!fs.existsSync(oldF) && fs.existsSync(newF));
});

test('findDocArgs: 두 번째 실행의 상대 경로는 그 실행의 작업 폴더 기준', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, '안내.hwpx'), 'x');
  assert.deepEqual(findDocArgs(['안내.hwpx'], d), [path.join(d, '안내.hwpx')]);
});

test('saveWithBackup: 같은 초에 같은 이름을 저장해도 백업을 덮어쓰지 않음', async () => {
  const d = tmp();
  const f = path.join(d, '문서.hwp');
  const bk = path.join(d, 'backup');
  const now = new Date(2026, 10, 9, 9, 0, 0);
  fs.writeFileSync(f, 'v1');
  const b1 = await saveWithBackup(f, Buffer.from('v2'), bk, now);
  const b2 = await saveWithBackup(f, Buffer.from('v3'), bk, now);
  assert.notEqual(b1, b2);
  assert.equal(fs.readFileSync(b1, 'utf8'), 'v1');
  assert.equal(fs.readFileSync(b2, 'utf8'), 'v2');
});

test('saveWithBackup: 같은 파일 동시 저장이 섞이지 않고 임시 파일이 남지 않음', async () => {
  const d = tmp();
  const f = path.join(d, '문서.hwp');
  fs.writeFileSync(f, 'v0');
  await Promise.all(['a', 'b', 'c'].map((v) => saveWithBackup(f, Buffer.from(v.repeat(50000)), path.join(d, 'backup'))));
  const final = fs.readFileSync(f, 'utf8');
  assert.ok(['a', 'b', 'c'].some((v) => final === v.repeat(50000)));
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.includes('.~')), []);
  assert.equal(fs.readdirSync(path.join(d, 'backup')).length, 3);
});

test('pagesHtml: 쪽마다 자기 용지 크기(A4·A3 섞임)', () => {
  const html = pagesHtml(['<svg/>', '<svg/>'], [{ w: 793.7008, h: 1122.5197 }, { w: 1122.5197, h: 1587.4016 }]);
  assert.match(html, /@page sz0 \{ size: 210\.00mm 297\.00mm/);
  assert.match(html, /@page sz1 \{ size: 297\.00mm 420\.00mm/);
  assert.match(html, /page:sz1;width:297\.00mm/);
});

test('backupBeforeSave: 오래된 문서의 백업도 30일 정리에 바로 지워지지 않음', async () => {
  const d = tmp();
  const f = path.join(d, '작년.hwp');
  fs.writeFileSync(f, 'old');
  fs.utimesSync(f, new Date(2025, 0, 1), new Date(2025, 0, 1));
  const bk = path.join(d, 'backup');
  const now = new Date();
  await saveWithBackup(f, Buffer.from('new'), bk, now);
  assert.equal(await pruneBackups(bk, now.getTime()), 0);
  assert.equal(fs.readdirSync(bk).length, 1);
});
