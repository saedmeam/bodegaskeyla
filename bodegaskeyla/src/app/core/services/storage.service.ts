import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class StorageService {
    private fs: any;
    private path: any;
    private isElectron: boolean = false;

    constructor() {
        // Detección de ambiente Electron para habilitar persistencia en archivo físico
        if (window && (window as any).process && (window as any).process.type) {
            try {
                this.fs = (window as any).require('fs');
                this.path = (window as any).require('path');
                this.isElectron = true;
                console.log('[StorageService] Ambiente Electron detectado. Backup en archivo habilitado.');
            } catch (e) {
                console.warn('[StorageService] No se pudo cargar el módulo fs de Node.');
            }
        }
    }

    /**
     * Guarda un objeto en el ambiente local (LocalStorage + Archivo Backup).
     * El archivo backup actúa como el "txt" solicitado para máxima robustez ante falta de luz.
     */
    saveLocal(key: string, data: any): void {
        try {
            const jsonData = JSON.stringify(data, null, 2);

            // 1. Guardado en Tabla Local (Navigator Storage)
            localStorage.setItem(key, jsonData);

            // 2. Guardado en TXT/JSON Físico (Si es Electron)
            if (this.isElectron && this.fs) {
                // v72.0: Usar ruta de usuario persistente para evitar bloqueos en Program Files
                const userDataPath = (window as any).process.env.APPDATA || (window as any).process.cwd();
                const backupDir = this.path.join(userDataPath, 'BodegasKeyla_Backup');

                if (!this.fs.existsSync(backupDir)) {
                    this.fs.mkdirSync(backupDir, { recursive: true });
                }

                const filePath = this.path.join(backupDir, `${key}.json`);
                this.fs.writeFileSync(filePath, jsonData, 'utf8');
                console.log(`[StorageService] Backup físico (TXT) creado en: ${filePath}`);
            }

            console.log(`[StorageService] Data guardada exitosamente: ${key}`);
        } catch (e) {
            console.error('[StorageService] Error guardando en ambiente local', e);
        }
    }

    /**
     * Recupera data del ambiente local.
     */
    loadLocal<T>(key: string): T | null {
        try {
            // 1. Intentar desde LocalStorage (Rápido)
            const data = localStorage.getItem(key);
            if (data) {
                console.log(`[StorageService] Data recuperada de LocalStorage: ${key}`);
                return JSON.parse(data) as T;
            }

            // 2. Si falla y es Electron, intentar desde archivo físico (Txt/Json backup)
            if (this.isElectron && this.fs) {
                const userDataPath = (window as any).process.env.APPDATA || (window as any).process.cwd();
                const backupDir = this.path.join(userDataPath, 'BodegasKeyla_Backup');
                const filePath = this.path.join(backupDir, `${key}.json`);

                if (this.fs.existsSync(filePath)) {
                    const fileData = this.fs.readFileSync(filePath, 'utf8');
                    console.log(`[StorageService] Data recuperada de archivo FISICO: ${filePath}`);
                    // Sincronizamos LocalStorage para la próxima
                    localStorage.setItem(key, fileData);
                    return JSON.parse(fileData) as T;
                }
            }
        } catch (e) {
            console.error('[StorageService] Error cargando de ambiente local', e);
        }
        return null;
    }

    /**
     * v72.0: Elimina el registro local y su backup físico asociado.
     */
    clearLocal(key: string): void {
        localStorage.removeItem(key);
        // Borrar también del disco para evitar recuperaciones accidentales
        if (this.isElectron && this.fs) {
            try {
                const userDataPath = (window as any).process.env.APPDATA || (window as any).process.cwd();
                const filePath = this.path.join(userDataPath, 'BodegasKeyla_Backup', `${key}.json`);
                if (this.fs.existsSync(filePath)) {
                    this.fs.unlinkSync(filePath);
                    console.log(`[StorageService] Backup físico eliminado: ${filePath}`);
                }
            } catch (e) {
                console.error('[StorageService] Error eliminando backup físico', e);
            }
        }
    }

    /**
     * v160.0: Limpia absolutamente todos los registros de sesiones y caché de órdenes.
     */
    clearAllOrders(): void {
        console.log('[StorageService] Purga completa de órdenes iniciada...');
        // 1. Limpiar LocalStorage mediante prefijos conocidos
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('REVISION_SESSION_') || key.startsWith('ORDER_CACHE_')) {
                localStorage.removeItem(key);
            }
        });

        // 2. Limpiar directorio físico de backup
        if (this.isElectron && this.fs) {
            try {
                const userDataPath = (window as any).process.env.APPDATA || (window as any).process.cwd();
                const backupDir = this.path.join(userDataPath, 'BodegasKeyla_Backup');
                if (this.fs.existsSync(backupDir)) {
                    const files = this.fs.readdirSync(backupDir);
                    files.forEach((file: string) => {
                        this.fs.unlinkSync(this.path.join(backupDir, file));
                    });
                    console.log(`[StorageService] Directorio de backup vaciado: ${backupDir}`);
                }
            } catch (e) {
                console.error('[StorageService] Error purgando directorio de backup', e);
            }
        }
    }
}
