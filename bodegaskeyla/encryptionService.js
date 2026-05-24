const { exec, execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

/**
 * Servicio de Encriptación usando encrypter-xuit.jar
 * Ejecuta el JAR para cifrar cadenas de texto
 */
class EncryptionService {
    constructor() {
        // Ruta al archivo JAR
        // El JAR debe estar en la raíz del proyecto: /encrypter-xuit.jar
        this.jarPath = this.getJarPath();
    }

    /**
     * Obtener la ruta correcta del JAR según el entorno
     */
    getJarPath() {
        const { app } = require('electron');
        let appPath = '';
        try {
            if (app) appPath = app.getAppPath();
        } catch (e) {
            console.error('[Electron:Encryption] Error al obtener appPath:', e.message);
        }

        const execDir = path.dirname(process.execPath);

        const possiblePaths = [
            path.join(process.cwd(), 'encrypter-xuit.jar'),
            path.join(__dirname, 'encrypter-xuit.jar'),
            path.join(process.resourcesPath || '', 'encrypter-xuit.jar'),
            path.join(process.resourcesPath || '', 'app', 'encrypter-xuit.jar'),
            appPath ? path.join(appPath, 'encrypter-xuit.jar') : '',
            path.join(execDir, 'resources', 'encrypter-xuit.jar'),
            path.join(execDir, 'resources', 'app', 'encrypter-xuit.jar')
        ].filter(Boolean);

        console.log('[Electron:Encryption] 🔍 Buscando encrypter-xuit.jar en:');
        possiblePaths.forEach(p => {
            const exists = require('fs').existsSync(p);
            console.log(`  - [${exists ? 'ENCONTRADO' : 'NO EXISTE'}] ${p}`);
        });

        let finalPath = possiblePaths.find(p => require('fs').existsSync(p));
        if (finalPath) {
            console.log('[Electron:Encryption] 🎯 Usando JAR seleccionado:', finalPath);
            return finalPath;
        }

        const fallback = path.join(__dirname, 'encrypter-xuit.jar');
        console.warn('[Electron:Encryption] ⚠️ No se encontró el JAR. Usando fallback:', fallback);
        return fallback;
    }

    /**
     * Verificar si Java está instalado (solo una vez)
     */
    async checkJavaInstalled() {
        if (this._javaChecked !== undefined) return this._javaChecked;
        
        try {
            await execFilePromise('java', ['-version']);
            this._javaChecked = true;
            return true;
        } catch (error) {
            console.error('[Electron:Encryption] ❌ Java no detectado');
            this._javaChecked = false;
            return false;
        }
    }

    /**
     * Encriptar una cadena de texto usando el JAR
     * @param {string} text - Texto a encriptar
     * @returns {Promise<string>} - Texto encriptado
     */
    async encrypt(text) {
        try {
            // Verificar que Java esté instalado
            const javaInstalled = await this.checkJavaInstalled();
            if (!javaInstalled) {
                console.error('❌ [MN] Java NO detectado');
                throw new Error('Java no está instalado. Por favor instale Java para continuar.');
            }

            // Verificar que el JAR exista
            if (!require('fs').existsSync(this.jarPath)) {
                console.error(`❌ [MN] JAR de encriptación no encontrado en: ${this.jarPath}`);
                throw new Error(`El archivo de encriptación 'encrypter-xuit.jar' no fue encontrado. Ruta intentada: ${this.jarPath}`);
            }

            console.log('[Electron:Encryption] 🔐 Iniciando proceso de encriptación...');
            console.log('[Electron:Encryption] 📂 Usando JAR en:', this.jarPath);

            console.log('[Electron:Encryption] ⚙️ Ejecutando comando JAR con execFile...');

            const { stdout, stderr } = await execFilePromise('java', ['-jar', this.jarPath, 'encrypt', text], {
                timeout: 10000, // 10 segundos de timeout
                maxBuffer: 1024 * 1024 // 1MB buffer
            });

            if (stderr && stderr.trim() !== '') {
                console.warn('[Electron:Encryption] ⚠️ JAR stderr:', stderr);
            }

            const encryptedText = stdout.trim();
            console.log('📝 [MN] Resultado stdout:', encryptedText);

            if (!encryptedText) {
                throw new Error('El JAR no retornó ningún resultado');
            }

            console.log('[Electron:Encryption] ✅ Encriptación finalizada con éxito');
            return encryptedText;

        } catch (error) {
            console.error('❌ [MN] Error al encriptar:', error);
            throw new Error(`Error de encriptación: ${error.message}`);
        }
    }

    /**
     * Desencriptar una cadena de texto usando el JAR (opcional)
     * @param {string} encryptedText - Texto encriptado
     * @returns {Promise<string>} - Texto desencriptado
     */
    async decrypt(encryptedText) {
        try {
            const javaInstalled = await this.checkJavaInstalled();
            if (!javaInstalled) {
                throw new Error('Java no está instalado.');
            }

            // Verificar que el JAR exista
            if (!require('fs').existsSync(this.jarPath)) {
                console.error(`❌ [MN] JAR de desencriptación no encontrado en: ${this.jarPath}`);
                throw new Error(`El archivo de encriptación 'encrypter-xuit.jar' no fue encontrado. Ruta intentada: ${this.jarPath}`);
            }

            console.log('🔓 Desencriptando texto...');
            console.log('⚙️ Ejecutando desencriptación con execFile...');

            const { stdout, stderr } = await execFilePromise('java', ['-jar', this.jarPath, 'decrypt', encryptedText], {
                timeout: 10000,
                maxBuffer: 1024 * 1024
            });

            if (stderr && stderr.trim() !== '') {
                console.warn('⚠️ Advertencia del JAR:', stderr);
            }

            const decryptedText = stdout.trim();

            if (!decryptedText) {
                throw new Error('El JAR no retornó ningún resultado');
            }

            console.log('✅ Texto desencriptado exitosamente');
            return decryptedText;

        } catch (error) {
            console.error('❌ Error al desencriptar:', error);
            throw new Error(`Error de desencriptación: ${error.message}`);
        }
    }
}

// Exportar una instancia única (singleton)
module.exports = new EncryptionService();
