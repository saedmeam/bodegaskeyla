import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Product } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';
import { StorageService } from '../../../core/services/storage.service';
import { switchMap, map, tap, catchError } from 'rxjs/operators';
import { of, throwError } from 'rxjs';
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

    public getOrdenesDespachoList(empresa: number, filtro: string, valor: string, pagina: number = 0) {
        return this.dataService.executeAction<any>('GET_ORDENES_DESPACHO_LIST', { empresa, filtro, valor, pagina });
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
    public executeProcess(action: 'LOAD' | 'SCAN' | 'UPDATE_QTY' | 'SAVE_SESSION' | 'SIMULATE_DISCREPANCIES' | 'SORT_PRIORITY' | 'API_UPDATE', payload?: any) {
        switch (action) {
            case 'LOAD':
                this.loadOrder(payload.orderNumber);
                break;
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

    private loadOrder(orderNumber: string) {
        this.currentOrderNumber = orderNumber;
        const storageKey = `REVISION_SESSION_${orderNumber}`;

        this.isLoading = true; // Bloqueamos autoguardado reactivo
        const savedSession = this.storage.loadLocal<any>(storageKey);

        // v62.0: Comparación robusta (string vs number)
        if (savedSession && String(savedSession.orderNumber) === String(orderNumber)) {
            console.log(`[RevisorService] Recuperando sesión local para la orden: ${orderNumber}`);
            console.log(`-- Items escaneados recuperados: ${savedSession.escaneados?.length || 0}`);

            this.ordenProductos.set(savedSession.ordenProductos || []);
            this.escaneados.set(savedSession.escaneados || []);
            this.orderMetadata.set(savedSession.orderMetadata || null);

            this.isLoading = false; // Liberamos
            return;
        }

        this.loadingService.show();
        // 2. Si no hay sesión local, realizamos login y luego consultamos la API Real (v51.0)
        this.dataService.login()
            .pipe(
                switchMap(loginRes => {
                    if (!loginRes) {
                        console.error('[RevisorService] No se pudo autenticar');
                        this.loadingService.hide();
                        return of(null);
                    }
                    // Obtenemos cabecera para metadata corporativa
                    return this.dataService.executeAction<any>('GET_ORDEN_DESPACHO', { numero: orderNumber });
                }),
                switchMap(headerRes => {
                    if (!headerRes) {
                        this.loadingService.hide();
                        return of(null);
                    }
                    const ordenes = headerRes?.ordenesDespacho || [];
                    if (ordenes.length === 0) {
                        this.orderMetadata.set(null);
                        this.loadingService.hide();
                        return of(null);
                    }
                    const cabecera = ordenes[0];
                    const cab_solicitud = cabecera.numeroSolicitud || 1;
                    const cab_orden = cabecera.numeroOrdenDespacho || 1; // v64.0: Forzar 1 según instrucción usuario

                    const user = this.authService.getStoredUser();
                    const sessionEmpresa = user?.empresa?.codigoEmpresa;

                    this.orderMetadata.set({
                        codigoEmpresa: cabecera.codigoEmpresa || sessionEmpresa, // v103.0: Dynamic company
                        bodega: cabecera.codigoBodega?.toString() || '001',
                        movimiento: '057',
                        nombre: 'REPOSICIÓN AUTOMÁTICA',
                        numeroSolicitud: cab_solicitud,
                        numeroOrdenDespacho: cab_orden,
                        concepto: `Orden #${orderNumber} | Solicitud: ${cab_solicitud}`,
                        estado: cabecera.codigoEstado
                    });

                    // Invocamos el servicio unificado pasando explícitamente los datos obtenidos
                    return this.dataService.getDetallesOrdenDespacho(cab_solicitud, cab_orden).pipe(
                        map(detRes => {
                            const detalles = detRes?.detalles || [];
                            // Mapeo manual al modelo Product (v64.0: Aseguramos mapeo correcto aquí mismo)
                            return detalles.map((d: any) => ({
                                item: d.codigoExistencia?.toString() || '',
                                nombre: d.nombreExistencia || 'SIN NOMBRE',
                                unidad: d.tipoMedida || 'U/C',
                                solicita: d.cantidad || 0,
                                invBod: d.cantidadUnidadMedidaStockB || d.stock || d.existencia || 0, // v145.0: Principal stock mapping
                                despachado: 0,
                                color: 'naranja',
                                bulto: d.unidadesXCaja || 1,
                                lote: d.lote || '',
                                caducidad: d.caducidad || '',
                                lineaDetalle: d.lineaDetalle,
                                estado: d.codigoEstado,
                                // v145.0: Persisting detailed technical fields
                                tipoMedida: d.tipoMedida || 'N/A',
                                tipoPresentacion: d.tipoPresentacion || 'N/A',
                                unidadesXCaja: d.unidadesXCaja || 0
                            })) as Product[];
                        }),
                        tap(() => this.loadingService.hide()),
                        catchError(err => {
                            this.loadingService.hide();
                            return throwError(() => err);
                        })
                    );
                })
            )
            .subscribe({
                next: (products) => {
                    const cleanProducts = products || [];
                    this.ordenProductos.set(cleanProducts);

                    // v160.0: Solo cargar en "Escaneados" aquellos que ya tienen cantidad despachada física (DB)
                    const actuallyDispatched = cleanProducts.filter(p => (p.despachado || 0) > 0);
                    this.escaneados.set(actuallyDispatched);

                    this.isLoading = false;
                    this.loadingService.hide();
                },
                error: (err) => {
                    console.error('[RevisorService] Error cargando orden', err);
                    this.isLoading = false;
                    this.loadingService.hide();
                }
            });
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

        // 1. Buscamos primero en lo que ya está en la grilla de "Despachados" para acumular
        // Ahora validamos que el lote coincida si se proporciona
        const scannedIndex = this.escaneados().findIndex(p =>
            p.item === barcode
        );

        if (scannedIndex !== -1) {
            // Si ya existe, tomamos el actual y sumamos +1
            const product = { ...this.escaneados()[scannedIndex] };
            product.despachado++;
            // v77.0: Lote y Caducidad omitidos permanentemente por solicitud de usuario

            // Buscamos su índice en la orden original para actualizar el estado global
            const originalIndex = this.ordenProductos().findIndex(p => p.item === product.item);

            this.updateColorLogic(product);
            this.updateState(product, originalIndex);
            return { product, isAccumulated: true };
        }

        // 2. Si no está en despachados, lo buscamos en la orden original (primer escaneo de este item)
        const productIndex = this.ordenProductos().findIndex(p => p.item === barcode);

        if (productIndex !== -1) {
            const product = { ...this.ordenProductos()[productIndex] };
            product.despachado = 1; // Primer pistoleo
            product.bulto = 1;      // Valor por defecto solicitado
            // v77.0: Lote y Caducidad omitidos permanentemente por solicitud de usuario

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
    public getValidationErrors(): { type: 'TYPES' | 'QTY' | 'BULTO' | 'SURPLUS', message: string, detail?: string }[] {
        const errors: { type: 'TYPES' | 'QTY' | 'BULTO' | 'SURPLUS', message: string, detail?: string }[] = [];
        const orden = this.ordenProductos();
        const escaneados = this.escaneados();

        // 1. VALIDACIÓN DE TIPOS (CABECERA) - v39.0
        const tiposSolicitados = orden.length;
        const tiposEscaneados = escaneados.filter(e => orden.some(o => o.item === e.item)).length;

        if (tiposEscaneados !== tiposSolicitados) {
            errors.push({
                type: 'TYPES',
                message: `TIPOS DE ÍTEMS: ${tiposEscaneados} de ${tiposSolicitados}`,
                detail: `Faltan ${tiposSolicitados - tiposEscaneados} tipos de productos por despachar.`
            });
        }

        // 2. AUDITORÍA ITEM POR ITEM (DETALLE) - v38.0/v39.0
        orden.forEach(o => {
            const esc = escaneados.find(e => e.item === o.item);
            const despachado = esc ? esc.despachado : 0;

            if (despachado !== o.solicita) {
                const diff = despachado - o.solicita;
                if (diff > 0) {
                    errors.push({
                        type: 'SURPLUS',
                        message: `SOBRANTE (CRÍTICO): ${o.nombre}`,
                        detail: `Solicitado: ${o.solicita} | Despachado: ${despachado} (Dif: +${diff}). EL BOTÓN CONTINUAR SE HA BLOQUEADO.`
                    });
                } else {
                    const status = despachado === 0 ? "FALTANTE TOTAL" : "FALTANTE PARCIAL";
                    errors.push({
                        type: 'QTY',
                        message: `${status}: ${o.nombre}`,
                        detail: `Solicitado: ${o.solicita} | Despachado: ${despachado} (Dif: ${diff})`
                    });
                }
            }
        });

        // 3. PRODUCTOS EXTRAS
        const extraItems = escaneados.filter(e => !orden.some(o => o.item === e.item));
        extraItems.forEach(e => {
            errors.push({
                type: 'TYPES',
                message: `EXTRA: ${e.nombre}`,
                detail: `No pertenece a la orden. Cantidad: ${e.despachado}`
            });
        });

        // 4. VALIDACIÓN DE BULTOS
        const sinBulto = escaneados.filter(p => !p.bulto || p.bulto <= 0);
        if (sinBulto.length > 0) {
            errors.push({
                type: 'BULTO',
                message: `BULTOS PENDIENTES: ${sinBulto.length} productos no tienen bulto asignado.`,
                detail: `Asegúrese de que todos los productos tengan un número de bulto válido.`
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
     * V31.0/v55.0: Ejecuta el envío final de la orden procesada.
     */
    public finalizeProcess() {
        return this.updateDetallesReal('AGREGAR');
    }

    private updateDetallesReal(tipo: 'AGREGAR' | 'EDITAR' | 'ELIMINAR', itemCode?: string) {
        const metadata = this.orderMetadata();
        if (!metadata) return of(null);

        console.log(`[RevisorService] Solicitando Finalización Real [${tipo}] para Sol: ${metadata.numeroSolicitud} Ord: ${metadata.numeroOrdenDespacho}`);

        return this.dataService.executeAction<any>('UPDATE_ORDEN_DETALLES', {
            params: {
                solicitud: metadata.numeroSolicitud || 1,
                orden: metadata.numeroOrdenDespacho || 1
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
