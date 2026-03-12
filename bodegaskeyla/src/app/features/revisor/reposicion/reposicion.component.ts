import { Component, signal, computed, inject, OnInit, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RevisorService } from '../services/revisor.service';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LoadingService } from '../../../core/services/loading.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
    selector: 'app-reposicion',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './reposicion.component.html',
    styleUrl: './reposicion.component.css'
})
export class ReposicionComponent implements OnInit {
    public revisorService = inject(RevisorService);
    private route = inject(ActivatedRoute);
    private loadingService = inject(LoadingService);
    private notificationService = inject(NotificationService);

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
    public get orderNumber() {
        // v130.0: Blindaje total para asegurar concatenación (Solicitud-Orden)
        const meta = this.revisorService.orderMetadata();
        if (meta) {
            const sol = meta.numeroSolicitud || this.numero || '---';
            const ord = meta.numeroOrdenDespacho || 1;
            return `${sol}-${ord}`;
        }
        return this.numero || '---';
    }
    showComparativo = signal(true);

    // Estados de Modal Custom (v35.0)
    modalVisible = signal(false);
    modalTitle = signal("");
    modalMessage = signal("");
    modalIcon = signal("⚠️");
    modalType = signal<'confirm' | 'alert'>('confirm');
    modalActionDisabled = signal(false);
    private modalResolve?: (value: boolean) => void;

    // Estados de Modal Bultos (v160.0)
    bultoModalVisible = signal(false);
    bultoTypes = signal([
        { label: 'Cajas', value: 0 },
        { label: 'Gavetas', value: 0 },
        { label: 'Pañales', value: 0 },
        { label: 'Frío', value: 0 },
        { label: 'Psicotrópicos', value: 0 },
        { label: 'Impresión de etiquetas', value: 0 }
    ]);

    // Proyecciones del servicio orquestador
    ordenProductos = this.revisorService.ordenProductos;
    escaneados = this.revisorService.escaneados;

    // v100.0: Estadísticas basadas en lo verificado (escaneados)
    totalOrder = computed(() => this.ordenProductos().length);
    totalVerificados = computed(() => this.escaneados().length);
    totalItems = computed(() => this.escaneados().length); // Mismo que verificados por solicitud usuario
    totalCorrectos = computed(() => this.escaneados().filter(p => p.color === 'negro').length);
    totalIncompletos = computed(() => this.escaneados().filter(p => p.color === 'azul' || p.color === 'naranja').length);

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
        // La pantalla inicia vacía or con una orden vía query param (v1.0 Nueva Pantalla)
        this.route.queryParams.subscribe(params => {
            if (params['order']) {
                this.numero = params['order'];
                this.consultarOrden();
            }
        });
    }

    async consultarOrden() {
        if (!this.numero || this.numero.trim() === "") {
            this.revisorService.orderMetadata.set(null);
            return;
        }

        try {
            this.revisorService.executeProcess('LOAD', { orderNumber: this.numero });
        } catch (e) {
            this.showToast("Error al iniciar la carga de la orden", true);
        }
    }

    manualSelect(item: string) {
        this.barcodeInput = item;
        this.simularEscaneo();
    }


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

        /* v160.0: Bloque de validación por Lote y Caducidad comentado por solicitud de usuario
        if (matches.length > 1) {
            if (!this.loteInput) {
                this.openModal("Selección de Lote", "Se detectaron <b>múltiples lotes</b> para este producto. Por favor, especifique el lote manualmente.", "inventory", "alert");
                return;
            }

            const matchConLote = matches.find(m => m.lote === this.loteInput);
            if (!matchConLote) {
                this.showToast(`ERROR: El lote [${this.loteInput}] no es válido para este producto.`, true);
                return;
            }
            matches = [matchConLote];
        } else {
            const match = matches[0];
            if (match.lote && !this.loteInput) {
                this.loteInput = match.lote;
                if (match.caducidad) this.caducidadInput = match.caducidad;
            }
        }
        */

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

    onProductDblClick(prod: any) {
        if (!prod) return;

        // V160.0: Manual Scan via double click
        this.barcodeInput = prod.item;

        // If the product has a specific lot/expiry in the order, we use it
        if (prod.lote) this.loteInput = prod.lote;
        if (prod.caducidad) this.caducidadInput = prod.caducidad;

        this.simularEscaneo();
        this.showToast(`CARGA MANUAL: [${prod.item}] cargado vía comparativo.`, false, "REGISTRO MANUAL");
    }

    private showToast(message: string, isError: boolean = false, title?: string) {
        this.notificationService.show(message, isError, title);
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
        this.showToast("Tu borrador ha sido guardado exitosamente en este equipo.", false, "SESIÓN GUARDADA");
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
            this.loadingService.show();
            (this.revisorService.executeProcess('API_UPDATE', { tipo: 'EDITAR' }) as any)?.subscribe({
                next: (res: any) => {
                    this.loadingService.hide();
                    if (res?.mensaje !== 'ERROR') {
                        this.showToast("¡REGISTRO COMPLETADO! La orden ha sido actualizada correctamente.", false, "ÉXITO");
                    } else {
                        this.openModal("❌ ERROR", `Error al guardar: ${res.error || 'No se pudo completar el registro'}`, "❌", "alert");
                    }
                },
                error: () => {
                    this.loadingService.hide();
                    this.showToast("Error de conexión con el servidor", true);
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
            this.bultoModalVisible.set(true);
            return;
        }

        // v100.0: Diseño de Auditoría en formato Tabla (Solicitud Usuario)
        let messageHtml = `
            <div class="audit-modal-container">
                <p class="audit-intro">
                    <span class="icon">⚠️</span>
                    Se han detectado las siguientes novedades en el despacho actual:
                </p>
                <div class="audit-table-wrapper">
                    <table class="audit-table">
                        <thead>
                            <tr>
                                <th>Novedad</th>
                                <th>Producto / Detalle</th>
                            </tr>
                        </thead>
                        <tbody>`;

        errors.forEach(err => {
            const getIcon = () => {
                if (err.type === 'TYPES') return '📦';
                if (err.type === 'QTY') return '🔢';
                if (err.type === 'SURPLUS') return '🚨';
                return '🏷️';
            };

            messageHtml += `
                <tr class="audit-row type-${err.type.toLowerCase()}">
                    <td class="audit-type">
                        <span class="type-badge">${getIcon()} ${err.message}</span>
                    </td>
                    <td class="audit-detail">
                        ${err.detail}
                    </td>
                </tr>`;
        });

        messageHtml += `
                        </tbody>
                    </table>
                </div>
                <div class="audit-footer-msg">
                    ¿Desea <b>ACEPTAR</b> y procesar el envío de todas formas o <b>CERRAR</b> para corregir?
                </div>
            </div>`;

        // Abrimos el modal con los nuevos textos de botón solicitados
        const aceptado = await this.openModal("📋 AUDITORÍA DE CIERRE", messageHtml, "⚠️", "confirm");

        if (aceptado) {
            this.bultoModalVisible.set(true);
        } else {
            this.showToast("DESPACHO RETENIDO: Auditoría cancelada por el usuario.", true);
        }
    }

    /**
     * V160.0: Procesa los tipos de bulto y ejecuta el envío final.
     */
    procesarBultos() {
        this.bultoModalVisible.set(false);
        this.ejecutarEnvioFinal();
    }

    /**
     * Ejecuta el cierre definitivo y envío de datos (AGREGAR).
     */
    private ejecutarEnvioFinal() {
        this.loadingService.show();
        (this.revisorService.finalizeProcess() as any)?.subscribe({
            next: (res: any) => {
                this.loadingService.hide();
                if (res?.mensaje === 'OK') {
                    this.showToast("¡ORDEN CREADA! El registro se ha realizado con éxito.", false, "ÉXITO");
                    // v104.5: Se comentada el auto-cierre para que el usuario pueda validar el éxito
                    // setTimeout(() => this.cerrarPantalla(), 2000);
                } else {
                    // v104.5: Mostrar el mensaje de error directamente desde la respuesta (400/500)
                    this.openModal("❌ ERROR EN PROCESO", `${res?.mensaje || 'Error desconocido'}`, "❌", "alert");
                }
            },
            error: () => {
                this.loadingService.hide();
                this.showToast("Error de conexión fatal", true);
            }
        });
    }

    /**
     * Retorna el producto escaneado correspondiente a un item de la orden.
     */
    getScannedProduct(itemCode: string): any {
        return this.escaneados().find(p => p.item === itemCode);
    }

    /**
     * V160.0: Busca el producto original solicitado para comparar discrepancias.
     */
    getOriginalRequested(itemCode: string) {
        return this.ordenProductos().find(p => p.item === itemCode);
    }

    /**
     * Determina el texto del estado visual (v42.0).
     */
    getStatusDisplay(status: any): string {
        if (!status) return 'INCOMPLETO';

        switch (status.color) {
            case 'negro': return 'COMPLETO';
            case 'verde': return 'EXCEDIDO';
            case 'azul': return 'EN PROCESO';
            case 'naranja': return 'INCOMPLETO';
            default: return 'INCOMPLETO';
        }
    }
}
