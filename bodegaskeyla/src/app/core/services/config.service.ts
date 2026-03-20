import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class ConfigService {
    private configSubject = new BehaviorSubject<any>(null);
    config$ = this.configSubject.asObservable();

    constructor() {
        this.init();
    }

    private async init() {
        if (window.electronAPI) {
            const result = await window.electronAPI.getAppConfig();
            if (result.success) {
                this.configSubject.next(result.data);
            } else {
                console.error('Failed to load config from Electron:', result.error);
            }
        } else {
            // Fallback or Web mock if needed
            this.configSubject.next({
                apiUrl: 'http://test.neu360.com/X-uitWSRestMagkaz2',
                endpoints: {
                    LOGIN: "/XPos/login",
                    EMPRESAS: "/XPosConsultas/empresas"
                }
            });
        }
    }

    getConfig(): any {
        return this.configSubject.value;
    }

    getApiUrl(): string {
        const config = this.getConfig();
        const env = config?.environment;
        if (env && config?.environments?.[env]) {
            const envConfig = config.environments[env];
            return typeof envConfig === 'string' ? envConfig : envConfig.apiUrl;
        }
        return config?.apiUrl || 'http://test.neu360.com/X-uitWSRestMagkaz2';
    }

    getEndpoint(key: string): string {
        return this.getConfig()?.endpoints?.[key] || '';
    }

    getAuth(): { user: string, pass: string } {
        const config = this.getConfig();
        const env = config?.environment;
        if (env && config?.environments?.[env]?.auth) {
            return config.environments[env].auth;
        }
        return config?.auth || { user: 'wsxpos', pass: 'n3UE60@s3Rv1c10@Xp0s' };
    }
}
