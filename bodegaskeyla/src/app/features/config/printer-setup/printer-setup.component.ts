import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfigService } from '../../../core/services/config.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
    selector: 'app-printer-setup',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './printer-setup.component.html',
    styleUrl: './printer-setup.component.css'
})
export class PrinterSetupComponent implements OnInit {
    private configService = inject(ConfigService);
    private notificationService = inject(NotificationService);
    private router = inject(Router);

    // v0.2.8: Configuración separada por tipo de documento
    printerTicketsSelected = signal('');
    previewTickets = signal(false);

    printerReportSelected = signal('');
    previewReport = signal(true);

    availablePrinters = signal<any[]>([]);

    async ngOnInit() {
        const config = this.configService.getConfig();
        if (config) {
            this.printerTicketsSelected.set(config.IMPRESORA_TICKET || '');
            this.previewTickets.set(config.PREVIEW_TICKET ?? false);
            
            this.printerReportSelected.set(config.IMPRESORA_REPORTE || '');
            this.previewReport.set(config.PREVIEW_REPORTE ?? true);
        }

        if (window.electronAPI) {
            const result = await window.electronAPI.getPrinters();
            if (result.success) {
                this.availablePrinters.set(result.data || []);
            }
        }
    }

    async save() {
        const fullConfig = this.configService.getConfig();
        if (!fullConfig) {
            this.notificationService.show('Error: No se pudo cargar la configuración', true);
            return;
        }

        const newConfig = { 
            ...fullConfig, 
            IMPRESORA_TICKET: this.printerTicketsSelected(),
            PREVIEW_TICKET: this.previewTickets(),
            IMPRESORA_REPORTE: this.printerReportSelected(),
            PREVIEW_REPORTE: this.previewReport()
        };

        try {
            const success = await this.configService.saveConfig(newConfig);
            if (success) {
                this.notificationService.show('CONFIGURACIÓN GUARDADA: Se han actualizado ambas impresoras.', false, 'ÉXITO');
                setTimeout(() => this.router.navigate(['/despacho-lista']), 1000);
            } else {
                this.notificationService.show('Error al guardar configuración.', true);
            }
        } catch (e) {
            this.notificationService.show('Fallo crítico al guardar configuración', true);
        }
    }

    cancel() {
        this.router.navigate(['/despacho-lista']);
    }

    selectPrinterTickets(name: string) {
        this.printerTicketsSelected.set(name);
    }

    selectPrinterReport(name: string) {
        this.printerReportSelected.set(name);
    }
}
