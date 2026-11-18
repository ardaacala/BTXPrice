const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopFiles', {
  saveXlsx: (filename, bytes) => ipcRenderer.invoke('save-xlsx', { filename, bytes }),
  fetchTcmbRates: () => ipcRenderer.invoke('fetch-tcmb-rates')
});
