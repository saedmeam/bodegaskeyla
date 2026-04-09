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
import { BultoType, Product, Batch } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';
import { ConfigService } from '../../../core/services/config.service';

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
    private configService = inject(ConfigService);

    @ViewChild('scannerInput') scannerInput!: ElementRef<HTMLInputElement>;
    @ViewChild('modalActionBtn') modalActionBtn!: ElementRef<HTMLButtonElement>;
    @ViewChild('bultoActionBtn') bultoActionBtn!: ElementRef<HTMLButtonElement>;

    // Estados de UI
    numero = "";
    fecha = new Date().toLocaleString();
    origenNombre = "";
    destinoNombre = "";
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

    // v2.0: Product Autocomplete State
    productosFiltrados = signal<Product[]>([]);
    showProductDropdown = signal(false);
    selectedIndexProd = signal<number>(-1);

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

    // Estados de Modal Lotes (v170.2: Asignación múltiple)
    loteModalVisible = signal(false);
    selectedProductForLote = signal<Product | null>(null);
    loteWorkingList = signal<any[]>([]);

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
                this.origenNombre = metadata.nombreSucursalOrigen || 'N/A';
                this.destinoNombre = metadata.nombreSucursalDestino || 'N/A';
                this.concepto = metadata.concepto;
            } else {
                // Si no hay orden, limpiamos campos
                this.origenNombre = "";
                this.destinoNombre = "";
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
                setTimeout(() => {
                    const firstBulto = document.getElementById('bulto-input-0');
                    if (firstBulto) {
                        (firstBulto as HTMLInputElement).focus();
                        (firstBulto as HTMLInputElement).select();
                    }
                }, 250); // v140.0: Un poco más de delay para asegurar renderizado
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
        // v160.10: Carga inicial sincronizada
        this.route.queryParams.subscribe(params => {
            if (params['order']) {
                this.numero = params['order'];
                const fd = params['fd'];
                const fh = params['fh'];
                this.actualizarOrdenData(fd, fh, true);
            }
        });
        this.cargarTiposBultos();
    }

    /**
     * v160.10: Método centralizado para actualizar stock y datos maestros.
     */
    async actualizarOrdenData(fd?: string, fh?: string, isInitial = false) {
        if (!this.numero) return;

        if (!isInitial) this.loadingService.show();
        try {
            // v160.10: El orquestador ya consume la API de manera segura
            await firstValueFrom(this.revisorService.executeProcess('LOAD', { 
                orderNumber: this.numero, 
                fechaDesde: fd, 
                fechaHasta: fh,
                forceRefresh: true
            }) as any);
            if (!isInitial) this.showToast("STOCK ACTUALIZADO: Datos sincronizados con el servidor.", false, "SINCRONIZACIÓN");
        } catch (e) {
            this.showToast("Error al sincronizar datos.", true);
        } finally {
            if (!isInitial) this.loadingService.hide();
            setTimeout(() => this.focusScanner(), 300);
        }
    }

    async cargarTiposBultos() {
        try {
            const res = await firstValueFrom(this.revisorService.getTiposBultos());
            if (!res?.isError) {
                const listFromApi = res?.tiposBultos || [];
                // v160.42: Quemar la opción 'IMPRESIÓN DE ETIQUETAS' como prioridad al inicio
                const list = [
                    { codigoTipoBulto: 999, nombreTipoBulto: 'IMPRESIÓN DE ETIQUETAS', cantidad: 0 },
                    ...listFromApi.map((t: any) => ({
                        codigoTipoBulto: t.codigoTipoBulto || t.codigo || t.id || 0,
                        nombreTipoBulto: t.nombreTipoBulto || t.descripcion || t.nombre || 'Bulto',
                        cantidad: 0
                    }))
                ];
                // Eliminar duplicados si el API ya lo mandaba
                const uniqueList = list.filter((v, i, a) => a.findIndex(t => t.nombreTipoBulto === v.nombreTipoBulto) === i);
                this.bultoTypes.set(uniqueList);
            }
        } catch (e) {
            console.error('Error cargando tipos de bultos', e);
        }
    }

    ngAfterViewInit() {
        // Enfoque inmediato al abrir la pantalla
        this.focusScanner();
    }

    async consultarOrden(fd?: string, fh?: string) {
        if (!this.numero || this.numero.trim() === "") {
            this.revisorService.orderMetadata.set(null);
            return;
        }

        try {
            this.revisorService.executeProcess('LOAD', { 
                orderNumber: this.numero, 
                fechaDesde: fd, 
                fechaHasta: fh 
            });
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
        if (!this.barcodeInput.trim()) return false;
        
        // v2.0: Soporte para Autocompletado - Si hay uno seleccionado en el dropdown, usar su item
        if (this.selectedIndexProd() >= 0 && this.productosFiltrados().length > 0) {
            const selected = this.productosFiltrados()[this.selectedIndexProd()];
            this.barcodeInput = selected.item;
            this.productosFiltrados.set([]);
            this.showProductDropdown.set(false);
            this.selectedIndexProd.set(-1);
            // Continúa el flujo normal con el item seleccionado
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

        // 1. Prioridad: Coincidencia exacta por código de ítem o NOMBRE (v160.12)
        const searchText = this.barcodeInput.trim().toUpperCase();
        let matches = this.ordenProductos().filter(p => 
            p.item?.trim().toUpperCase() === searchText || p.nombre?.trim().toUpperCase() === searchText
        );

        if (matches.length === 0) {
            this.openModal("ERROR", `ERROR el código o nombre : [${this.barcodeInput}] no existe en esta orden.`, "❌", "alert");
            this.barcodeInput = "";
            return false;
        }

        // Uso del método orquestador con auditoría estricta (v160.15)
        try {
            const result = this.revisorService.executeProcess('SCAN', {
                barcode: this.barcodeInput,
                lote: this.loteInput,
                caducidad: this.caducidadInput
            });

            if (result) {
                const p = result.product;
                
                // v170.2: Lógica de detección automática de multi-lote
                if (p.lotes && p.lotes.length > 1) {
                    this.showToast(`DETECTADOS ${p.lotes.length} LOTES: Se requiere asignación manual.`, false, "MULTI-LOTE");
                    this.onLoteModify(p);
                } else {
                    // Evaluamos si el escaneo acaba de generar un excedente para notificar (v160.8)
                    const req = this.getOriginalRequested(p.item);
                    const scannedItem = this.getScannedProduct(p.item);

                    if (req && scannedItem) {
                        if (Number(scannedItem.despachado) > Number(req.invBod || 0)) {
                            this.showToast(`⚠️ STOCK INSUFICIENTE: ${p.nombre} (Stock: ${req.invBod})`, true);
                        } else if (Number(scannedItem.despachado) > Number(req.solicita)) {
                            this.showToast(`🚨 PRODUCTO EXCEDIDO: ${p.nombre} (Soli: ${req.solicita})`, true);
                        } else {
                            if (result.isAccumulated) {
                                this.showToast(`OK: [${p.item}] Ya existe, se sumó a lo despachado.`, false, "REGISTRO EXISTENTE");
                            } else {
                                this.showToast(`OK: [${p.item}] Registrado con éxito.`, false, "REGISTRO EXITOSO");
                            }
                        }
                    }
                }

                this.loteInput = "";
                this.caducidadInput = "";
                this.barcodeInput = "";
                return true;
            }
        } catch (error: any) {
            console.error('[ReposicionComponent] Error durante escaneo:', error.message);
            // v160.15: Mostrar pantalla de error (Alert) solicitada por el usuario
            this.openModal("❌ ERROR DE ESCANEO", error.message || 'No se pudo procesar el producto', "🚨", "alert");
            this.barcodeInput = "";
            return false;
        }
        return false;
    }

    onProductDblClick(prod: any) {
        if (!prod) return;

        // V160.12: Manual Scan via double click. Si no hay barcode, usamos el nombre exacto.
        this.barcodeInput = prod.item || prod.nombre;

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
        // v160.8: Actualización directa permitida para visualización de discrepancias
        this.revisorService.executeProcess('UPDATE_QTY', { item: itemCode, qty: Number(qty) });

        const targetItem = this.getOriginalRequested(itemCode);
        if (targetItem) {
            if (Number(qty) > Number(targetItem.invBod || 0)) {
                this.showToast(`⚠️ STOCK INSUFICIENTE: Stock actual: ${targetItem.invBod || 0}`, true);
            } else if (Number(qty) > Number(targetItem.solicita)) {
                this.showToast(`🚨 PRODUCTO EXCEDIDO: Solicitud: ${targetItem.solicita}`, true);
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
        // v135.0: Bloqueo de edición en estados definitivos
        const metadata = this.revisorService.orderMetadata();
        const status = metadata?.estado?.trim().toUpperCase();
        if (status === 'DP' || status === 'DT') {
            this.showToast(`ORDEN CERRADA: No se permite editar una orden en estado ${status}`, true);
            return;
        }

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
     * v170.2: Abre el modal de asignación de lotes para un producto.
     */
    onLoteModify(product: Product) {
        this.selectedProductForLote.set(product);
        // Clonar para edición segura
        const working = (product.lotes || []).map(l => ({ ...l }));
        
        // v170.3: Si no tiene lotes, mostrar "Sin lote asociado" según requerimiento
        if (working.length === 0) {
            working.push({ lote: 'SIN LOTE ASOCIADO', caducidad: 'N/A', stock: product.invBod || 0, despachado: product.despachado || 0 });
        }
        
        this.loteWorkingList.set(working);
        this.loteModalVisible.set(true);
    }

    /**
     * v170.2: Guarda la asignación de lotes y actualiza la cantidad total del producto.
     */
    saveLoteSelection() {
        const prod = this.selectedProductForLote();
        if (!prod) return;

        const working = this.loteWorkingList();
        
        // 1. Validaciones de Stock por Lote
        for (const l of working) {
            if (l.despachado > l.stock) {
                this.showToast(`ERROR: El lote ${l.lote} solo tiene ${l.stock} unidades.`, true, "EXCESO DE LOTE");
                return;
            }
        }

        // 2. Calcular Nuevo Total Despachado
        const newTotal = working.reduce((sum: number, l: any) => sum + (Number(l.despachado) || 0), 0);
        
        // 3. Aplicar Cambios al Producto en el RevisorService
        this.revisorService.executeProcess('UPDATE_QTY', { item: prod.item, qty: newTotal });
        
        // Sincronizar los lotes en el Signal del servicio
        this.revisorService.escaneados.update(list => {
            const idx = list.findIndex(p => p.item === prod.item);
            if (idx !== -1) {
                list[idx].lotes = working;
                list[idx].despachado = newTotal;
            }
            return [...list];
        });

        this.loteModalVisible.set(false);
        this.selectedProductForLote.set(null);
        this.showToast(`OK: Lotes actualizados para ${prod.nombre}.`, false, "LOTES GUARDADOS");
    }

    /**
     * v170.2: Retorna los nombres de los lotes concatenados para la grilla.
     */
    getLotesConcat(product: Product): string {
        if (!product.lotes || product.lotes.length === 0) return 'S/L';
        const despachados = product.lotes.filter((l: any) => l.despachado > 0);
        if (despachados.length === 0) return product.lotes[0].lote || 'PEND';
        return despachados.map((l: any) => l.lote).join(', ');
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

    async finalizar() {
        // v135.0: Validación de estados definitivos (DP / DT) solicitada por usuario
        const metadata = this.revisorService.orderMetadata();
        const status = metadata?.estado?.trim().toUpperCase();
        
        if (status === 'DP' || status === 'DT') {
            await this.openModal(
                "ORDEN YA PROCESADA",
                `<div style="text-align:center;">
                    <span class="material-icons" style="font-size:48px; color:var(--danger-color); margin-bottom:15px;">lock</span>
                    <p>Esta orden de despacho se encuentra actualmente en estado <b>[${status}]</b>.</p>
                    <p style="margin-top:10px; font-size:0.9rem; color:#636e72;">No está permitido subir cambios ni bultos a una orden que ya ha sido cerrada o despachada totalmente.</p>
                </div>`,
                "🚫",
                "alert"
            );
            return;
        }

        this.revisorService.executeProcess('SORT_PRIORITY');
        const errors = this.revisorService.getValidationErrors();
        const criticalErrors = errors.filter(e => e.isCritical);
        const hasCritical = criticalErrors.length > 0;

        if (errors.length === 0) {
            this.bultoModalVisible.set(true);
            return;
        }

        // v160.9: Diseño de Auditoría con Bloqueo Crítico
        const generalErrors = errors.filter(e => e.type === 'TYPES' || e.type === 'BULTO');
        const detailErrors = errors.filter(e => e.type !== 'TYPES' && e.type !== 'BULTO');

        let messageHtml = `
            <div class="audit-modal-container">
                ${hasCritical ? `
                <div class="audit-lock-banner" style="background: #fee2e2; border: 2px solid #ef4444; border-radius: 8px; padding: 12px; margin-bottom: 15px; display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 24px;">🚫</span>
                    <div style="color: #991b1b; font-weight: 800; font-size: 0.85rem;">
                        ENVÍO BLOQUEADO: Se detectaron errores críticos (Stock o Excedidos). 
                        Debe corregir los ítems marcados en rojo antes de continuar.
                    </div>
                </div>` : `
                <p class="audit-intro">
                    <span class="icon">⚠️</span>
                    Se han detectado las siguientes novedades en el despacho actual:
                </p>`}
        `;

        if (generalErrors.length > 0) {
            messageHtml += `
                <div class="audit-summary-observations" style="margin-bottom: 20px; padding: 15px; background: #fff7ed; border-radius: 10px; border: 2px solid #ed8936;">
                    <strong style="color: #9c4221; display: block; margin-bottom: 8px; font-size: 0.9rem;">📌 OBSERVACIONES:</strong>
                    ${generalErrors.map(err => `
                        <div style="font-weight: 800; color: #7b341e; font-size: 0.85rem; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                            <span>${err.type === 'TYPES' ? '📦' : '🏗️'}</span>
                            <span style="${err.isCritical ? 'color: #e53e3e; text-decoration: underline;' : ''}">${err.message} - ${err.detail}</span>
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
                if (err.type === 'STOCK') return '⚠️';
                if (err.type === 'SURPLUS') return '🚨';
                if (err.type === 'QTY') return '🔢';
                return '🏷️';
            };

            const getColor = () => {
                if (err.isCritical) return '#e53e3e';
                if (err.type === 'QTY') return '#d69e2e';
                return '#4a5568';
            };

            messageHtml += `
                <tr class="audit-row" style="${err.isCritical ? 'background: #fff5f5;' : ''}">
                    <td class="audit-type" style="border: 1px solid black; padding: 10px; width: 150px; text-align: center;">
                        <span class="type-badge" style="font-weight: 800; color: ${getColor()}; font-size: 0.75rem;">
                            ${getIcon()} ${err.message}
                        </span>
                    </td>
                    <td class="audit-detail" style="border: 1px solid black; padding: 10px; color: #1a202c; font-size: 0.8rem; line-height: 1.4;">
                        ${err.isCritical ? `<strong>${err.detail}</strong>` : err.detail}
                    </td>
                </tr>`;
        });

        messageHtml += `
                        </tbody>
                    </table>
                </div>
                <div class="audit-footer-msg" style="margin-top: 20px; text-align: center; font-size: 0.9rem; color: #2d3748; padding: 10px; border-top: 1px dashed #cbd5e1;">
                    ${hasCritical ? 
                        `No se puede procesar el envío hasta que se resuelvan las novedades críticas.` : 
                        `¿Desea <b>ACEPTAR</b> y procesar el envío de todas formas o <b>CERRAR</b> para corregir?`}
                </div>
            </div>`;

        // Abrimos el modal con el reporte
        this.modalActionDisabled.set(hasCritical);
        const aceptado = await this.openModal(
            hasCritical ? "⛔ BLOQUEO DE ENVÍO" : "📋 AUDITORÍA DE CIERRE", 
            messageHtml, 
            hasCritical ? "🚫" : "⚠️", 
            "confirm"
        );

        if (aceptado && !hasCritical) {
            this.bultoModalVisible.set(true);
        } else if (!aceptado) {
            this.showToast("DESPACHO RETENIDO: Auditoría cancelada por el usuario.", true);
        }
        
        // Reset por seguridad
        this.modalActionDisabled.set(false);
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
        
        setTimeout(() => this.focusScanner(), 300); // v2.8: Volver al scanner tras procesar bultos
    }



    // v2.0: Autocomplete Methods
    filtrarProductos(event: any) {
        const val = event.target.value.toLowerCase().trim();
        if (!val || val.length < 2) {
            this.productosFiltrados.set([]);
            this.showProductDropdown.set(false);
            return;
        }

        const filtered = this.ordenProductos().filter(p => 
            p.nombre.toLowerCase().includes(val) || 
            p.item.toLowerCase().includes(val)
        ).slice(0, 10); // Limit to 10 for performance

        this.productosFiltrados.set(filtered);
        this.showProductDropdown.set(filtered.length > 0);
        this.selectedIndexProd.set(filtered.length > 0 ? 0 : -1);
    }

    seleccionarProducto(prod: Product) {
        this.barcodeInput = prod.item;
        this.productosFiltrados.set([]);
        this.showProductDropdown.set(false);
        this.selectedIndexProd.set(-1);
        
        // Ejecutar escaneo inmediatamente
        this.simularEscaneo();
    }

    onScannerKeydown(event: KeyboardEvent) {
        if (!this.showProductDropdown()) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.selectedIndexProd.update(i => (i + 1) % this.productosFiltrados().length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.selectedIndexProd.update(i => (i - 1 + this.productosFiltrados().length) % this.productosFiltrados().length);
        } else if (event.key === 'Escape') {
            this.showProductDropdown.set(false);
        }
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
                    // v120.0: Ahora la impresión se dispara solo si la API responde éxito total
                    this.imprimirReportesFinales(bultos);

                    // v160.11: Redirección automática al mantenimiento de órdenes tras éxito
                    setTimeout(() => {
                        this.router.navigate(['/despacho-lista']);
                    }, 2500);
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

    private imprimirReportesFinales(bultosParaEnviar?: any[]) {
        const metadata = this.revisorService.orderMetadata();
        const user = this.authService.getStoredUser();

        // 1. REGLA MAESTRA (v160.50): Solo se imprimen etiquetas si el bulto 999 tiene cantidad > 0
        const bulto999 = bultosParaEnviar?.find(b => b.codigoTipoBulto === 999);
        const cantidadAPrint = bulto999 ? Number(bulto999.cantidad) : 0;

        if (cantidadAPrint > 0) {
            console.log(`[ReposicionComponent] 🖨️ Generando ${cantidadAPrint} etiquetas (Master 999)`);

            const extraData = {
                sucursal: metadata?.nombreSucursalDestino || metadata?.sucursalDestino || '---',
                digitador: user?.username || 'SISTEMA',
                fecha: new Date().toLocaleDateString('es-EC')
            };

            const bultosLabelsMapped = [{ label: 'IMPRESIÓN DE ETIQUETAS', value: cantidadAPrint }];
            const labelsHtml = this.printerService.generateLabelsHtml(this.orderNumber, bultosLabelsMapped, extraData);

            this.printerService.printLabels(labelsHtml, undefined, { pageSize: 'A4', landscape: true }, true);
        } else {
            console.log('[ReposicionComponent] ⏭️ Saltando etiquetas físicas (Bulto 999 es 0)');
        }

        // 2. v2.7: Reporte de Transferencia de Mercadería (SIEMPRE se imprime si hay productos)
        const productsVerificados = this.escaneados().filter(p => p.despachado > 0);
        if (productsVerificados.length > 0) {
            console.log('[ReposicionComponent] Generando reporte de transferencia A4...');

            const extraReport = {
                sucursal: metadata?.nombreSucursalDestino || metadata?.sucursalDestino || '---',
                usuario: user?.username || 'SISTEMA',
                digitador: user?.username || 'SISTEMA',
                fecha: new Date().toLocaleDateString('es-EC'),
                bodegaOrigen: metadata?.nombreSucursalOrigen,
                bodegaDestino: metadata?.nombreSucursalDestino || metadata?.sucursalDestino,
                bultos: bultosParaEnviar
            };

            const reportHtml = this.printerService.generateTransferReportHtml(this.orderNumber, productsVerificados, extraReport);
            this.printerService.printLabels(reportHtml, undefined, { pageSize: 'A4' }, true);

            this.showToast("Reporte generado. Etiquetas omitidas o procesadas según Bulto 999.", false, "IMPRESIÓN");
        }
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
}
