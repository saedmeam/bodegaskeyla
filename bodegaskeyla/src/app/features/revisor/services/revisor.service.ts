import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Product } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';
import { StorageService } from '../../../core/services/storage.service';
import { switchMap, map, tap, catchError } from 'rxjs/operators';
import { of, throwError, Observable, firstValueFrom, from } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { LoadingService } from '../../../core/services/loading.service';

@Injectable({
    providedIn: 'root'
})
export class RevisorService {
    // Signals principales del proceso
    public ordenProductos = signal<Product[]>([]);
    public escaneados = signal<Product[]>([]);
    public orderMetadata = signal<any>(null);

    public getOrdenesDespachoList(empresa: number, filtro: string, valor: string, pagina: number = 0, fechaDesde?: string, fechaHasta?: string, diaEmbarque?: string) {
        return this.dataService.executeAction<any>('GET_ORDENES_DESPACHO_LIST', { empresa, filtro, valor, pagina, fechaDesde, fechaHasta, diaEmbarque });
    }

    public getTiposBultos() {
        return this.dataService.executeAction<any>('GET_TIPOS_BULTOS');
    }

    private currentOrderNumber: string | null = null;
    private isLoading = false; // v62.0: Prevenir autoguardado durante la carga inicial

    // FLAG DE BÚSQUEDA EXTERNA (v30.0)
    // Cuando esté activo, permitirá buscar productos fuera de la orden original vía REST.
    private enableExternalLookup = false;

    // Diccionario de Unidades Parametrizadas
    private readonly UNIT_DESCRIPTIONS: Record<string, string> = {
        'C': 'CAJA',
        'P': 'PAQUETE',
        'F': 'FRASCO'
    };

    constructor(
        private dataService: DataService,
        private storage: StorageService,
        private authService: AuthService,
        private loadingService: LoadingService
    ) {
        // v62.0: Autoguardado REACTIVO. Cualquier cambio en los Signals activa la persistencia.
        effect(() => {
            const esc = this.escaneados();
            if (!this.isLoading && this.currentOrderNumber && esc.length > 0) {
                console.log(`[RevisorService] Effect: Cambio detectado en escaneados (${esc.length}). Guardando...`);
                this.persistCurrentState();
            }
        });
    }

    /**
     * MÉTODO ORQUESTADOR (Action Executor)
     * Centraliza el proceso de negocio solicitado por el componente.
     */
    public executeProcess(action: 'LOAD' | 'SCAN' | 'UPDATE_QTY' | 'SAVE_SESSION' | 'SIMULATE_DISCREPANCIES' | 'SORT_PRIORITY' | 'API_UPDATE', payload?: any): any {
        switch (action) {
            case 'LOAD':
                return this.loadOrder(payload.orderNumber, payload.fechaDesde, payload.fechaHasta, payload.forceRefresh);
            case 'SCAN':
                return this.processBarcode(payload.barcode, payload.lote, payload.caducidad, payload.lineaDetalle);
            case 'UPDATE_QTY':
                this.updateQuantity(payload.item, payload.qty);
                break;
            case 'SAVE_SESSION':
                this.persistCurrentState();
                break;
            case 'SIMULATE_DISCREPANCIES':
                this.simularDiscrepancias();
                break;
            case 'SORT_PRIORITY':
                this.ordenarPorEstado();
                break;
            case 'API_UPDATE':
                return this.updateDetallesReal(payload.tipo, payload.itemCode);
        }
        return null;
    }

    private loadOrder(orderNumber: string, fechaDesde?: string, fechaHasta?: string, forceRefresh: boolean = false): Observable<boolean> {
        // v200.1: BLINDAJE DE MEMORIA - Detectar cambio de orden para purgar estado previo
        const isDifferentOrder = this.currentOrderNumber && String(this.currentOrderNumber) !== String(orderNumber);

        if (isDifferentOrder) {
            console.log(`[RevisorService] 🧹 Detectado cambio de orden (${this.currentOrderNumber} -> ${orderNumber}). Limpiando memoria.`);
            this.escaneados.set([]);
            this.ordenProductos.set([]);
            this.orderMetadata.set(null);
        }

        this.currentOrderNumber = orderNumber;
        const storageKey = `REVISION_SESSION_${orderNumber}`;
        const savedSession = this.storage.loadLocal<any>(storageKey);

        // v104.9: OFFLINE-FIRST. Cargamos la sesión local INMEDIATAMENTE si existe.
        if (savedSession && String(savedSession.orderNumber) === String(orderNumber)) {
            console.log(`[RevisorService] 🏠 Cargando sesión local inmediata para: ${orderNumber}`);
            this.ordenProductos.set(savedSession.ordenProductos || []);
            this.escaneados.set(savedSession.escaneados || []);
            this.orderMetadata.set(savedSession.orderMetadata || null);
            
            // Si no es forzado, ya terminamos.
            if (!forceRefresh) {
                this.isLoading = false;
                return of(true);
            }
        }

        this.loadingService.show();
        this.isLoading = true; // Bloqueamos autoguardado reactivo durante el fetch

        // Preservamos escaneados previos si estamos forzando refresh de la MISMA orden (v160.11 / v200.1)
        // O si venimos de otra orden, recuperamos su progreso de la sesión guardada.
        let previousEscaneados: any[] = [];
        if (forceRefresh && !isDifferentOrder) {
            previousEscaneados = [...this.escaneados()];
        } else if (savedSession && savedSession.escaneados) {
            console.log(`[RevisorService] ♻️ Recuperando progreso guardado para ${orderNumber}`);
            previousEscaneados = [...savedSession.escaneados];
        }

        // 2. Si es forzado o no hay sesión, consultamos la API Real
        return this.dataService.login()
            .pipe(
                switchMap(loginRes => {
                    if (!loginRes || loginRes.isError) {
                        console.error('[RevisorService] ❌ Fallo en autenticación:', loginRes?.mensaje);
                        this.loadingService.hide();
                        return throwError(() => new Error(loginRes?.mensaje || 'No se pudo autenticar'));
                    }
                    console.log('[RevisorService] 🔑 Sesión iniciada.');

                    const meta = this.orderMetadata();
                    // v104.9: Corregido match exacto para evitar colisiones entre órdenes con prefijos similares (ej. 96-12 vs 96-2)
                    const currentFullKey = meta ? (meta.numeroSolicitudOrdenDespacho || `${meta.numeroSolicitud}-${meta.numeroOrdenDespacho}`) : null;
                    
                    if (meta && currentFullKey === orderNumber) {
                        console.log('[RevisorService] ⚡ Metadata existente detectada. Saltando consulta de cabecera.');
                        return of({ isFromCache: true, metadata: meta });
                    }

                    console.log('[RevisorService] 🔍 Consultando cabecera de orden en el servidor...');
                    return this.dataService.executeAction<any>('GET_ORDEN_DESPACHO', {
                        numero: orderNumber,
                        fechaDesde: fechaDesde,
                        fechaHasta: fechaHasta
                    }).pipe(map(res => ({ isFromCache: false, headerRes: res })));
                }),
                switchMap((result: any) => {
                    if (result.isFromCache) {
                        const m = result.metadata;
                        return this.dataService.getDetallesOrdenDespacho(m.numeroSolicitud, m.numeroOrdenDespacho);
                    }

                    const headerRes = result.headerRes;
                    if (!headerRes || headerRes.isError || !headerRes?.ordenesDespacho || headerRes.ordenesDespacho.length === 0) {
                        const msg = headerRes?.mensaje || 'La orden no existe o requiere rango de fechas para búsqueda inicial.';
                        console.error('[RevisorService] ❌ Orden no encontrada:', msg);
                        this.loadingService.hide();
                        return throwError(() => new Error(msg));
                    }

                    console.log('[RevisorService] 📑 Cabecera obtenida. Procesando metadata y detalles...');
                    const cabecera = headerRes.ordenesDespacho[0];
                    const cab_solicitud = cabecera.numeroSolicitud || 1;
                    const cab_orden = cabecera.numeroOrdenDespacho || 1;
                    const user = this.authService.getStoredUser();

                    this.orderMetadata.set({
                        codigoEmpresa: cabecera.codigoEmpresa || user?.empresa?.codigoEmpresa || 1,
                        bodega: cabecera.codigoBodega?.toString() || '001',
                        movimiento: '057',
                        nombre: 'REPOSICIÓN AUTOMÁTICA',
                        numeroSolicitud: cab_solicitud,
                        numeroOrdenDespacho: cab_orden,
                        concepto: `Orden #${orderNumber} | Solicitud: ${cab_solicitud}`,
                        estado: cabecera.codigoEstado,
                        sucursalDestino: cabecera.nombreSucursal || 'DESTINO',
                        nombreSucursalOrigen: cabecera.nombreSucursalOrigen || 'Origen N/A',
                        nombreSucursalDestino: cabecera.nombreSucursalDestino || 'Destino N/A'
                    });

                    return this.dataService.getDetallesOrdenDespacho(cab_solicitud, cab_orden);
                }),
                switchMap(detRes => {
                    if (detRes?.isError) {
                        console.error('[RevisorService] ❌ Error en detalles de orden:', detRes?.mensaje);
                        throw new Error(detRes?.mensaje || 'Error consultando detalles');
                    }
                    console.log(`[RevisorService] 📦 Productos obtenidos (${detRes?.detalles?.length || 0}). Mapeando lista...`);
                    const detalles = detRes?.detalles || [];
                    const newProducts = detalles.map((d: any, index: number) => {
                        let barcode = d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString()
                            || d.codigoBarras?.toString()
                            || '';
                        
                        // v104.9: Gestión de Productos sin Código de Barras
                        // Si no hay barcode, usamos el codigoExistencia como base para la identificación
                        if (!barcode || barcode.trim() === '') {
                            barcode = d.codigoExistencia?.toString()?.trim() || `REF-${index}-${Date.now()}`;
                        }

                        // v104.9: Creamos un ID ÚNICO combinando código y lineaDetalle
                        // Esto evita que productos con el mismo código pero distinta línea se sobreescriban.
                        const uniqueId = `${barcode}|${d.lineaDetalle}`;

                        const p: Product = {
                            item: uniqueId,
                            codigoExistencia: d.codigoExistencia?.toString() || '',
                            codigoBarras: barcode,
                            nombre: d.nombreExistencia || 'SIN NOMBRE',
                            unidad: d.tipoMedida || 'U/C',
                            solicita: d.cantidad || d.cantidad || 0,
                            invBod: d.saldoActualEnCajas || d.stock || 0,
                            // v104.9: Si la orden ya está procesada (DP/DT), cargamos lo que se despachó realmente
                            despachado: (this.orderMetadata()?.estado !== 'ING') ? (d.cantidadADespachar || d.cantidadUnidadMedidaStockB || 0) : 0,
                            color: (this.orderMetadata()?.estado !== 'ING') ? 'negro' : 'naranja',
                            bulto: d.unidadesXCaja || 1,
                            lote: d.lote || '',
                            caducidad: d.caducidad || '',
                            laboratorio: d.fabricante || '',
                            lineaDetalle: d.lineaDetalle,
                            estado: d.codigoEstado,
                            unidadesXCaja: d.unidadesXCaja || 0,
                            cantidad: d.cantidad || 0,
                            cantidadUnidades: d.cantidadUnidades || 0,
                            grupoUnidadMedidaStockBase: d.grupoUnidadMedidaStockBase || null,
                            unidadMedidaStockBase: d.unidadMedidaStockBase || null,
                            cantidadUnidadMedidaStockB: d.cantidadUnidadMedidaStockB || 0,
                            cantidadBaseEquivalente: d.cantidadBaseEquivalente || 0,
                            observacion: d.observacion || 'API_REFRESH',
                            esActivo: d.esActivo || 'S',
                            vtas: d.vtas || 0,
                            sLocal: d.sLocal || d.saldoActualEnCajas || 0,
                            suger: d.suger || 0,
                            lotes: []
                        };
                        return p;
                    });

                    // PASO ADICIONAL (v2.7/v200.4): Consultar lotes masivos de forma SECUENCIAL
                    const meta = this.orderMetadata();
                    console.log('[RevisorService] 🛠️ Iniciando enriquecimiento secuencial de lotes...');
                    
                    return from(this.fetchBatchesForAll(newProducts, meta?.numeroSolicitud, meta?.numeroOrdenDespacho)).pipe(
                        map(() => {
                            this.ordenProductos.set(newProducts);

                            if (forceRefresh) {
                                const updatedEscaneados = previousEscaneados.map(esc => {
                                    // v104.9: Intento de recuperación por ID Único
                                    let matchingIndex = newProducts.findIndex((np: Product) => np.item === esc.item);
                                    
                                    // Si no coincide el ID (por cambio de versión), intentamos por barcode + lineaDetalle
                                    if (matchingIndex === -1 && esc.codigoBarras && esc.lineaDetalle !== undefined) {
                                        const derivedId = `${esc.codigoBarras}|${esc.lineaDetalle}`;
                                        matchingIndex = newProducts.findIndex((np: Product) => np.item === derivedId);
                                    }

                                    // Último recurso: por item (barcode antiguo) + lineaDetalle
                                    if (matchingIndex === -1 && esc.item && esc.lineaDetalle !== undefined) {
                                        const derivedId = `${esc.item}|${esc.lineaDetalle}`;
                                        matchingIndex = newProducts.findIndex((np: Product) => np.item === derivedId);
                                    }

                                    if (matchingIndex !== -1) {
                                        const matching = newProducts[matchingIndex];
                                        // v200.5: Sincronizar cantidades
                                        newProducts[matchingIndex].despachado = esc.despachado;
                                        newProducts[matchingIndex].color = esc.despachado === esc.solicita ? 'completado' : 'naranja';
                                        
                                        const updated = { ...newProducts[matchingIndex] };
                                        this.updateColorLogic(updated);
                                        return updated;
                                    }
                                    return esc;
                                });
                                this.escaneados.set(updatedEscaneados);
                                this.ordenProductos.set([...newProducts]);
                            } else {
                                this.escaneados.set([]);
                            }

                            this.isLoading = false;
                            this.loadingService.hide();
                            this.persistCurrentState();
                            return true;
                        })
                    );
                }),
                catchError(err => {
                    console.error('[RevisorService] 🔌 Error de red o API. Manteniendo estado local si existe.', err);
                    this.isLoading = false;
                    this.loadingService.hide();
                    
                    // v104.9: Si falló la API pero tenemos datos cargados de la sesión, no lanzamos error.
                    if (this.ordenProductos().length > 0) {
                        return of(true); 
                    }
                    return throwError(() => err);
                })
            );
    }

    private persistCurrentState() {
        if (!this.currentOrderNumber) return;

        const currentEscaneados = this.escaneados();
        const currentOrden = this.ordenProductos();

        const sessionState = {
            orderNumber: this.currentOrderNumber,
            ordenProductos: currentOrden,
            escaneados: currentEscaneados,
            orderMetadata: this.orderMetadata(),
            timestamp: new Date().toISOString(),
            version: '2.0'
        };

        const sessionKey = `REVISION_SESSION_${this.currentOrderNumber}`;
        const lotesCount = currentEscaneados.filter(p => p.lote).length;
        console.log(`[RevisorService] 💾 Persistiendo sesión local en ${sessionKey}. Escaneados: ${currentEscaneados.length}, Con Lote: ${lotesCount}`);
        
        // Guardamos en LocalStorage y archivo físico (.json) automáticamente
        this.storage.saveLocal(sessionKey, sessionState);
    }

    private async processBarcode(barcode: string, lote?: string, caducidad?: string, lineaDetalle?: number): Promise<{ product: Product, isAccumulated: boolean } | null> {
        if (!barcode) return null;

        // v104.8: AUDITORÍA PREVIA (Bloqueo por errores críticos pendientes)
        const currentErrors = this.getValidationErrors();
        if (currentErrors.some(e => e.isCritical)) {
            throw new Error("Pistoleo Bloqueado: Corrija las discrepancias (Sobrantes / Stock Insuficiente) antes de seguir escaneando.");
        }

        const searchText = barcode.trim().toUpperCase();

        // 1. Buscamos primero en lo que ya está en la grilla de "Despachados" para acumular
        // v104.9: Búsqueda priorizada por lineaDetalle -> Item -> Nombre
        const scannedIndex = this.escaneados().findIndex(p => {
            // v104.9: Prioridad 1: Coincidencia exacta por lineaDetalle (Desambiguación Total)
            if (lineaDetalle !== undefined && p.lineaDetalle === lineaDetalle) return true;
            
            // Prioridad 2: Coincidencia por Código de Existencia (v104.9)
            if (p.codigoExistencia?.trim().toUpperCase() === searchText) return true;

            // Prioridad 3: Coincidencia por Barcode (sin lineaDetalle)
            const cleanItem = p.item?.split('|')[0] || '';
            const itemMatch = cleanItem.toUpperCase() === searchText;
            const nameMatch = p.nombre?.trim().toUpperCase() === searchText;
            return itemMatch || nameMatch;
        });

        if (scannedIndex !== -1) {
            const product = { ...this.escaneados()[scannedIndex] };
            const newQty = (product.despachado || 0) + 1;

            // v160.14: VALIDACIONES DE LÍMITE (Acumulación)
            if (newQty > product.solicita) {
                throw new Error(`PRODUCTO EXCEDIDO: No puede despachar más de ${product.solicita} ${product.unidad} de este item.`);
            }
            if (newQty > Number(product.invBod || 0)) {
                throw new Error(`STOCK INSUFICIENTE: Solo hay ${product.invBod} en bodega. Corrija o reporte falta de stock.`);
            }

            product.despachado = newQty;
            
            // v200.2: Sincronización automática de lote único en acumulación (Captura 2)
            if (product.lotes && product.lotes.length === 1) {
                product.lotes[0].despachado = newQty;
            }

            const originalIndex = this.ordenProductos().findIndex(p => p.lineaDetalle === product.lineaDetalle);
            this.updateColorLogic(product);
            this.updateState(product, originalIndex);
            return { product, isAccumulated: true };
        }

        // 2. Si no está en despachados, lo buscamos en la orden original
        // v104.9: Búsqueda priorizada por lineaDetalle -> Item -> Nombre
        const productIndex = this.ordenProductos().findIndex(p => {
            // v104.9: Prioridad 1: Coincidencia exacta por lineaDetalle (Desambiguación Total)
            if (lineaDetalle !== undefined && p.lineaDetalle === lineaDetalle) return true;

            // Prioridad 2: Coincidencia por Código de Existencia (v104.9)
            if (p.codigoExistencia?.trim().toUpperCase() === searchText) return true;

            // Prioridad 3: Coincidencia por Barcode/Nombre
            const cleanItem = p.item?.split('|')[0] || '';
            const itemMatch = cleanItem.toUpperCase() === searchText;
            const nameMatch = p.nombre?.trim().toUpperCase() === searchText;
            return itemMatch || nameMatch;
        });

        if (productIndex !== -1) {
            let product = { ...this.ordenProductos()[productIndex] };

            // v160.14: VALIDACIONES DE LÍMITE (Primer pistoleo)
            if (Number(product.invBod || 0) <= 0) {
                throw new Error(`SIN STOCK: El producto ${product.nombre} tiene stock 0 en bodega. No se puede agregar.`);
            }
            if (1 > (product.solicita || 0)) {
                throw new Error(`NO SOLICITADO: Este item tiene cantidad solicitada 0.`);
            }

            // v2.6: CONSULTA BAJO DEMANDA (Solo si no vinieron en el detalle)
            if (!product.lotes || product.lotes.length === 0) {
                const meta = this.orderMetadata();
                console.log(`[RevisorService] 🔍 Lotes vacíos para ${product.nombre}. Consultando API específica...`);
                try {
                    const lotesRes = await firstValueFrom(this.dataService.executeAction<any>('GET_LOTES_EXISTENCIA_ORDEN', {
                        solicitud: meta.numeroSolicitud,
                        orden: meta.numeroOrdenDespacho
                    }));

                    if (lotesRes && !lotesRes.isError) {
                        const batchList = lotesRes.detalles?.[0]?.lotesXExistencia || lotesRes.lotesXExistencia || lotesRes.lotes || [];
                        product.lotes = batchList.map((l: any) => ({
                            lote: l.codigoLote || l.lote || 'S/L',
                            caducidad: l.fechaCaducidad || l.caducidad || 'N/A',
                            fechaElaboracion: l.fechaElaboracion || '',
                            codigoExistencia: l.codigoExistencia || product.codigoExistencia,
                            stock: l.saldoActualEnCajas || l.stock || 0,
                            despachado: 0
                        }));
                    }
                } catch (err) {
                    console.error('[RevisorService] Error cargando lotes para el producto:', err);
                }
            }

            product.despachado = 1;
            product.bulto = 1;

            const totalLotes = product.lotes?.length || 0;

            if (totalLotes === 0) {
                product.despachado = 1;
                product.lote = '';
                product.caducidad = '';
            } else if (totalLotes === 1) {
                const uniqueLote = product.lotes![0];
                uniqueLote.despachado = 1;
                product.lote = uniqueLote.lote;
                product.caducidad = uniqueLote.caducidad;
            } else {
                product.despachado = 0; 
                product.lote = 'MULTI-LOTE';
            }

            this.updateColorLogic(product);
            this.updateState(product, productIndex);
            return { product, isAccumulated: false };
        }

        // 3. BÚSQUEDA EXTERNA (Si no está en la orden y el flag está activo)
        if (this.enableExternalLookup) {
            console.log(`[v30.0] Buscando código ${barcode} en servicio externo...`);
        }

        return null;
    }

    private updateColorLogic(product: Product) {
        if (product.despachado === product.solicita) {
            product.color = 'negro';
        } else if (product.despachado < product.solicita) {
            product.color = 'azul';
        } else {
            product.color = 'verde';
        }
    }

    private updateState(product: Product, index: number) {
        this.escaneados.update(list => {
            const existingIndex = list.findIndex(p => p.item === product.item);
            if (existingIndex !== -1) {
                // v104.7: Si ya existe, lo removemos y lo ponemos al inicio (Último escaneado arriba)
                list.splice(existingIndex, 1);
            }
            return [product, ...list];
        });

        this.ordenProductos.update(list => {
            const idx = list.findIndex(p => p.item === product.item);
            if (idx !== -1) {
                list[idx].despachado = product.despachado;
                list[idx].color = product.color === 'negro' ? 'completado' : 'naranja';
            }
            return [...list];
        });

        // Al finalizar cualquier cambio de estado, persistimos en el disco (Blindaje v28.0)
        console.log(`[RevisorService] Persistiendo cambio para item: ${product.item} | Desp: ${product.despachado}`);
        this.persistCurrentState();
    }

    private updateQuantity(item: string, qty: number) {
        const productIndex = this.ordenProductos().findIndex(p => p.item === item);
        if (productIndex !== -1) {
            const product = { ...this.ordenProductos()[productIndex] };
            const newQty = Math.max(0, Number(qty) || 0);
            product.despachado = newQty;

            // v200.2: Sincronización automática de lote único en actualización manual
            if (product.lotes && product.lotes.length === 1) {
                product.lotes[0].despachado = newQty;
                product.lote = product.lotes[0].lote;
                product.caducidad = product.lotes[0].caducidad;
            }

            this.updateColorLogic(product);
            this.updateState(product, productIndex);
        }
    }

    /**
     * Fuerza el guardado de la sesión actual (v61.0)
     */
    saveSession() {
        this.persistCurrentState();
    }

    /**
     * Retorna la descripción parametrizada de una unidad de medida.
     */
    public getUnitDescription(code: string): string {
        const cleanCode = code?.trim().toUpperCase() || '';
        return this.UNIT_DESCRIPTIONS[cleanCode] || code;
    }

    /**
     * Elimina un item de la lista de despachados y resetea su estado en la orden.
     */
    public eliminarItem(itemCode: string) {
        // 1. Remover de la lista de escaneados
        this.escaneados.update(list => list.filter(p => p.item !== itemCode));

        // 2. Resetear el estado visual en la orden original
        this.ordenProductos.update(list => {
            const index = list.findIndex(p => p.item === itemCode);
            if (index !== -1) {
                list[index].color = 'naranja';
                list[index].despachado = 0;
            }
            return [...list];
        });

        // Persistimos la eliminación en el disco (Blindaje v28.0)
        this.persistCurrentState();
    }

    /**
     * RESET MAESTRO: Limpia todos los productos despachados y restaura la orden original.
     * Útil cuando se procesó de manera incorrecta y se requiere reiniciar.
     */
    public resetearDespacho() {
        const orderId = this.currentOrderNumber;
        if (orderId) {
            console.log(`[RevisorService] Limpiando sesión local para orden: ${orderId}`);
            this.storage.clearLocal(`REVISION_SESSION_${orderId}`);
            // También limpiamos cualquier caché de metadata si existe
            this.storage.clearLocal(`ORDER_CACHE_${orderId}`);
        }

        // 1. Limpiar lista de escaneados
        this.escaneados.set([]);

        // 2. Restaurar estados en la orden original
        this.ordenProductos.update(list => {
            return list.map(p => ({
                ...p,
                despachado: 0,
                color: 'naranja'
            }));
        });

        // 3. Persistir la limpieza (crea una sesión vacía limpia)
        this.persistCurrentState();
    }

    /**
     * V160.0: Limpia absolutamente toda la persistencia de órdenes.
     */
    public purgeAllSessions() {
        this.storage.clearAllOrders();
        this.ordenProductos.set([]);
        this.escaneados.set([]);
        this.currentOrderNumber = null;
    }

    /**
     * V31.0: Retorna una lista de errores de validación para el cierre del despacho.
     */
    public getValidationErrors(): { type: 'TYPES' | 'QTY' | 'BULTO' | 'SURPLUS' | 'STOCK', message: string, detail?: string, isCritical: boolean }[] {
        const errors: { type: 'TYPES' | 'QTY' | 'BULTO' | 'SURPLUS' | 'STOCK', message: string, detail?: string, isCritical: boolean }[] = [];
        const orden = this.ordenProductos();
        const escaneados = this.escaneados();

        // 1. VALIDACIÓN DE TIPOS (CABECERA)
        const tiposSolicitados = orden.length;
        const tiposEscaneados = escaneados.filter(e => orden.some(o => o.item === e.item)).length;

        if (tiposEscaneados !== tiposSolicitados) {
            errors.push({
                type: 'TYPES',
                message: `TIPOS DE ÍTEMS: ${tiposEscaneados} de ${tiposSolicitados}`,
                detail: `Faltan ${tiposSolicitados - tiposEscaneados} tipos de productos por despachar.`,
                isCritical: false
            });
        }

        // 2. AUDITORÍA ITEM POR ITEM (DETALLE)
        orden.forEach(o => {
            const esc = escaneados.find(e => e.item === o.item);
            const despachado = esc ? esc.despachado : 0;

            // a. Validar Stock Físico (v160.9)
            if (despachado > Number(o.invBod || 0)) {
                errors.push({
                    type: 'STOCK',
                    message: `STOCK INSUFICIENTE: ${o.nombre}`,
                    detail: `Stock en bodega: ${o.invBod} | Intentando despachar: ${despachado}. DEBE CORREGIR PARA CONTINUAR.`,
                    isCritical: true
                });
            }

            // b. Validar Solicitado vs Despachado
            if (despachado !== o.solicita) {
                const diff = despachado - o.solicita;
                if (diff > 0) {
                    errors.push({
                        type: 'SURPLUS',
                        message: `EXCEDIDO (SOBRANTE): ${o.nombre}`,
                        detail: `Solicitado: ${o.solicita} | Despachado: ${despachado} (Dif: +${diff}). CORRIJA PARA CONTINUAR.`,
                        isCritical: true // v160.14: Siempre bloqueante
                    });
                } else {
                    errors.push({
                        type: 'QTY',
                        message: despachado === 0 ? "FALTANTE TOTAL" : "FALTANTE PARCIAL",
                        detail: `Producto: ${o.nombre} | Solicitado: ${o.solicita} | Despachado: ${despachado}`,
                        isCritical: false
                    });
                }
            }
        });

        // 3. PRODUCTOS EXTRAS (No están en la orden)
        const extraItems = escaneados.filter(e => !orden.some(o => o.item === e.item));
        extraItems.forEach(e => {
            errors.push({
                type: 'TYPES',
                message: `EXTRA: ${e.nombre}`,
                detail: `No pertenece a la orden. Cantidad: ${e.despachado}. DEBE ELIMINAR PARA CONTINUAR.`,
                isCritical: true
            });
        });

        // 4. VALIDACIÓN DE BULTOS
        const sinBulto = escaneados.filter(p => p.despachado > 0 && (!p.bulto || p.bulto <= 0));
        if (sinBulto.length > 0) {
            errors.push({
                type: 'BULTO',
                message: `BULTOS PENDIENTES: ${sinBulto.length} productos sin bulto.`,
                detail: `Asegúrese de que todos los productos tengan un bulto válido.`,
                isCritical: false
            });
        }

        return errors;
    }

    /**
     * EFECTO LABORATORIO (v37.0): Carga todos los productos de la orden pero con discrepancias.
     * Útil para verificar que los modales de alerta y validación funcionen correctamente.
     */
    private simularDiscrepancias() {
        const orden = this.ordenProductos();
        if (orden.length === 0) return;

        console.warn(`[v37.0] Generando escenario de discrepancias para la orden: ${this.currentOrderNumber}`);

        const escaneadosSimulados: Product[] = orden.map((prod, index) => {
            const p = { ...prod };
            // Generamos discrepancias variadas:
            if (index % 3 === 0) {
                p.despachado = p.solicita + 2; // Sobra
            } else if (index % 3 === 1) {
                p.despachado = Math.max(1, p.solicita - 1); // Falta
            } else {
                p.despachado = p.solicita; // Correcto (para tener mezcla)
            }

            p.bulto = 1; // Asignamos bulto para pasar esa fase o dejar algunos vacíos
            if (index === 0) p.bulto = 0; // El primero sin bulto para disparar alerta de bultos

            this.updateColorLogic(p);
            return p;
        });

        const fantasma: Product = {
            item: 'CODE-999-ERROR',
            nombre: 'PRODUCTO NO PERTENECIENTE A LA ORDEN (SIMULADO)',
            solicita: 0,
            despachado: 5,
            unidad: 'UND',
            invBod: 0,
            vtas: 0,
            sLocal: 0,
            suger: 0,
            color: 'verde',
            bulto: 2
        };

        this.escaneados.set([...escaneadosSimulados, fantasma]);

        // Actualizar estados visuales en la orden
        this.ordenProductos.update(list => {
            return list.map(o => {
                const esc = escaneadosSimulados.find(e => e.item === o.item);
                if (esc) {
                    o.color = esc.color === 'negro' ? 'completado' : 'naranja';
                    o.despachado = esc.despachado;
                }
                return o;
            });
        });

        this.persistCurrentState();
    }

    /**
     * V31.0/v55.0/v107.0: Ejecuta el envío final de la orden procesada.
     * Ahora recibe los bultos dinámicos del modal.
     */
    /**
     * V112.0: Orquestación de cierre definitiva.
     * 1. Invoca Actualizar Detalles (Productos con cantidadADespachar).
     * 2. Si es exitoso, invoca Finalizar (Bultos).
     */
    public finalizeProcess(bultos?: any[]) {
        const metadata = this.orderMetadata();
        if (!metadata) return of(null);

        // A. Mapear productos escaneados (v112.0: Nuevo parámetro 'cantidadADespachar')
        // B. Recolectar todos los lotes despachados (v170.5: Requerimiento Keyla API v2)
        // v104.9: Usamos la lista maestra de la orden para asegurar que enviamos todo lo despachado
        const allProducts = this.ordenProductos().filter(p => p.despachado > 0);
        const allLotes: any[] = [];

        allProducts.forEach(p => {
            let lotsAddedForThisProduct = 0;
            if (p.lotes && p.lotes.length > 0) {
                p.lotes.forEach(l => {
                    if (l.despachado > 0) {
                        allLotes.push({
                            codigoLote: l.lote || 'MIGRACION',
                            codigoExistencia: Number(l.codigoExistencia || p.codigoExistencia) || 0,
                            fechaElaboracion: l.fechaElaboracion || '01/04/2026',
                            fechaCaducidad: (l.caducidad && l.caducidad !== 'N/A' && l.caducidad !== 'S/F') ? l.caducidad : '01/07/2026',
                            cantidadADespachar: l.despachado
                        });
                        lotsAddedForThisProduct++;
                    }
                });
            }
            
            // v104.9: FALLBACK CRÍTICO - Si el producto está despachado pero no se agregaron lotes desde el array (o el array está vacío)
            if (p.despachado > 0 && lotsAddedForThisProduct === 0) {
                allLotes.push({
                    codigoLote: p.lote || 'MIGRACION',
                    codigoExistencia: Number(p.codigoExistencia) || 0,
                    fechaElaboracion: '01/04/2026',
                    fechaCaducidad: (p.caducidad && p.caducidad !== 'N/A' && p.caducidad !== 'S/F') ? p.caducidad : '01/07/2026',
                    cantidadADespachar: p.despachado
                });
            }
        });

        const payloadActualizar = {
            codigoEmpresa: metadata.codigoEmpresa || 1,
            numeroSolicitud: metadata.numeroSolicitud,
            numeroOrdenDespacho: metadata.numeroOrdenDespacho,
            codigoUsuario: this.authService.getStoredUser()?.username || 'AAAVEROS',
            detalles: allProducts.map(p => ({
                lineaDetalle: p.lineaDetalle || 1,
                codigoExistencia: Number(p.codigoExistencia) || 0,
                unidadesXCaja: p.unidadesXCaja || 1,
                cantidad: p.cantidad || 0,
                cantidadADespachar: p.despachado || 0, 
                cantidadCajas: p.despachado || 0,
                cantidadUnidades: p.despachado || 0,
                grupoUnidadMedidaStockBase: (p.grupoUnidadMedidaStockBase === 0 || !p.grupoUnidadMedidaStockBase) ? null : p.grupoUnidadMedidaStockBase,
                unidadMedidaStockBase: (p.unidadMedidaStockBase === 0 || !p.unidadMedidaStockBase) ? null : p.unidadMedidaStockBase,
                cantidadUnidadMedidaStockB: p.despachado || 0,
                cantidadBaseEquivalente: p.cantidadBaseEquivalente || 0,
                observacion: p.observacion || 'API_UPDATE_KEYLA',
                codigoEstado: p.estado || 'ING',
                esActivo: p.esActivo || 'S'
            })),
            lotesXExistencia: allLotes
        };

        console.log('[RevisorService] 🛠️ Paso 1: Actualizando detalles de productos...', payloadActualizar);

        return this.dataService.executeAction<any>('ACTUALIZAR_ORDEN_DETALLES', { payload: payloadActualizar }).pipe(
            switchMap(resAct => {
                if (resAct?.mensaje === 'OK' || resAct?.codigo === '000') {
                    console.log('[RevisorService] ✅ Productos actualizados. Paso 2: Finalizando con bultos...');
                    return this.updateDetallesReal('AGREGAR', undefined, bultos);
                } else {
                    console.error('[RevisorService] ❌ Error en Actualizar Detalles:', resAct);
                    return of(resAct); // Devolver error para detener el flujo
                }
            })
        );
    }

    private updateDetallesReal(tipo: 'AGREGAR' | 'EDITAR' | 'ELIMINAR', itemCode?: string, bultos?: any[]) {
        const metadata = this.orderMetadata();
        if (!metadata) return of(null);

        console.log(`[RevisorService] Solicitando Acción [${tipo}] para Sol: ${metadata.numeroSolicitud} Ord: ${metadata.numeroOrdenDespacho}`);

        let bultosMapped: any[] = [];

        if (tipo === 'AGREGAR' && bultos) {
            // v160.45: FILTRAR Bultos Virtuales (Código 999 - Impresión de etiquetas)
            // Estos no se guardan en el servidor (Captura 2 error)
            const realBultos = bultos.filter(b => b.codigoTipoBulto !== 999);

            bultosMapped = realBultos.map((b, index) => ({
                lineaDetalle: index + 1,
                codigoTipoBulto: Number(b.codigoTipoBulto) || 1,
                cantidad: Number(b.cantidad) || 0
            }));
        } else {
            // Modo retrocompatibilidad o actualización de detalle
            bultosMapped = this.escaneados().map((p, index) => ({
                lineaDetalle: index + 1,
                codigoTipoBulto: p.bulto || 1,
                cantidad: p.despachado
            }));
        }

        return this.dataService.executeAction<any>('UPDATE_ORDEN_DETALLES', {
            params: {
                solicitud: metadata.numeroSolicitud || 1,
                orden: metadata.numeroOrdenDespacho || 1,
                bultos: bultosMapped
            }
        }).pipe(
            tap(res => {
                if (res?.mensaje !== 'ERROR') {
                    if (tipo === 'AGREGAR') {
                        // v79.0: Por solicitud de usuario, NO se limpia la sesión local para permitir re-consultas.
                        // this.storage.clearLocal(`REVISION_SESSION_${this.currentOrderNumber}`);
                    }
                }
            })
        );
    }
    /**
     * V42.0: Ordena los productos pistoleados por prioridad de discrepancia:
     * 1. Faltantes (Solicitado > Despachado)
     * 2. Sobrantes (Solicitado < Despachado)
     * 3. OK (Solicitado == Despachado)
     */
    public ordenarPorEstado() {
        this.escaneados.update(list => {
            return [...list].sort((a, b) => {
                const getWeight = (p: Product) => {
                    const desp = p.despachado || 0;
                    const sol = p.solicita || 0;
                    if (desp < sol) return 1; // Faltante (Azul)
                    if (desp > sol) return 2; // Sobrante (Verde)
                    return 3; // OK (Negro)
                };
                return getWeight(a) - getWeight(b);
            });
        });
        this.persistCurrentState();
    }

    /**
     * v2.7: Carga masiva y EFICIENTE de lotes.
     * Consulta una sola vez la API de lotes sin código de existencia para obtener toda la orden,
     * y luego mapea los lotes a sus respectivos productos.
     */
    private async fetchBatchesForAll(products: Product[], solicitud: number, orden: number) {
        console.log(`[RevisorService] ⏳ Consultando lotes globales para la orden Sol:${solicitud} Ord:${orden}...`);

        try {
            // Un solo hit a la API para "pintar todo" (3 argumentos: empresa, solicitud, orden)
            const res = await firstValueFrom(this.dataService.executeAction<any>('GET_LOTES_EXISTENCIA_ORDEN', {
                solicitud,
                orden
            }));

            if (res && !res.isError && res.detalles) {
                console.log(`[RevisorService] 📥 API Response Global Lotes:`, res);
                console.log(`[RevisorService] 📥 Recibidos lotes para ${res.detalles.length} productos.`);

                // Distribución de lotes a los productos locales
                products.forEach(p => {
                    const match = res.detalles.find((d: any) =>
                        (d.codigoExistencia?.toString() === p.codigoExistencia?.toString()) ||
                        (d.nombreExistencia?.trim().toUpperCase() === p.nombre?.trim().toUpperCase())
                    );

                    if (match && match.lotesXExistencia) {
                        console.log(`[RevisorService] 🔗 Vinculando ${match.lotesXExistencia.length} lotes a ${p.nombre}`);
                        p.lotes = match.lotesXExistencia.map((l: any) => ({
                            lote: l.codigoLote || l.lote || 'S/L',
                            caducidad: l.fechaCaducidad || l.caducidad || 'N/A',
                            fechaElaboracion: l.fechaElaboracion || '',
                            codigoExistencia: l.codigoExistencia || p.codigoExistencia,
                            stock: l.saldoActualEnCajas || l.stock || 0,
                            despachado: 0
                        }));
                    }
                });
            } else {
                console.warn('[RevisorService] ⚠️ La API de lotes no devolvió detalles válidos o está vacía.', res);
            }
        } catch (e) {
            console.error('[RevisorService] ❌ Error fatal en carga masiva de lotes:', e);
        }

        console.log('[RevisorService] ✅ Sincronización de lotes finalizada.');
        this.ordenProductos.set([...products]);
        this.persistCurrentState();
    }
}
