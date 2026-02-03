import { Injectable, signal, inject } from '@angular/core';
import { Product } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';
import { StorageService } from '../../../core/services/storage.service';

@Injectable({
    providedIn: 'root'
})
export class RevisorService {
    private dataService = inject(DataService);
    private storage = inject(StorageService);

    // Estados reactivos (Signals)
    public ordenProductos = signal<Product[]>([]);
    public escaneados = signal<Product[]>([]);
    private currentOrderNumber = "";

    // FLAG DE BÚSQUEDA EXTERNA (v30.0)
    // Cuando esté activo, permitirá buscar productos fuera de la orden original vía REST.
    private enableExternalLookup = false;

    // Diccionario de Unidades Parametrizadas
    private readonly UNIT_DESCRIPTIONS: Record<string, string> = {
        'C': 'CAJA',
        'P': 'PAQUETE',
        'F': 'FRASCO'
    };

    /**
     * MÉTODO ORQUESTADOR (Action Executor)
     * Centraliza el proceso de negocio solicitado por el componente.
     */
    public executeProcess(action: 'LOAD' | 'SCAN' | 'UPDATE_QTY' | 'SAVE_SESSION' | 'SIMULATE_DISCREPANCIES', payload?: any) {
        switch (action) {
            case 'LOAD':
                this.loadOrder(payload.orderNumber);
                break;
            case 'SCAN':
                return this.processBarcode(payload.barcode);
            case 'UPDATE_QTY':
                this.updateQuantity(payload.item, payload.qty);
                break;
            case 'SAVE_SESSION':
                this.persistCurrentState();
                break;
            case 'SIMULATE_DISCREPANCIES':
                this.simularDiscrepancias();
                break;
        }
        return null;
    }

    /**
     * Persiste el estado actual de la sesión (Orden + Escaneados) en el disco local.
     * Esto asegura que se pueda retomar el trabajo tras un fallo de luz o reinicio.
     */
    private persistCurrentState() {
        if (!this.currentOrderNumber) return;

        const sessionState = {
            orderNumber: this.currentOrderNumber,
            ordenProductos: this.ordenProductos(),
            escaneados: this.escaneados(),
            timestamp: new Date().toISOString(),
            version: '2.0'
        };

        // Guardamos en LocalStorage y archivo físico (.json) automáticamente
        this.storage.saveLocal(`REVISION_SESSION_${this.currentOrderNumber}`, sessionState);
    }

    private loadOrder(orderNumber: string) {
        this.currentOrderNumber = orderNumber;
        const storageKey = `REVISION_SESSION_${orderNumber}`;

        // 1. Intentamos recuperar sesión previa desde el disco local (Blindaje v28.0)
        const savedSession = this.storage.loadLocal<any>(storageKey);

        if (savedSession && savedSession.orderNumber === orderNumber) {
            console.log(`[RevisorService] Recuperando sesión local para la orden: ${orderNumber}`);
            this.ordenProductos.set(savedSession.ordenProductos || []);
            this.escaneados.set(savedSession.escaneados || []);
            return; // Sesión recuperada con éxito, no consultamos al servidor
        }

        // 2. Si no hay sesión local, consultamos la base de datos central
        this.dataService.executeAction<Product[]>('GET_ORDER_PRODUCTS', { orderNumber })
            .subscribe(products => {
                this.ordenProductos.set(products);
                // Inicializamos escaneados vacío o con lógica de carga inicial si aplica
                this.escaneados.set([]);

                // Guardamos el estado inicial en el disco
                this.persistCurrentState();
            });
    }

    private processBarcode(barcode: string): { product: Product, isAccumulated: boolean } | null {
        if (!barcode) return null;

        // 1. Buscamos primero en lo que ya está en la grilla de "Despachados" para acumular
        const scannedIndex = this.escaneados().findIndex(p =>
            p.item.includes(barcode) || p.nombre.toLowerCase().includes(barcode.toLowerCase())
        );

        if (scannedIndex !== -1) {
            // Si ya existe, tomamos el actual y sumamos +1
            const product = { ...this.escaneados()[scannedIndex] };
            product.despachado++;

            // Buscamos su índice en la orden original para actualizar el estado global
            const originalIndex = this.ordenProductos().findIndex(p => p.item === product.item);

            this.updateColorLogic(product);
            this.updateState(product, originalIndex);
            return { product, isAccumulated: true };
        }

        // 2. Si no está en despachados, lo buscamos en la orden original (primer escaneo de este item)
        const productIndex = this.ordenProductos().findIndex(p =>
            p.item.includes(barcode) || p.nombre.toLowerCase().includes(barcode.toLowerCase())
        );

        if (productIndex !== -1) {
            const product = { ...this.ordenProductos()[productIndex] };
            product.despachado = 1; // Primer pistoleo
            product.bulto = 1;      // Valor por defecto solicitado

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
            list[index].color = product.color === 'negro' ? 'completado' : 'naranja';
            return [...list];
        });

        // Al finalizar cualquier cambio de estado, persistimos en el disco (Blindaje v28.0)
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
     * Retorna la descripción parametrizada de una unidad de medida.
     */
    public getUnitDescription(code: string): string {
        const cleanCode = code?.trim().toUpperCase() || '';
        return this.UNIT_DESCRIPTIONS[cleanCode] || code;
    }

    /**
     * Fuerza la persistencia del estado actual. Útil para cambios manuales por referencia.
     */
    public saveSession() {
        this.persistCurrentState();
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
        // 1. Limpiar lista de escaneados
        this.escaneados.set([]);

        // 2. Restaurar estados en la orden original
        this.ordenProductos.update(list => {
            return list.map(p => {
                p.despachado = 0;
                p.color = 'naranja';
                return p;
            });
        });

        // 3. Persistir la limpieza total en el disco
        this.persistCurrentState();
    }

    /**
     * V31.0: Retorna una lista de errores de validación para el cierre del despacho.
     */
    public getValidationErrors(): { type: 'TYPES' | 'QTY' | 'BULTO', message: string, detail?: string }[] {
        const errors: { type: 'TYPES' | 'QTY' | 'BULTO', message: string, detail?: string }[] = [];
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
                const status = despachado === 0 ? "FALTANTE TOTAL" : (diff > 0 ? "SOBRANTE" : "FALTANTE PARCIAL");

                errors.push({
                    type: 'QTY',
                    message: `${status}: ${o.nombre}`,
                    detail: `Solicitado: ${o.solicita} | Despachado: ${despachado} (Dif: ${diff})`
                });
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
     * V31.0: Ejecuta el envío final de la orden procesada.
     */
    public finalizeProcess() {
        console.log('[RevisorService] Ejecutando POST final de despacho...', {
            order: this.currentOrderNumber,
            data: this.escaneados()
        });

        /**
         * TODO: Al confirmar el servicio POST:
         * this.dataService.post('URL_CONFIRMADA', payload).subscribe(...)
         */

        // Limpieza de sesión tras éxito (simulado)
        this.storage.clearLocal(`REVISION_SESSION_${this.currentOrderNumber}`);
    }
}
