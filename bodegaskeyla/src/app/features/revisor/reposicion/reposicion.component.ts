import { Component, signal, computed, inject, OnInit, AfterViewInit, ViewChild, ElementRef, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RevisorService } from '../services/revisor.service';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { firstValueFrom } from 'rxjs';
import { LoadingService } from '../../../core/services/loading.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PrinterService } from '../../../core/services/printer.service';
import { BultoType } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';

@Component({
    selector: 'app-reposicion',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './reposicion.component.html',
    styleUrl: './reposicion.component.css'
})
export class ReposicionComponent implements OnInit, AfterViewInit {
    public revisorService = inject(RevisorService);
    public authService = inject(AuthService); // v2.3: Inyección pública para acceso en template
    private route = inject(ActivatedRoute);
    private loadingService = inject(LoadingService);
    private notificationService = inject(NotificationService);
    private router = inject(Router);
    private printerService = inject(PrinterService);
    private dataService = inject(DataService);

    @ViewChild('scannerInput') scannerInput!: ElementRef<HTMLInputElement>;
    @ViewChild('modalActionBtn') modalActionBtn!: ElementRef<HTMLButtonElement>;
    @ViewChild('bultoActionBtn') bultoActionBtn!: ElementRef<HTMLButtonElement>;

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
        // v130.1: Priorizar 'numero' (URL) para evitar desfase visual con metadata lenta
        const meta = this.revisorService.orderMetadata();
        if (meta && this.numero && this.numero.includes('-')) {
            // Si hay meta y numero, verificamos consistencia básica
            return this.numero;
        }
        if (meta) {
            const sol = meta.numeroSolicitud || '---';
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

    // Estados de Modal Bultos (v107.2: Dinámico por API)
    bultoModalVisible = signal(false);
    bultoTypes = signal<BultoType[]>([]);

    // Proyecciones del servicio orquestador
    ordenProductos = this.revisorService.ordenProductos;
    escaneados = this.revisorService.escaneados;

    // v100.0: Estadísticas basadas en lo verificado (escaneados)
    totalOrder = computed(() => this.ordenProductos().length);
    totalVerificados = computed(() => this.escaneados().length);
    totalItems = computed(() => this.totalOrder()); // v2.1: Refiere al total de la orden (ej. 5761) en lugar de escaneados
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

        // v2.8: Efectos de foco automático para modales
        effect(() => {
            if (this.modalVisible()) {
                setTimeout(() => this.modalActionBtn?.nativeElement?.focus(), 150);
            }
        });

        effect(() => {
            if (this.bultoModalVisible()) {
                setTimeout(() => this.bultoActionBtn?.nativeElement?.focus(), 150);
            }
        });
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyboardShortcuts(event: KeyboardEvent) {
        if (this.modalVisible() || this.bultoModalVisible()) return; // Don't trigger if a modal is open

        if (event.key === 'F5') {
            event.preventDefault();
            this.finalizar(); // Same as "Agregar" button according to request
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.cerrarPantalla(); // Return to previous screen
        }
    }

    ngOnInit() {
        // La pantalla inicia vacía or con una orden vía query param (v1.0 Nueva Pantalla)
        this.route.queryParams.subscribe(params => {
            if (params['order']) {
                this.numero = params['order'];
                this.consultarOrden();
            }
        });

        // v107.0: Cargar tipos de bultos dinámicos
        this.cargarTiposBultos();
    }

    async cargarTiposBultos() {
        try {
            const res = await firstValueFrom(this.revisorService.getTiposBultos());
            if (!res?.isError) {
                const list = res?.tiposBultos || [];
                this.bultoTypes.set(list.map((t: any) => ({
                    codigoTipoBulto: t.codigoTipoBulto,
                    nombreTipoBulto: t.nombreTipoBulto || t.descripcion || 'Bulto',
                    cantidad: 0 // Empezamos en cero
                })));
            }
        } catch (e) {
            console.error('Error cargando tipos de bultos', e);
        }
    }

    ngAfterViewInit() {
        // Enfoque inmediato al abrir la pantalla
        this.focusScanner();
    }

    async consultarOrden() {
        if (!this.numero || this.numero.trim() === "") {
            this.revisorService.orderMetadata.set(null);
            return;
        }

        try {
            this.revisorService.executeProcess('LOAD', { orderNumber: this.numero });
            setTimeout(() => this.focusScanner(), 500); // Aseguramos el enfoque después de cargar
        } catch (e) {
            this.showToast("Error al iniciar la carga de la orden", true);
        }
    }

    manualSelect(item: string) {
        this.barcodeInput = item;
        this.simularEscaneo();
    }


    simularEscaneo(): boolean {
        if (!this.barcodeInput) {
            this.focusScanner();
            return false;
        }

        // REGLA DE NEGOCIO: No permitir pistoleo si no hay orden cargada
        if (this.ordenProductos().length === 0) {
            this.showToast("ERROR: Debe cargar una orden antes de pistolear.", true);
            this.barcodeInput = "";
            return false;
        }

        // --- NUEVA VALIDACIÓN GLOBAL: Bloqueo si hay errores previos en la lista ---
        const errorNoExiste = this.escaneados().find(e => !this.getOriginalRequested(e.item));
        if (errorNoExiste) {
            this.openModal("PRODUCTO NO PERTENECE", `El producto <b>${errorNoExiste.nombre || errorNoExiste.item}</b> no existe en la orden original. Por favor, elimínelo antes de continuar pistoleando.`, "❌", "alert");
            this.barcodeInput = "";
            return false;
        }

        const errorGlobal = this.escaneados().find(e => {
            const req = this.getOriginalRequested(e.item);
            if (!req) return false;
            return Number(e.despachado) > Number(req.solicita) || Number(e.despachado) > Number(req.invBod || 0);
        });

        if (errorGlobal) {
            const req = this.getOriginalRequested(errorGlobal.item);
            if (Number(errorGlobal.despachado) > Number(req?.invBod || 0)) {
                this.openModal("ALERTA DE STOCK", `Tienes el producto <b>${errorGlobal.nombre}</b> con cantidad mayor a tu stock actual físico (${req?.invBod || 0}). Por favor, corrige la cantidad antes de continuar pistoleando.`, "⚠️", "alert");
            } else {
                this.openModal("PRODUCTO EXCEDIDO", `Tienes el producto <b>${errorGlobal.nombre}</b> excedido (Sol: ${req?.solicita}). Por favor eliminar o corrige antes de continuar.`, "🚨", "alert");
            }
            this.barcodeInput = "";
            return false;
        }

        // 1. Prioridad: Coincidencia exacta por código de ítem (Restricción v57.0)
        let matches = this.ordenProductos().filter(p => p.item === this.barcodeInput);

        if (matches.length === 0) {
            this.openModal("ERROR", `ERROR el código : [${this.barcodeInput}] no existe en esta orden.`, "❌", "alert");
            this.barcodeInput = "";
            return false;
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
        const barcodeAttempt = this.barcodeInput; // Safeguard the input for the message
        const result = this.revisorService.executeProcess('SCAN', {
            barcode: this.barcodeInput,
            lote: this.loteInput,
            caducidad: this.caducidadInput
        }) as any;

        if (!result) {
            this.openModal("ERROR", `ERROR: [${barcodeAttempt}] no existe en esta orden o el lote no coincide.`, "❌", "alert");
            this.barcodeInput = "";
            return false;
        } else {
            // Evaluamos si el escaneo acaba de generar un excedente para notificar inmediatamente
            const req = this.getOriginalRequested(result.product.item);
            const scannedItem = this.getScannedProduct(result.product.item);

            if (req && scannedItem) {
                if (Number(scannedItem.despachado) > Number(req.invBod || 0)) {
                    this.openModal("STOCK INSUFICIENTE", `No puedes despachar más de lo que tienes en stock en bodega. Stock actual: <b>${req.invBod}</b>`, "⚠️", "alert");
                } else if (Number(scannedItem.despachado) > Number(req.solicita)) {
                    this.openModal("PRODUCTO EXCEDIDO", `Tienes el producto <b>${result.product.nombre}</b> excedido, por favor eliminar o corrige antes de continuar.`, "🚨", "alert");
                } else {
                    if (result.isAccumulated) {
                        this.showToast(`OK: [${result.product.item}] Ya existe, se sumó a lo despachado.`, false, "REGISTRO EXISTENTE");
                    } else {
                        this.showToast(`OK: [${result.product.item}] Registrado con éxito.`, false, "REGISTRO EXITOSO");
                    }
                }
            }

            // Limpiamos lote y caducidad después de un registro exitoso si no queremos que persistan
            this.loteInput = "";
            this.caducidadInput = "";
            this.barcodeInput = "";
            return true;
        }
    }

    onProductDblClick(prod: any) {
        if (!prod) return;

        // V160.0: Manual Scan via double click
        this.barcodeInput = prod.item;

        // If the product has a specific lot/expiry in the order, we use it
        if (prod.lote) this.loteInput = prod.lote;
        if (prod.caducidad) this.caducidadInput = prod.caducidad;

        const wasAdded = this.simularEscaneo();
        if (wasAdded) {
            // Only show manual scan toast if it passed the filters inside simularEscaneo
            this.showToast(`CARGA MANUAL: [${prod.item}] cargado vía comparativo.`, false, "REGISTRO MANUAL");
        }
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
        this.modalResolve?.(result);
        setTimeout(() => this.focusScanner(), 200); // v2.8: Siempre volver al scanner tras modal
    }

    async eliminarItem(item: string) {
        const aceptado = await this.openModal("Eliminar Producto", `¿Está seguro que desea eliminar el producto <b>${item}</b> de su lista local?`, "🗑️", "confirm");

        if (aceptado) {
            // v67.0: Eliminación local con estándares de UI (Prefijo OK y Modal)
            this.revisorService.eliminarItem(item);
            this.showToast(`OK: [${item}] Removido de la sesión local.`, false, "ELIMINACIÓN COMPLETADA");
        }
    }

    updateQty(itemCode: string, qty: number) {
        // Ejecutamos cálculo del estado independientemente de que se pase
        this.revisorService.executeProcess('UPDATE_QTY', { item: itemCode, qty: Number(qty) });

        // Y lanzamos las modales si hay problemas, pero el registro ya se dio y calculó.
        const targetItem = this.getOriginalRequested(itemCode);
        if (targetItem) {
            if (Number(qty) > Number(targetItem.invBod || 0)) {
                this.openModal("STOCK INSUFICIENTE", `No puedes despachar más de lo que tienes en stock en bodega. Stock actual: <b>${targetItem.invBod || 0}</b>`, "⚠️", "alert");
            } else if (Number(qty) > Number(targetItem.solicita)) {
                this.openModal("PRODUCTO EXCEDIDO", `Tienes el producto <b>${targetItem.nombre}</b> excedido (Sol: ${targetItem.solicita}). Por favor eliminar o corrige antes de continuar.`, "🚨", "alert");
            }
        }
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
        window.history.back();
    }

    logout() {
        this.authService.logout();
        this.router.navigate(['/login']);
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
        // v100.0: Diseño de Auditoría en formato Tabla (Solicitud Usuario)
        const generalErrors = errors.filter(e => e.type === 'TYPES' || e.type === 'BULTO');
        const detailErrors = errors.filter(e => e.type !== 'TYPES' && e.type !== 'BULTO');

        let messageHtml = `
            <div class="audit-modal-container">
                <p class="audit-intro">
                    <span class="icon">⚠️</span>
                    Se han detectado las siguientes novedades en el despacho actual:
                </p>`;

        if (generalErrors.length > 0) {
            messageHtml += `
                <div class="audit-summary-observations" style="margin-bottom: 20px; padding: 15px; background: #fff7ed; border-radius: 10px; border: 2px solid #ed8936;">
                    <strong style="color: #9c4221; display: block; margin-bottom: 8px; font-size: 0.9rem;">📌 OBSERVACIONES GENERALES:</strong>
                    ${generalErrors.map(err => `
                        <div style="font-weight: 800; color: #7b341e; font-size: 0.85rem; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                            <span>${err.type === 'TYPES' ? '📦' : '🏗️'}</span>
                            <span>${err.message} - ${err.detail}</span>
                        </div>
                    `).join('')}
                </div>`;
        }

        messageHtml += `
                <div class="audit-table-label" style="font-weight: 700; font-size: 0.85rem; color: #4a5568; margin-bottom: 8px; text-transform: uppercase;">
                    Detalle de Productos:
                </div>
                <div class="audit-table-wrapper" style="border: 2px solid black; border-radius: 4px; overflow: hidden;">
                    <table class="audit-table" style="border-collapse: collapse; width: 100%; background: white;">
                        <thead>
                            <tr style="background: #f1f2f6;">
                                <th style="border: 1px solid black; padding: 10px; color: black; font-weight: 800; text-transform: uppercase; font-size: 0.75rem;">Novedad</th>
                                <th style="border: 1px solid black; padding: 10px; color: black; font-weight: 800; text-transform: uppercase; font-size: 0.75rem;">Producto / Detalle</th>
                            </tr>
                        </thead>
                        <tbody>`;

        detailErrors.forEach(err => {
            const getIcon = () => {
                if (err.type === 'QTY') return '🔢';
                if (err.type === 'SURPLUS') return '🚨';
                return '🏷️';
            };

            const getColor = () => {
                if (err.type === 'SURPLUS') return '#e53e3e';
                if (err.type === 'QTY') return '#d69e2e';
                return '#4a5568';
            };

            messageHtml += `
                <tr class="audit-row">
                    <td class="audit-type" style="border: 1px solid black; padding: 10px; background: white; width: 150px; text-align: center;">
                        <span class="type-badge" style="background: transparent; padding: 0; font-weight: 800; color: ${getColor()}; font-size: 0.75rem;">
                            ${getIcon()} ${err.message}
                        </span>
                    </td>
                    <td class="audit-detail" style="border: 1px solid black; padding: 10px; background: white; color: #1a202c; font-size: 0.8rem; line-height: 1.4;">
                        ${err.detail}
                    </td>
                </tr>`;
        });

        if (detailErrors.length === 0) {
            messageHtml += `
                <tr>
                    <td colspan="2" style="padding: 20px; text-align: center; color: #718096; font-style: italic;">
                        Sin discrepancias individuales en productos.
                    </td>
                </tr>`;
        }

        messageHtml += `
                        </tbody>
                    </table>
                </div>
                <div class="audit-footer-msg" style="margin-top: 20px; text-align: center; font-size: 0.9rem; color: #2d3748; padding: 10px; border-top: 1px dashed #cbd5e1;">
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

    procesarBultos() {
        // v107.5: Validación y Extracción de bultos registrados
        const bultosParaEnviar = this.bultoTypes().filter(b => (b.cantidad || 0) > 0);
        
        if (bultosParaEnviar.length === 0) {
            this.showToast("DEBE REGISTRAR AL MENOS UN BULTO: Verifique las cantidades antes de continuar.", true, "VALIDACIÓN DE BULTOS");
            return;
        }

        this.bultoModalVisible.set(false);
        this.ejecutarEnvioFinal(bultosParaEnviar);

        // 1. v115.0: Impresión de etiquetas mediante Puente Java (Texto Plano)
        if (bultosParaEnviar.length > 0) {
            console.log('[ReposicionComponent] Generando etiquetas TXT para puente Java:', bultosParaEnviar);
            const metadata = this.revisorService.orderMetadata();
            const user = this.authService.getStoredUser();

            const extraData = {
                sucursal: metadata?.sucursalDestino || '---',
                digitador: user?.username || 'SISTEMA',
                fecha: new Date().toLocaleDateString('es-EC')
            };

            const bultosLabels = bultosParaEnviar.map(b => ({ label: b.nombreTipoBulto, value: b.cantidad }));
            const labelsTxt = this.printerService.generateLabelsText(this.orderNumber, bultosLabels, extraData);
            
            // Impresión asíncrona pero sin bloquear el flujo principal
            this.printerService.printLabelsText(labelsTxt).catch(err => {
                this.showToast("Error al imprimir etiquetas físicas. Verifique impresora y Java.", true);
            });
        }

        // 2. v2.7: Reporte de Transferencia de Mercadería (Formato A4 - Se mantiene HTML)
        const productsVerificados = this.escaneados().filter(p => p.despachado > 0);
        if (productsVerificados.length > 0) {
            console.log('[ReposicionComponent] Generando reporte de transferencia A4...');
            const metadata = this.revisorService.orderMetadata();
            const user = this.authService.getStoredUser();

            const extraReport = {
                sucursal: metadata?.sucursalDestino || '---',
                usuario: user?.username || 'SISTEMA',
                digitador: user?.username || 'SISTEMA',
                fecha: new Date().toLocaleDateString('es-EC')
            };

            const reportHtml = this.printerService.generateTransferReportHtml(this.orderNumber, productsVerificados, extraReport);
            this.printerService.printLabels(reportHtml, undefined, { pageSize: 'A4' }, true);
            
            this.showToast("Etiquetas enviadas al motor Java y Reporte abierto.", false, "IMPRESIÓN");
        }
        
        setTimeout(() => this.focusScanner(), 300); // v2.8: Volver al scanner tras procesar bultos
    }

    /**
     * Ejecuta el cierre definitivo y envío de datos (AGREGAR).
     */
    private ejecutarEnvioFinal(bultos?: any[]) {
        this.loadingService.show();
        (this.revisorService.finalizeProcess(bultos) as any)?.subscribe({
            next: (res: any) => {
                this.loadingService.hide();
                if (res?.mensaje === 'OK' || res?.codigo === '000') {
                    this.showToast("¡ORDEN CREADA! El registro se ha realizado con éxito.", false, "ÉXITO");
                    // v118.0: Se descarta impresión de tirilla por solicitud de usuario (Solo etiquetas)
                } else {
                    // v104.5: Mostrar el mensaje de error directamente desde la respuesta (400/500)
                    this.openModal("ERROR EN PROCESO", `${res?.mensaje || 'Error desconocido'}`, "❌", "alert");
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
