const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 860,
    minHeight: 580,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── MODULE 1: PRQ Generator ──────────────────────────────────────────────────

ipcMain.handle('pick-file', async (_e, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('pick-save-path', async (_e, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'PRQ_Input.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('generate-prq', async (_e, config) => {
  return new Promise((resolve) => {
    const worker = fork(path.join(__dirname, 'prq-worker.js'), [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    const logs = [];

    worker.stdout.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) { logs.push(msg); mainWindow.webContents.send('prq-log', msg); }
    });
    worker.stderr.on('data', (d) => {
      const msg = '⚠ ' + d.toString().trim();
      logs.push(msg); mainWindow.webContents.send('prq-log', msg);
    });

    worker.send({ config });

    worker.on('message', (msg) => {
      if (msg.type === 'done') resolve({ success: true, outputPath: msg.outputPath, summary: msg.summary, logs });
      else if (msg.type === 'error') resolve({ success: false, error: msg.error, logs });
    });
    worker.on('error', (err) => resolve({ success: false, error: err.message, logs }));
  });
});

ipcMain.handle('show-in-finder', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// ─── MODULE 2: Puppeteer Launcher ────────────────────────────────────────────

ipcMain.handle('run-puppeteer', async (_e, config) => {
  return new Promise((resolve) => {
    const worker = fork(path.join(__dirname, 'puppeteer-worker.js'), [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    const logs = [];

    worker.stdout.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) { logs.push(msg); mainWindow.webContents.send('pup-log', msg); }
    });
    worker.stderr.on('data', (d) => {
      const msg = '⚠ ' + d.toString().trim();
      logs.push(msg); mainWindow.webContents.send('pup-log', msg);
    });

    worker.send({ config });
    worker.on('message', (msg) => {
      if (msg.type === 'done') resolve({ success: true, screenshotPath: msg.screenshotPath, logs });
      else if (msg.type === 'error') resolve({ success: false, error: msg.error, logs });
    });
    worker.on('error', (err) => resolve({ success: false, error: err.message, logs }));
  });
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose screenshot save folder',
  });
  return result.canceled ? null : result.filePaths[0];
});
