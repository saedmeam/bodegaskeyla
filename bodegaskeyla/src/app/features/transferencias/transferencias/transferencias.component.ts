import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-transferencias',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './transferencias.component.html',
    styleUrl: './transferencias.component.css'
})
export class TransferenciasComponent {
    title = "TRANSFERENCIAS DE MERCADERÍA A SUCURSALES";
}
