import { Component, OnInit, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RevisorService } from '../services/revisor.service';
import { AuthService } from '../../../core/services/auth.service';
import { Router, ActivatedRoute } from '@angular/router';
import { CajaService } from '../../../core/services/caja.service';
import { Sucursal } from '../../../shared/models/auth.model';
import { LoadingService } from '../../../core/services/loading.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DispatchOrder } from '../../../shared/models/product.model';
import { firstValueFrom } from 'rxjs';

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

    // Filters
    // Filters (v2.9)
    diaEmbarque: string = 'TODOS';
    fechaDesde: string = new Date().toISOString().split('T')[0];
    fechaHasta: string = new Date().toISOString().split('T')[0];
    estado: string = 'DP';
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
    public ordenes = signal<DispatchOrder[]>([]);
    public loading = this.loadingService.isLoading;
    public error = signal<string>('');
    public currentPage = signal<number>(0);
    public pageInput: number = 1;
    public selectedIndex = signal<number>(0); // v2.4: Keyboard navigation

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        if (this.ordenes().length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.selectedIndex.update(i => Math.min(i + 1, this.ordenes().length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.selectedIndex.update(i => Math.max(i - 1, 0));
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.nextPage();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.prevPage();
        } else if (event.key === 'Enter') {
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
            this.searchTermSucursal = user.sucursal.nombreSucursal;
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

            const authorizedRaw = await firstValueFrom(this.cajaService.getSucursalesAutorizadas(empresa, token));
            const myBranches = authorizedRaw.filter((a: any) =>
                a.codigoUsuario.toUpperCase() === user.username.toUpperCase() && a.esActivo === 'S'
            );

            this.sucursales = myBranches.map((b: any) => ({
                codigoSucursal: b.codigoSucursal,
                nombreSucursal: b.identificacionSucursal || `Sucursal ${b.codigoSucursal}`,
                codigoEmpresa: b.codigoEmpresa,
                esActivo: 'S'
            }));
            this.sucursalesFiltradas = [...this.sucursales];
        } catch (e) {
            console.error('Error al cargar sucursales', e);
        }
    }

    async buscar(page: number = 0) {
        this.loadingService.show();
        this.error.set('');
        this.currentPage.set(page);
        this.selectedIndex.set(0); // Reset selection on new search

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

            // v2.9: Solo enviar filtro si se busca por Numero de Pedido (Solicitud-Orden)
            if (this.numeroPedido && this.numeroPedido.trim() !== '') {
                filtro = 'NUMERO_SOLICITUD'; // DataService interpreta esto como concatenado
                valor = this.numeroPedido.trim();
            }

            // v110.0: Corregir inicio de página (0-indexed para el API de Keyla)
            const pagedArg = page * 20;
            console.log('[Revisor:Mantenimiento] 🚀 Ejecutando búsqueda:', { empresa, usuario: user?.username, filtro, valor, pag: pagedArg });
            const res = await firstValueFrom(this.revisorService.getOrdenesDespachoList(empresa, filtro, valor, pagedArg));
            console.log('[Revisor:Mantenimiento] 📥 Respuesta API:', res);
            console.log('[Revisor] Respuesta de API:', res);

            if (res?.mensaje === 'OK' || res?.codigo === '000') {
                let list = res.ordenesDespacho || [];
                console.log(`[Revisor] Total registros recibidos: ${list.length}`);

                // v2.9.2: Desactivados filtros locales por Sucursal y Estado según solicitud (Solo vista)
                /*
                if (this.selectedSucursal && Number(this.selectedSucursal.codigoSucursal) !== 0) {
                    const sid = Number(this.selectedSucursal.codigoSucursal);
                    list = list.filter((o: any) => Number(o.codigoSucursal) === sid);
                }

                if (this.estado) {
                    list = list.filter((o: any) => o.codigoEstado === this.estado);
                }
                */

                console.log(`[Revisor] Registros finales (sin filtros locales): ${list.length}`);

                // v2.9.3: Mapeo unificado según requerimiento mantenimiento y lógica de esDespachado
                const mappedOrders = list.map((o: any) => ({
                    ...o,
                    solicitudOrden: `${o.numeroSolicitud}-${o.numeroOrdenDespacho}`,
                    nombreSucursalOrigen: o.nombreSucursalOrigen || o.nombreSucursalSolicita || 'Origen N/A',
                    nombreSucursalDestino: o.nombreSucursalDestino || o.nombreSucursal || 'Destino N/A',
                    // v106.0: Nuevos campos según especificación Keyla
                    grupoDespacho: o.codigoGrupoDespacho || 'SIN GRUPO',
                    nombreUsuarioDespachador: o.usuarioIngreso || 'SISTEMA',
                    // v2.9.3: Usar el código de estado real del API (DP / DT / etc)
                    codigoEstado: o.codigoEstado || 'DP'
                }));

                this.ordenes.set(mappedOrders);
                this.pageInput = page + 1;
            } else {
                const msg = res?.mensaje || res?.error || 'No se encontraron registros o error en el servicio';
                this.error.set(`API: ${msg}`);
                this.ordenes.set([]);
            }
        } catch (e: any) {
            console.error('Error en búsqueda:', e);
            this.error.set(`CONEXIÓN: ${e.message || 'Error inesperado'}`);
            this.ordenes.set([]);
        } finally {
            this.loadingService.hide();
        }
    }

    purgarTodo() {
        if (confirm('¿Está seguro de que desea eliminar todas las sesiones locales? Se recargará todo desde el servidor.')) {
            this.revisorService.purgeAllSessions();
            this.buscar();
        }
    }

    nextPage() {
        this.buscar(this.currentPage() + 1);
    }

    prevPage() {
        if (this.currentPage() > 0) {
            this.buscar(this.currentPage() - 1);
        }
    }

    irAPagina() {
        const targetPage = Math.max(1, Number(this.pageInput) || 1);
        this.buscar(targetPage - 1); // API es 0-based
    }

    procesar(orden: DispatchOrder) {
        // v131.0: Usar clave compuesta (Solicitud-Orden) para evitar ambigüedades en la carga
        const compositeKey = `${orden.numeroSolicitud}-${orden.numeroOrdenDespacho}`;
        this.router.navigate(['/revisor'], {
            queryParams: { order: compositeKey }
        });
    }

    getStatusLabel(code: string): string {
        const labels: Record<string, string> = {
            'DP': 'Despacho Parcial',
            'DT': 'Despacho Total',
            'ING': 'Ingresado',
            'PRO': 'Despachado',
            'CAN': 'Cancelado'
        };
        return labels[code] || code;
    }

    getStatusClass(code: string): string {
        return `status-${code.toLowerCase()}`;
    }

    // Dropdown Handlers
    toggleSucursalDropdown() {
        this.showSucursalDropdown = !this.showSucursalDropdown;
    }

    selectSucursal(suc: Sucursal) {
        this.selectedSucursal = suc;
        this.searchTermSucursal = suc.nombreSucursal;
        this.showSucursalDropdown = false;
        this.buscar(); // Re-search when sucursal changes
    }

    filterSucursales() {
        const term = this.searchTermSucursal.toLowerCase().trim();
        if (!term) {
            this.sucursalesFiltradas = [...this.sucursales];
        } else {
            this.sucursalesFiltradas = this.sucursales.filter(s =>
                s.nombreSucursal.toLowerCase().includes(term) ||
                s.codigoSucursal.toString().includes(term)
            );
        }
    }

    logout() {
        this.authService.logout();
        this.router.navigate(['/login']);
    }

    /**
     * v2.3: Formatea fecha string del API a dd/MM/yyyy de forma robusta
     */
    formatDate(dateStr: string): string {
        if (!dateStr) return '---';
        try {
            // Si viene YYYY-MM-DD
            if (dateStr.includes('-')) {
                const parts = dateStr.split('T')[0].split('-');
                if (parts.length === 3 && parts[0].length === 4) {
                    return `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
            }
            // Si viene MM/DD/YYYY (como parece sugerir la captura)
            if (dateStr.includes('/')) {
                const parts = dateStr.split('/');
                if (parts.length === 3) {
                    // Asumimos MM/DD/YYYY -> DD/MM/YYYY
                    if (Number(parts[0]) <= 12 && Number(parts[1]) > 12) {
                        return `${parts[1]}/${parts[0]}/${parts[2]}`;
                    }
                    // Si ya es DD/MM/YYYY o ambiguo, lo dejamos igual pero aseguramos orden
                    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
                }
            }
            return dateStr;
        } catch (e) {
            return dateStr;
        }
    }
}
