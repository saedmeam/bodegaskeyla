import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Product } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';
import { StorageService } from '../../../core/services/storage.service';
import { switchMap, map, tap, catchError } from 'rxjs/operators';
import { of, throwError, Observable } from 'rxjs';
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

    public getOrdenesDespachoList(empresa: number, filtro: string, valor: string, pagina: number = 0, fechaDesde?: string, fechaHasta?: string) {
        return this.dataService.executeAction<any>('GET_ORDENES_DESPACHO_LIST', { empresa, filtro, valor, pagina, fechaDesde, fechaHasta });
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
                return this.processBarcode(payload.barcode, payload.lote, payload.caducidad);
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
        this.currentOrderNumber = orderNumber;
        const storageKey = `REVISION_SESSION_${orderNumber}`;
        const savedSession = this.storage.loadLocal<any>(storageKey);

        // v160.11: Si NO es forzado y hay sesión, recuperamos y retornamos OK inmediatamente
        if (!forceRefresh && savedSession && String(savedSession.orderNumber) === String(orderNumber)) {
            console.log(`[RevisorService] Recuperando sesión local para la orden: ${orderNumber}`);
            this.ordenProductos.set(savedSession.ordenProductos || []);
            this.escaneados.set(savedSession.escaneados || []);
            this.orderMetadata.set(savedSession.orderMetadata || null);
            this.isLoading = false;
            return of(true);
        }

        this.loadingService.show();
        this.isLoading = true; // Bloqueamos autoguardado reactivo durante el fetch

        // Preservamos escaneados previos si estamos forzando refresh (v160.11)
        const previousEscaneados = forceRefresh ? [...this.escaneados()] : [];

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
                    // v160.12: Si ya tenemos la metadata (solicitud y orden), no consultamos la cabecera para evitar error de fechas
                    if (meta && (String(meta.numeroSolicitud) === String(orderNumber) || String(meta.numeroOrdenDespacho) === String(orderNumber) || orderNumber.includes(String(meta.numeroSolicitud)))) {
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
                map(detRes => {
                    if (detRes?.isError) {
                        console.error('[RevisorService] ❌ Error en detalles de orden:', detRes?.mensaje);
                        throw new Error(detRes?.mensaje || 'Error consultando detalles');
                    }
                    console.log(`[RevisorService] 📦 Productos obtenidos (${detRes?.detalles?.length || 0}). Mapeando lista...`);
                    const detalles = detRes?.detalles || [];
                    const newProducts = detalles.map((d: any) => {
                        const barcode = d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString() 
                                        || d.codigoBarras?.toString() 
                                        || '';
                        const p: Product = {
                            item: barcode,
                            codigoExistencia: d.codigoExistencia?.toString() || '',
                            codigoBarras: barcode,
                            nombre: d.nombreExistencia || 'SIN NOMBRE',
                            unidad: d.tipoMedida || 'U/C',
                            solicita: d.cantidad || 0,
                            invBod: d.stock !== undefined && d.stock !== null ? d.stock : (d.cantidadUnidadMedidaStockB || d.existencia || 0),
                            despachado: 0,
                            color: 'naranja',
                            bulto: d.unidadesXCaja || 1,
                            lote: d.lote || '',
                            caducidad: d.caducidad || '',
                            lineaDetalle: d.lineaDetalle,
                            estado: d.codigoEstado,
                            unidadesXCaja: d.unidadesXCaja || 0,
                            cantidadCajas: d.cantidadCajas || 0,
                            cantidadUnidades: d.cantidadUnidades || 0,
                            grupoUnidadMedidaStockBase: d.grupoUnidadMedidaStockBase || null,
                            unidadMedidaStockBase: d.unidadMedidaStockBase || null,
                            cantidadUnidadMedidaStockB: d.cantidadUnidadMedidaStockB || 0,
                            cantidadBaseEquivalente: d.cantidadBaseEquivalente || 0,
                            observacion: d.observacion || 'API_REFRESH',
                            esActivo: d.esActivo || 'S',
                            vtas: 0,
                            sLocal: 0,
                            suger: 0,
                            // v170.2: Mocking batches for testing as requested
                            lotes: [
                                { lote: 'L001', caducidad: '2026-04-15', stock: 4, despachado: 0 },
                                { lote: 'L002', caducidad: '2026-05-10', stock: 8, despachado: 0 },
                                { lote: 'L003', caducidad: '2026-08-01', stock: 20, despachado: 0 }
                            ]
                        };

                        // v160.11: Si estamos forzando refresh, re-aplicamos el estado del producto si ya estaba escaneado
                        if (forceRefresh && previousEscaneados.length > 0) {
                            const prev = previousEscaneados.find(e => e.item === p.item);
                            if (prev) {
                                p.despachado = prev.despachado;
                                // Recalculamos el color con el nuevo stock/cantidades
                                this.updateColorLogic(p);
                                // No usamos p.color directamente de 'prev' por si cambió el stock
                            }
                        }
                        return p;
                    });

                    this.ordenProductos.set(newProducts);
                    if (forceRefresh) {
                        // Sincronizamos escaneados por si algún campo técnico del API varió
                        const updatedEscaneados = previousEscaneados.map(esc => {
                            const matching = newProducts.find((np: Product) => np.item === esc.item);
                            return matching ? { ...matching, despachado: esc.despachado } : esc;
                        });
                        this.escaneados.set(updatedEscaneados);
                    } else {
                        this.escaneados.set([]);
                    }

                    this.isLoading = false;
                    this.loadingService.hide();
                    this.persistCurrentState(); // Guardamos el nuevo estado refrescado
                    return true;
                }),
                catchError(err => {
                    console.error('[RevisorService] Error cargando/sincronizando orden', err);
                    this.isLoading = false;
                    this.loadingService.hide();
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
        console.log(`[RevisorService] Persistiendo sesión local en ${sessionKey}. Escaneados: ${currentEscaneados.length}`);
        // Guardamos en LocalStorage y archivo físico (.json) automáticamente
        this.storage.saveLocal(sessionKey, sessionState);
    }

    private processBarcode(barcode: string, lote?: string, caducidad?: string): { product: Product, isAccumulated: boolean } | null {
        if (!barcode) return null;

        // v160.14: AUDITORÍA PREVIA (Bloqueo por errores críticos pendientes)
        const currentErrors = this.getValidationErrors();
        if (currentErrors.some(e => e.isCritical)) {
            throw new Error("Pistoleo Bloqueado: Corrija las discrepancias (Sobrantes / Stock Insuficiente) antes de seguir escaneando.");
        }

        const searchText = barcode.trim().toUpperCase();

        // 1. Buscamos primero en lo que ya está en la grilla de "Despachados" para acumular
        const scannedIndex = this.escaneados().findIndex(p =>
            p.item?.trim().toUpperCase() === searchText || p.nombre?.trim().toUpperCase() === searchText
        );

        if (scannedIndex !== -1) {
            const product = { ...this.escaneados()[scannedIndex] };
            const newQty = product.despachado + 1;

            // v160.14: VALIDACIONES DE LÍMITE (Acumulación)
            if (newQty > product.solicita) {
                throw new Error(`PRODUCTO EXCEDIDO: No puede despachar más de ${product.solicita} ${product.unidad} de este item.`);
            }
            if (newQty > Number(product.invBod || 0)) {
                throw new Error(`STOCK INSUFICIENTE: Solo hay ${product.invBod} en bodega. Corrija o reporte falta de stock.`);
            }

            product.despachado = newQty;
            const originalIndex = this.ordenProductos().findIndex(p => p.item === product.item);
            this.updateColorLogic(product);
            this.updateState(product, originalIndex);
            return { product, isAccumulated: true };
        }

        // 2. Si no está en despachados, lo buscamos en la orden original
        const productIndex = this.ordenProductos().findIndex(p => 
            p.item?.trim().toUpperCase() === searchText || p.nombre?.trim().toUpperCase() === searchText
        );

        if (productIndex !== -1) {
            const product = { ...this.ordenProductos()[productIndex] };
            
            // v160.14: VALIDACIONES DE LÍMITE (Primer pistoleo)
            if (Number(product.invBod || 0) <= 0) {
                throw new Error(`SIN STOCK: El producto ${product.nombre} tiene stock 0 en bodega. No se puede agregar.`);
            }
            if (1 > product.solicita) { // Caso raro donde solicitan 0 (no debería estar en la orden)
                throw new Error(`NO SOLICITADO: Este item tiene cantidad solicitada 0.`);
            }

            product.despachado = 1;
            product.bulto = 1;
            this.updateColorLogic(product);
            this.updateState(product, productIndex);
            return { product, isAccumulated: false };
        }

        // 3. BÚSQUEDA EXTERNA (Si no está en la orden y el flag está activo)
        if (this.enableExternalLookup) {
            /**
             * TODO: Implementar llamada REST GET dinámica aquí.
             * const extProduct = await this.dataService.fetchExternal(barcode);
             */
            console.log(`[v30.0] Buscando código ${barcode} en servicio externo...`);
            // Por ahora, simulamos que no lo encuentra hasta tener la info del servicio.
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
            const existing = list.findIndex(p => p.item === product.item);
            if (existing !== -1) {
                list[existing] = product;
                return [...list];
            }
            return [...list, product];
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
            // Aseguramos que sea un número válido y no negativo
            product.despachado = Math.max(0, Number(qty) || 0);
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
        const payloadActualizar = {
            codigoEmpresa: metadata.codigoEmpresa || 1,
            numeroSolicitud: metadata.numeroSolicitud,
            numeroOrdenDespacho: metadata.numeroOrdenDespacho,
            codigoUsuario: this.authService.getStoredUser()?.username || 'AAAVEROS',
            detalles: this.escaneados().map(p => ({
                lineaDetalle: p.lineaDetalle || 1,
                codigoExistencia: Number(p.codigoExistencia) || 0,
                unidadesXCaja: p.unidadesXCaja || 1,
                cantidadADespachar: p.despachado !== undefined ? p.despachado : 0, // v131.0: Default a 0 si no se escaneó
                // v146.0: Technical fields for API consistency
                cantidadCajas: p.cantidadCajas || 0,
                cantidadUnidades: p.cantidadUnidades || 0,
                grupoUnidadMedidaStockBase: (p.grupoUnidadMedidaStockBase === 0 || !p.grupoUnidadMedidaStockBase) ? null : p.grupoUnidadMedidaStockBase,
                unidadMedidaStockBase: (p.unidadMedidaStockBase === 0 || !p.unidadMedidaStockBase) ? null : p.unidadMedidaStockBase,
                cantidadUnidadMedidaStockB: p.cantidadUnidadMedidaStockB || 0,
                cantidadBaseEquivalente: p.cantidadBaseEquivalente || 0,
                observacion: p.observacion || 'API_UPDATE_KEYLA',
                codigoEstado: p.estado || 'ING',
                esActivo: p.esActivo || 'S'
            }))
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
            // v107.0: Mapear desde información dinámica del modal bultos
            bultosMapped = bultos.map((b, index) => ({
                lineaDetalle: index + 1, 
                // v150.4: Asegurar que el código sea un número válido y mayor a cero para evitar 'parent key not found'
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
}
