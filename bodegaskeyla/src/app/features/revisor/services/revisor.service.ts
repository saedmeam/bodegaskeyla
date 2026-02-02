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

    /**
     * MÉTODO ORQUESTADOR (Action Executor)
     * Centraliza el proceso de negocio solicitado por el componente.
     */
    public executeProcess(action: 'LOAD' | 'SCAN' | 'UPDATE_QTY', payload: any) {
        switch (action) {
            case 'LOAD':
                this.loadOrder(payload.orderNumber);
                break;
            case 'SCAN':
                return this.processBarcode(payload.barcode);
            case 'UPDATE_QTY':
                this.updateQuantity(payload.item, payload.qty);
                break;
        }
        return null;
    }

    /**
     * Persiste el comparativo de la orden consultada en el ambiente local.
     * Solo se llama cuando se ingresa/carga una orden inicialmente.
     */
    private persistInitialOrder(products: Product[]) {
        const state = {
            orden: products,
            timestamp: new Date().toISOString()
        };
        // Guardamos en el ambiente local (LocalStorage + Archivo TXT vía StorageService)
        this.storage.saveLocal(`ORDER_COMP_ID_${this.currentOrderNumber}`, state);
    }

    private loadOrder(orderNumber: string) {
        this.currentOrderNumber = orderNumber;

        // 1. Intentamos consultar la base de datos (vía DataService con su propia lógica Offline-First)
        this.dataService.executeAction<Product[]>('GET_ORDER_PRODUCTS', { orderNumber })
            .subscribe(products => {
                // 2. Cargamos en memoria para visualizar en pantalla
                this.ordenProductos.set(products);
                this.escaneados.set([]);

                // 3. Persistimos el comparativo consultado para que esté disponible localmente (a prueba de fallos)
                this.persistInitialOrder(products);
            });
    }

    private processBarcode(barcode: string): Product | null {
        if (!barcode) return null;

        const productIndex = this.ordenProductos().findIndex(p =>
            p.item.includes(barcode) || p.nombre.toLowerCase().includes(barcode.toLowerCase())
        );

        if (productIndex !== -1) {
            const product = { ...this.ordenProductos()[productIndex] };
            product.despachado++;

            this.updateColorLogic(product);
            this.updateState(product, productIndex);
            return product;
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
    }

    private updateQuantity(item: string, qty: number) {
        const productIndex = this.ordenProductos().findIndex(p => p.item === item);
        if (productIndex !== -1) {
            const product = { ...this.ordenProductos()[productIndex] };
            product.despachado = qty;
            this.updateColorLogic(product);
            this.updateState(product, productIndex);
        }
    }
}
