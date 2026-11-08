const { contextBridge, ipcRenderer } = require('electron');

// 버튼 화면에 열어 주는 기능은 이것뿐이다. 파일 경로는 메인 프로세스가 정하고 화면은 내용(bytes)과 표(token)만 다룬다.
contextBridge.exposeInMainWorld('hwpApp', {
  initialDoc: () => ipcRenderer.invoke('doc:initial'),
  openDoc: () => ipcRenderer.invoke('doc:open'),
  recent: () => ipcRenderer.invoke('recent:list'),
  openRecent: (i) => ipcRenderer.invoke('doc:openRecent', i),
  commit: (token) => ipcRenderer.invoke('doc:commit', token),
  save: (bytes) => ipcRenderer.invoke('doc:save', bytes),
  pickSaveAs: (suggestedName) => ipcRenderer.invoke('doc:pickSaveAs', suggestedName),
  saveTo: (token, bytes) => ipcRenderer.invoke('doc:saveTo', token, bytes),
  confirm: (message) => ipcRenderer.invoke('ui:confirm', message),
  printPages: (svgs, sizes) => ipcRenderer.invoke('print:pages', svgs, sizes),
  savePdf: (svgs, sizes, suggestedName) => ipcRenderer.invoke('print:pdf', svgs, sizes, suggestedName),
  preview: (svgs, sizes, title) => ipcRenderer.invoke('print:preview', svgs, sizes, title),
  pickBatch: () => ipcRenderer.invoke('batch:pick'),
  pickTemplate: () => ipcRenderer.invoke('template:pick'),
  blank: () => ipcRenderer.invoke('doc:blank'),
  info: () => ipcRenderer.invoke('app:info'),
  openFolder: (which) => ipcRenderer.invoke('app:openFolder', which),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, key) => cb(key)),
});
