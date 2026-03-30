const electron = require('electron');
const { app, BrowserWindow } = electron;
const path = require('path');
const { ipcMain } = electron;

// v150.0: Optimización para equipos antiguos (Bajos recursos)
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-accelerated-video-decode');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512'); // Limite de memoria para evitar saturar RAM antigua
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-breakpad'); // Desactivar reporte de errores para ahorrar CPU
app.commandLine.appendSwitch('disable-component-update');

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
        
        const winConfig = {
            show: false,
            width: 900,
            height: 950,
            title: 'Vista Previa de Reporte',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                plugins: true // v120.0: Habilita el visor de PDF nativo (Chrome PDF)
            }
        };

        if (preview) {
            // v120.1: Para vista previa generamos un PDF real del HTML.
            // Esto permite usar los controles nativos del navegador (Imprimir, Descargar)
            let printWindow = new BrowserWindow(winConfig);
            
            try {
                // Paso 1: Generar el PDF en una ventana oculta
                let tempWin = new BrowserWindow({ show: false });
                await tempWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
                
                const pdfData = await tempWin.webContents.printToPDF({
                    pageSize: options?.pageSize || 'A4',
                    printBackground: true,
                    margins: { marginType: 'none' }
                });
                
                tempWin.close();

                // Paso 2: Cargar el PDF como Data URI en la ventana principal
                const pdfBase64 = pdfData.toString('base64');
                await printWindow.loadURL(`data:application/pdf;base64,${pdfBase64}`);
                
                printWindow.setMenu(null);
                printWindow.show();
                printWindow.focus();
                
                return { success: true };
            } catch (error) {
                console.error('[Electron:Main] ❌ Error generando PDF para vista previa:', error.message);
                if (printWindow) printWindow.close();
                return { success: false, error: error.message };
            }
        } else {
            // Impresión directa y silenciosa
            let printWindow = new BrowserWindow({ show: false });
            try {
                await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
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
                return { success: true };
            } catch (error) {
                if (printWindow) printWindow.close();
                return { success: false, error: error.message };
            }
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

    ipcMain.handle('save-app-config', async (event, newConfig) => {
        console.log('[Electron:Main] 📨 IPC Receive: save-app-config');
        const fs = require('fs');
        const isPackaged = app.isPackaged;
        const resourcesPath = isPackaged ? process.resourcesPath : __dirname;
        const configPath = path.join(resourcesPath, 'config.json');

        try {
            // v160.18: Guardado persistente de configuración
            fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 4), 'utf8');
            return { success: true };
        } catch (e) {
            console.error('[Electron:Main] ❌ Error guardando config:', e.message);
            return { success: false, error: e.message };
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
            devTools: true, // v150.1: Habilitar consola para depuración
            preload: path.join(__dirname, 'preload.js')
        }
    });
    // Apunta al archivo index.html generado por Angular después de hacer 'ng build'
    win.loadFile(path.join(__dirname, 'dist/bodegaskeyla/browser/index.html'));

    // v110.0: Abrir las herramientas de desarrollo automáticamente
    win.webContents.openDevTools(); // v110.0: Habilitar para depuración

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
