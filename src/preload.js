const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Module 1 - PRQ
  pickFile: (filters) => ipcRenderer.invoke('pick-file', filters),
  pickSavePath: (name) => ipcRenderer.invoke('pick-save-path', name),
  generatePRQ: (config) => ipcRenderer.invoke('generate-prq', config),
  onPrqLog: (cb) => ipcRenderer.on('prq-log', (_e, m) => cb(m)),
  removePrqLog: () => ipcRenderer.removeAllListeners('prq-log'),

  // Module 2 - Puppeteer
  runPuppeteer: (config) => ipcRenderer.invoke('run-puppeteer', config),
  onPupLog: (cb) => ipcRenderer.on('pup-log', (_e, m) => cb(m)),
  removePupLog: () => ipcRenderer.removeAllListeners('pup-log'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),

  // Shared
  showInFinder: (p) => ipcRenderer.invoke('show-in-finder', p),
});
