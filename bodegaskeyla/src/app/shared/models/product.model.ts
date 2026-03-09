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

export interface DispatchOrder {
    codigoEmpresa: number;
    numeroSolicitud: number;
    numeroOrdenDespacho: number;
    codigoSucursal: number;
    codigoBodega: number;
    codigoUbicacion?: number;
    fechaEmision: string;
    codigoEstado: string;
    // UI Extended fields
    nombreSucursal?: string;
    nombreBodega?: string;
    ubicacion?: string;
    despachador?: string;
    // v100.0: New technical fields from API
    nombreSucursalSolicita?: string;
    descripcionUbicacion?: string;
    nombreUsuarioDespachador?: string;
}
