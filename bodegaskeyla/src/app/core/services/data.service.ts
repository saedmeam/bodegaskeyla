import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, catchError, delay, switchMap, map } from 'rxjs/operators';
import { StorageService } from './storage.service';
import { ConfigService } from './config.service';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private storage = inject(StorageService);
    private http = inject(HttpClient);
    private config = inject(ConfigService);

    // v104.5: Use AuthService for dynamic company/branch context
    private authService = inject(AuthService, { optional: true });

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
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error de conexión';
                return of({ mensaje: errorMsg, isError: true });
            })
        );
    }

    private getHeaders(): HttpHeaders {
        let headers = new HttpHeaders().set('Content-Type', 'application/json');

        if (!this.token) {
            // Priority: direct token > Storage Key 'authToken' > deprecated 'ACCESS_TOKEN'
            this.token = this.authService?.getStoredToken() ||
                this.storage.loadLocal<string>('authToken') ||
                this.storage.loadLocal<string>('ACCESS_TOKEN');
        }

        if (this.token) {
            headers = headers.set('Authorization', `Bearer ${this.token}`);
        }
        return headers;
    }

    private getCurrentCompany(): number {
        const user = this.authService?.getStoredUser();
        return user?.empresa?.codigoEmpresa || 20; // Fallback to 20 if not logged in
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
                // v104.5: El servicio anterior se comenta pero se mantiene por si se requiere
                // return this.actualizarDetallesOrdenDespacho(params.payload) as Observable<T>;
                return this.finalizarOrdenDespacho(params.params) as Observable<T>;
            case 'GET_ORDENES_DESPACHO_LIST':
                return this.getOrdenesDespachoList(params.empresa, params.filtro, params.valor, params.pagina) as Observable<T>;
            default:
                return of(null as any);
        }
    }

    getOrdenDespacho(numero: string): Observable<any> {
        const user = this.authService?.getStoredUser();
        const username = user?.username || 'DESCONOCIDO';

        const params = {
            arg0: this.getCurrentCompany(),
            arg1: username,
            arg2: 'numeroSolicitud-numeroOrdenDespacho',
            arg3: numero,
            arg4: 0,
            arg5: 20
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/ordenesDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando ordenesDespacho', err);
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error consultando orden';
                return of({ mensaje: errorMsg, isError: true, ordenesDespacho: [] });
            })
        );
    }

    getOrdenesDespachoList(empresa: number, filtro: string, valor: string, pagina: number = 0): Observable<any> {
        const user = this.authService?.getStoredUser();
        const username = user?.username || 'DESCONOCIDO';

        let params = new HttpParams()
            .set('arg0', (empresa || this.getCurrentCompany()).toString())
            .set('arg1', username)
            .set('arg2', '')
            .set('arg3', '')
            .set('arg4', pagina.toString())
            .set('arg5', '20');

        if (filtro && filtro.trim() !== '') {
            // v100.0: Estandarizar arg2 a la clave compuesta según instrucción del usuario (desplazado por arg1:user)
            params = params.set('arg2', 'numeroSolicitud-numeroOrdenDespacho');
            params = params.set('arg3', valor || '');
        }

        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/ordenesDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando lista ordenesDespacho', err);
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error consultando listado';
                return of({
                    mensaje: errorMsg,
                    isError: true,
                    ordenesDespacho: []
                });
            })
        );
    }

    getDetallesOrdenDespacho(solicitud: number, orden: number): Observable<any> {
        const params = {
            arg0: this.getCurrentCompany(),
            arg1: solicitud,
            arg2: orden
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/detallesOrdenDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando detallesOrdenDespacho', err);
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error consultando detalles';
                return of({ mensaje: errorMsg, isError: true, detalles: [] });
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
                const errorMsg = err.error?.mensaje || err.error?.causa || err.message || 'Error actualizando detalles';
                return of({ mensaje: errorMsg, isError: true });
            })
        );
    }

    /**
     * v104.5: Nuevo servicio de finalización de orden de despacho
     * URL: http://test.neu360.com/X-uitWSRestMagkaz2/XPos/finalizarOrdenDespacho
     */
    finalizarOrdenDespacho(params: { solicitud: number, orden: number }): Observable<any> {
        const user = this.authService?.getStoredUser();
        const username = user?.username || 'DESCONOCIDO';

        const queryParams = {
            arg0: this.getCurrentCompany(),
            arg1: params.solicitud,
            arg2: params.orden,
            arg3: username // v104.5: Keep as arg4 if legacy backend expects it there too, but arg1 is now primary
        };

        const headers = this.getHeaders();
        // Nota: El usuario especificó una URL que parece estar fuera del API_BASE estándar,
        // pero seguiremos el patrón de inyectar los parámetros solicitados con el nuevo orden.
        return this.http.get(`${this.API_BASE}/XPos/finalizarOrdenDespacho`, { params: queryParams, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error en finalizarOrdenDespacho', err);
                const errorBody = err.error;
                const errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error de conexión';
                return of({ mensaje: errorMsg, isError: true });
            })
        );
    }
}
