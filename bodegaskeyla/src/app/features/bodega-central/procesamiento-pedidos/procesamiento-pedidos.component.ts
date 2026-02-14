import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BodegaService } from '../services/bodega.service';

@Component({
    selector: 'app-procesamiento-pedidos',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './procesamiento-pedidos.component.html',
    styleUrl: './procesamiento-pedidos.component.css'
})
export class ProcesamientoPedidosComponent implements OnInit {
    public bodegaService = inject(BodegaService);

    // Estados de UI
    sucursalSeleccionada = "";
    numeroOrden = "";
    fechaActual = new Date().toLocaleString();
    isCargando = signal(false);
    ordenProductos = this.bodegaService.ordenActual;
    secuencia = this.bodegaService.secuenciaActual;

    // Estados de Modal Custom
    modalVisible = signal(false);
    modalTitle = signal("");
    modalMessage = signal("");
    modalIcon = signal("⚠️");
    modalType = signal<'confirm' | 'alert'>('confirm');
    private modalResolve?: (value: boolean) => void;

    // Toast
    notificationMessage = signal("");
    isError = signal(false);

    ngOnInit() { }

    async buscarPedido() {
        if (!this.sucursalSeleccionada) {
            this.showToast("Debe seleccionar una sucursal", true);
            return;
        }

        const deseaCargar = await this.openModal(
            "Carga de Información",
            `¿Desea cargar la información del pedido de la sucursal <b>${this.sucursalSeleccionada}</b>?`,
            "cloud_download",
            "confirm"
        );

        if (deseaCargar) {
            this.ejecutarFlujoSincronizacion();
        }
    }

    private async ejecutarFlujoSincronizacion() {
        this.isCargando.set(true);
        this.showToast(`Conectando al Punto de Venta ${this.sucursalSeleccionada}...`, false);

        try {
            const result = await this.bodegaService.conectarYObtenerPedido(this.sucursalSeleccionada);
            this.isCargando.set(false);

            // 19. Mostrar cantidad de items
            await this.openModal(
                "Info de Carga",
                `<div style="text-align:center; padding:10px;">
                    <span class="material-icons" style="font-size:48px; color:var(--accent-color);">check_circle</span>
                    <p style="font-size:1.1rem; margin-top:10px;">Usted va a cargar <b>${result.total} ítems</b></p>
                </div>`,
                "inventory_2",
                "alert"
            );

            // 20. Notificar excluidos si existen
            if (result.excluidos > 0) {
                await this.openModal(
                    "Verificación de Bloqueos",
                    `<div style="text-align:left;">
                        <p style="color:var(--danger-color); font-weight:700;">AVISO DE EXCLUSIÓN:</p>
                        <p>Se han detectado <b>${result.excluidos} productos bloqueados</b>.</p>
                        <p style="font-size:0.85rem; color:#636e72; margin-top:10px;">Dichos productos han sido excluidos automáticamente de la carga por seguridad.</p>
                    </div>`,
                    "block",
                    "alert"
                );
            }

            this.showToast("Carga finalizada correctamente", false);

        } catch (error) {
            this.isCargando.set(false);
            this.showToast("Error en la conexión con el servidor POS", true);
        }
    }

    async aceptarYGuardar() {
        this.bodegaService.ordenarPorEstado(); // v42.0: Primero detectar faltantes/sobrantes
        if (this.ordenProductos().length === 0) {
            this.showToast("No hay información cargada para guardar", true);
            return;
        }

        const confirm = await this.openModal(
            "Guardar Procesamiento",
            "¿Desea finalizar el procesamiento y generar el número de pedido oficial?",
            "save",
            "confirm"
        );

        if (confirm) {
            const num = this.bodegaService.generarNuevoPedido();
            this.numeroOrden = num.toString();

            await this.openModal(
                "Proceso Exitoso",
                `<div style="text-align:center;">
                    <p>Se ha generado el pedido número:</p>
                    <h2 style="font-size:2.5rem; color:var(--accent-color); margin:15px 0;">${num}</h2>
                    <p style="font-size:0.85rem; color:#666;">Se han enviado las tirillas de despacho a las impresoras térmicas asignadas.</p>
                </div>`,
                "receipt",
                "alert"
            );

            this.bodegaService.limpiarOrden();
            this.sucursalSeleccionada = "";
            this.numeroOrden = "";
        }
    }

    private showToast(message: string, isError: boolean) {
        this.isError.set(isError);
        this.notificationMessage.set(message);
        setTimeout(() => this.notificationMessage.set(""), 3000);
    }

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

    siguientePrioridad() {
        this.bodegaService.ordenarPorEstado();
        this.showToast("Lista organizada por prioridad de discrepancia", false);
    }

    cerrarPantalla() {
        window.history.back();
    }
}
