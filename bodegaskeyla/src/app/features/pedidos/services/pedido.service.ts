import { Injectable, signal, inject } from '@angular/core';
import { Product } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';
import { StorageService } from '../../../core/services/storage.service';

@Injectable({
    providedIn: 'root'
})
export class PedidoService {
    private dataService = inject(DataService);
    private storage = inject(StorageService);

    // Estado reactivo del pedido actual
    public carrito = signal<Product[]>([]);

    // Catálogo maestro (simulado o cargado desde DB)
    public catalogo = signal<Product[]>([]);

    private readonly STORAGE_KEY = 'PEDIDO_EN_CURSO_FARMACIA';

    constructor() {
        this.loadInitialState();
    }

    private loadInitialState() {
        // Recuperar pedido guardado si existe
        const saved = this.storage.loadLocal<Product[]>(this.STORAGE_KEY);
        if (saved) {
            this.carrito.set(saved);
        }

        // Cargar catálogo inicial (Mock o DB)
        this.dataService.executeAction<Product[]>('GET_CATALOG_PRODUCTS', {})
            .subscribe(products => {
                this.catalogo.set(products);
            });
    }

    public buscarProductos(termino: string): Product[] {
        if (!termino) return [];
        const t = termino.toLowerCase();
        return this.catalogo().filter(p =>
            p.item.toLowerCase().includes(t) ||
            p.nombre.toLowerCase().includes(t)
        );
    }

    public agregarAlPedido(producto: Product, cantidad: number) {
        if (cantidad <= 0) return;

        this.carrito.update(list => {
            const index = list.findIndex(p => p.item === producto.item);
            if (index !== -1) {
                // Si ya existe, actualizamos cantidad
                const updated = [...list];
                updated[index] = { ...updated[index], solicita: cantidad };
                return updated;
            } else {
                // Si es nuevo, lo agregamos como solicitud
                const nuevo = { ...producto, solicita: cantidad, despachado: 0, color: 'naranja' };
                return [...list, nuevo];
            }
        });

        this.saveCurrentState();
    }

    public eliminarDelPedido(itemCode: string) {
        this.carrito.update(list => list.filter(p => p.item !== itemCode));
        this.saveCurrentState();
    }

    public limpiarPedido() {
        this.carrito.set([]);
        this.storage.clearLocal(this.STORAGE_KEY);
    }

    private saveCurrentState() {
        this.storage.saveLocal(this.STORAGE_KEY, this.carrito());
    }

    public enviarPedido() {
        const pedidoFinal = this.carrito();
        console.log('[PedidoService] Enviando pedido a bodega...', pedidoFinal);

        // Simulación de envío exitoso
        this.limpiarPedido();
        return true;
    }
}
