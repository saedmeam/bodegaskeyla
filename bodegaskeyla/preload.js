const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script para exponer APIs seguras al renderer process
 * Este archivo actúa como puente entre Electron (Node.js) y React
 */

// Exponer APIs al contexto del renderer (React)
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Encriptar texto usando el JAR
     * @param {string} text - Texto a encriptar
     * @returns {Promise<string>} - Texto encriptado
     */
    encryptText: (text) => ipcRenderer.invoke('encrypt-text', text),

    /**
     * Desencriptar texto usando el JAR
     * @param {string} encryptedText - Texto encriptado
     * @returns {Promise<string>} - Texto desencriptado
     */
    decryptText: (encryptedText) => ipcRenderer.invoke('decrypt-text', encryptedText),

    /**
     * Verificar si Java está instalado
     * @returns {Promise<boolean>}
     */
    checkJava: () => ipcRenderer.invoke('check-java'),

    /**
     * Cerrar la aplicación
     * @returns {void}
     */
    closeApp: () => ipcRenderer.send('close-app'),

    /**
     * Obtener configuración local de la aplicación (config.json)
     * @returns {Promise<{success: boolean, data?: any, error?: string}>}
     */
    getAppConfig: () => ipcRenderer.invoke('get-app-config'),

    /**
     * Guardar configuración local (v160.18)
     */
    saveAppConfig: (config) => ipcRenderer.invoke('save-app-config', config),

    /**
     * Imprimir texto plano
     * @param {string} text - Texto a imprimir
     * @param {string} [printerName] - Nombre de la impresora opcional
     * @returns {Promise<{success: boolean, data?: string, printer?: string, error?: string}>}
     */
    printText: (text, printerName) => ipcRenderer.invoke('print-text', { text, printerName }),

    /**
     * Obtener lista de impresoras
     * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
     */
    printLabels: (payload) => ipcRenderer.invoke('print-labels', payload),
    printJasper: (payload) => ipcRenderer.invoke('print-jasper', payload),
    getPrinters: () => ipcRenderer.invoke('get-printers'),

    // Otras APIs que puedas necesitar
    platform: process.platform,
    versions: {
        node: process.versions.node,
        chrome: process.versions.chrome,
        electron: process.versions.electron
    },

    /**
     * Redimensionar ventana
     * @param {Object} options - { width, height, maximize }
     */
    resizeWindow: (options) => ipcRenderer.invoke('resize-window', options),

    /**
     * Transacción SOAP (procesada en Main process para evitar CORS)
     */
    soapTransaction: (options) => ipcRenderer.invoke('soap-transaction', options),

    /**
     * v1.0.6: Gestión de Actualizaciones
     */
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    gitSync: () => ipcRenderer.invoke('git-sync'),
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, status) => callback(status)),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, percent) => callback(percent)),

    // Flag para indicar que está corriendo en Electron
    isElectron: true
});

console.log('✅ Preload script cargado correctamente');
