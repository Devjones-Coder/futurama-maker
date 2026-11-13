const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('futurama', {
  getStatus: () => ipcRenderer.invoke('status'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  togglePause: () => ipcRenderer.invoke('toggle-pause'),
  quit: () => ipcRenderer.invoke('quit'),
  onStatus: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('status', listener); return () => ipcRenderer.removeListener('status', listener); }
});
