import { Injectable, signal, inject } from '@angular/core';
import { DataService } from '../../../core/services/data.service';
import { StorageService } from '../../../core/services/storage.service';

export interface Laboratorio {
    codigo: string;
    nombre: string;
    vendedor: string;
    porcentaje: number;
    ingreso: string;
    despacho: string;
}

@Injectable({
    providedIn: 'root'
})
export class TablasService {
    private dataService = inject(DataService);
    private storage = inject(StorageService);

    public laboratorioActual = signal<Laboratorio | null>(null);
    public isLocked = signal<boolean>(true);

    /**
     * MÉTODO ORQUESTADOR
     * Busca los datos del laboratorio y gestiona el bloqueo.
     */
    public executeProcess(action: 'LOAD' | 'CLEAN', payload: any) {
        switch (action) {
            case 'LOAD':
                this.loadLaboratorio(payload.codigo);
                break;
            case 'CLEAN':
                this.laboratorioActual.set(null);
                this.isLocked.set(true);
                break;
        }
    }

    private loadLaboratorio(codigo: string) {
        if (!codigo) return;

        // 1. Intentamos buscar en persistencia local por seguridad (a prueba de fallos)
        const cached = this.storage.loadLocal<Laboratorio>(`LAB_DATA_${codigo}`);

        if (cached) {
            console.log('[TablasService] Recuperando laboratorio desde ambiente local.');
            this.laboratorioActual.set(cached);
            this.isLocked.set(false);
            return;
        }

        // 2. Si no hay local, consultamos al "REST" GET
        this.dataService.executeAction<Laboratorio>('GET_LABORATORIO', { codigo })
            .subscribe(lab => {
                if (lab) {
                    this.laboratorioActual.set(lab);
                    this.isLocked.set(false);
                    // 3. Persistimos localmente tras la consulta exitosa
                    this.storage.saveLocal(`LAB_DATA_${codigo}`, lab);
                } else {
                    this.laboratorioActual.set(null);
                    this.isLocked.set(true);
                }
            });
    }
}
