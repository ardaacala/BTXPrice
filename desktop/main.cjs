const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

app.setName('Biotex Price');

ipcMain.handle('fetch-tcmb-rates', async () => {
  const response = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: 'application/xml, text/xml' }
  });
  if (!response.ok) throw new Error(`TCMB yanıtı: HTTP ${response.status}`);
  const xml = await response.text();
  if (xml.length > 300000) throw new Error('TCMB yanıtı beklenenden büyük.');
  return xml;
});

ipcMain.handle('save-xlsx', async (event, payload) => {
  const bytes = payload?.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 50 * 1024 * 1024) {
    throw new Error('Excel verisi geçersiz veya çok büyük.');
  }
  const filename = path.basename(String(payload.filename || 'set-maliyeti.xlsx'))
    .replace(/[<>:"/\\|?*]/g, '_');
  const options = {
    title: 'Set maliyet raporunu kaydet',
    defaultPath: path.join(app.getPath('documents'), filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`),
    filters: [{ name: 'Excel çalışma kitabı', extensions: ['xlsx'] }]
  };
  const parent=BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return { canceled: true };
  await fs.writeFile(filePath, Buffer.from(bytes));
  return { canceled: false, filePath };
});

function createWindow() {
  const window = new BrowserWindow({
    title: 'Biotex Price',
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'app.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
