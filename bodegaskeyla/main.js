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

        // v160.24: Ruta base (Solo lectura en Program Files)
        const isPackaged = app.isPackaged;
        const resourcesPath = isPackaged ? process.resourcesPath : __dirname;
        const baseConfigPath = path.join(resourcesPath, 'config.json');

        // v160.24: Única ruta de usuario segura fuera de AppData y Program Files (Evita bloqueos)
        const userConfigPath = 'C:\\FarmaciasKeyla_Config\\config.json';

        let mergedConfig = {};

        // 1. Cargar Base
        if (fs.existsSync(baseConfigPath)) {
            try {
                const base = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));
                mergedConfig = { ...base };
            } catch (e) {
                console.error('Error reading base config:', e.message);
            }
        }

        // 2. Cargar User (si existe, sobreescribe base)
        if (fs.existsSync(userConfigPath)) {
            try {
                const user = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
                mergedConfig = { ...mergedConfig, ...user };
                console.log('[Electron:Main] Config de usuario cargada desde C:\\.');
            } catch (e) {
                console.error('Error reading user config from C:\\:', e.message);
            }
        }

        if (Object.keys(mergedConfig).length > 0) {
            return { success: true, data: mergedConfig };
        }
        return { success: false, error: 'Config file not found in resources or C:\\' };
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
            width: 1000,
            height: 950,
            title: 'Vista Previa de Reporte - Keyla',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                plugins: true
            }
        };

        if (preview) {
            let printWindow = new BrowserWindow(winConfig);
            
            try {
                // v160.33: Usar archivo temporal en lugar de Data URI para evitar el problema de Blanco (Limite de caracteres en URL)
                const fs = require('fs');
                const os = require('os');
                const tempPath = path.join(os.tmpdir(), `keyla_print_${Date.now()}.html`);
                fs.writeFileSync(tempPath, html, 'utf8');

                let tempWin = new BrowserWindow({ show: false });
                await tempWin.loadFile(tempPath);
                
                // v160.37: Delay para asegurar que el motor de renderizado procese el HTML/CSS
                await new Promise(resolve => setTimeout(resolve, 500));

                const pdfOptions = {
                    printBackground: true,
                    pageSize: options?.pageSize || 'A4',
                    landscape: options?.landscape || false,
                    margins: { marginType: 'none' } // v160.36: Modern API logic
                };

                const pdfData = await tempWin.webContents.printToPDF(pdfOptions);
                tempWin.close();
                
                // Borrar archivo temporal
                try { fs.unlinkSync(tempPath); } catch (e) {}

                // Paso 2: Cargar el PDF
                const pdfBase64 = pdfData.toString('base64');
                await printWindow.loadURL(`data:application/pdf;base64,${pdfBase64}`);
                
                printWindow.setMenu(null);
                printWindow.show();
                printWindow.focus();
                
                return { success: true };
            } catch (error) {
                console.error('[Electron:Main] ❌ Error generando PDF:', error.message);
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
        
        // v160.24: Ruta única en Disco C:\ fuera de AppData para acceso total sin bloqueos
        const userConfigDir = 'C:\\FarmaciasKeyla_Config';
        const userConfigPath = path.join(userConfigDir, 'config.json');

        try {
            // Asegurar que la carpeta raíz en C:\ exista
            if (!fs.existsSync(userConfigDir)) {
                fs.mkdirSync(userConfigDir, { recursive: true });
            }
            
            // Guardar configuración de usuario directamente en C:\
            fs.writeFileSync(userConfigPath, JSON.stringify(newConfig, null, 4), 'utf8');
            console.log('[Electron:Main] ✅ Config guardada exitosamente en C:\\:', userConfigPath);
            return { success: true };
        } catch (e) {
            console.error('[Electron:Main] ❌ Error guardando config en C:\\:', e.message);
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
            devTools: false, // v160.32: Deshabilitado por solicitud
            preload: path.join(__dirname, 'preload.js')
        }
    });
    // Apunta al archivo index.html generado por Angular después de hacer 'ng build'
    win.loadFile(path.join(__dirname, 'dist/bodegaskeyla/browser/index.html'));

    // v160.29: Habilitado para pase final
    // win.webContents.openDevTools();

    // v160.22: Refuerzo para asegurar que las herramientas de desarrollo no se abran
    win.webContents.on('devtools-opened', () => {
        win.webContents.closeDevTools();
    });

    /**
     * v160.22: Reinstalación de Menú Profesional para Pase a Producción
     * Se elimina "Inspeccionar" pero se mantiene la configuración de impresora.
     */
    const { Menu } = electron;
    const menuTemplate = [
        {
            label: 'Archivo',
            submenu: [
                {
                    label: 'Configuración de Impresora',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => {
                        win.webContents.executeJavaScript('window.location.hash = "#/config-impresora";');
                    }
                },
                { type: 'separator' },
                { label: 'Cerrar Sesión', click: () => { win.webContents.executeJavaScript('window.location.hash = "#/login";'); } },
                { label: 'Salir', role: 'quit' }
            ]
        },
        {
            label: 'Ver',
            submenu: [
                { label: 'Recargar', role: 'reload' },
                { label: 'Forzar Recarga', role: 'forceReload' },
                { type: 'separator' },
                { label: 'Pantalla Completa', role: 'togglefullscreen' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

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
