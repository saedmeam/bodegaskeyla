const electron = require('electron');
const { app, BrowserWindow } = electron;
const path = require('path');
const { ipcMain } = electron;

let encryptionService;
let printerService;
let win; // v130.0: Definición explícita de la ventana principal para evitar errores de scope

function getPrinterService() {
    if (!printerService) {
        try {
            printerService = require(path.join(__dirname, 'printer.js'));
        } catch (error) {
            console.error('⚠️ Error al cargar servicio de impresora:', error.message);
        }
    }
    return printerService;
}

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

    ipcMain.handle('get-printers', async () => {
        console.log('[Electron:Main] 📨 IPC Receive: get-printers');
        try {
            const printers = await win.webContents.getPrintersAsync();
            return { success: true, data: printers };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('print-labels', async (event, { html, printerName, options, preview }) => {
        console.log('[Electron:Main] 📨 IPC Receive: print-labels (Preview:', !!preview, ')');
        let printWindow = new BrowserWindow({
            show: !!preview,
            width: 800,
            height: 900,
            title: 'Vista Previa de Reporte',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        try {
            await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
            
            if (!preview) {
                const printOptions = {
                    silent: true,
                    deviceName: printerName || '',
                    printBackground: true,
                    pageSize: options?.pageSize || 'A4',
                    margins: { marginType: 'none' },
                    ...options
                };
                await printWindow.webContents.print(printOptions);
                printWindow.close();
            } else {
                // Si es vista previa, dejamos la ventana abierta
                // para que el usuario pueda usar Ctrl+P u otros
                printWindow.setMenu(null);
                printWindow.focus();
            }
            return { success: true };
        } catch (error) {
            if (printWindow) printWindow.close();
            return { success: false, error: error.message };
        }
    });

    /**
     * v2.0: Manejador para impresión de texto plano vía Java (PrintVeris.jar)
     */
    ipcMain.handle('print-text', async (event, { text, printerName }) => {
        console.log('[Electron:Main] 📨 IPC Receive: print-text');
        const svc = getPrinterService();
        if (!svc) return { success: false, error: 'Servicio de impresión no disponible' };
        try {
            const result = await svc.imprimir(printerName, text);
            return { success: true, data: result };
        } catch (error) {
            console.error('[Electron:Main] ❌ Error en print-text:', error.message);
            return { success: false, error: error.message };
        }
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'public/logo-keyla-icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    // Apunta al archivo index.html generado por Angular después de hacer 'ng build'
    win.loadFile(path.join(__dirname, 'dist/bodegaskeyla/browser/index.html'));

    // v110.0: Abrir las herramientas de desarrollo automáticamente por solicitud de usuario
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
