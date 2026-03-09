import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map, tap, catchError, of } from 'rxjs';
import { ConfigService } from './config.service';
import { Empresa, Sucursal, Caja } from '../../shared/models/auth.model';

@Injectable({
    providedIn: 'root'
})
export class CajaService {
    private http = inject(HttpClient);
    private config = inject(ConfigService);

    private getBaseUrl(): string {
        return this.config.getApiUrl();
    }

    private getHeaders(token: string): HttpHeaders {
        return new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });
    }

    /**
     * Step 1.3: Get Companies
     */
    getEmpresas(token: string): Observable<Empresa[]> {
        console.log('[CajaService] 🏢 Obteniendo lista de empresas...');
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('EMPRESAS') || '/XPosConsultas/empresas'}`;
        return this.http.get<any>(url, { headers: this.getHeaders(token) }).pipe(
            tap(res => console.log('[CajaService] 📡 Respuesta empresas:', res)),
            map(res => (res.dafEmpresas || []).filter((e: any) => e.esActivo === 'S')),
            catchError(err => {
                console.error('[CajaService] Error en getEmpresas', err);
                return of([]);
            })
        );
    }

    /**
     * Step 2.1: Get User System ID (secuenciaPersonal)
     */
    getUsuarioSistema(token: string): Observable<any> {
        console.log('[CajaService] 👤 Obteniendo datos básicos del usuario (secuenciaPersonal)...');
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('USUARIOS_SISTEMA') || '/XPosConsultas/usuariosSistema'}`;
        return this.http.get<any>(url, { headers: this.getHeaders(token) }).pipe(
            tap(res => console.log('[CajaService] 📡 Respuesta usuarioSistema:', res)),
            map(res => res.dafUsuariosSistema?.[0] || null),
            catchError(err => {
                console.error('[CajaService] Error en getUsuarioSistema', err);
                return of(null);
            })
        );
    }

    /**
     * Step 2.2: Get Cost Center (codigoCentroCosto)
     */
    getPersonalXEmpresa(codigoEmpresa: number, token: string): Observable<any[]> {
        console.log(`[CajaService] 👥 Obteniendo personal para empresa: ${codigoEmpresa}`);
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('PERSONAL_X_EMPRESA') || '/XPosConsultas/personalXEmpresa'}`;
        const params = new HttpParams().set('arg0', codigoEmpresa.toString());
        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            tap(res => console.log('[CajaService] 📡 Respuesta personalXEmpresa:', res)),
            map(res => res.dafPersonalXEmpresa || []),
            catchError(err => {
                console.error('[CajaService] Error en getPersonalXEmpresa', err);
                return of([]);
            })
        );
    }

    /**
     * Step 2.4: Get Authorized Branches
     */
    getSucursalesAutorizadas(codigoEmpresa: number, token: string): Observable<any[]> {
        console.log(`[CajaService] 📍 Obteniendo sucursales autorizadas para empresa: ${codigoEmpresa}`);
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('SUCURSALES_X_USUARIO') || '/XPosConsultas/sucursalesXUsuario'}`;
        const params = new HttpParams().set('arg0', codigoEmpresa.toString());
        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            tap(res => console.log('[CajaService] 📡 Respuesta sucursalesXUsuario:', res)),
            map(res => res.dafUsuarioXSucursal || []),
            catchError(err => {
                console.error('[CajaService] Error en getSucursalesAutorizadas', err);
                return of([]);
            })
        );
    }

    /**
     * Step 2.5: Get Master Branch Catalog
     */
    getSucursales(codigoEmpresa: number, token: string): Observable<any[]> {
        console.log(`[CajaService] 🏗️ Obteniendo catálogo maestro de sucursales para empresa: ${codigoEmpresa}`);
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('SUCURSALES') || '/XPosConsultas/sucursales'}`;
        const params = new HttpParams().set('arg0', codigoEmpresa.toString());
        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            tap(res => console.log('[CajaService] 📡 Respuesta sucursales (Master):', res)),
            map(res => res.dafSucursales || []),
            catchError(err => {
                console.error('[CajaService] Error en getSucursales', err);
                return of([]);
            })
        );
    }

    /**
     * Step 3.2: Get Box Real Status (Arqueo)
     */
    getCajasDisponiblesUsuario(codigoEmpresa: number, codigoSucursal: number, username: string, token: string): Observable<any[]> {
        console.log(`[CajaService] 💵 Consultando cajas disponibles (Empresa: ${codigoEmpresa}, Sucursal: ${codigoSucursal}, Usuario: ${username})`);
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('CAJAS_DISPONIBLES_USUARIO') || '/XPosConsultas/cajasDisponiblesUsuario'}`;
        const params = new HttpParams()
            .set('arg0', codigoEmpresa.toString())
            .set('arg1', codigoSucursal.toString())
            .set('arg2', username.toUpperCase());

        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            tap(res => console.log('[CajaService] 📡 Respuesta cajasDisponiblesUsuario:', res)),
            map(res => res.facArqueosCajas || []),
            catchError(err => {
                console.error('[CajaService] Error en getCajasDisponiblesUsuario', err);
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error consultando cajas';
                // Retornar un objeto que el login.component pueda identificar como error
                return of([{ mensaje: errorMsg, isError: true }] as any);
            })
        );
    }

    /**
     * Step 3.1: Get Box Catalog
     */
    getCatalogoCajas(codigoEmpresa: number, token: string): Observable<any[]> {
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('CAJAS') || '/XPosConsultas/cajas'}`;
        const params = new HttpParams().set('arg0', codigoEmpresa.toString());
        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            map(res => res.facCajas || []),
            catchError(err => {
                console.error('[CajaService] Error en getCatalogoCajas', err);
                return of([]);
            })
        );
    }
}
