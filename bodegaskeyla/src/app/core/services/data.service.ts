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
        // v150.0: Reusar token si ya existe (Optimización para equipos antiguos)
        if (!user && !pass && this.token) {
            return of({ accesToken: this.token });
        }

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
                }
            }),
            catchError(err => {
                const errorBody = err.error;
                let errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error de conexión';
                if (errorBody?.errorSistemas) {
                    errorMsg = `<strong>MENSAJE:</strong> ${errorMsg}<br/><br/><strong>DETALLE SISTEMA:</strong> ${errorBody.errorSistemas}`;
                }
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
        return user?.empresa?.codigoEmpresa || 0;
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
                return detalles.map((d: any) => {
                    // v170.0: Priorizar el código de barras dentro del arreglo sciExistenciasXCodBarras[0]
                    const barcode = d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString()
                        || d.codigoBarras?.toString()
                        || '';

                    return {
                        item: barcode,
                        codigoExistencia: d.codigoExistencia?.toString() || '',
                        codigoBarras: barcode,
                        nombre: d.nombreExistencia || 'SIN NOMBRE',
                        unidad: d.tipoMedida || 'UND', // v170.1: Usar tipoMedida del API
                        invBod: d.saldoActualEnCajas || d.stock || 0,
                        vtas: 0,
                        sLocal: 0,
                        suger: 0,
                        solicita: d.cantidad || 0,
                        despachado: 0,
                        color: 'naranja',
                        bulto: d.unidadesXCaja || 1,
                        lote: d.lote || '',
                        caducidad: d.caducidad || '',
                        laboratorio: d.fabricante || ''
                    };
                });
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
                return this.getOrdenDespacho(params.numero, params.fechaDesde, params.fechaHasta) as Observable<T>;
            case 'GET_DETALLES_ORDEN':
                return this.getDetallesOrdenDespacho(params.solicitud, params.orden) as Observable<T>;
            case 'GET_TRANSFERENCIA_PRODUCTS':
                return this.getTransferenciaProducts(params.numero) as Observable<T>;
            case 'GET_LABORATORIO':
                return this.getMockLaboratorio(params.codigo) as Observable<T>;
            case 'UPDATE_ORDEN_DETALLES':
                return this.finalizarOrdenDespacho(params.params) as Observable<T>;
            case 'ACTUALIZAR_ORDEN_DETALLES':
                return this.actualizarDetallesOrdenDespacho(params.payload) as Observable<T>;
            case 'GET_ORDENES_DESPACHO_LIST':
                return this.getOrdenesDespachoList(params.empresa, params.filtro, params.valor, params.pagina, params.fechaDesde, params.fechaHasta, params.diaEmbarque) as Observable<T>;
            case 'GET_TIPOS_BULTOS':
                return this.getTiposBultos() as Observable<T>;
            case 'GET_LOTES_EXISTENCIA_ORDEN':
                return this.getLotesExistenciaOrdenDespacho(params.solicitud, params.orden) as Observable<T>;
            case 'GET_LOTES_EXISTENCIA':
                return this.getLotesExistencia(params.codigoExistencia, params.nombreExistencia) as Observable<T>;
            case 'GET_DIAS_SEMANA':
                return this.getDiasSemana() as Observable<T>;
            case 'IMPRIMIR_TIRILLA':
                return this.imprimirTirilla(params.empresa, params.secuencia) as Observable<T>;
            default:
                return of(null as any);
        }
    }

    private getDiasSemana(): Observable<any> {
        const params = {
            arg0: this.getCurrentCompany()
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/diasSemana`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando diasSemana', err);
                return of({ mensaje: 'Error cargando días', isError: true, diasSemana: [] });
            })
        );
    }

    getOrdenDespacho(numero: string, fechaDesde?: string, fechaHasta?: string): Observable<any> {
        const user = this.authService?.getStoredUser();
        const username = user?.username || 'DESCONOCIDO';

        const formatToAPI = (dateStr?: string) => {
            if (!dateStr || dateStr.trim() === '') return '';
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                return `${parts[2]}/${parts[1]}/${parts[0]}`; // YYYY-MM-DD -> DD/MM/YYYY
            }
            return dateStr;
        };

        const params = {
            arg0: this.getCurrentCompany(),
            arg1: username,
            arg2: 'numeroSolicitud-numeroOrdenDespacho',
            arg3: numero,
            arg4: 0,
            arg5: 20,
            arg6: formatToAPI(fechaDesde),
            arg7: formatToAPI(fechaHasta)
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/ordenesDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando ordenesDespacho', err);
                const errorBody = err.error;
                let errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error consultando orden';
                if (errorBody?.errorSistemas) {
                    errorMsg = `<strong>MENSAJE:</strong> ${errorMsg}<br/><br/><strong>DETALLE SISTEMA:</strong> ${errorBody.errorSistemas}`;
                }
                return of({ mensaje: errorMsg, isError: true, ordenesDespacho: [] });
            })
        );
    }

    getOrdenesDespachoList(empresa: number, filtro: string, valor: string, pagina: number = 0, fechaDesde?: string, fechaHasta?: string, diaEmbarque?: string): Observable<any> {
        const user = this.authService?.getStoredUser();
        const username = user?.username || 'DESCONOCIDO';

        const formatToAPI = (dateStr?: string) => {
            if (!dateStr || dateStr.trim() === '') return '';
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                return `${parts[2]}/${parts[1]}/${parts[0]}`; // YYYY-MM-DD -> DD/MM/YYYY
            }
            return dateStr;
        };

        let params = new HttpParams()
            .set('arg0', (empresa || this.getCurrentCompany()).toString())
            .set('arg1', username)
            .set('arg2', '')
            .set('arg3', '')
            .set('arg4', pagina.toString())
            .set('arg5', '20')
            .set('arg6', formatToAPI(fechaDesde))
            .set('arg7', formatToAPI(fechaHasta));

        if (diaEmbarque && diaEmbarque !== 'TODOS') {
            params = params.set('arg8', diaEmbarque);
        }

        if (valor && valor.trim() !== '') {
            // v110.0: Requerimiento mandatorio Keyla: arg2 siempre es la clave compuesta si hay valor
            params = params.set('arg2', 'numeroSolicitud-numeroOrdenDespacho');
            params = params.set('arg3', valor.trim());
        } else {
             // Si no hay valor, igual mandamos la clave compuesta vacía, como en Postman
             params = params.set('arg2', 'numeroSolicitud-numeroOrdenDespacho');
        }

        const headers = this.getHeaders();
        const url_final = `${this.API_BASE}/XPosConsultas/ordenesDespacho`;

        /* v150.0: Logs deshabilitados para optimizar equipos antiguos
        console.log(`[DataService] 📡 REQUEST: ${url_final}`, {
            arg0: params.get('arg0'),
            arg1: params.get('arg1'),
            arg2: params.get('arg2'),
            arg3: params.get('arg3'),
            arg4: params.get('arg4'),
            arg5: params.get('arg5'),
            arg6: params.get('arg6'),
            arg7: params.get('arg7')
        });
        */

        return this.http.get(url_final, { params, headers }).pipe(
            // tap(res => console.log('[DataService] 📥 RESPONSE:', res)),
            catchError(err => {
                console.error('[DataService] Error consultando lista ordenesDespacho', err);
                const errorBody = err.error;
                let errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error consultando listado';
                if (errorBody?.errorSistemas) {
                    errorMsg = `<strong>MENSAJE:</strong> ${errorMsg}<br/><br/><strong>DETALLE SISTEMA:</strong> ${errorBody.errorSistemas}`;
                }
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
                const errorBody = err.error;
                let errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error consultando detalles';
                if (errorBody?.errorSistemas) {
                    errorMsg = `<strong>MENSAJE:</strong> ${errorMsg}<br/><br/><strong>DETALLE SISTEMA:</strong> ${errorBody.errorSistemas}`;
                }
                return of({ mensaje: errorMsg, isError: true, detalles: [] });
            })
        );
    }

    getLotesExistenciaOrdenDespacho(solicitud: number, orden: number): Observable<any> {
        const params = {
            arg0: this.getCurrentCompany(),
            arg1: solicitud,
            arg2: orden
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/lotesExistenciaXOrdenDespacho`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando lotesExistenciaXOrdenDespacho', err);
                const errorBody = err.error;
                let errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error consultando lotes';
                if (errorBody?.errorSistemas) {
                    errorMsg = `<strong>MENSAJE:</strong> ${errorMsg}<br/><br/><strong>DETALLE SISTEMA:</strong> ${errorBody.errorSistemas}`;
                }
                return of({ mensaje: errorMsg, isError: true, lotes: [] });
            })
        );
    }

    /**
     * v200.4: Consulta de lotes para un ítem específico (Uso bajo demanda)
     */
    getLotesExistencia(codigoExistencia: string, nombreExistencia: string): Observable<any> {
        const params = {
            arg0: this.getCurrentCompany(),
            arg1: codigoExistencia || '',
            arg2: nombreExistencia || ''
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}/XPosConsultas/lotesExistencia`, { params, headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error consultando lotesExistencia individual', err);
                return of({ mensaje: err.message, isError: true, detalles: [] });
            })
        );
    }

    private getTiposBultos(): Observable<any> {
        const params = {
            arg0: this.getCurrentCompany(),
            arg1: '',
            arg2: '',
            arg3: 0,
            arg4: 100
        };
        const headers = this.getHeaders();
        return this.http.get(`${this.API_BASE}${this.config.getEndpoint('TIPOS_BULTOS') || '/XPosConsultas/tiposBultos'}`, { params, headers }).pipe(
            catchError(err => of({ mensaje: err.message, isError: true, tiposBultos: [] }))
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
                const errorBody = err.error;
                let errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error actualizando detalles';
                if (errorBody?.errorSistemas) {
                    errorMsg = `<strong>MENSAJE:</strong> ${errorMsg}<br/><br/><strong>DETALLE SISTEMA:</strong> ${errorBody.errorSistemas}`;
                }
                return of({ mensaje: errorMsg, isError: true });
            })
        );
    }

    /**
     * v105.0: Servicio de finalización actualizado (POST Body JSON)
     */
    finalizarOrdenDespacho(payload: any): Observable<any> {
        const headers = this.getHeaders();
        // El backend ahora espera un JSON body completo
        const finalBody = {
            codigoEmpresa: this.getCurrentCompany(),
            numeroSolicitud: payload.solicitud,
            numeroOrdenDespacho: payload.orden,
            codigoUsuario: this.authService?.getStoredUser()?.username || 'DESCONOCIDO',
            tiposBultosXOrdenDespacho: payload.bultos || []
        };

        return this.http.post(`${this.API_BASE}/XPos/finalizarOrdenDespacho`, finalBody, { headers }).pipe(
            catchError(err => {
                console.error('[DataService] Error en finalizarOrdenDespacho', err);
                const errorBody = err.error;
                let errorMsg = errorBody?.mensaje || errorBody?.causa || err.message || 'Error de conexión';
                if (errorBody?.errorSistemas) {
                    errorMsg = `<strong>MENSAJE:</strong> ${errorMsg}<br/><br/><strong>DETALLE SISTEMA:</strong> ${errorBody.errorSistemas}`;
                }
                return of({ mensaje: errorMsg, isError: true });
            })
        );
    }

    /**
     * v2.0: Servicio para obtener la tirilla formateada para la impresora térmica
     */
    imprimirTirilla(codigoEmpresa: number, secuencia: number): Observable<any> {
        const headers = this.getHeaders();
        const params = {
            arg0: codigoEmpresa,
            arg1: secuencia
        };

        console.log('📡 [DataService] Solicitando Tirilla para impresión...', { params });

        return this.http.post(`${this.API_BASE}/XPos/imprimirTirilla`, {}, { headers, params }).pipe(
            tap(res => console.log('✅ [DataService] Respuesta Tirilla:', res)),
            catchError(err => {
                console.error('[DataService] Error en imprimirTirilla', err);
                return of({ mensaje: 'Error al obtener formato de impresión', isError: true });
            })
        );
    }
}
