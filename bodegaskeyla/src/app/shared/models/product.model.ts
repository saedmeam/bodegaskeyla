export interface Batch {
    lote: string;
    caducidad: string;
    stock: number;
    despachado: number;
}

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
    // v145.0: New technical fields for detailed view
    tipoMedida?: string;
    tipoPresentacion?: string;
    unidadesXCaja?: number;
    codigoExistencia?: string;
    codigoBarras?: string;
    // v146.0: Fields for actualizarDetallesOrdenDespacho
    cantidadCajas?: number;
    cantidadUnidades?: number;
    grupoUnidadMedidaStockBase?: number;
    unidadMedidaStockBase?: number;
    cantidadUnidadMedidaStockB?: number;
    cantidadBaseEquivalente?: number;
    observacion?: string;
    esActivo?: string;
    // v170.2: Sophisticated multi-batch support
    lotes?: Batch[];
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
    nombreSucursalOrigen?: string;
    nombreSucursalDestino?: string;
    descripcionUbicacion?: string;
    nombreUsuarioDespachador?: string;
    // v2.9: UI specific fields
    solicitudOrden?: string;
    grupoDespacho?: string;
    // v106.0: New technical fields for Keyla API
    codigoGrupoDespacho?: number;
    nombreGrupoDespacho?: string;
    usuarioIngreso?: string;
}

export interface BultoType {
    codigoTipoBulto: number;
    nombreTipoBulto: string;
    // UI field
    cantidad?: number;
}
