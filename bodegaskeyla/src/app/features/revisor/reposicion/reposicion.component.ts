import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RevisorService } from '../services/revisor.service';

@Component({
    selector: 'app-reposicion',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './reposicion.component.html',
    styleUrl: './reposicion.component.css'
})
export class ReposicionComponent implements OnInit {
    private revisorService = inject(RevisorService);

    // Estados de UI
    numero = "";
    fecha = new Date().toLocaleString();
    movimiento = "";
    movimientoNombre = "";
    bodega = "";
    concepto = "";
    barcodeInput = "";

    // Proyecciones del servicio orquestador
    ordenProductos = this.revisorService.ordenProductos;
    escaneados = this.revisorService.escaneados;

    totalItems = computed(() => this.ordenProductos().length);
    totalCorrectos = computed(() => this.escaneados().filter(p => p.color === 'negro').length);
    totalIncompletos = computed(() => this.escaneados().filter(p => p.color === 'azul').length);

    ngOnInit() {
        // La pantalla inicia vacía. El usuario debe ingresar una orden.
    }

    consultarOrden() {
        if (!this.numero || this.numero.trim() === "") {
            // Si el campo está vacío, limpiamos todo para mayor seguridad
            this.bodega = "";
            this.movimiento = "";
            this.movimientoNombre = "";
            this.concepto = "";
            return;
        }

        this.notificationMessage.set(`Consultando orden ${this.numero}...`);

        // Simulación: Al consultar, poblamos los campos bloqueados desde la "DB"
        this.revisorService.executeProcess('LOAD', { orderNumber: this.numero });

        // Simulamos la respuesta de cabecera
        setTimeout(() => {
            this.bodega = "001";
            this.movimiento = "057";
            this.movimientoNombre = "REPOSICIÓN AUTOMÁTICA";
            this.concepto = `Revisión de Orden #${this.numero}`;
            this.notificationMessage.set("");
        }, 1000);
    }

    manualSelect(item: string) {
        this.barcodeInput = item;
        this.simularEscaneo();
    }

    notificationMessage = signal("");
    isError = signal(false);

    simularEscaneo() {
        if (!this.barcodeInput) return;

        // REGLA DE NEGOCIO: No permitir pistoleo si no hay orden cargada
        if (this.ordenProductos().length === 0) {
            this.isError.set(true);
            this.notificationMessage.set("ERROR: Debe cargar una orden antes de pistolear.");
            this.barcodeInput = "";
            setTimeout(() => this.notificationMessage.set(""), 4000);
            return;
        }

        this.notificationMessage.set("");

        // Uso del método orquestador
        const result = this.revisorService.executeProcess('SCAN', { barcode: this.barcodeInput });

        if (!result) {
            this.isError.set(true);
            this.notificationMessage.set(`ERROR: [${this.barcodeInput}] No pertenece a esta orden.`);
        } else {
            this.isError.set(false);
            this.notificationMessage.set(`OK: [${result.item}] Registrado con éxito.`);
        }

        setTimeout(() => this.notificationMessage.set(""), 4000);
        this.barcodeInput = "";
    }

    updateQty(item: string, qty: number) {
        this.revisorService.executeProcess('UPDATE_QTY', { item, qty });
    }
}
