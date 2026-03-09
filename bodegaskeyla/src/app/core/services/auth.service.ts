import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, map, switchMap, tap, of, catchError } from 'rxjs';
import { FinalUserData } from '../../shared/models/auth.model';
import { StorageService } from './storage.service';
import { ConfigService } from './config.service'; // Assuming path for ConfigService

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private http = inject(HttpClient);
    private storage = inject(StorageService);
    private config = inject(ConfigService);

    private readonly XPOS_TOKEN_KEY = 'authToken';
    private readonly USER_DATA_KEY = 'userData';

    constructor() { }

    private getBaseUrl(): string {
        return this.config.getApiUrl();
    }

    /**
     * Step 1.1: Get XPOS Token using Basic Auth
     */
    getXPosToken(): Observable<string> {
        console.log('[AuthService] 🔑 Solicitando XPOS Token...');
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('LOGIN') || '/XPos/login'}`;
        const auth = this.config.getAuth();
        const headers = new HttpHeaders({
            'Authorization': `Basic ${btoa(`${auth.user}:${auth.pass}`)}`,
            'Content-Type': 'application/json'
        });

        return this.http.post<any>(url, {}, { headers }).pipe(
            map(res => res.accesToken),
            tap(token => {
                console.log('[AuthService] ✅ XPOS Token obtenido:', token ? '***' + token.slice(-5) : 'NULL');
                this.storage.saveLocal(this.XPOS_TOKEN_KEY, token);
            }),
            catchError(err => {
                console.error('[AuthService] ❌ Error obteniendo XPOS Token:', err);
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error de autenticación base';
                return of({ mensaje: errorMsg, isError: true } as any);
            })
        );
    }

    /**
     * Step 1.2: Perform Login with encrypted password
     */
    login(username: string, encryptedPassword: string, xposToken: string): Observable<any> {
        console.log(`[AuthService] 👤 Intentando inicio de sesión para: ${username.toUpperCase()}`);
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${xposToken}`,
            'Content-Type': 'application/json'
        });

        const body = {
            codigoUsuario: username.toUpperCase(),
            contrasenia: encryptedPassword
        };

        return this.http.post<any>(`${this.getBaseUrl()}/XPos/inicioSesion`, body, { headers }).pipe(
            tap(res => console.log('[AuthService] 📡 Respuesta inicioSesion:', res)),
            catchError(err => {
                console.error('[AuthService] ❌ Error en inicio de sesión:', err);
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error de credenciales';
                return of({ mensaje: errorMsg, isError: true });
            })
        );
    }

    /**
     * Step 4: Finalize session storage
     */
    saveSession(userData: FinalUserData) {
        this.storage.saveLocal(this.USER_DATA_KEY, userData);
    }

    getStoredToken(): string | null {
        return this.storage.loadLocal<string>(this.XPOS_TOKEN_KEY);
    }

    getStoredUser(): FinalUserData | null {
        return this.storage.loadLocal<FinalUserData>(this.USER_DATA_KEY);
    }

    logout() {
        this.storage.clearLocal(this.USER_DATA_KEY);
        this.storage.clearLocal(this.XPOS_TOKEN_KEY);
    }
}
