import { Injectable, signal, inject } from '@angular/core';
import { Product } from '../../../shared/models/product.model';
import { DataService } from '../../../core/services/data.service';
import { StorageService } from '../../../core/services/storage.service';

@Injectable({
    providedIn: 'root'
})
export class BodegaService {
    private dataService = inject(DataService);
    private storage = inject(StorageService);

    public ordenActual = signal<any[]>([]);
    public secuenciaActual = signal<number>(55359);

    // Lista de productos bloqueados (simulada)
    private productosBloqueados = ['0020-00090', '0023-00112'];

    public async conectarYObtenerPedido(sucursal: string): Promise<{ total: number; excluidos: number }> {
        // Simulación de conexión al servidor de la sucursal
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Obtenemos datos crudos (simulados)
        const rawData: any[] = [];

        const totalOriginal = rawData.length;

        // Filtramos bloqueados
        const filtrados = rawData.filter(p => !this.productosBloqueados.includes(p.item));
        const excluidosCount = totalOriginal - filtrados.length;

        this.ordenActual.set(filtrados);
        return { total: totalOriginal, excluidos: excluidosCount };
    }

    public generarNuevoPedido(): number {
        const nuevaSecuencia = this.secuenciaActual() + 1;
        this.secuenciaActual.set(nuevaSecuencia);
        return nuevaSecuencia;
    }

    public limpiarOrden() {
        this.ordenActual.set([]);
    }

    /**
     * V42.0: Ordena la carga de bodega por prioridad de discrepancia:
     * 1. Faltantes (Solicita > Cargado)
     * 2. Sobrantes (Solicita < Cargado)
     * 3. OK (Solicita == Cargado)
     */
    public ordenarPorEstado() {
        this.ordenActual.update(list => {
            return [...list].sort((a, b) => {
                const getWeight = (p: any) => {
                    const desp = p.solicita || 0;
                    const sol = p.sugerido || p.solicita; // En Bodega Central comparamos contra el sugerido o el original
                    if (desp < sol) return 1; // Faltante
                    if (desp > sol) return 2; // Sobrante
                    return 3; // OK
                };
                return getWeight(a) - getWeight(b);
            });
        });
    }
}
