import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NavigationService } from '../../services/navigation.service';

@Component({
    selector: 'app-menu-principal',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './menu-principal.component.html',
    styleUrl: './menu-principal.component.css'
})
export class MenuPrincipalComponent {
    public navService = inject(NavigationService);
    menus = [
        { label: 'Archivo', options: [{ text: 'Abrir', route: '' }, { text: 'Cerrar', route: '' }, { text: 'Salir', route: '' }] },
        {
            label: 'Despacho', options: [
                { text: 'Listado Órdenes Despacho', route: '/despacho-lista' },
                { text: 'Reposición Mercadería', route: '/revisor' },
                { text: 'Reposición Cód. Barra', route: '/revisor' },
                { text: 'Transferencia Sucursales', route: '/transferencias' },
                { text: 'Guía Despacho', route: '' }
            ]
        },
        { label: 'Caducados', options: [] },
        { label: 'Vencimientos', options: [] },
        { label: 'Orden de Compra', options: [] },
        { label: 'Inventarios', options: [] },
        { label: 'Cuadro de Caja', options: [] },
        { label: 'Logística y B.P.A.D.T', options: [] },
        { label: 'Clientes', options: [] },
        { label: 'Proveedores', options: [] },
        { label: 'Caja', options: [] },
        { label: 'Bancos', options: [] },
        { label: 'Contabilidad', options: [] },
        { label: 'Anexos', options: [] },
        {
            label: 'Mantenimiento', options: [
                { text: 'Usuarios', route: '' },
                { text: 'Empresa', route: '' },
                { text: 'Accesos', route: '' },
                { text: 'Parametrización de Tablas', route: '/tablas-validacion' }
            ]
        },
        { label: 'Salir', options: [] }
    ];

    iconos = [
        { name: 'Menu', icon: 'assets/icons/menu.png' },
        { name: 'Inventario', icon: 'assets/icons/inventario.png' },
        { name: 'WWW', icon: 'assets/icons/www.png' },
        { name: 'D.S.R.I', icon: 'assets/icons/dsri.png' },
        { name: 'Cargos', icon: 'assets/icons/cargos.png' },
        { name: 'Salir', icon: 'assets/icons/salir.png' }
    ];

    salir() {
        this.navService.closeMenu();
        if (window.electronAPI) {
            window.electronAPI.closeApp();
        }
    }
}
