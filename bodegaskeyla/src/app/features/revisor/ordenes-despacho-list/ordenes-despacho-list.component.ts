import { Component, OnInit, inject, signal, HostListener, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RevisorService } from '../services/revisor.service';
import { AuthService } from '../../../core/services/auth.service';
import { Router, ActivatedRoute } from '@angular/router';
import { CajaService } from '../../../core/services/caja.service';
import { Sucursal } from '../../../shared/models/auth.model';
import { LoadingService } from '../../../core/services/loading.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DispatchOrder, Product } from '../../../shared/models/product.model';
import { firstValueFrom } from 'rxjs';
import { PrinterService } from '../../../core/services/printer.service';
import { ConfigService } from '../../../core/services/config.service';
import { DataService } from '../../../core/services/data.service';

@Component({
    selector: 'app-ordenes-despacho-list',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './ordenes-despacho-list.component.html',
    styleUrl: './ordenes-despacho-list.component.css'
})
export class OrdenesDespachoListComponent implements OnInit {
    public revisorService = inject(RevisorService);
    public authService = inject(AuthService); // v2.3: Inyección pública para acceso en template
    private route = inject(ActivatedRoute);
    private loadingService = inject(LoadingService);
    private notificationService = inject(NotificationService);
    
    @ViewChild('numPedidoInput') numPedidoInput!: ElementRef;
    private router = inject(Router);
    private cajaService = inject(CajaService);
    private printerService = inject(PrinterService);
    private configService = inject(ConfigService);
    private dataService = inject(DataService);
    private titleService = inject(Title);
    public appVersion = '1.2.0';
    public Math = Math;

    // Filters
    diaEmbarque: string = this.getInitialDay();
    fechaDesde: string = this.getLocalDateString();
    fechaHasta: string = this.getLocalDateString();

    private getInitialDay(): string {
        const day = new Date().getDay(); // 0: Domingo, 1: Lunes...
        return day === 0 ? '7' : day.toString(); // Asume Lunes=1, Domingo=7
    }

    private getLocalDateString(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    estado = signal<string>('TODOS');
    numeroPedido: string = '';
    selectedSucursal: Sucursal | null = null;

    diasSemana: any[] = [{ value: 'TODOS', label: 'Todos' }];

    // Selection UI State
    sucursales: Sucursal[] = [];
    sucursalesFiltradas: Sucursal[] = [];
    searchTermSucursal: string = '';
    showSucursalDropdown: boolean = false;

    // Data
    public allOrdenesBase = signal<DispatchOrder[]>([]);
    public loading = this.loadingService.isLoading;
    public error = signal<string>('');
    public currentPage = signal<number>(0);
    public pageInput: number = 1;
    public selectedIndex = signal<number>(0); // v2.4: Keyboard navigation
    
    // v104.6: Label Reimprinting UI State
    public showLabelModal = signal<boolean>(false);
    public labelQuantity = 1;
    public selectedOrderForLabels = signal<DispatchOrder | null>(null);
    public tiposBultos: any[] = [];
    public selectedTipoBulto = signal<any>(null);

    public ordenes = computed(() => {
        const est = this.estado();
        const list = this.allOrdenesBase();
        if (est === 'TODOS') return list;
        return list.filter(o => o.codigoEstado === est);
    });

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        const target = event.target as HTMLElement;
        const isInput = target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA';

        // v1.3.6: Si el usuario está escribiendo, SALIR INMEDIATAMENTE.
        if (isInput) return;

        if (this.ordenes().length === 0) return;

        if (event.key === 'ArrowDown') {
            if (isInput) return;
            event.preventDefault();
            this.selectedIndex.update(i => Math.min(i + 1, this.ordenes().length - 1));
        } else if (event.key === 'ArrowUp') {
            if (isInput) return;
            event.preventDefault();
            this.selectedIndex.update(i => Math.max(i - 1, 0));
        } else if (event.key === 'ArrowRight') {
            if (isInput) return;
            event.preventDefault();
            this.nextPage();
        } else if (event.key === 'ArrowLeft') {
            if (isInput) return;
            event.preventDefault();
            this.selectedIndex.update(i => Math.max(i - 1, 0));
        } else if (event.key === 'Enter') {
            if (isInput) return;
            event.preventDefault();
            const order = this.ordenes()[this.selectedIndex()];
            if (order) {
                this.procesar(order);
            }
        }
    }

    constructor() {
        this.titleService.setTitle(`Bodegas Keyla - v${this.appVersion}`);
    }

    ngOnInit() {
        const user = this.authService.getStoredUser();
        if (user) {
            if (user.sucursal) {
                this.selectedSucursal = user.sucursal;
                this.searchTermSucursal = '';
            }
            // v2.2: Cargar días SOLO si tenemos contexto de usuario/empresa
            this.cargarDiasEmbarque();
        }
        this.cargarSucursales();
        this.buscar(0);
    }

    async cargarDiasEmbarque() {
        try {
            // v2.1: Log de diagnóstico para asegurar que la llamada se realiza
            const res = await firstValueFrom(this.dataService.executeAction<any>('GET_DIAS_SEMANA'));
            console.log('[OrdenesList] Respuesta diasSemana:', res);

            if (res && !res.isError) {
                const listRaw = res.diasSemana || [];
                const list = listRaw.map((d: any) => ({
                    value: d.codigoDia?.toString() || '',
                    label: d.nombreDia || '---'
                }));
                if (list.length > 0) {
                    this.diasSemana = [{ value: 'TODOS', label: 'Todos' }, ...list];
                    console.log('[OrdenesList] Combo de días poblado:', this.diasSemana.length);
                }
            }
        } catch (e) {
            console.error('Error cargando dias de embarque', e);
        }
    }

    async cargarSucursales() {
        try {
            const user = this.authService.getStoredUser();
            if (!user) return;
            const empresa = user.empresa?.codigoEmpresa;
            if (!empresa) return;
            const token = user.token || this.authService.getStoredToken() || '';

            // v4.3: Cargamos ambos para tener nombres maestros pero sin perder sucursales por desincronización
            const [masterBranches, authorizedRaw] = await Promise.all([
                firstValueFrom(this.cajaService.getSucursales(empresa, token)),
                firstValueFrom(this.cajaService.getSucursalesAutorizadas(empresa, token))
            ]);

            // 1. Sucursales autorizadas por permisos
            const myPermissions = authorizedRaw.filter((p: any) =>
                p.codigoUsuario?.toUpperCase() === user.username.toUpperCase() && p.esActivo === 'S'
            );

            // 2. Enriquecer con nombres del catálogo maestro
            this.sucursales = myPermissions.map((p: any) => {
                const master = masterBranches.find((m: any) => Number(m.codigoSucursal) === Number(p.codigoSucursal));
                return {
                    codigoSucursal: p.codigoSucursal,
                    nombreSucursal: master?.nombreSucursal || p.identificacionSucursal || `Sucursal ${p.codigoSucursal}`,
                    codigoEmpresa: p.codigoEmpresa,
                    esActivo: 'S'
                };
            });

            this.sucursalesFiltradas = [...this.sucursales];

            // v6.0: Selección Automática Robusta
            const userSuc = this.authService.getStoredUser()?.sucursal;
            if (this.sucursales.length > 0) {
                // Prioridad 1: Match con la sucursal del usuario
                const match = this.sucursales.find(s => s.codigoSucursal === userSuc?.codigoSucursal);
                if (match) {
                    this.selectedSucursal = match;
                } else if (!this.selectedSucursal) {
                    // Prioridad 2: Primera de la lista si no hay selección
                    this.selectedSucursal = this.sucursales[0];
                }
                
                // Forzar búsqueda inicial una vez cargadas las sucursales
                this.buscar(0);
            }
        } catch (e) {
            console.error('Error al cargar sucursales', e);
        }
    }

    async buscar(page: number = 0, silent: boolean = false) {
        if (!silent) this.loadingService.show();
        this.error.set('');
        this.currentPage.set(page);
        this.selectedIndex.set(0);

        try {
            const user = this.authService.getStoredUser();
            const empresa = user?.empresa?.codigoEmpresa;
            if (!empresa) {
                this.error.set('Contexto de empresa no encontrado');
                this.loadingService.hide();
                return;
            }
            let filtro = '';
            let valor = '';
            if (this.numeroPedido && this.numeroPedido.trim() !== '') {
                filtro = 'NUMERO_SOLICITUD';
                valor = this.numeroPedido.trim();
            }
            const pagedArg = page * 20;
            const res = await firstValueFrom(this.revisorService.getOrdenesDespachoList(
                empresa, filtro, valor, pagedArg, this.fechaDesde, this.fechaHasta, this.diaEmbarque
            ));
            if (res?.mensaje === 'OK' || res?.codigo === '000') {
                let list = res.ordenesDespacho || [];
                const mappedOrders = list.map((o: any) => ({
                    ...o,
                    solicitudOrden: `${o.numeroSolicitud}-${o.numeroOrdenDespacho}`,
                    nombreSucursalOrigen: o.nombreSucursalOrigen || o.nombreSucursalSolicita || 'Origen N/A',
                    nombreSucursalDestino: o.nombreSucursalDestino || o.nombreSucursal || 'Destino N/A',
                    grupoDespacho: o.nombreGrupoDespacho || o.codigoGrupoDespacho || 'SIN GRUPO',
                    nombreUsuarioDespachador: o.usuarioIngreso || 'SISTEMA',
                    codigoEstado: o.codigoEstado || 'DP'
                }));
                this.allOrdenesBase.set(mappedOrders);
                this.pageInput = page + 1;
            } else {
                this.error.set(`API: ${res?.mensaje || 'Error en el servicio'}`);
                this.allOrdenesBase.set([]);
            }
        } catch (e: any) {
            this.error.set(`CONEXIÓN: ${e.message}`);
            this.allOrdenesBase.set([]);
        } finally {
            this.loadingService.hide();
        }
    }

    purgarTodo() {
        // v1.3.8: LIMPIEZA SILENCIOSA Y DIRECTA (Evita bloqueos de confirm() en Electron)
        this.loadingService.forceHide();
        this.error.set('');
        
        // Reset de filtros y modelos
        this.numeroPedido = '';
        this.estado.set('TODOS');
        this.fechaDesde = this.getLocalDateString();
        this.fechaHasta = this.getLocalDateString();
        this.diaEmbarque = this.getInitialDay();

        // Limpiar lista e interfaz de inmediato
        this.allOrdenesBase.set([]);

        // Purgar memoria y disco
        this.revisorService.purgeAllSessions();
        
        // Foco de Bajo Nivel (Acceso directo al DOM para saltar cualquier bloqueo de Angular)
        const el = document.getElementById('numPedidoMaster');
        if (el) {
            (el as HTMLInputElement).disabled = false;
            (el as HTMLInputElement).readOnly = false;
            (el as HTMLInputElement).value = '';
            setTimeout(() => {
                el.focus();
                (el as HTMLInputElement).select();
            }, 10);
        }

        this.notificationService.show('Filtros reseteados. Puede escribir ahora.', false, 'LIMPIEZA');
    }

    nextPage() { this.buscar(this.currentPage() + 1); }
    prevPage() { if (this.currentPage() > 0) this.buscar(this.currentPage() - 1); }
    irAPagina() { this.buscar(Math.max(1, Number(this.pageInput) || 1) - 1); }

    procesar(orden: DispatchOrder) {
        // v104.9: Se permite entrar a órdenes DP/DT para MODO CONSULTA
        const compositeKey = `${orden.numeroSolicitud}-${orden.numeroOrdenDespacho}`;
        this.router.navigate(['/revisor'], { queryParams: { order: compositeKey, fd: this.fechaDesde, fh: this.fechaHasta } });
    }

    async imprimirOrdenDirecto(orden: DispatchOrder) {
        console.log('[Revisor:Mantenimiento] 🖨️ Reimpresión directa unificada:', orden.solicitudOrden);
        this.loadingService.show();
        try {
            // 1. Obtener cabecera para asegurar datos de Franquicia/Cliente (v200.7)
            const headRes = await firstValueFrom(this.dataService.executeAction<any>('GET_ORDEN_DESPACHO', { numero: `${orden.numeroSolicitud}-${orden.numeroOrdenDespacho}` }));
            const fullOrder = (headRes?.ordenesDespacho && headRes.ordenesDespacho.length > 0) ? headRes.ordenesDespacho[0] : orden;

            // 2. Obtener detalles de la orden para el reporte de transferencia
            const detRes = await firstValueFrom(this.dataService.getDetallesOrdenDespacho(orden.numeroSolicitud, orden.numeroOrdenDespacho));

            if (detRes?.isError || !detRes?.detalles) {
                throw new Error(detRes?.mensaje || 'No se pudieron obtener los detalles de la orden.');
            }

            const products: Product[] = detRes.detalles
                .filter((d: any) => d.cantidadDespachadaEnCajas && d.cantidadDespachadaEnCajas > 0)
                .map((d: any) => ({
                item: d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString() || d.codigoBarras?.toString() || '',
                nombre: d.nombreExistencia || 'SIN NOMBRE',
                unidad: d.tipoMedida || 'U/C',
                solicita: d.cantidad || 0,
                despachado: d.cantidadDespachadaEnCajas || 0,
                lote: d.lote || '',
                caducidad: d.caducidad || '',
                codigoExistencia: d.codigoExistencia?.toString() || '',
                codigoBarras: d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString() || d.codigoBarras?.toString() || '',
                laboratorio: d.fabricante || '',
                vtas: 0, sLocal: 0, suger: 0, bulto: 0, invBod: d.saldoActualEnCajas || d.stock || 0, color: 'negro'
            }));

            const user = this.authService.getStoredUser();
            const ordenFullId = `${orden.numeroSolicitud}-${orden.numeroOrdenDespacho}`;

            const extraData = {
                sucursal: fullOrder.nombreSucursalDestino || fullOrder.nombreSucursal || '---',
                usuario: user?.username || 'SISTEMA',
                digitador: user?.username || 'SISTEMA',
                fecha: new Date().toLocaleDateString('es-EC'),
                bodegaOrigen: fullOrder.nombreSucursalOrigen,
                bodegaDestino: fullOrder.nombreSucursalDestino || fullOrder.nombreSucursal,
                bultos: []
            };
 
            // 4. Generar y Enviar Reporte de Transferencia (A4) vía Jasper (Configurable)
            setTimeout(async () => {
                const res = await this.printerService.imprimirReporteTransferenciaJasper(ordenFullId, products, extraData);
                if (res.success) {
                    this.notificationService.show("Reimpresión generada satisfactoriamente vía Jasper.", false, "ÉXITO");
                } else {
                    this.notificationService.show(`Error reporte: ${res.error}`, true, "ERROR");
                }
            }, 800);

        } catch (e: any) {
            this.error.set(`ERROR IMPRESIÓN: ${e.message}`);
            this.notificationService.show(e.message, true, "ERROR");
        } finally {
            this.loadingService.hide();
        }
    }

    /**
     * v105.0: Reimpresión de Orden de Despacho Masiva (Picking List Matricial)
     */
    async imprimirOrdenMasivo(orden: DispatchOrder) {
        console.log('[Revisor:Mantenimiento] 🖨️ Reimpresión Masiva:', orden.solicitudOrden);
        this.loadingService.show();
        try {
            const user = this.authService.getStoredUser();
            const empresa = user?.empresa?.codigoEmpresa || 1;

            // 1. Consultar el nuevo servicio de datos masivos
            const resData = await firstValueFrom(this.dataService.executeAction<any>('GET_ORDEN_DESPACHO_MASIVO', {
                empresa: empresa,
                solicitud: orden.numeroSolicitud,
                orden: orden.numeroOrdenDespacho
            }));

            if (!resData || resData.isError || !resData.cabecera) {
                throw new Error(resData?.mensaje || 'No se pudo obtener la información masiva de la orden.');
            }

            // 2. Enviar a imprimir vía Jasper
            const printRes = await this.printerService.imprimirDespachoMasivoJasper(
                { ...resData.cabecera, usuario: user?.username || 'SISTEMA' },
                resData.detalles || []
            );

            if (printRes.success) {
                this.notificationService.show("Reporte de despacho masivo generado correctamente.", false, "ÉXITO");
            } else {
                throw new Error(printRes.error);
            }

        } catch (e: any) {
            console.error('[OrdenesList] Error en impresión masiva:', e);
            this.notificationService.show(e.message, true, "ERROR");
        } finally {
            this.loadingService.hide();
        }
    }

    /**
     * v104.6: Abre el modal para configurar la reimpresión de etiquetas
     */
    abrirModalEtiquetas(orden: DispatchOrder) {
        this.selectedOrderForLabels.set(orden);
        this.labelQuantity = 1;
        this.showLabelModal.set(true);
        this.cargarTiposBultos();
    }

    async cargarTiposBultos() {
        try {
            const res = await firstValueFrom(this.dataService.executeAction<any>('GET_TIPOS_BULTOS'));
            if (res && !res.isError) {
                this.tiposBultos = res.tiposBultos || [];
                if (this.tiposBultos.length > 0) {
                    // Seleccionar por defecto ETIQUETA REIMPRESA o similar si existe
                    const def = this.tiposBultos.find(b => b.nombreTipoBulto.toUpperCase().includes('ETIQUETA')) || this.tiposBultos[0];
                    this.selectedTipoBulto.set(def);
                }
            }
        } catch (e) {
            console.error('Error cargando tipos de bultos', e);
        }
    }

    async confirmarImpresionEtiquetas() {
        const orden = this.selectedOrderForLabels();
        const bulto = this.selectedTipoBulto();
        const quantity = this.labelQuantity;

        if (!orden || !bulto) return;

        this.loadingService.show();
        this.showLabelModal.set(false);

        try {
            const user = this.authService.getStoredUser();
            const ordenFullId = `${orden.numeroSolicitud}-${orden.numeroOrdenDespacho}`;

            // v200.7: Obtener cabecera para asegurar datos de Franquicia/Cliente en etiquetas
            const headRes = await firstValueFrom(this.dataService.executeAction<any>('GET_ORDEN_DESPACHO', { numero: ordenFullId }));
            const fullOrder = (headRes?.ordenesDespacho && headRes.ordenesDespacho.length > 0) ? headRes.ordenesDespacho[0] : orden;

            const extraData = {
                sucursal: fullOrder.nombreSucursalDestino || fullOrder.nombreSucursal || '---',
                usuario: user?.username || 'SISTEMA',
                digitador: user?.username || 'SISTEMA',
                fecha: new Date().toLocaleDateString('es-EC'),
                bodegaOrigen: fullOrder.nombreSucursalOrigen,
                bodegaDestino: fullOrder.nombreSucursalDestino || fullOrder.nombreSucursal,
                bultos: [{ codigoTipoBulto: bulto.codigoTipoBulto, nombreTipoBulto: bulto.nombreTipoBulto, cantidad: quantity }]
            };

            const bultoParam = { label: bulto.nombreTipoBulto, value: quantity };
            const res = await this.printerService.imprimirEtiquetaJasper(ordenFullId, bultoParam, extraData);

            if (res.success) {
                this.notificationService.show(`Se han enviado ${quantity} etiquetas de [${bulto.nombreTipoBulto}] a la cola de impresión.`, false, "ÉXITO");
            } else {
                throw new Error(res.error);
            }
        } catch (e: any) {
            this.notificationService.show(`Error reimprimiendo etiquetas: ${e.message}`, true, "ERROR");
        } finally {
            this.loadingService.hide();
        }
    }

    getStatusLabel(code: string): string {
        const labels: Record<string, string> = { 'DP': 'Despacho Parcial', 'DT': 'Despacho Total', 'ING': 'Ingresado', 'PRO': 'Despachado', 'CAN': 'Cancelado' };
        return labels[code] || code;
    }

    getStatusClass(code: string): string { return `status-${code.toLowerCase()}`; }

    toggleSucursalDropdown() {
        this.showSucursalDropdown = !this.showSucursalDropdown;
        if (this.showSucursalDropdown) {
            this.searchTermSucursal = ''; // Limpiar búsqueda para ver todas las opciones al abrir
            this.filterSucursales();
        }
    }
    selectSucursal(suc: Sucursal) { this.selectedSucursal = suc; this.searchTermSucursal = suc.nombreSucursal; this.showSucursalDropdown = false; this.buscar(); }
    filterSucursales() {
        const term = this.searchTermSucursal.toLowerCase().trim();
        this.sucursalesFiltradas = term ? this.sucursales.filter(s => s.nombreSucursal.toLowerCase().includes(term) || s.codigoSucursal.toString().includes(term)) : [...this.sucursales];
    }

    logout() { this.authService.logout(); this.router.navigate(['/login']); }

    formatDate(dateStr: string): string {
        if (!dateStr) return '---';
        try {
            if (dateStr.includes('-')) {
                const parts = dateStr.split('T')[0].split('-');
                if (parts.length === 3 && parts[0].length === 4) return `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
            if (dateStr.includes('/')) {
                const parts = dateStr.split('/');
                if (parts.length === 3) return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
            }
            return dateStr;
        } catch (e) { return dateStr; }
    }
}
