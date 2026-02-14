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
                const filePath = this.path.join((window as any).process.cwd(), `${key}.json`);
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
                const filePath = this.path.join((window as any).process.cwd(), `${key}.json`);
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
     * Elimina un registro local.
     */
    clearLocal(key: string): void {
        localStorage.removeItem(key);
    }
}
