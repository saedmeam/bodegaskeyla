import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, catchError, delay, switchMap, map } from 'rxjs/operators';
import { StorageService } from './storage.service';
import { REST_CONFIG } from '../config/rest.config';

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private storage = inject(StorageService);
    private http = inject(HttpClient);
    private readonly API_BASE = REST_CONFIG.API_BASE;
    private token: string | null = null;

    constructor() {
        // v52.0: Limpieza total de cache persistente en Chromium para forzar uso de API real
        try {
            localStorage.clear();
            console.log('[DataService] LocalStorage purgado con éxito.');
        } catch (e) { }
    }

    /**
     * MÉTODO DE AUTENTICACIÓN (LOGIN)
     * Obtiene el accesToken usando Basic Auth desde la configuración centralizada.
     */
    login(user: string = REST_CONFIG.AUTH.USER, pass: string = REST_CONFIG.AUTH.PASS): Observable<any> {
        const authHeader = 'Basic ' + btoa(`${user}:${pass}`);
        const headers = new HttpHeaders().set('Authorization', authHeader);

        return this.http.post(`${this.API_BASE}/XPos/login`, {}, { headers }).pipe(
            tap((res: any) => {
                if (res?.accesToken) {
                    this.token = res.accesToken;
                    this.storage.saveLocal('ACCESS_TOKEN', res.accesToken); // v56.0: Persistencia
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

        // v56.0: Recuperar token si se perdió el estado en memoria
        if (!this.token) {
            this.token = this.storage.loadLocal<string>('ACCESS_TOKEN');
        }

        if (this.token) {
            headers = headers.set('Authorization', `Bearer ${this.token}`);
        }
        return headers;
    }

    /**
     * MÉTODO PARAMETRIZABLE (GET)
     * Consulta la data para el comparativo de orden.
     * Implementa lógica Offline-First: Guarda en LocalStorage/Archivo tras consultar.
     */
    getOrdenComparativo(numeroOrden: string): Observable<any[]> {
        console.log(`[DataService] Consultando Comparativo Real para Orden: ${numeroOrden}`);

        return this.getOrdenDespacho(numeroOrden).pipe(
            switchMap(response => {
                const ordenes = response?.ordenesDespacho || [];
                if (ordenes.length === 0) return of([]);

                const cabecera = ordenes[0];
                return this.getDetallesOrdenDespacho(cabecera.numeroSolicitud, cabecera.numeroOrdenDespacho);
            }),
            map(response => {
                const detalles = response?.detalles || [];
                // Mapeo al modelo de la UI (v51.0)
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
                    lote: d.lote || '', // Si viene en la API
                    caducidad: d.caducidad || '' // Si viene en la API
                }));
            }),
            tap(data => {
                if (data.length > 0) {
                    this.storage.saveLocal(`ORDER_CACHE_${numeroOrden}`, data);
                    this.storage.saveLocal('LAST_ORDER_NUMBER', numeroOrden);
                }
            }),
            catchError(err => {
                console.warn('[DataService] Error consultando servicio real. Intentando cache...');
                const cached = this.storage.loadLocal<any[]>(`ORDER_CACHE_${numeroOrden}`);
                return of(cached || []);
            })
        );
    }

    /**
     * Punto de entrada único para ejecutar acciones de datos.
     */
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
            default:
                return of(null as any);
        }
    }

    /**
     * CATÁLOGO DE PRUEBA (MOCK)
     * Esta información se cargará por default mientras se integra el servicio REST.
     */
    private getMockOrderProducts(orderNumber: string): Observable<any[]> {
        const products: any[] = [];
        return of(products);
    }

    /**
     * Consulta la cabecera de la orden de despacho (v45.0)
     */
    getOrdenDespacho(numero: string): Observable<any> {
        const params = {
            arg0: REST_CONFIG.EMPRESA_DEFAULT,
            arg1: 'numeroSolicitud',
            arg2: numero,
            arg3: 0,
            arg4: 10
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/ordenesDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando ordenesDespacho', err);
                return of({ mensaje: 'ERROR', ordenesDespacho: [] });
            })
        );
    }

    /**
     * Consulta el detalle de la orden de despacho (v45.0)
     */
    getDetallesOrdenDespacho(solicitud: number, orden: number): Observable<any> {
        const params = {
            arg0: REST_CONFIG.EMPRESA_DEFAULT,
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
        const products: any[] = [];
        return of(products);
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

    /**
     * MÉTODO POST: Actualiza detalles de la orden (v55.0)
     */
    actualizarDetallesOrdenDespacho(payload: any): Observable<any> {
        const headers = this.getHeaders();
        console.log('[DataService] POST Payload:', JSON.stringify(payload));
        return this.http.post(`${this.API_BASE}/XPos/actualizarDetallesOrdenDespacho`, payload, { headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error en actualizarDetallesOrdenDespacho', err);
                // v56.0: Extraer mensaje de error más descriptivo
                const errorMsg = err.error?.mensaje || err.message || 'Error desconocido en servidor';
                return of({ mensaje: 'ERROR', error: errorMsg });
            })
        );
    }
}
