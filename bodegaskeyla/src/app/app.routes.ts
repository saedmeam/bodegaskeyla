import { Routes } from '@angular/router';
import { ReposicionComponent } from './features/revisor/reposicion/reposicion.component';
import { TransferenciasComponent } from './features/transferencias/transferencias/transferencias.component';
import { TablasValidacionComponent } from './features/tablas/tablas-validacion/tablas-validacion.component';
import { PedidoCreacionComponent } from './features/pedidos/pedido-creacion/pedido-creacion.component';
import { ProcesamientoPedidosComponent } from './features/bodega-central/procesamiento-pedidos/procesamiento-pedidos.component';
import { LoginComponent } from './features/auth/login/login.component';
import { OrdenesDespachoListComponent } from './features/revisor/ordenes-despacho-list/ordenes-despacho-list.component';
import { PrinterSetupComponent } from './features/config/printer-setup/printer-setup.component';

export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: 'login', component: LoginComponent },
    { path: 'despacho-lista', component: OrdenesDespachoListComponent },
    { path: 'config-impresora', component: PrinterSetupComponent },
    { path: 'revisor', component: ReposicionComponent },
    { path: 'transferencias', component: TransferenciasComponent },
    { path: 'tablas-validacion', component: TablasValidacionComponent },
    { path: 'pedidos', component: PedidoCreacionComponent },
    { path: 'bodega-central', component: ProcesamientoPedidosComponent },
];
