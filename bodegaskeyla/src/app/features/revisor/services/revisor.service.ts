import { Injectable, inject, signal, effect } from '@angular/core';
import { DataService } from '../../../core/services/data.service';
import { Observable, of, forkJoin, firstValueFrom, throwError, from } from 'rxjs';
import { tap, map, catchError, switchMap } from 'rxjs/operators';
import { Product } from '../../../shared/models/product.model';
import { NotificationService } from '../../../core/services/notification.service';
import { LoadingService } from '../../../core/services/loading.service';
import { StorageService } from '../../../core/services/storage.service';
import { AuthService } from '../../../core/services/auth.service';

@Injectable({
    providedIn: 'root'
})
export class RevisorService {
    private dataService = inject(DataService);
    private notificationService = inject(NotificationService);
    private loadingService = inject(LoadingService);
    private storage = inject(StorageService);
    private authService = inject(AuthService);

    // Signals principales del proceso
    public ordenProductos = signal<Product[]>([]);
    public escaneados = signal<Product[]>([]);
    public lotesDisponibles = signal<any[]>([]);
    public tiposBultos = signal<any[]>([]);
    public orderMetadata = signal<any>(null);

    public getOrdenesDespachoList(empresa: number, filtro: string, valor: string, pagina: number = 0, fechaDesde?: string, fechaHasta?: string, diaEmbarque?: string) {
        return this.dataService.executeAction<any>('GET_ORDENES_DESPACHO_LIST', { empresa, filtro, valor, pagina, fechaDesde, fechaHasta, diaEmbarque });
    }

    public getTiposBultos() {
        return this.dataService.executeAction<any>('GET_TIPOS_BULTOS');
    }

    private currentOrderNumber: string | null = null;
    private isLoading = false;

    constructor() {
        // v1.1.3: Persistencia reactiva TOTAL (Se activa con cada cambio en escaneados)
        effect(() => {
            const list = this.escaneados();
            const order = this.currentOrderNumber;
            // Solo guardamos si hay una orden activa y no estamos en medio de una carga (isLoading)
            if (order && !this.isLoading) {
                console.log(`[RevisorService] 💾 Guardando respaldo local para ${order} (${list.length} productos)...`);
                this.storage.saveLocal(`SCAN_SESSION_${order}`, {
                    order: order,
                    escaneados: list,
                    timestamp: Date.now()
                });
            }
        });
    }

    executeProcess(action: string, params: any = {}): Observable<any> | Promise<any> | void {
        switch (action) {
            case 'LOAD':
                return this.loadOrder(params.orderNumber, params.fechaDesde, params.fechaHasta, params.forceRefresh);
            case 'SCAN':
                return this.processScan(params.barcode, params.lote, params.caducidad, params.lineaDetalle);
            case 'UPDATE_QTY':
                this.updateItemQuantity(params.item, params.qty);
                break;
            case 'API_UPDATE':
                return this.updateOrderAPI(params.tipo);
            case 'SAVE_SESSION':
                this.storage.saveLocal(`SCAN_SESSION_${this.currentOrderNumber}`, {
                    escaneados: this.escaneados(),
                    timestamp: Date.now()
                });
                break;
            case 'SORT_PRIORITY':
                this.sortProductsByStatus();
                break;
            case 'SIMULATE_DISCREPANCIES':
                this.simulateDiscrepancies();
                break;
        }
    }

    private loadOrder(orderNumber: string, fechaDesde?: string, fechaHasta?: string, forceRefresh = false): Observable<any> {
        if (!orderNumber) return of(null);

        // v1.0.7: Detección correcta de cambio de orden (ANTES de actualizar el estado)
        const isDifferentOrder = this.currentOrderNumber !== null && this.currentOrderNumber !== orderNumber;
        this.currentOrderNumber = orderNumber;
        const savedSession = this.storage.loadLocal<any>(`SCAN_SESSION_${orderNumber}`);

        // v160.11: Si ya tenemos los datos y no es un refresh forzado, no volvemos a consultar
        if (!forceRefresh && !isDifferentOrder) {
            if (this.ordenProductos().length > 0) {
                console.log('[RevisorService] ⚡ Usando datos en memoria.');
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
                    if (headerRes?.isError || !headerRes?.ordenesDespacho || headerRes.ordenesDespacho.length === 0) {
                        this.loadingService.hide();
                        throw new Error(headerRes?.mensaje || 'La orden no existe o no se pudo cargar');
                    }

                    const m = headerRes.ordenesDespacho[0];
                    // v104.9: Guardamos la clave compuesta completa para desambiguar
                    m.numeroSolicitudOrdenDespacho = `${m.numeroSolicitud}-${m.numeroOrdenDespacho}`;
                    this.orderMetadata.set(m);
                    return this.dataService.getDetallesOrdenDespacho(m.numeroSolicitud, m.numeroOrdenDespacho);
                }),
                switchMap(detRes => {
                    if (detRes?.isError) {
                        console.error('[RevisorService] ❌ Error en detalles de orden:', detRes?.mensaje);
                        throw new Error(detRes?.mensaje || 'Error consultando detalles');
                    }
                    console.log(`[RevisorService] 📦 Productos obtenidos (${detRes?.detalles?.length || 0}). Mapeando lista...`);
                    const detalles = detRes?.detalles || [];
                    const newProducts = detalles.map((d: any, index: number) => {
                        // v1.1.3: Extracción precisa de código de barras según el JSON del usuario (vía sciExistencias o directo)
                        let barcode = d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString()?.trim();
                        if (!barcode || barcode === 'null' || barcode === '') {
                            barcode = d.codigoBarras?.toString()?.trim();
                        }
                        if (!barcode || barcode === 'null' || barcode === '') {
                            barcode = d.codigoExistencia?.toString()?.trim() || `REF-${index}-${Date.now()}`;
                        }

                        // v104.9: Creamos un ID ÚNICO combinando código y lineaDetalle
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
                            lotes: [] // Se llenará con el segundo servicio
                        };
                        return p;
                    });

                    // v1.1.3: Restaurar flujo secuencial (Detalle -> Lotes -> Bultos)
                    const meta = this.orderMetadata();
                    console.log('[RevisorService] 🛠️ Iniciando enriquecimiento secuencial (Lotes + Bultos)...');
                    
                    return forkJoin({
                        batches: from(this.fetchBatchesForAll(newProducts, meta?.codigoEmpresa || 1, meta?.numeroSolicitud, meta?.numeroOrdenDespacho)),
                        bultos: this.getTiposBultos()
                    }).pipe(
                        map(({ bultos }) => {
                            console.log('[RevisorService] 📦 Respuesta tiposBultos API:', bultos);
                            if (bultos && !bultos.isError) {
                                const rawList = bultos.tiposBultos || bultos.data || (Array.isArray(bultos) ? bultos : []);
                                this.tiposBultos.set(rawList);
                            }
                            this.ordenProductos.set(newProducts);

                            // v170.8: Priorizar SIEMPRE la recuperación de la sesión guardada si existe
                            const saved = this.storage.loadLocal<any>(`SCAN_SESSION_${this.currentOrderNumber}`);
                            if (saved && saved.escaneados && saved.escaneados.length > 0) {
                                console.log(`[RevisorService] 🧠 Restaurando sesión de ${saved.escaneados.length} items.`);
                                
                                // v1.1.3 Fix: Sincronizar lotes de la sesión con los lotes enriquecidos de la API
                                const restored = saved.escaneados.map((s: Product) => {
                                    const original = newProducts.find((p: any) => p.lineaDetalle === s.lineaDetalle);
                                    if (original && original.lotes && original.lotes.length > 0) {
                                        // Si el producto tiene lotes, asegurar que mantenemos las cantidades pistoleadas
                                        s.lotes = original.lotes.map((l: any) => {
                                            const savedLot = s.lotes?.find((sl: any) => (sl.lote || sl.codigoLote) === (l.lote || l.codigoLote));
                                            return { ...l, despachado: savedLot?.despachado || 0 };
                                        });
                                    }
                                    return s;
                                });
                                this.escaneados.set(restored);
                            } else {
                                this.escaneados.set(previousEscaneados);
                            }

                            this.isLoading = false;
                            this.loadingService.hide();
                            return true;
                        })
                    );
                }),
                catchError(err => {
                    this.isLoading = false;
                    this.loadingService.hide();
                    return throwError(() => err);
                })
            );
    }

    private async fetchBatchesForAll(products: Product[], empresa: number, solicitud: number, orden: number): Promise<void> {
        try {
            console.log(`[RevisorService] 🔍 Consultando lotes para Empresa:${empresa}, Solicitud:${solicitud}, Orden:${orden}`);
            const res = await firstValueFrom(this.dataService.executeAction<any>('GET_LOTES_EXISTENCIA_ORDEN', { 
                empresa: empresa || 1, 
                solicitud: Number(solicitud), 
                orden: Number(orden) 
            }));
            
            const allLotes = res?.lotes || res?.data || [];
            console.log(`[RevisorService] 📥 Recibidos ${allLotes.length} lotes totales.`);
            this.lotesDisponibles.set(allLotes);

            products.forEach(p => {
                const pCode = p.codigoExistencia?.toString()?.trim();
                // v1.1.3: El segundo servicio devuelve un objeto con { detalles: [...] }
                const apiItems = res?.detalles || res?.data || [];
                const apiItem = apiItems.find((l: any) => l.codigoExistencia?.toString()?.trim() === pCode);
                
                if (apiItem && apiItem.lotesXExistencia) {
                    p.lotes = apiItem.lotesXExistencia.map((l: any) => ({
                        lote: (l.codigoLote || l.lote || 'SIN LOTE').toString().trim(),
                        caducidad: l.fechaCaducidad || l.caducidad || 'N/A',
                        stock: l.saldoActualEnCajas || l.cantidadDisponible || 0,
                        // v1.4.3: Recuperar lo que ya esté despachado en este lote desde Oracle
                        despachado: Number(l.cantidadADespachar || l.cantidad || 0),
                        fechaElaboracion: l.fechaElaboracion,
                        codigoExistencia: pCode
                    }));
                    console.log(`[RevisorService] 🔗 Vinculados ${p.lotes?.length || 0} lotes a ${p.nombre} (ID: ${pCode})`);
                } else {
                    console.warn(`[RevisorService] ⚠️ No se encontraron lotes para ${p.nombre} (ID: ${pCode}) en el segundo servicio.`);
                    p.lotes = [];
                }
            });
            console.log(`[RevisorService] ✅ Vinculación de lotes finalizada.`);
        } catch (e) {
            console.error('[RevisorService] ❌ Fallo enriqueciendo lotes:', e);
        }
    }

    private processScan(barcode: string, lote?: string, caducidad?: string, lineaDetalle?: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const searchText = barcode.trim().toUpperCase();
            
            // v1.1.3: BÚSQUEDA GLOBAL DE LOTES (Si no es producto, ¿es un lote de la orden?)
            let match = this.ordenProductos().find(p => {
                if (lineaDetalle !== undefined && p.lineaDetalle === lineaDetalle) return true;
                return p.codigoBarras?.trim().toUpperCase() === searchText || p.nombre?.trim().toUpperCase() === searchText;
            });

            // Si no hay match por producto, buscamos si es un lote de CUALQUIER producto de la orden
            if (!match && !lineaDetalle) {
                const globalLot = this.lotesDisponibles().find((l: any) => l.lote?.trim().toUpperCase() === searchText);
                if (globalLot) {
                    console.log('[RevisorService] 🎯 Lote detectado globalmente:', globalLot.lote, 'para producto:', globalLot.codigoExistencia);
                    match = this.ordenProductos().find(p => Number(p.codigoExistencia) === Number(globalLot.codigoExistencia));
                    if (match) {
                        lote = globalLot.lote; // Forzamos el lote para el proceso
                        caducidad = globalLot.fechaCaducidad;
                    }
                }
            }

            if (!match) {
                return reject(new Error(`El código [${barcode}] no corresponde a un producto ni lote de esta orden.`));
            }

            // v170.5: REGLA DE NEGOCIO - No permitir agregar productos con stock 0
            if (Number(match.invBod || 0) <= 0) {
                return reject(new Error(`STOCK AGOTADO: El producto [${match.nombre}] no tiene stock disponible en bodega.`));
            }

            const currentList = this.escaneados();
            // v104.9: El matching debe ser por el ID ÚNICO (barcode|lineaDetalle)
            const existingIdx = currentList.findIndex(p => p.item === match.item);

            if (existingIdx !== -1) {
                const existing = { ...currentList[existingIdx] };
                // v1.1.3: Clonación profunda de lotes para evitar problemas de referencia
                existing.lotes = JSON.parse(JSON.stringify(existing.lotes || []));
                
                const nextQty = (Number(existing.despachado) || 0) + 1;

                // v170.6: VALIDACIÓN DE STOCK FÍSICO (BLOQUEANTE)
                if (nextQty > Number(match.invBod || 0)) {
                    return reject(new Error(`STOCK INSUFICIENTE: No se puede despachar más de ${match.invBod} unidades (Stock físico actual).`));
                }

                existing.despachado = nextQty;
                
                // v1.1.3 Fix: Regla de Negocio Estricta de Lotes
                if (lote) {
                    const lotIdx = (existing.lotes!).findIndex((l: any) => l.lote === lote);
                    if (lotIdx !== -1) {
                        (existing.lotes!)[lotIdx].despachado = (Number((existing.lotes!)[lotIdx].despachado) || 0) + 1;
                    } else {
                        (existing.lotes!).push({ lote, caducidad: caducidad || 'N/A', stock: 9999, despachado: 1 });
                    }
                } else if (existing.lotes && existing.lotes.length === 1) {
                    // Único lote -> Asignación AUTOMÁTICA
                    existing.lotes[0].despachado = existing.despachado;
                } else if (existing.lotes && existing.lotes.length > 1) {
                    // Múltiples lotes -> NO asignar automáticamente, obligar a usar la pantalla de asignación
                    console.log('[RevisorService] 👤 Múltiples lotes detectados. Requiere intervención manual.');
                    // Retornamos un flag especial para que el componente abra el modal
                    const newList = [...currentList];
                    newList[existingIdx] = existing;
                    this.escaneados.set(newList);
                    return resolve({ product: existing, isAccumulated: true, needsLotSelection: true });
                }

                // Recalcular color
                const solicita = Number(match.solicita || 0);
                if (existing.despachado > Number(match.invBod) || existing.despachado > solicita) existing.color = 'verde';
                else if (existing.despachado === solicita) existing.color = 'negro';
                else existing.color = 'azul';

                // v1.4.4: REGLA DE PRIORIDAD - Mover el producto escaneado al inicio de la lista
                const newList = [existing, ...currentList.filter(p => p.item !== existing.item)];
                this.escaneados.set(newList);
                
                // Persistencia inmediata
                this.storage.saveLocal(`SCAN_SESSION_${this.currentOrderNumber}`, { order: this.currentOrderNumber, escaneados: newList, timestamp: Date.now() });
                resolve({ product: existing, isAccumulated: true });
            } else {
                // v170.8: Producto NUEVO
                const newProd: Product = { ...match, despachado: 1, color: 'azul', lotes: JSON.parse(JSON.stringify(match.lotes || [])) };

                if (lote && newProd.lotes) {
                    const lIdx = newProd.lotes.findIndex((l: any) => l.lote === lote);
                    if (lIdx !== -1) newProd.lotes[lIdx].despachado = 1;
                    else newProd.lotes.push({ lote, caducidad: caducidad || 'N/A', stock: 9999, despachado: 1 });
                } else if (newProd.lotes && newProd.lotes.length === 1) {
                    // Único lote -> Asignación AUTOMÁTICA
                    newProd.lotes[0].despachado = 1;
                } else if (newProd.lotes && newProd.lotes.length > 1) {
                    // Múltiples lotes -> NO asignar nada, disparar selección manual
                    console.log('[RevisorService] 👤 Nuevo producto con múltiples lotes. Requiere selección.');
                    const updatedList = [newProd, ...currentList];
                    this.escaneados.set(updatedList);
                    this.storage.saveLocal(`SCAN_SESSION_${this.currentOrderNumber}`, { order: this.currentOrderNumber, escaneados: updatedList, timestamp: Date.now() });
                    return resolve({ product: newProd, isAccumulated: false, needsLotSelection: true });
                }
                
                const solicita = Number(match.solicita || 0);
                if (newProd.despachado > Number(match.invBod) || newProd.despachado > solicita) newProd.color = 'verde';
                else if (newProd.despachado === solicita) newProd.color = 'negro';

                const updatedList = [newProd, ...currentList];
                this.escaneados.set(updatedList);
                this.storage.saveLocal(`SCAN_SESSION_${this.currentOrderNumber}`, { order: this.currentOrderNumber, escaneados: updatedList, timestamp: Date.now() });
                resolve({ product: newProd, isAccumulated: false });
            }
        });
    }

    private updateItemQuantity(itemCode: string, qty: number) {
        const match = this.ordenProductos().find(p => p.item === itemCode);
        const currentList = this.escaneados();
        const idx = currentList.findIndex(p => p.item === itemCode);
        
        if (idx !== -1 && match) {
            // v170.8: Validación de stock físico
            if (qty > Number(match.invBod || 0)) {
                this.notificationService.show(`ALERTA: Cantidad (${qty}) supera el stock (${match.invBod}).`, true, "STOCK EXCEDIDO");
            }

            const updated = { ...currentList[idx], despachado: qty };
            // v1.1.3: Clonación profunda para evitar mutaciones de referencia
            updated.lotes = JSON.parse(JSON.stringify(updated.lotes || []));
            
            // v1.1.3 Fix: Regla Estricta de Edición Manual
            if (updated.lotes && updated.lotes.length === 1) {
                // Único lote -> Sincronización automática de lo que se digite
                updated.lotes[0].despachado = qty;
            } else if (match.lotes && match.lotes.length === 1) {
                // Si el escaneado no tenía lotes pero el original sí (1 solo), los recuperamos y asignamos
                updated.lotes = JSON.parse(JSON.stringify(match.lotes));
                (updated.lotes!)[0].despachado = qty;
            } else if ((updated.lotes && updated.lotes.length > 1) || (match.lotes && match.lotes.length > 1)) {
                // Bloqueo total si cualquiera tiene múltiples lotes
                console.warn('[RevisorService] 🚫 Bloqueo: Producto multi-lote detectado en base original o actual.');
                return;
            }
            
            // Recalcular color
            const solicita = Number(match.solicita || 0);
            if (updated.despachado > Number(match.invBod) || updated.despachado > solicita) updated.color = 'verde';
            else if (updated.despachado === solicita) updated.color = 'negro';
            else updated.color = 'azul';
            
            const newList = [...currentList];
            newList[idx] = updated;
            this.escaneados.set(newList);

            // Respaldo inmediato en disco
            this.storage.saveLocal(`SCAN_SESSION_${this.currentOrderNumber}`, { order: this.currentOrderNumber, escaneados: newList, timestamp: Date.now() });
        }
    }

    updateOrderAPI(tipo?: string): Observable<any> {
        const meta = this.orderMetadata();
        if (!meta) return of({ isError: true, mensaje: 'Sin metadata' });

        const lotesXExistencia: any[] = [];
        const allBaseProducts = this.ordenProductos();
        const scannedProducts = this.escaneados();

        // v1.1.3: Combinar base con escaneados para enviar la orden COMPLETA
        const detalles = allBaseProducts.map(baseP => {
            const scannedP = scannedProducts.find(s => s.item === baseP.item);
            
            // v1.4.2: Si NO está escaneado, FORZAMOS 0. 
            // Ignoramos cualquier valor previo que venga de la base de datos (p.despachado).
            const despachadoTotal = scannedP ? Number(scannedP.despachado || 0) : 0;
            
            const p = scannedP || baseP;
            const pCode = Number(p.codigoExistencia);

            if (despachadoTotal > 0 && p.lotes && p.lotes.length > 0) {
                p.lotes.forEach(l => {
                    if (Number(l.despachado) > 0) {
                        lotesXExistencia.push({
                            codigoLote: l.lote || l.codigoLote,
                            codigoExistencia: pCode,
                            fechaElaboracion: l.fechaElaboracion || new Date().toLocaleDateString('es-EC'),
                            fechaCaducidad: l.caducidad || l.fechaCaducidad || '31/12/2099',
                            cantidadADespachar: Number(l.despachado)
                        });
                    }
                });
            }

            return {
                lineaDetalle: p.lineaDetalle,
                codigoExistencia: pCode,
                unidadesXCaja: p.unidadesXCaja || 1,
                cantidad: Number(p.solicita || 0),
                cantidadADespachar: despachadoTotal,
                cantidadCajas: Math.floor(despachadoTotal / (p.unidadesXCaja || 1)),
                cantidadUnidades: despachadoTotal,
                grupoUnidadMedidaStockBase: null,
                unidadMedidaStockBase: null,
                cantidadUnidadMedidaStockB: despachadoTotal,
                cantidadBaseEquivalente: despachadoTotal,
                observacion: p.observacion || 'DESPACHO_BODEGA_V1',
                codigoEstado: 'ING',
                esActivo: 'S'
            };
        });

        const payload = {
            codigoEmpresa: Number(meta.codigoEmpresa || 1),
            numeroSolicitud: Number(meta.numeroSolicitud),
            numeroOrdenDespacho: Number(meta.numeroOrdenDespacho),
            codigoUsuario: this.authService?.getStoredUser()?.username || 'DFAJARDO',
            detalles: detalles,
            lotesXExistencia: lotesXExistencia
        };

        console.log('[RevisorService] 🚀 ENVIANDO ACTUALIZACIÓN FINAL:', payload);
        return this.dataService.executeAction<any>('ACTUALIZAR_ORDEN_DETALLES', payload);
    }

    finalizeProcess(bultos: any[]): Observable<any> {
        const meta = this.orderMetadata();
        if (!meta) {
            return of({ isError: true, mensaje: 'No hay metadata para finalizar' });
        }

        // v1.1.3: Mapeo exacto de cabecera para producción
        const payload = {
            codigoEmpresa: Number(meta.codigoEmpresa || 1),
            solicitud: Number(meta.numeroSolicitud),
            orden: Number(meta.numeroOrdenDespacho),
            bultos: bultos
                .filter(b => (b.codigoTipoBulto || b.codigo) !== 999) // v1.4.0: Excluir código virtual de etiquetas
                .map((b, index) => ({
                    lineaDetalle: index + 1,
                    codigoTipoBulto: b.codigoTipoBulto || b.codigo,
                    cantidad: Number(b.cantidad)
                }))
        };

        return this.dataService.executeAction<any>('UPDATE_ORDEN_DETALLES', payload);
    }

    getValidationErrors(): any[] {
        const errors: any[] = [];
        const escaneados = this.escaneados();
        const originales = this.ordenProductos();

        escaneados.forEach(e => {
            const orig = originales.find(o => o.item === e.item);
            if (!orig) {
                errors.push({ type: 'NOT_FOUND', item: e.item, message: 'Producto no pertenece a la orden', isCritical: true, detail: e.nombre });
            } else {
                if (Number(e.despachado) > Number(orig.solicita)) {
                    errors.push({ type: 'EXCEEDED', item: e.item, message: 'Cantidad excede lo solicitado', isCritical: true, detail: `${e.nombre} (${e.despachado} > ${orig.solicita})` });
                }
                if (Number(e.despachado) > Number(orig.invBod || 0)) {
                    errors.push({ type: 'STOCK', item: e.item, message: 'Stock insuficiente en bodega', isCritical: true, detail: `${e.nombre} (Stock: ${orig.invBod})` });
                }
            }
        });

        // v160.8: Auditoría de productos faltantes o incompletos (No Crítico)
        originales.forEach(orig => {
            const esc = escaneados.find(e => e.item === orig.item);
            if (!esc) {
                errors.push({ type: 'MISSING', item: orig.item, message: 'Producto no pistoleado', isCritical: false, detail: orig.nombre });
            } else if (Number(esc.despachado) < Number(orig.solicita)) {
                errors.push({ type: 'INCOMPLETE', item: orig.item, message: 'Cantidad menor a lo solicitado', isCritical: false, detail: `${orig.nombre} (${esc.despachado} de ${orig.solicita})` });
            }
        });

        return errors;
    }

    eliminarItem(itemCode: string) {
        this.escaneados.update(list => list.filter(p => p.item !== itemCode));
    }

    resetearDespacho() {
        this.escaneados.set([]);
        this.storage.saveLocal(`SCAN_SESSION_${this.currentOrderNumber}`, {
            escaneados: [],
            timestamp: Date.now()
        });
    }

    purgeAllSessions() {
        // v1.4.1: NO ELIMINAR del disco (localStorage) para permitir recuperación tras cierres o actualizaciones.
        // Solo limpiamos la memoria reactiva (Signals)
        console.log('[RevisorService] 🧹 Limpiando memoria de sesión (Preservando respaldos en disco)');

        // Reset de Signals en Memoria
        this.escaneados.set([]);
        this.ordenProductos.set([]);
        this.lotesDisponibles.set([]);
        this.tiposBultos.set([]);
        this.orderMetadata.set(null);
        this.currentOrderNumber = null;

        this.notificationService.show('Sistema limpiado: Memoria y Sesiones eliminadas.', false, 'LIMPIEZA TOTAL');
    }

    private sortProductsByStatus() {
        const list = [...this.escaneados()];
        list.sort((a, b) => {
            if (a.color === 'rojo' && b.color !== 'rojo') return -1;
            if (a.color !== 'rojo' && b.color === 'rojo') return 1;
            return 0;
        });
        this.escaneados.set(list);
    }

    private simulateDiscrepancies() {
        const current = this.escaneados();
        if (current.length > 0) {
            const updated = [...current];
            updated[0] = { ...updated[0], despachado: Number(updated[0].despachado) + 100, color: 'rojo' };
            this.escaneados.set(updated);
        }
    }

    revisarEstadoOrden(numero: string, fd?: string, fh?: string) {
        this.dataService.login().subscribe(() => {
            this.dataService.executeAction<any>('GET_ORDEN_DESPACHO', { numero, fechaDesde: fd, fechaHasta: fh }).subscribe(res => {
                if (res?.ordenesDespacho?.length > 0) {
                    const m = res.ordenesDespacho[0];
                    m.numeroSolicitudOrdenDespacho = `${m.numeroSolicitud}-${m.numeroOrdenDespacho}`;
                    this.orderMetadata.set(m);
                }
            });
        });
    }

    clearCurrentSession() {
        if (this.currentOrderNumber) {
            console.log(`[RevisorService] 🗑️ Eliminando respaldo local de la orden finalizada: ${this.currentOrderNumber}`);
            localStorage.removeItem(`SCAN_SESSION_${this.currentOrderNumber}`);
        }
        this.purgeAllSessions();
    }
}
