const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFilePath: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  getFileDetails: (files) => ipcRenderer.invoke('files:getDetails', files),
  renameFiles: (list) => ipcRenderer.invoke('files:rename', list),
  renameSingle: (item) => ipcRenderer.invoke('files:renameSingle', item),
  undoRename: () => ipcRenderer.invoke('files:undo'),
  exportMapping: (data) => ipcRenderer.invoke('files:exportMapping', data),
  onFilesDropped: (callback) => {
    ipcRenderer.on('files:dropped', (_event, filePaths) => callback(filePaths));
  },
});
