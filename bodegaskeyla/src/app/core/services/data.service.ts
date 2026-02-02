import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, catchError, delay } from 'rxjs/operators';
import { StorageService } from './storage.service';

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private storage = inject(StorageService);

    constructor() { }

    /**
     * MÉTODO PARAMETRIZABLE (GET)
     * Consulta la data para el comparativo de orden.
     * Implementa lógica Offline-First: Guarda en LocalStorage/Archivo tras consultar.
     */
    getOrdenComparativo(numeroOrden: string): Observable<any[]> {
        console.log(`[DataService] Consultando Comparativo para Orden: ${numeroOrden}`);

        // Mientras no hay servicio REST GET, usamos la data mock por defecto.
        return this.getMockOrderProducts(numeroOrden).pipe(
            delay(800), // Simulamos una pequeña latencia de red para realismo
            tap(data => {
                // Insertar en ambiente local para seguridad
                this.storage.saveLocal(`ORDER_CACHE_${numeroOrden}`, data);
                this.storage.saveLocal('LAST_ORDER_NUMBER', numeroOrden);
            }),
            catchError(err => {
                console.warn('[DataService] Error de red. Intentando recuperar de ambiente local...');
                const cached = this.storage.loadLocal<any[]>(`ORDER_CACHE_${numeroOrden}`);
                return of(cached || []);
            })
        );
    }

    /**
     * Punto de entrada único para ejecutar acciones de datos.
     */
    executeAction<T>(action: string, params: any = {}): Observable<T> {
        switch (action) {
            case 'GET_ORDER_PRODUCTS':
                return this.getOrdenComparativo(params.orderNumber) as Observable<T>;
            default:
                return of(null as any);
        }
    }

    /**
     * CATÁLOGO DE PRUEBA (MOCK)
     * Esta información se cargará por default mientras se integra el servicio REST.
     */
    private getMockOrderProducts(orderNumber: string): Observable<any[]> {
        const products = [
            { item: '0018-00027', nombre: 'MUSIC TAB 1.5MG X 10 *1', unidad: 'C', invBod: 517, vtas: 2, sLocal: 0, suger: 0, solicita: 2, despachado: 0, color: 'naranja' },
            { item: '0011-00115', nombre: 'ADVANZ 500MG X 10 *1', unidad: 'C', invBod: 120, vtas: 10, sLocal: 0, suger: 0, solicita: 5, despachado: 0, color: 'naranja' },
            { item: '0005-00010', nombre: 'ASPIRINA 100MG TAB X 100', unidad: 'C', invBod: 1200, vtas: 50, sLocal: 0, suger: 0, solicita: 10, despachado: 0, color: 'amarillo' },
            { item: '0025-00441', nombre: 'IBUPROFENO 600MG CAP *20', unidad: 'C', invBod: 45, vtas: 5, sLocal: 2, suger: 0, solicita: 8, despachado: 0, color: 'naranja' },
            { item: '0032-00892', nombre: 'PARACETAMOL 500MG TB*100', unidad: 'C', invBod: 890, vtas: 100, sLocal: 10, suger: 0, solicita: 15, despachado: 0, color: 'naranja' },
            { item: '0099-00122', nombre: 'VITAMINA C 1GR NARANJA *10', unidad: 'P', invBod: 300, vtas: 20, sLocal: 5, suger: 0, solicita: 20, despachado: 0, color: 'amarillo' },
            { item: '0014-00673', nombre: 'ALCOHOL ANTISÉPTICO 500ML', unidad: 'F', invBod: 80, vtas: 15, sLocal: 0, suger: 0, solicita: 12, despachado: 0, color: 'naranja' }
        ];
        return of(products);
    }
}
