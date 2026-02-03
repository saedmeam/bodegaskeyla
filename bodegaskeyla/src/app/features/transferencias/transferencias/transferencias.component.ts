import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransferenciaService } from '../services/transferencia.service';

@Component({
    selector: 'app-transferencias',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './transferencias.component.html',
    styleUrl: './transferencias.component.css'
})
export class TransferenciasComponent implements OnInit {
    private transferenciaService = inject(TransferenciaService);

    // Estados de UI
    numero = "";
    fecha = "";
    bodega = "";
    movimiento = "";
    movimientoNombre = "";
    pedido = "";
    concepto = "";

    // Proyecciones del servicio
    productos = this.transferenciaService.productos;
    infoCabecera = this.transferenciaService.infoCabecera;

    // Totales calculados
    totalGeneral = computed(() => {
        return this.productos().reduce((acc, p) => acc + p.subtotal, 0);
    });

    totalItems = computed(() => this.productos().length);

    notificationMessage = signal("");

    ngOnInit() {
        // Inicia en blanco. El usuario debe consultar una transferencia.
    }

    consultarTransferencia() {
        if (!this.numero || this.numero.trim() === "") {
            this.limpiarPantalla();
            return;
        }

        this.notificationMessage.set(`Consultando transferencia ${this.numero}...`);

        // Ejecutamos el orquestador
        this.transferenciaService.executeProcess('LOAD', { numero: this.numero });

        // Sincronizamos la cabecera cuando el servicio la actualice
        // En una implementación real usaríamos un effect o suscripción
        setTimeout(() => {
            const info = this.infoCabecera();
            if (info) {
                this.fecha = info.fecha;
                this.bodega = info.bodega;
                this.movimiento = info.movimiento;
                this.movimientoNombre = info.movimientoNombre;
                this.pedido = info.pedido;
                this.concepto = info.concepto;
            }
            this.notificationMessage.set("");
        }, 800);
    }

    private limpiarPantalla() {
        this.fecha = "";
        this.bodega = "";
        this.movimiento = "";
        this.movimientoNombre = "";
        this.pedido = "";
        this.concepto = "";
        this.transferenciaService.productos.set([]);
    }
}
