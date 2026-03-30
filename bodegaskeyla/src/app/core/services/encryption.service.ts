import { Injectable } from '@angular/core';

declare global {
    interface Window {
        electronAPI: {
            encryptText: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>;
            decryptText: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>;
            checkJava: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
            getAppConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
            saveAppConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
            printText: (text: string, printerName?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
            getPrinters: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
            printLabels: (payload: any) => Promise<{ success: boolean; error?: string }>;
            closeApp: () => void;
        };
    }
}

@Injectable({
    providedIn: 'root'
})
export class EncryptionService {
    constructor() { }

    async encrypt(text: string): Promise<string> {
        console.log('[EncryptionService] 🔐 Solicitando encriptación de texto...');
        if (!window.electronAPI) {
            console.warn('[EncryptionService] ⚠️ Electron API no disponible, usando MOCK');
            return text;
        }

        try {
            const result = await window.electronAPI.encryptText(text);
            if (!result.success) {
                console.error('[EncryptionService] ❌ Falló la encriptación:', result.error);
                throw new Error(result.error || 'Encryption failed');
            }
            console.log('[EncryptionService] ✅ Texto encriptado correctamente');
            return result.data || '';
        } catch (err) {
            console.error('[EncryptionService] ❌ Error inesperado en encriptación:', err);
            throw err;
        }
    }

    async checkJava(): Promise<boolean> {
        if (!window.electronAPI) return false;
        const result = await window.electronAPI.checkJava();
        return result.success ? (result.data || false) : false;
    }
}
