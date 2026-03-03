import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, catchError, delay, switchMap, map } from 'rxjs/operators';
import { StorageService } from './storage.service';
import { ConfigService } from './config.service';

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private storage = inject(StorageService);
    private http = inject(HttpClient);
    private config = inject(ConfigService);
    private readonly API_BASE = this.config.getApiUrl();
    private token: string | null = null;

    constructor() {
    }

    login(user?: string, pass?: string): Observable<any> {
        const auth = this.config.getAuth();
        const username = user || auth.user;
        const password = pass || auth.pass;
        const authHeader = 'Basic ' + btoa(`${username}:${password}`);
        const headers = new HttpHeaders().set('Authorization', authHeader);

        return this.http.post(`${this.API_BASE}/XPos/login`, {}, { headers }).pipe(
            tap((res: any) => {
                if (res?.accesToken) {
                    this.token = res.accesToken;
                    this.storage.saveLocal('ACCESS_TOKEN', res.accesToken);
                    console.log('[DataService] Token obtenido con éxito');
                }
            }),
            catchError(err => {
                console.error('[DataService] Error en el login', err);
                return of(null);
            })
        );
    }

    private getHeaders(): HttpHeaders {
        let headers = new HttpHeaders().set('Content-Type', 'application/json');

        // v68.0: Synchronize with AuthService key ('authToken')
        if (!this.token) {
            this.token = this.storage.loadLocal<string>('authToken') ||
                this.storage.loadLocal<string>('ACCESS_TOKEN');
        }

        if (this.token) {
            headers = headers.set('Authorization', `Bearer ${this.token}`);
        } else {
            console.warn('[DataService] No se encontró token en memoria ni en storage');
        }
        return headers;
    }

    getOrdenComparativo(numeroOrden: string): Observable<any[]> {
        return this.getOrdenDespacho(numeroOrden).pipe(
            switchMap(response => {
                const ordenes = response?.ordenesDespacho || [];
                if (ordenes.length === 0) return of([]);
                const cabecera = ordenes[0];
                return this.getDetallesOrdenDespacho(cabecera.numeroSolicitud, cabecera.numeroOrdenDespacho);
            }),
            map(response => {
                const detalles = response?.detalles || [];
                return detalles.map((d: any) => ({
                    item: d.codigoExistencia?.toString() || '',
                    nombre: d.nombreExistencia || 'SIN NOMBRE',
                    unidad: 'UND',
                    invBod: 0,
                    vtas: 0,
                    sLocal: 0,
                    suger: 0,
                    solicita: d.cantidad || 0,
                    despachado: 0,
                    color: 'naranja',
                    bulto: d.unidadesXCaja || 1,
                    lote: d.lote || '',
                    caducidad: d.caducidad || ''
                }));
            }),
            tap(data => {
                if (data.length > 0) {
                    this.storage.saveLocal(`ORDER_CACHE_${numeroOrden}`, data);
                    this.storage.saveLocal('LAST_ORDER_NUMBER', numeroOrden);
                }
            }),
            catchError(err => {
                const cached = this.storage.loadLocal<any[]>(`ORDER_CACHE_${numeroOrden}`);
                return of(cached || []);
            })
        );
    }

    executeAction<T>(action: string, params: any = {}): Observable<T> {
        switch (action) {
            case 'GET_ORDER_PRODUCTS':
                return this.getOrdenComparativo(params.orderNumber) as Observable<T>;
            case 'GET_ORDEN_DESPACHO':
                return this.getOrdenDespacho(params.numero) as Observable<T>;
            case 'GET_DETALLES_ORDEN':
                return this.getDetallesOrdenDespacho(params.solicitud, params.orden) as Observable<T>;
            case 'GET_TRANSFERENCIA_PRODUCTS':
                return this.getTransferenciaProducts(params.numero) as Observable<T>;
            case 'GET_LABORATORIO':
                return this.getMockLaboratorio(params.codigo) as Observable<T>;
            case 'UPDATE_ORDEN_DETALLES':
                return this.actualizarDetallesOrdenDespacho(params.payload) as Observable<T>;
            case 'GET_ORDENES_DESPACHO_LIST':
                return this.getOrdenesDespachoList(params.empresa, params.filtro, params.valor, params.pagina) as Observable<T>;
            default:
                return of(null as any);
        }
    }

    getOrdenDespacho(numero: string): Observable<any> {
        const params = {
            arg0: 20, // Default empresa
            arg1: 'numeroSolicitud-numeroOrdenDespacho',
            arg2: numero,
            arg3: 0,
            arg4: 20
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/ordenesDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando ordenesDespacho', err);
                return of({ mensaje: 'ERROR', ordenesDespacho: [] });
            })
        );
    }

    getOrdenesDespachoList(empresa: number, filtro: string, valor: string, pagina: number = 0): Observable<any> {
        let params = new HttpParams()
            .set('arg0', (empresa || 20).toString())
            .set('arg1', '') // v102.0: Vacío por defecto para traer todo
            .set('arg2', '') // v102.0: Vacío por defecto
            .set('arg3', pagina.toString())
            .set('arg4', '20');

        if (filtro && filtro.trim() !== '') {
            // v100.0: Estandarizar arg1 a la clave compuesta según instrucción del usuario
            params = params.set('arg1', 'numeroSolicitud-numeroOrdenDespacho');
            params = params.set('arg2', valor || '');
        }

        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/ordenesDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando lista ordenesDespacho', err);
                return of({
                    mensaje: 'ERROR',
                    error: `Status: ${err.status} - ${err.message}`,
                    ordenesDespacho: []
                });
            })
        );
    }

    getDetallesOrdenDespacho(solicitud: number, orden: number): Observable<any> {
        const params = {
            arg0: 20, // Default empresa
            arg1: solicitud,
            arg2: orden
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/detallesOrdenDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando detallesOrdenDespacho', err);
                return of({ mensaje: 'ERROR', detalles: [] });
            })
        );
    }

    private getTransferenciaProducts(numero: string): Observable<any[]> {
        return of([]);
    }

    private getMockLaboratorio(codigo: string): Observable<any> {
        return of({
            codigo: codigo,
            nombre: "LABORATORIO " + codigo,
            vendedor: "09999",
            porcentaje: 0.00,
            ingreso: "E",
            despacho: "D"
        }).pipe(delay(300));
    }

    actualizarDetallesOrdenDespacho(payload: any): Observable<any> {
        const headers = this.getHeaders();
        return this.http.post(`${this.API_BASE}/XPos/actualizarDetallesOrdenDespacho`, payload, { headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error en actualizarDetallesOrdenDespacho', err);
                const errorMsg = err.error?.mensaje || err.message || 'Error desconocido en servidor';
                return of({ mensaje: 'ERROR', error: errorMsg });
            })
        );
    }
}
