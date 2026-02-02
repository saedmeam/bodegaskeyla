import { Routes } from '@angular/router';
import { ReposicionComponent } from './features/revisor/reposicion/reposicion.component';
import { TransferenciasComponent } from './features/transferencias/transferencias/transferencias.component';
import { TablasValidacionComponent } from './features/tablas/tablas-validacion/tablas-validacion.component';

export const routes: Routes = [
    { path: '', redirectTo: 'revisor', pathMatch: 'full' },
    { path: 'revisor', component: ReposicionComponent },
    { path: 'transferencias', component: TransferenciasComponent },
    { path: 'tablas-validacion', component: TablasValidacionComponent },
];
