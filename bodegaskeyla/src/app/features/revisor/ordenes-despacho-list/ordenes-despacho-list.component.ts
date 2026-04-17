import { Component, OnInit, inject, signal, HostListener, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
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
    private router = inject(Router);
    private cajaService = inject(CajaService);
    private printerService = inject(PrinterService);
    private configService = inject(ConfigService);
    private dataService = inject(DataService);

    // Filters
    diaEmbarque: string = 'TODOS';
    fechaDesde: string = this.getLocalDateString();
    fechaHasta: string = this.getLocalDateString();

    private getLocalDateString(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    estado = signal<string>('TODOS');
    numeroPedido: string = '';
    selectedSucursal: Sucursal | null = null;

    diasSemana = [
        { value: 'TODOS', label: 'Todos' },
        { value: 'LUN', label: 'Lunes' },
        { value: 'MAR', label: 'Martes' },
        { value: 'MIE', label: 'Miércoles' },
        { value: 'JUE', label: 'Jueves' },
        { value: 'VIE', label: 'Viernes' },
        { value: 'SAB', label: 'Sábado' },
        { value: 'DOM', label: 'Domingo' }
    ];

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

    ngOnInit() {
        const user = this.authService.getStoredUser();
        if (user && user.sucursal) {
            this.selectedSucursal = user.sucursal;
            // v4.3: searchTermSucursal debe estar vacío para no filtrar el dropdown al abrirlo
            this.searchTermSucursal = '';
        }
        this.cargarSucursales();
        this.buscar(0);
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
        } catch (e) {
            console.error('Error al cargar sucursales', e);
        }
    }

    async buscar(page: number = 0) {
        this.loadingService.show();
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
                empresa, filtro, valor, pagedArg, this.fechaDesde, this.fechaHasta
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
        if (confirm('¿Está seguro de que desea eliminar todas las sesiones locales?')) {
            this.revisorService.purgeAllSessions();
            this.buscar();
        }
    }

    nextPage() { this.buscar(this.currentPage() + 1); }
    prevPage() { if (this.currentPage() > 0) this.buscar(this.currentPage() - 1); }
    irAPagina() { this.buscar(Math.max(1, Number(this.pageInput) || 1) - 1); }

    procesar(orden: DispatchOrder) {
        if (orden.codigoEstado === 'DP' || orden.codigoEstado === 'DT') {
            this.notificationService.show(`ERROR: La orden ${orden.solicitudOrden} ya ha sido procesada.`, true, 'ACCESO DENEGADO');
            return;
        }
        const compositeKey = `${orden.numeroSolicitud}-${orden.numeroOrdenDespacho}`;
        this.router.navigate(['/revisor'], { queryParams: { order: compositeKey, fd: this.fechaDesde, fh: this.fechaHasta } });
    }

    async imprimirOrdenDirecto(orden: DispatchOrder) {
        console.log('[Revisor:Mantenimiento] 🖨️ Reimpresión directa unificada:', orden.solicitudOrden);
        this.loadingService.show();
        try {
            // 1. Obtener detalles de la orden para el reporte de transferencia
            const detRes = await firstValueFrom(this.dataService.getDetallesOrdenDespacho(orden.numeroSolicitud, orden.numeroOrdenDespacho));

            if (detRes?.isError || !detRes?.detalles) {
                throw new Error(detRes?.mensaje || 'No se pudieron obtener los detalles de la orden.');
            }

            const products: Product[] = detRes.detalles.map((d: any) => ({
                item: d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString() || d.codigoBarras?.toString() || '',
                nombre: d.nombreExistencia || 'SIN NOMBRE',
                unidad: d.tipoMedida || 'U/C',
                solicita: d.cantidad || d.cantidad || 0,
                despachado: d.cantidad || d.cantidad || 0,
                lote: d.lote || '',
                caducidad: d.caducidad || '',
                codigoBarras: d.sciExistenciasXCodBarras?.[0]?.codigoBarras?.toString() || d.codigoBarras?.toString() || '',
                vtas: 0, sLocal: 0, suger: 0, bulto: 0, invBod: d.saldoActualEnCajas || d.stock || 0, color: 'negro'
            }));

            // 2. Definir bultos para la etiqueta (v160.48: Por defecto 2 etiquetas si es reimpresión rápida)
            // v3.2: Nombre de sucursal destino corregido para consistencia total
            const bultosParaImprimir = [{ codigoTipoBulto: 999, nombreTipoBulto: 'IMPRESIÓN DE ETIQUETAS', cantidad: 2 }];
            const user = this.authService.getStoredUser();
            const ordenFullId = `${orden.numeroSolicitud}-${orden.numeroOrdenDespacho}`;

            const extraData = {
                sucursal: orden.nombreSucursalDestino || orden.nombreSucursal || '---',
                usuario: user?.username || 'SISTEMA',
                digitador: user?.username || 'SISTEMA',
                fecha: new Date().toLocaleDateString('es-EC'),
                bodegaOrigen: orden.nombreSucursalOrigen,
                bodegaDestino: orden.nombreSucursalDestino || orden.nombreSucursal,
                bultos: bultosParaImprimir
            };

            // 3. Generar y Enviar Etiquetas Térmicas vía Jasper
            const bultosLabelsMapped = bultosParaImprimir.map(b => ({ label: b.nombreTipoBulto, value: b.cantidad }));
            for (const bulto of bultosLabelsMapped) {
                await this.printerService.imprimirEtiquetaJasper(ordenFullId, bulto, extraData);
            }

            // 4. Generar y Enviar Reporte de Transferencia (A4) vía Jasper
            setTimeout(async () => {
                await this.printerService.imprimirReporteTransferenciaJasper(ordenFullId, products, extraData);
                this.notificationService.show("Reimpresión generada satisfactoriamente vía Jasper.", false, "ÉXITO");
            }, 800);

        } catch (e: any) {
            this.error.set(`ERROR IMPRESIÓN: ${e.message}`);
            this.notificationService.show(e.message, true, "ERROR");
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
