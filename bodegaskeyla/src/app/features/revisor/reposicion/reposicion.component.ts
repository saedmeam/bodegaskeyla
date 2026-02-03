import { Component, signal, computed, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RevisorService } from '../services/revisor.service';

@Component({
    selector: 'app-reposicion',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './reposicion.component.html',
    styleUrl: './reposicion.component.css'
})
export class ReposicionComponent implements OnInit {
    public revisorService = inject(RevisorService);

    @ViewChild('scannerInput') scannerInput!: ElementRef<HTMLInputElement>;

    // Estados de UI
    numero = "";
    fecha = new Date().toLocaleString();
    movimiento = "";
    movimientoNombre = "";
    bodega = "";
    concepto = "";
    barcodeInput = "";
    showComparativo = signal(true);

    // Estados de Modal Custom (v35.0)
    modalVisible = signal(false);
    modalTitle = signal("");
    modalMessage = signal("");
    modalIcon = signal("⚠️");
    modalType = signal<'confirm' | 'alert'>('confirm');
    private modalResolve?: (value: boolean) => void;

    // Proyecciones del servicio orquestador
    ordenProductos = this.revisorService.ordenProductos;
    escaneados = this.revisorService.escaneados;

    totalItems = computed(() => this.ordenProductos().length);
    totalCorrectos = computed(() => this.escaneados().filter(p => p.color === 'negro').length);
    totalIncompletos = computed(() => this.escaneados().filter(p => p.color === 'azul').length);

    ngOnInit() {
        // La pantalla inicia vacía. El usuario debe ingresar una orden.
    }

    consultarOrden() {
        if (!this.numero || this.numero.trim() === "") {
            // Si el campo está vacío, limpiamos todo para mayor seguridad
            this.bodega = "";
            this.movimiento = "";
            this.movimientoNombre = "";
            this.concepto = "";
            return;
        }

        this.notificationMessage.set(`Consultando orden ${this.numero}...`);

        // Simulación: Al consultar, poblamos los campos bloqueados desde la "DB"
        this.revisorService.executeProcess('LOAD', { orderNumber: this.numero });

        // Simulamos la respuesta de cabecera
        setTimeout(() => {
            this.bodega = "001";
            this.movimiento = "057";
            this.movimientoNombre = "REPOSICIÓN AUTOMÁTICA";
            this.concepto = `Revisión de Orden #${this.numero}`;
            this.showToast(`Orden ${this.numero} cargada con éxito.`, false);
        }, 1000);
    }

    manualSelect(item: string) {
        this.barcodeInput = item;
        this.simularEscaneo();
    }

    notificationMessage = signal("");
    isError = signal(false);

    simularEscaneo() {
        if (!this.barcodeInput) return;

        // REGLA DE NEGOCIO: No permitir pistoleo si no hay orden cargada
        if (this.ordenProductos().length === 0) {
            this.showToast("ERROR: Debe cargar una orden antes de pistolear.", true);
            this.barcodeInput = "";
            return;
        }

        // Uso del método orquestador
        const result = this.revisorService.executeProcess('SCAN', { barcode: this.barcodeInput });

        if (!result) {
            this.showToast(`ERROR: [${this.barcodeInput}] No pertenece a esta orden.`, true);
        } else {
            if (result.isAccumulated) {
                this.showToast(`ESTA EXISTENCIA YA EXISTE, SE SUMARÁ A LO DESPACHADO.`, false);
            } else {
                this.showToast(`OK: [${result.product.item}] Registrado con éxito.`, false);
            }
        }

        this.barcodeInput = "";
    }

    private showToast(message: string, isError: boolean = false) {
        this.isError.set(isError);
        this.notificationMessage.set(message);
        setTimeout(() => {
            if (this.notificationMessage() === message) {
                this.notificationMessage.set("");
            }
        }, 4000);
        this.focusScanner();
    }

    focusScanner() {
        // Un pequeño delay asegura que el DOM se haya estabilizado
        setTimeout(() => {
            if (this.scannerInput && !this.modalVisible()) {
                this.scannerInput.nativeElement.focus();
                this.scannerInput.nativeElement.select();
            }
        }, 150);
    }

    // GESTIÓN DE MODAL CUSTOM
    private openModal(title: string, message: string, icon: string = "⚠️", type: 'confirm' | 'alert' = 'confirm'): Promise<boolean> {
        this.modalTitle.set(title);
        this.modalMessage.set(message);
        this.modalIcon.set(icon);
        this.modalType.set(type);
        this.modalVisible.set(true);

        return new Promise((resolve) => {
            this.modalResolve = resolve;
        });
    }

    closeModal(result: boolean) {
        this.modalVisible.set(false);
        if (this.modalResolve) {
            this.modalResolve(result);
        }
        this.focusScanner();
    }

    async eliminarItem(item: string) {
        const aceptado = await this.openModal("Eliminar Producto", `¿Está seguro que desea eliminar el producto <b>${item}</b> del despacho?`, "🗑️", "confirm");

        if (aceptado) {
            this.revisorService.eliminarItem(item);
            this.showToast("Ítem eliminado correctamente.", false);
        }
    }

    updateQty(item: string, qty: number) {
        this.revisorService.executeProcess('UPDATE_QTY', { item, qty });
    }

    toggleComparativo() {
        this.showComparativo.update(v => !v);
    }

    /**
     * Guarda un borrador de la sesión actual firmando la persistencia en disco.
     */
    guardarBorrador() {
        this.revisorService.executeProcess('SAVE_SESSION', null);
        this.showToast("BORRADOR GUARDADO: Sesión asegurada en disco local.", false);
        this.focusScanner();
    }

    /**
     * V37.0: Activa el escenario de pruebas con discrepancias.
     */
    simularEscenarioDiscrepancias() {
        this.revisorService.executeProcess('SIMULATE_DISCREPANCIES');
        this.showToast("MODO LABORATORIO: Discrepancias cargadas para validación.", false);
        this.focusScanner();
    }
    /**
     * Cierra la pantalla y regresa al menú anterior.
     */
    cerrarPantalla() {
        // En una app Electron/Angular real se usaría el Router,
        // pero history.back() es una solución estándar segura para navegación.
        window.history.back();
    }

    /**
     * Limpia por completo el despacho de la orden actual.
     */
    /**
     * Limpia por completo el despacho de la orden actual.
     */
    async resetearTodo() {
        const confirmacion = await this.openModal("Reset Maestro", "¿Está seguro de ELIMINAR todo lo despachado? Esta acción no se puede deshacer y reiniciará el proceso.", "🛡️", "confirm");
        if (confirmacion) {
            this.revisorService.resetearDespacho();
            this.showToast("ORDEN REINICIADA: Se han eliminado todos los pistoleos.", false);
        }
    }

    /**
     * V31.0: Proceso de finalización del despacho con validación multietapa.
     * Se vincula al botón "Agregar" (que actúa como Procesar/Enviar).
     */
    async finalizar() {
        const errors = this.revisorService.getValidationErrors();

        if (errors.length === 0) {
            this.ejecutarEnvioFinal();
            return;
        }

        // v39.1: Consolidación Pro de Discrepancias con Scroll
        let messageHtml = `<div style="text-align:left; font-family:inherit;">`;
        messageHtml += `<p style="margin-bottom:15px; font-weight:700; color:#e17055; display:flex; align-items:center; gap:8px;">
                            <span class="material-icons" style="font-size:20px;">info</span>
                            Se han detectado discrepancias que requieren su atención:
                         </p>`;

        messageHtml += `<div style="display:flex; flex-direction:column; gap:8px;">`;

        errors.forEach(err => {
            const getColor = () => {
                if (err.type === 'TYPES') return '#0984e3'; // Azul
                if (err.type === 'QTY') return '#d63031'; // Rojo
                return '#6c5ce7'; // Morado para bultos
            };
            const color = getColor();

            messageHtml += `
                <div style="padding:12px; background:#fdfdfd; border-radius:10px; border:1px solid #eee; border-left:5px solid ${color};">
                    <div style="font-weight:800; font-size:0.8rem; color:#2d3436; text-transform:uppercase; letter-spacing:0.5px; display:flex; justify-content:space-between;">
                        <span>${err.message}</span>
                    </div>
                    <div style="font-size:0.75rem; color:#636e72; margin-top:4px; line-height:1.4;">
                        ${err.detail}
                    </div>
                </div>`;
        });

        messageHtml += `</div>`;
        messageHtml += `<p style="margin-top:20px; font-size:0.85rem; color:#2d3436; text-align:center; padding-top:15px; border-top:1px dashed #ddd;">
                            ¿Desea <b>IGNORAR</b> estos errores y proceder con el envío final?
                        </p>`;
        messageHtml += `</div>`;

        const aceptado = await this.openModal("📋 AUDITORÍA DE CIERRE", messageHtml, "warning_amber", "confirm");

        if (aceptado) {
            this.ejecutarEnvioFinal();
        } else {
            this.showToast("DESPACHO RETENIDO: Auditoría cancelada por el usuario.", true);
        }
    }

    /**
     * Ejecuta el cierre definitivo y envío de datos.
     */
    private ejecutarEnvioFinal() {
        this.revisorService.finalizeProcess();
        this.isError.set(false);
        this.notificationMessage.set("¡DESPACHO EXITOSO! La información ha sido enviada correctamente.");

        // Limpiamos y cerramos tras unos segundos para dar feedback visual
        setTimeout(() => {
            this.notificationMessage.set("");
            this.cerrarPantalla();
        }, 3000);
    }
}
