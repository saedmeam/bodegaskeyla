import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransferenciaService } from '../services/transferencia.service';
import { PrinterService } from '../../../core/services/printer.service';
import { ConfigService } from '../../../core/services/config.service';
import { ReportPreviewModalComponent } from '../../../shared/components/report-preview-modal/report-preview-modal.component';

@Component({
    selector: 'app-transferencias',
    standalone: true,
    imports: [CommonModule, FormsModule, ReportPreviewModalComponent],
    templateUrl: './transferencias.component.html',
    styleUrl: './transferencias.component.css'
})
export class TransferenciasComponent implements OnInit {
    private transferenciaService = inject(TransferenciaService);
    private printerService = inject(PrinterService);
    private configService = inject(ConfigService);

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
    showPreview = signal(false);
    previewHtml = signal("");

    ngOnInit() {
        // Inicia en blanco. El usuario debe consultar una transferencia.
    }

    imprimir() {
        if (this.productos().length === 0) return;

        const config = this.configService.getConfig();
        const showPreview = config?.PREVIEW_REPORTE !== false; // Default true

        if (showPreview) {
            const info = this.infoCabecera();
            const html = this.printerService.generateTransferReportHtml(this.numero, this.productos(), {
                sucursal: info.sucursal || '---',
                usuario: 'ADMINISTRA',
                digitador: 'ADMINISTRA',
                bodegaOrigen: this.bodega,
                bodegaDestino: this.movimientoNombre,
                fecha: this.fecha
            });

            this.previewHtml.set(html);
            this.showPreview.set(true);
        } else {
            // Impresión automática
            this.ejecutarImpresion();
        }
    }

    async ejecutarImpresion() {
        // Ejecuta la impresión física sin abrir el visor nativo (Jasper) ya que se vio la previa interna
        const info = this.infoCabecera();
        await this.printerService.imprimirReporteTransferenciaJasper(this.numero, this.productos(), {
            sucursal: info.sucursal || '---',
            usuario: 'ADMINISTRA',
            digitador: 'ADMINISTRA',
            bodegaOrigen: this.bodega,
            bodegaDestino: this.movimientoNombre,
            fecha: this.fecha
        }, undefined, false); // printerName: undefined, preview: false
        this.showPreview.set(false);
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
