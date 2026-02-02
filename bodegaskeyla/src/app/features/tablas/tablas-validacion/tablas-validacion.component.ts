import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-tablas-validacion',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './tablas-validacion.component.html',
    styleUrl: './tablas-validacion.component.css'
})
export class TablasValidacionComponent {
    title = "TABLAS DE VALIDACION";
}
