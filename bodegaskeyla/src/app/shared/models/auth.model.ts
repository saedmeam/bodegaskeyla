export interface Empresa {
    codigoEmpresa: number;
    nombreEmpresa: string;
    nombreComercial?: string;
    ruc?: string;
    esActivo?: string;
}

export interface Sucursal {
    codigoSucursal: number;
    nombreSucursal: string;
    codigoEmpresa: number;
    esActivo?: string;
}

export interface Caja {
    codigoCaja: number;
    nombreCaja: string;
    numeroPuntoEmision: number;
    numeroPuntoEmisionSri: number;
    codigoSucursal: number;
    codigoEmpresa: number;
    estado: 'ABIERTO' | 'CERRADO';
    codigoUsuario?: string;
    fechaApertura?: string;
    fechaCierre?: string;
}

export interface FinalUserData {
    username: string;
    token?: string;
    secuenciaPersonal?: number;
    codigoCentroCosto?: number;
    empresa?: Empresa;
    sucursal?: Sucursal;
    caja?: Caja;
}
