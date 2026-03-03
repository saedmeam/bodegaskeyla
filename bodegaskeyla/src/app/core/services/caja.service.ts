import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('EMPRESAS') || '/XPosConsultas/empresas'}`;
        return this.http.get<any>(url, { headers: this.getHeaders(token) }).pipe(
            map(res => (res.dafEmpresas || []).filter((e: any) => e.esActivo === 'S'))
        );
    }

    /**
     * Step 2.1: Get User System ID (secuenciaPersonal)
     */
    getUsuarioSistema(token: string): Observable<any> {
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('USUARIOS_SISTEMA') || '/XPosConsultas/usuariosSistema'}`;
        return this.http.get<any>(url, { headers: this.getHeaders(token) }).pipe(
            map(res => res.dafUsuariosSistema?.[0] || null)
        );
    }

    /**
     * Step 2.2: Get Cost Center (codigoCentroCosto)
     */
    getPersonalXEmpresa(codigoEmpresa: number, token: string): Observable<any[]> {
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('PERSONAL_X_EMPRESA') || '/XPosConsultas/personalXEmpresa'}`;
        const params = new HttpParams().set('arg0', codigoEmpresa.toString());
        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            map(res => res.dafPersonalXEmpresa || [])
        );
    }

    /**
     * Step 2.4: Get Authorized Branches
     */
    getSucursalesAutorizadas(codigoEmpresa: number, token: string): Observable<any[]> {
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('SUCURSALES_X_USUARIO') || '/XPosConsultas/sucursalesXUsuario'}`;
        const params = new HttpParams().set('arg0', codigoEmpresa.toString());
        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            map(res => res.dafUsuarioXSucursal || [])
        );
    }

    /**
     * Step 3.2: Get Box Real Status (Arqueo)
     */
    getCajasDisponiblesUsuario(codigoEmpresa: number, codigoSucursal: number, username: string, token: string): Observable<any[]> {
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('CAJAS_DISPONIBLES_USUARIO') || '/XPosConsultas/cajasDisponiblesUsuario'}`;
        const params = new HttpParams()
            .set('arg0', codigoEmpresa.toString())
            .set('arg1', codigoSucursal.toString())
            .set('arg2', username.toUpperCase());

        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            map(res => res.facArqueosCajas || [])
        );
    }

    /**
     * Step 3.1: Get Box Catalog
     */
    getCatalogoCajas(codigoEmpresa: number, token: string): Observable<any[]> {
        const url = `${this.getBaseUrl()}${this.config.getEndpoint('CAJAS') || '/XPosConsultas/cajas'}`;
        const params = new HttpParams().set('arg0', codigoEmpresa.toString());
        return this.http.get<any>(url, { headers: this.getHeaders(token), params }).pipe(
            map(res => res.facCajas || [])
        );
    }
}
