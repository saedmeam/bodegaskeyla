import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RevisorService } from '../services/revisor.service';
import { AuthService } from '../../../core/services/auth.service';
import { Router } from '@angular/router';
import { CajaService } from '../../../core/services/caja.service';
import { Sucursal } from '../../../shared/models/auth.model';
import { LoadingService } from '../../../core/services/loading.service';
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
    private revisorService = inject(RevisorService);
    private authService = inject(AuthService);
    private router = inject(Router);
    private loadingService = inject(LoadingService);
    private cajaService = inject(CajaService);

    // Filters
    fechaDesde: string = new Date().toISOString().split('T')[0];
    fechaHasta: string = new Date().toISOString().split('T')[0]; // Not used by current API signature but kept for UI
    estado: string = 'ING';
    numeroPedido: string = '';
    selectedSucursal: Sucursal | null = null;

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
                // v100.0: El valor se envía a DataService, que ahora fuerza la clave compuesta
                filtro = 'NUMERO_SOLICITUD'; // Nombre descriptivo, DataService usará el compuesto
                valor = this.numeroPedido.trim();
            }

            console.log(`[Revisor] Consultando Órdenes - Empresa: ${empresa}, Filtro: "${filtro}", Valor: "${valor}", Pág: ${page}`);
            const res = await firstValueFrom(this.revisorService.getOrdenesDespachoList(empresa, filtro, valor, page));
            console.log('[Revisor] Respuesta de API:', res);

            if (res?.mensaje === 'OK' || res?.codigo === '000') {
                let list = res.ordenesDespacho || [];
                console.log(`[Revisor] Total registros recibidos: ${list.length}`);

                // Aplicar filtros en el cliente para mayor flexibilidad (Sucursal y Estado)
                if (this.selectedSucursal && Number(this.selectedSucursal.codigoSucursal) !== 0) {
                    const sid = Number(this.selectedSucursal.codigoSucursal);
                    list = list.filter((o: any) => Number(o.codigoSucursal) === sid);
                }

                if (this.estado) {
                    list = list.filter((o: any) => o.codigoEstado === this.estado);
                }

                console.log(`[Revisor] Registros tras filtrado local: ${list.length}`);

                // v100.0: Mapeo robusto de campos técnicos para visualización (Origen y Destino)
                const mappedOrders = list.map((o: any) => ({
                    ...o,
                    nombreSucursalOrigen: o.nombreSucursalOrigen || o.nombreSucursalSolicita || 'Origen N/A',
                    nombreSucursalDestino: o.nombreSucursalDestino || o.nombreSucursal || 'Destino N/A',
                    nombreSucursal: o.nombreSucursal || 'Portete',
                    nombreSucursalSolicita: o.nombreSucursalSolicita || '---',
                    descripcionUbicacion: o.descripcionUbicacion || o.ubicacion || 'N/A',
                    nombreUsuarioDespachador: o.nombreUsuarioDespachador || o.despachador || 'Sistema'
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
            'ING': 'Pendiente',
            'PRO': 'Procesado',
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

    cerrarPantalla() {
        window.history.back();
    }
}
