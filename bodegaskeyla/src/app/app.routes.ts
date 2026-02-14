import { Routes } from '@angular/router';
import { ReposicionComponent } from './features/revisor/reposicion/reposicion.component';
import { TransferenciasComponent } from './features/transferencias/transferencias/transferencias.component';
import { TablasValidacionComponent } from './features/tablas/tablas-validacion/tablas-validacion.component';
import { PedidoCreacionComponent } from './features/pedidos/pedido-creacion/pedido-creacion.component';
import { ProcesamientoPedidosComponent } from './features/bodega-central/procesamiento-pedidos/procesamiento-pedidos.component';

export const routes: Routes = [
    { path: '', redirectTo: 'revisor', pathMatch: 'full' },
    { path: 'revisor', component: ReposicionComponent },
    { path: 'transferencias', component: TransferenciasComponent },
    { path: 'tablas-validacion', component: TablasValidacionComponent },
    { path: 'pedidos', component: PedidoCreacionComponent },
    { path: 'bodega-central', component: ProcesamientoPedidosComponent },
];
