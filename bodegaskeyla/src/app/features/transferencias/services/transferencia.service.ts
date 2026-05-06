import { Injectable, signal, inject } from '@angular/core';
import { DataService } from '../../../core/services/data.service';

export interface TransferenciaProduct {
    item: string;
    nombre: string;
    lote: string;
    vencimiento: string;
    unidad: string;
    cantidad: number;
    costo: number;
    subtotal: number;
    laboratorio?: string;
}

@Injectable({
    providedIn: 'root'
})
export class TransferenciaService {
    private dataService = inject(DataService);

    public productos = signal<TransferenciaProduct[]>([]);
    public infoCabecera = signal<any>(null);

    /**
     * MÉTODO ORQUESTADOR
     * Centraliza la carga de la transferencia y su detalle.
     */
    public executeProcess(action: 'LOAD', payload: any) {
        switch (action) {
            case 'LOAD':
                this.loadTransferencia(payload.numero);
                break;
        }
    }

    private loadTransferencia(numero: string) {
        if (!numero) return;

        // Consultamos el detalle de productos
        this.dataService.executeAction<TransferenciaProduct[]>('GET_TRANSFERENCIA_PRODUCTS', { numero })
            .subscribe(products => {
                this.productos.set(products);

                // Simulamos la carga de cabecera asociada a ese número
                this.infoCabecera.set({
                    numero: numero,
                    fecha: new Date().toLocaleString(),
                    bodega: "001",
                    movimiento: "096",
                    movimientoNombre: "TRANSFERENCIA A SUCURSALES",
                    pedido: "915402",
                    concepto: "CARGA AUTOMÁTICA DE TRANSFERENCIA"
                });
            });
    }
}
