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
        // Verificar si la app está empaquetada
        const isPackaged = require('electron').app ? require('electron').app.isPackaged : false;

        if (isPackaged || process.env.NODE_ENV === 'production') {
            // En producción (app empaquetada)
            const resourcesPath = process.resourcesPath || path.join(__dirname, '../../');
            return path.join(resourcesPath, 'encrypter-xuit.jar');
        } else {
            // En desarrollo - el JAR está en la raíz junto a main.js
            return path.join(__dirname, 'encrypter-xuit.jar');
        }
    }

    /**
     * Verificar si Java está instalado
     */
    async checkJavaInstalled() {
        try {
            const { stdout } = await execPromise('java -version');
            console.log('✅ Java instalado:', stdout);
            return true;
        } catch (error) {
            console.error('❌ Java no está instalado o no está en PATH');
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

            console.log('🔐 [MN] Encriptando texto...');
            console.log('📂 [MN] JAR Path:', this.jarPath);

            // Escapar el texto para evitar problemas con caracteres especiales
            const escapedText = text.replace(/"/g, '\\"');

            const command = `java -jar "${this.jarPath}" encrypt "${escapedText}"`;

            console.log('⚙️ [MN] Ejecutando comando:', command);

            const { stdout, stderr } = await execPromise(command, {
                timeout: 10000, // 10 segundos de timeout
                maxBuffer: 1024 * 1024 // 1MB buffer
            });

            if (stderr && stderr.trim() !== '') {
                console.warn('⚠️ [MN] Advertencia del JAR (stderr):', stderr);
            }

            const encryptedText = stdout.trim();
            console.log('📝 [MN] Resultado stdout:', encryptedText);

            if (!encryptedText) {
                throw new Error('El JAR no retornó ningún resultado');
            }

            console.log('✅ [MN] Encriptación exitosa');
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
