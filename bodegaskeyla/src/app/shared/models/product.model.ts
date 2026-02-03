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
    estado?: string;
    lote?: string;
    bulto?: number;
}
