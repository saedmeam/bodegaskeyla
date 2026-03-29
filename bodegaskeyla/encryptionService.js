const { exec } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);

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
        const isPackaged = app ? app.isPackaged : false;

        const possiblePaths = [
            path.join(process.cwd(), 'encrypter-xuit.jar'),
            path.join(__dirname, 'encrypter-xuit.jar'),
            path.join(process.resourcesPath, 'encrypter-xuit.jar'),
            path.join(process.resourcesPath, 'app', 'encrypter-xuit.jar')
        ];

        let finalPath = possiblePaths.find(p => require('fs').existsSync(p));
        return finalPath || path.join(__dirname, 'encrypter-xuit.jar');
    }

    /**
     * Verificar si Java está instalado (solo una vez)
     */
    async checkJavaInstalled() {
        if (this._javaChecked !== undefined) return this._javaChecked;
        
        try {
            await execPromise('java -version');
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

            console.log('[Electron:Encryption] 🔐 Iniciando proceso de encriptación...');
            console.log('[Electron:Encryption] 📂 Usando JAR en:', this.jarPath);

            // Escapar el texto para evitar problemas con caracteres especiales
            const escapedText = text.replace(/"/g, '\\"');

            const command = `java -jar "${this.jarPath}" encrypt "${escapedText}"`;

            console.log('[Electron:Encryption] ⚙️ Ejecutando comando JAR...');

            const { stdout, stderr } = await execPromise(command, {
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

            console.log('🔓 Desencriptando texto...');

            const escapedText = encryptedText.replace(/"/g, '\\"');
            const command = `java -jar "${this.jarPath}" decrypt "${escapedText}"`;

            console.log('⚙️ Ejecutando comando:', command);

            const { stdout, stderr } = await execPromise(command, {
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
