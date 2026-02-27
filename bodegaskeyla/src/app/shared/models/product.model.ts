export interface Product {
    item: string;
    nombre: string;
    unidad: string;
    invBod: number;
    vtas: number;
    sLocal: number;
    suger: number;
    solicita: number;
    despachado: number;
    color: string; // 'negro', 'verde', 'azul', 'rojo', 'naranja', 'amarillo'
    lineaDetalle?: number;
    estado?: string;
    lote?: string;
    caducidad?: string;
    bulto?: number;
}
