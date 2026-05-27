const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let undoHistory = []; // [{originalName, newName, originalPath}]

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '批量文件重命名工具',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle OS file drag-and-drop — provides real file paths
  mainWindow.webContents.on('drop-files', (event, filePaths) => {
    event.preventDefault();
    mainWindow.webContents.send('files:dropped', filePaths);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

// ---- IPC Handlers ----

ipcMain.handle('dialog:selectFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '所有文件', extensions: ['*'] }],
  });
  if (result.canceled) return [];
  return result.filePaths.map(fp => ({
    path: fp,
    name: path.basename(fp),
    ext: path.extname(fp),
    dir: path.dirname(fp),
  }));
});

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return [];
  const dirPath = result.filePaths[0];
  return getFilesFromDir(dirPath);
});

function getFilesFromDir(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile())
      .map(e => ({
        path: path.join(dirPath, e.name),
        name: e.name,
        ext: path.extname(e.name),
        dir: dirPath,
      }));
  } catch { return []; }
}

ipcMain.handle('files:getDetails', async (_event, files) => {
  return files.map(f => {
    try {
      const stat = fs.statSync(f.path);
      return {
        ...f,
        size: stat.size,
        sizeFormatted: formatSize(stat.size),
        modifiedTime: stat.mtime.toISOString(),
        modifiedTimeFormatted: formatDate(stat.mtime),
        createdTime: stat.birthtime.toISOString(),
        createdTimeFormatted: formatDate(stat.birthtime),
      };
    } catch {
      return { ...f, size: 0, sizeFormatted: '0 B', modifiedTime: '', modifiedTimeFormatted: '', createdTime: '', createdTimeFormatted: '' };
    }
  });
});

ipcMain.handle('files:rename', async (_event, renameList) => {
  const results = [];
  const historyEntry = [];

  for (const item of renameList) {
    try {
      const oldPath = item.oldPath;
      const newPath = item.newPath;

      if (oldPath === newPath) {
        results.push({ ...item, success: true, skipped: true });
        continue;
      }

      if (fs.existsSync(newPath)) {
        results.push({ ...item, success: false, error: '目标文件已存在' });
        continue;
      }

      fs.renameSync(oldPath, newPath);

      historyEntry.push({
        oldPath,
        newPath,
        originalName: item.originalName,
        newName: path.basename(newPath),
      });
      results.push({ ...item, success: true, skipped: false });
    } catch (err) {
      results.push({ ...item, success: false, error: err.message });
    }
  }

  if (historyEntry.length > 0) {
    undoHistory.push(historyEntry);
  }

  return results;
});

ipcMain.handle('files:undo', async () => {
  if (undoHistory.length === 0) return [];

  const historyEntry = undoHistory.pop();
  const results = [];

  for (const item of historyEntry.reverse()) {
    try {
      if (fs.existsSync(item.oldPath)) {
        results.push({ ...item, success: false, error: '原始路径已被占用' });
        continue;
      }
      fs.renameSync(item.newPath, item.oldPath);
      results.push({ ...item, success: true });
    } catch (err) {
      results.push({ ...item, success: false, error: err.message });
    }
  }

  return results;
});

ipcMain.handle('files:renameSingle', async (_event, item) => {
  try {
    const { oldPath, newPath } = item;
    if (oldPath === newPath) return { success: true, skipped: true };

    if (fs.existsSync(newPath)) {
      return { success: false, error: '目标文件已存在' };
    }

    fs.renameSync(oldPath, newPath);

    // Add to undo history
    undoHistory.push([{
      oldPath,
      newPath,
      originalName: item.originalName,
      newName: path.basename(newPath),
    }]);

    const stat = fs.statSync(newPath);
    return {
      success: true,
      newPath,
      name: path.basename(newPath),
      ext: path.extname(newPath),
      dir: path.dirname(newPath),
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      modifiedTime: stat.mtime.toISOString(),
      modifiedTimeFormatted: formatDate(stat.mtime),
      createdTime: stat.birthtime.toISOString(),
      createdTimeFormatted: formatDate(stat.birthtime),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('files:exportMapping', async (_event, mappingData) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出重命名映射表',
    defaultPath: 'rename-mapping.csv',
    filters: [
      { name: 'CSV 文件', extensions: ['csv'] },
      { name: '文本文件', extensions: ['txt'] },
    ],
  });

  if (result.canceled) return { success: false };

  try {
    const bom = '﻿';
    const header = '原文件名,新文件名,文件路径\n';
    const rows = mappingData.map(m => {
      const esc = s => `"${s.replace(/"/g, '""')}"`;
      return `${esc(m.originalName)},${esc(m.newName)},${esc(m.dir)}`;
    }).join('\n');
    fs.writeFileSync(result.filePath, bom + header + rows, 'utf-8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- Utilities ----

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}
