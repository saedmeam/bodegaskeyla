import { Injectable } from '@angular/core';

declare global {
    interface Window {
        electronAPI: {
            encryptText: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>;
            decryptText: (text: string) => Promise<{ success: boolean; data?: string; error?: string }>;
            checkJava: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
            getAppConfig: () => Promise<{ success: boolean; data?: any; error?: string }>;
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
        if (!window.electronAPI) {
            console.warn('Electron API not available, returning plain text (MOCK)');
            return text;
        }

        const result = await window.electronAPI.encryptText(text);
        if (!result.success) {
            throw new Error(result.error || 'Encryption failed');
        }
        return result.data || '';
    }

    async checkJava(): Promise<boolean> {
        if (!window.electronAPI) return false;
        const result = await window.electronAPI.checkJava();
        return result.success ? (result.data || false) : false;
    }
}
