import { Component, signal, computed, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PedidoService } from '../services/pedido.service';
import { Product } from '../../../shared/models/product.model';

@Component({
    selector: 'app-pedido-creacion',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './pedido-creacion.component.html',
    styleUrl: './pedido-creacion.component.css'
})
export class PedidoCreacionComponent implements OnInit {
    private pedidoService = inject(PedidoService);

    @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

    // Estados de UI
    searchQuery = "";
    searchResults = signal<Product[]>([]);
    carrito = this.pedidoService.carrito;

    // Totales calculados
    totalItems = computed(() => this.carrito().length);
    puntosTotales = computed(() => this.carrito().reduce((acc, p) => acc + (p.solicita || 0), 0));

    // Estados de Notificación (Toast)
    notificationMessage = signal("");
    isError = signal(false);

    // Estados de Modal Custom
    modalVisible = signal(false);
    modalTitle = signal("");
    modalMessage = signal("");
    modalIcon = signal("⚠️");
    modalType = signal<'confirm' | 'alert'>('confirm');
    private modalResolve?: (value: boolean) => void;

    ngOnInit() {
        this.focusSearch();
    }

    onSearch() {
        if (this.searchQuery.length < 2) {
            this.searchResults.set([]);
            return;
        }
        const results = this.pedidoService.buscarProductos(this.searchQuery);
        this.searchResults.set(results);
    }

    agregarProducto(producto: Product, qtyInput: HTMLInputElement) {
        const qty = parseInt(qtyInput.value);
        if (isNaN(qty) || qty <= 0) {
            this.showToast("Ingrese una cantidad válida", true);
            return;
        }
        this.pedidoService.agregarAlPedido(producto, qty);
        this.showToast(`Agregado: ${producto.nombre}`, false);
        qtyInput.value = "";
        this.searchQuery = "";
        this.searchResults.set([]);
        this.focusSearch();
    }

    eliminarProducto(item: string) {
        this.pedidoService.eliminarDelPedido(item);
        this.showToast("Producto eliminado del pedido", false);
    }

    async enviarPedido() {
        if (this.carrito().length === 0) {
            this.showToast("El pedido está vacío", true);
            return;
        }

        const confirmacion = await this.openModal(
            "Confirmar Envío",
            `¿Desea enviar este pedido de <b>${this.totalItems()} ítems</b> a la bodega principal?`,
            "local_shipping",
            "confirm"
        );

        if (confirmacion) {
            this.pedidoService.enviarPedido();
            this.showToast("¡PEDIDO ENVIADO CON ÉXITO!", false);
            setTimeout(() => this.cerrarPantalla(), 2000);
        }
    }

    async resetearPedido() {
        const confirmacion = await this.openModal(
            "Borrar Todo",
            "¿Desea vaciar completamente su carrito de pedido?",
            "delete_forever",
            "confirm"
        );
        if (confirmacion) {
            this.pedidoService.limpiarPedido();
            this.showToast("Pedido limpiado", false);
        }
    }

    focusSearch() {
        setTimeout(() => this.searchInput?.nativeElement.focus(), 100);
    }

    private showToast(message: string, isError: boolean) {
        this.isError.set(isError);
        this.notificationMessage.set(message);
        setTimeout(() => this.notificationMessage.set(""), 3000);
    }

    // MODAL LOGIC
    private openModal(title: string, message: string, icon: string, type: 'confirm' | 'alert'): Promise<boolean> {
        this.modalTitle.set(title);
        this.modalMessage.set(message);
        this.modalIcon.set(icon);
        this.modalType.set(type);
        this.modalVisible.set(true);
        return new Promise((resolve) => this.modalResolve = resolve);
    }

    closeModal(result: boolean) {
        this.modalVisible.set(false);
        this.modalResolve?.(result);
    }

    cerrarPantalla() {
        window.history.back();
    }
}
