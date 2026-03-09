const electron = require('electron');
const { app, BrowserWindow } = electron;
const path = require('path');
const { ipcMain } = electron;
let encryptionService;

function getEncryptionService() {
    if (!encryptionService) {
        try {
            encryptionService = require(path.join(__dirname, 'encryptionService.js'));
        } catch (error) {
            console.error('⚠️ Error al cargar servicio de encriptación:', error.message);
        }
    }
    return encryptionService;
}

function setupIpcHandlers() {
    ipcMain.handle('encrypt-text', async (event, text) => {
        console.log('[Electron:Main] 📨 IPC Receive: encrypt-text');
        const svc = getEncryptionService();
        if (!svc) return { success: false, error: 'Servicio de encriptación no disponible' };
        try {
            const encrypted = await svc.encrypt(text);
            return { success: true, data: encrypted };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('check-java', async () => {
        console.log('[Electron:Main] 📨 IPC Receive: check-java');
        const svc = getEncryptionService();
        if (!svc) return { success: true, data: false };
        try {
            const isInstalled = await svc.checkJavaInstalled();
            return { success: true, data: isInstalled };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('close-app', () => {
        console.log('[Electron:Main] 📨 IPC Receive: close-app');
        app.quit();
    });

    ipcMain.handle('get-app-config', async () => {
        console.log('[Electron:Main] 📨 IPC Receive: get-app-config');
        const fs = require('fs');

        // v104.5: Usar process.resourcesPath en producción para config.json
        const isPackaged = app.isPackaged;
        const resourcesPath = isPackaged ? process.resourcesPath : __dirname;
        const configPath = path.join(resourcesPath, 'config.json');

        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                return { success: true, data: config };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
        return { success: false, error: 'Config file not found' };
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'public/app_icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    // Apunta al archivo index.html generado por Angular después de hacer 'ng build'
    win.loadFile(path.join(__dirname, 'dist/bodegaskeyla/browser/index.html'));

    // Abrir las herramientas de desarrollo automáticamente
    win.webContents.openDevTools();

    win.setMenu(null);
    win.on('closed', () => {
        win = null;
    });
}
app.on('ready', () => {
    setupIpcHandlers();
    createWindow();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('activate', () => {
    if (win === null) {
        createWindow();
    }
});
