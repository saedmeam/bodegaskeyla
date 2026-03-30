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

    printerNameSelected = signal('');
    availablePrinters = signal<any[]>([]);

    async ngOnInit() {
        // v160.18: Cargar configuración actual al iniciar
        const currentPrinter = this.configService.getPrinterName();
        this.printerNameSelected.set(currentPrinter);

        // v160.18: Solicitar lista de impresoras reales al S.O vía Electron
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
            this.notificationService.show('Error: No se pudo cargar la configuración base', true);
            return;
        }

        // v160.18: Clonamos y modificamos solo la clave de la impresora
        const newConfig = { ...fullConfig, IMPRESORA_TICKET: this.printerNameSelected() };

        try {
            const success = await this.configService.saveConfig(newConfig);
            if (success) {
                this.notificationService.show('IMPRESORA CONFIGURADA: El cambio se ha guardado permanentemente.', false, 'ÉXITO');
                // Navegar de regreso al mantenimiento de órdenes solicitado
                setTimeout(() => {
                    this.router.navigate(['/despacho-lista']);
                }, 1000);
            } else {
                this.notificationService.show('Error al intentar guardar la configuración en el disco.', true);
            }
        } catch (e) {
            this.notificationService.show('Fallo crítico al guardar configuración', true);
        }
    }

    cancel() {
        this.router.navigate(['/despacho-lista']);
    }

    selectPrinter(name: string) {
        this.printerNameSelected.set(name);
    }
}
