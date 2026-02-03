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
            case 'GET_TRANSFERENCIA_PRODUCTS':
                return this.getTransferenciaProducts(params.numero) as Observable<T>;
            case 'GET_LABORATORIO':
                return this.getMockLaboratorio(params.codigo) as Observable<T>;
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
            { item: '0018-00027', nombre: 'MUSIC TAB 1.5MG X 10 *1', unidad: 'C', invBod: 517, vtas: 2, sLocal: 0, suger: 0, solicita: 2, despachado: 0, color: 'naranja', lote: 'LT-9152' },
            { item: '0011-00115', nombre: 'ADVANZ 500MG X 10 *1', unidad: 'C', invBod: 120, vtas: 10, sLocal: 0, suger: 0, solicita: 5, despachado: 0, color: 'naranja', lote: 'ADZ-44' },
            { item: '0005-00010', nombre: 'ASPIRINA 100MG TAB X 100', unidad: 'C', invBod: 1200, vtas: 50, sLocal: 0, suger: 0, solicita: 10, despachado: 0, color: 'amarillo', lote: 'ASP-100' },
            { item: '0025-00441', nombre: 'IBUPROFENO 600MG CAP *20', unidad: 'C', invBod: 45, vtas: 5, sLocal: 2, suger: 0, solicita: 8, despachado: 0, color: 'naranja', lote: 'IBU-600' },
            { item: '0032-00892', nombre: 'PARACETAMOL 500MG TB*100', unidad: 'C', invBod: 890, vtas: 100, sLocal: 10, suger: 0, solicita: 15, despachado: 0, color: 'naranja', lote: 'PAR-500' },
            { item: '0099-00122', nombre: 'VITAMINA C 1GR NARANJA *10', unidad: 'P', invBod: 300, vtas: 20, sLocal: 5, suger: 0, solicita: 20, despachado: 0, color: 'amarillo', lote: 'VIT-C1' },
            { item: '0014-00673', nombre: 'ALCOHOL ANTISÉPTICO 500ML', unidad: 'F', invBod: 80, vtas: 15, sLocal: 0, suger: 0, solicita: 12, despachado: 0, color: 'naranja', lote: 'ALC-80' },
            { item: '0044-00212', nombre: 'DICLOFENACO 50MG TAB X 20', unidad: 'C', invBod: 150, vtas: 30, sLocal: 0, suger: 0, solicita: 5, despachado: 0, color: 'naranja', lote: 'DIC-050' },
            { item: '0055-00333', nombre: 'AMOXICILINA 500MG CAP X 50', unidad: 'C', invBod: 400, vtas: 80, sLocal: 5, suger: 0, solicita: 25, despachado: 0, color: 'azul', lote: 'AMX-500' },
            { item: '0066-00444', nombre: 'OMEPRAZOL 20MG CAP X 30', unidad: 'C', invBod: 250, vtas: 60, sLocal: 0, suger: 0, solicita: 30, despachado: 0, color: 'naranja', lote: 'OME-020' },
            { item: '0077-00555', nombre: 'LORATADINA 10MG TAB X 10', unidad: 'C', invBod: 500, vtas: 100, sLocal: 20, suger: 0, solicita: 50, despachado: 0, color: 'azul', lote: 'LOR-010' },
            { item: '0088-00666', nombre: 'ENALAPRIL 10MG TAB X 20', unidad: 'C', invBod: 300, vtas: 40, sLocal: 0, suger: 0, solicita: 10, despachado: 0, color: 'naranja', lote: 'ENA-010' },
            { item: '0091-00777', nombre: 'METFORMINA 850MG TAB X 30', unidad: 'C', invBod: 600, vtas: 120, sLocal: 15, suger: 0, solicita: 40, despachado: 0, color: 'azul', lote: 'MET-850' },
            { item: '0012-00888', nombre: 'LOSARTAN 50MG TAB X 30', unidad: 'C', invBod: 450, vtas: 90, sLocal: 10, suger: 0, solicita: 30, despachado: 0, color: 'naranja', lote: 'LOS-050' },
            { item: '0023-00999', nombre: 'SIMVASTATINA 20MG TAB X 20', unidad: 'C', invBod: 200, vtas: 35, sLocal: 0, suger: 0, solicita: 12, despachado: 0, color: 'naranja', lote: 'SIM-020' },
            { item: '0034-00123', nombre: 'AZITROMICINA 500MG TAB X 3', unidad: 'C', invBod: 150, vtas: 45, sLocal: 2, suger: 0, solicita: 15, despachado: 0, color: 'azul', lote: 'AZI-500' },
            { item: '0045-00456', nombre: 'CETIRIZINA 10MG TAB X 10', unidad: 'C', invBod: 350, vtas: 75, sLocal: 8, suger: 0, solicita: 20, despachado: 0, color: 'naranja', lote: 'CET-010' }
        ];
        return of(products);
    }

    private getTransferenciaProducts(numero: string): Observable<any[]> {
        const products = [
            { item: '0018-00027', nombre: 'MUSIC TAB 1.5MG X 10 *1', lote: '231555A', vencimiento: '03/2026', unidad: 'C', cantidad: 1, costo: 4.20, subtotal: 4.20 },
            { item: '0011-00115', nombre: 'ADVANZ 500MG X 10 *1', lote: 'ADZ-44', vencimiento: '12/2025', unidad: 'C', cantidad: 5, costo: 8.50, subtotal: 42.50 },
            { item: '0022-00331', nombre: 'VITAMINA D3 2000UI CAP', lote: 'VIT-D', vencimiento: '10/2027', unidad: 'C', cantidad: 10, costo: 12.00, subtotal: 120.00 }
        ];
        return of(products);
    }

    private getMockLaboratorio(codigo: string): Observable<any> {
        const laboratorios: any = {
            "001": { codigo: "001", nombre: "ABBOTT", vendedor: "00449", porcentaje: 5.50, ingreso: "E", despacho: "D" },
            "0001": { codigo: "0001", nombre: "ABBOTT", vendedor: "00449", porcentaje: 5.50, ingreso: "E", despacho: "D" },
            "002": { codigo: "002", nombre: "ABBOTT", vendedor: "00449", porcentaje: 5.50, ingreso: "E", despacho: "D" },
            "0002": { codigo: "0002", nombre: "ABBOTT", vendedor: "00449", porcentaje: 5.50, ingreso: "E", despacho: "D" },
            "0005": { codigo: "0005", nombre: "BAYER", vendedor: "00720", porcentaje: 10.00, ingreso: "E", despacho: "D" },
            "0010": { codigo: "0010", nombre: "PFIZER", vendedor: "00112", porcentaje: 2.25, ingreso: "I", despacho: "P" }
        };

        // Si no existe, devolvemos un genérico para que el usuario vea que funciona con cualquier código
        const result = laboratorios[codigo] || {
            codigo: codigo,
            nombre: "LABORATORIO " + codigo,
            vendedor: "09999",
            porcentaje: 0.00,
            ingreso: "E",
            despacho: "D"
        };

        return of(result).pipe(delay(300)); // Latencia mínima para feedback visual
    }
}
