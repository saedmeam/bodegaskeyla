import { Component, signal, computed, inject, OnInit, ViewChild, ElementRef, effect } from '@angular/core';
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
    loteInput = "";
    caducidadInput = "";
    showComparativo = signal(true);

    // Estados de Modal Custom (v35.0)
    modalVisible = signal(false);
    modalTitle = signal("");
    modalMessage = signal("");
    modalIcon = signal("⚠️");
    modalType = signal<'confirm' | 'alert'>('confirm');
    modalActionDisabled = signal(false);
    private modalResolve?: (value: boolean) => void;

    // Proyecciones del servicio orquestador
    ordenProductos = this.revisorService.ordenProductos;
    escaneados = this.revisorService.escaneados;

    totalItems = computed(() => this.ordenProductos().length);
    totalCorrectos = computed(() => this.escaneados().filter(p => p.color === 'negro').length);
    totalIncompletos = computed(() => this.escaneados().filter(p => p.color === 'azul').length);

    constructor() {
        // v45.0: Sincronización reactiva con la metadata de la orden cargada
        effect(() => {
            const metadata = this.revisorService.orderMetadata();
            if (metadata) {
                this.bodega = metadata.bodega;
                this.movimiento = metadata.movimiento;
                this.movimientoNombre = metadata.nombre;
                this.concepto = metadata.concepto;
            } else {
                // Si no hay orden, limpiamos campos
                this.bodega = "";
                this.movimiento = "";
                this.movimientoNombre = "";
                this.concepto = "";
            }
        });
    }

    ngOnInit() {
        // La pantalla inicia vacía. El usuario debe ingresar una orden.
    }

    consultarOrden() {
        if (!this.numero || this.numero.trim() === "") {
            this.revisorService.orderMetadata.set(null);
            return;
        }

        this.showToast(`OK: Consultando orden #${this.numero}...`, false, "SINCRONIZACIÓN");

        // Llamada al orquestador para iniciar proceso async (v45.0)
        this.revisorService.executeProcess('LOAD', { orderNumber: this.numero });
    }

    manualSelect(item: string) {
        this.barcodeInput = item;
        this.simularEscaneo();
    }

    notificationMessage = signal("");
    notificationTitle = signal("");
    isError = signal(false);

    simularEscaneo() {
        if (!this.barcodeInput) return;

        // REGLA DE NEGOCIO: No permitir pistoleo si no hay orden cargada
        if (this.ordenProductos().length === 0) {
            this.showToast("ERROR: Debe cargar una orden antes de pistolear.", true);
            this.barcodeInput = "";
            return;
        }

        // 1. Prioridad: Coincidencia exacta por código de ítem (Restricción v57.0)
        let matches = this.ordenProductos().filter(p => p.item === this.barcodeInput);

        if (matches.length === 0) {
            this.showToast(`ERROR: [${this.barcodeInput}] no existe en esta orden.`, true);
            this.barcodeInput = "";
            return;
        }

        // Si hay múltiples lotes para el mismo código de existencia (mismo item)
        if (matches.length > 1) {
            if (!this.loteInput) {
                this.openModal("Selección de Lote", "Se detectaron <b>múltiples lotes</b> para este producto. Por favor, especifique el lote manualmente.", "inventory", "alert");
                return;
            }

            // Si el lote está escrito, filtramos por ese lote
            const matchConLote = matches.find(m => m.lote === this.loteInput);
            if (!matchConLote) {
                this.showToast(`ERROR: El lote [${this.loteInput}] no es válido para este producto.`, true);
                return;
            }
            matches = [matchConLote];
        } else {
            // Un solo match, autocompletamos lote si no está
            const match = matches[0];
            if (match.lote && !this.loteInput) {
                this.loteInput = match.lote;
                if (match.caducidad) this.caducidadInput = match.caducidad;
            }
        }

        // Uso del método orquestador
        const result = this.revisorService.executeProcess('SCAN', {
            barcode: this.barcodeInput,
            lote: this.loteInput,
            caducidad: this.caducidadInput
        }) as any;

        if (!result) {
            this.showToast(`ERROR: [${this.barcodeInput}] No pertenece a esta orden o el lote no coincide.`, true);
        } else {
            if (result.isAccumulated) {
                this.showToast(`OK: [${result.product.item}] Ya existe, se sumó a lo despachado.`, false, "REGISTRO EXISTENTE");
            } else {
                this.showToast(`OK: [${result.product.item}] Registrado con éxito.`, false, "REGISTRO EXITOSO");
            }
            // Limpiamos lote y caducidad después de un registro exitoso si no queremos que persistan
            this.loteInput = "";
            this.caducidadInput = "";
        }

        this.barcodeInput = "";
    }

    private showToast(message: string, isError: boolean = false, title?: string) {
        this.isError.set(isError);
        this.notificationMessage.set(message);

        // v68.0: Títulos por defecto en MAYÚSCULAS para mayor consistencia visual
        const defaultTitle = isError ? 'ERROR DE PISTOLEO' : 'REGISTRO EXITOSO';
        this.notificationTitle.set(title || defaultTitle);

        setTimeout(() => {
            if (this.notificationMessage() === message) {
                this.notificationMessage.set("");
                this.notificationTitle.set("");
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
        const aceptado = await this.openModal("Eliminar Producto", `¿Está seguro que desea eliminar el producto <b>${item}</b> de su lista local?`, "🗑️", "confirm");

        if (aceptado) {
            // v67.0: Eliminación local con estándares de UI (Prefijo OK y Modal)
            this.revisorService.eliminarItem(item);
            this.showToast(`OK: [${item}] Removido de la sesión local.`, false, "ELIMINACIÓN COMPLETADA");
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
        this.revisorService.executeProcess('SORT_PRIORITY'); // v42.0
        this.revisorService.executeProcess('SAVE_SESSION', null);
        this.showToast("OK: Sesión asegurada y ordenada.", false, "BORRADOR GUARDADO");
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
     * V55.0: Ejecuta el envío de actualización (ING / S) al presionar EDITAR.
     */
    async confirmarEdicion() {
        if (this.escaneados().length === 0) {
            this.showToast("No hay cambios que editar.", true);
            return;
        }

        const confirm = await this.openModal("Actualizar Orden", "¿Desea enviar los cambios actuales al servidor con estado ING?", "sync", "confirm");
        if (confirm) {
            (this.revisorService.executeProcess('API_UPDATE', { tipo: 'EDITAR' }) as any)?.subscribe((res: any) => {
                if (res?.mensaje !== 'ERROR') {
                    this.showToast("¡REGISTRO COMPLETADO! La orden ha sido actualizada.", false, "ÉXITO");
                } else {
                    this.showToast(`ERROR: ${res.error || 'No se pudo completar el registro'}`, true, "ERROR DE REGISTRO");
                }
            });
        }
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
        this.revisorService.executeProcess('SORT_PRIORITY'); // v42.0
        const errors = this.revisorService.getValidationErrors();

        if (errors.length === 0) {
            this.ejecutarEnvioFinal();
            return;
        }

        // v50.1: Verificar si hay excedentes para bloquear el botón del modal
        const hasSurplus = errors.some(e => e.type === 'SURPLUS');
        this.modalActionDisabled.set(hasSurplus);

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
     * Ejecuta el cierre definitivo y envío de datos (AGREGAR).
     */
    private ejecutarEnvioFinal() {
        this.showToast("Dando cierre al despacho en el servidor...", false, "PROCESANDO");

        (this.revisorService.finalizeProcess() as any)?.subscribe((res: any) => {
            if (res?.mensaje !== 'ERROR') {
                this.showToast("OK: ¡REGISTRO EXITOSO! La orden ha sido creada correctamente.", false, "ÉXITO");
                // Cerramos tras unos segundos para dar feedback visual
                setTimeout(() => this.cerrarPantalla(), 3000);
            } else {
                this.showToast(`ERROR: ${res.error || 'Fallo al finalizar registro'}`, true, "ERROR DE REGISTRO");
            }
        });
    }

    /**
     * Retorna el producto escaneado correspondiente a un item de la orden.
     */
    getScannedProduct(item: string) {
        return this.escaneados().find(e => e.item === item);
    }
}
