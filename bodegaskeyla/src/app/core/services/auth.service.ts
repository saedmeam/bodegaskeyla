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
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('LOGIN') || '/XPos/login'}`;
        const auth = this.config.getAuth();
        const headers = new HttpHeaders({
            'Authorization': `Basic ${btoa(`${auth.user}:${auth.pass}`)}`,
            'Content-Type': 'application/json'
        });

        return this.http.post<any>(url, {}, { headers }).pipe(
            map(res => res.accesToken),
            tap(token => this.storage.saveLocal(this.XPOS_TOKEN_KEY, token))
        );
    }

    /**
     * Step 1.2: Perform Login with encrypted password
     */
    login(username: string, encryptedPassword: string, xposToken: string): Observable<any> {
        const headers = new HttpHeaders({
            'Authorization': `Bearer ${xposToken}`,
            'Content-Type': 'application/json'
        });

        const body = {
            codigoUsuario: username.toUpperCase(),
            contrasenia: encryptedPassword
        };

        return this.http.post<any>(`${this.getBaseUrl()}/XPos/inicioSesion`, body, { headers });
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
