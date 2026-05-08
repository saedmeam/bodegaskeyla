import { Injectable, inject } from '@angular/core';
import { ConfigService } from './config.service';

@Injectable({
    providedIn: 'root'
})
export class PrinterService {

    constructor() { }

    async getPrinters(): Promise<any[]> {
        if ((window as any).electronAPI) {
            const result = await (window as any).electronAPI.getPrinters();
            if (result.success) {
                return result.data;
            }
        }
        return [];
    }

    async printLabels(html: string, printerName?: string, options?: any, preview: boolean = false): Promise<boolean> {
        // Legado: Sigue funcionando para HTML si es necesario
        if ((window as any).electronAPI) {
            let finalOptions = { ...options };
            if (html.includes('page-label')) {
                finalOptions.pageSize = 'A4';
                finalOptions.landscape = true;
                finalOptions.margins = { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 };
            }
            const result = await (window as any).electronAPI.printLabels({ html, printerName, options: finalOptions, preview });
            return result.success;
        }
        return false;
    }

    /**
     * v3.0: Impresión Profesional vía JasperReports
     */
    async imprimirJasper(reportFileName: string, jsonData: any, printerName?: string, preview: boolean = true): Promise<{ success: boolean; error?: string }> {
        if ((window as any).electronAPI && (window as any).electronAPI.printJasper) {
            console.log(`📡 [PrinterService] Solicitando impresión Jasper: ${reportFileName} (Vista Previa: ${preview})`);
            const result = await (window as any).electronAPI.printJasper({ 
                printerName: printerName || '', 
                reportFileName, 
                jsonData,
                preview
            });
            if (!result.success) {
                console.error('❌ [PrinterService] Error en impresión Jasper:', result.error);
            }
            return result;
        }
        const errorMsg = 'Electron API for Jasper not available';
        console.error(`❌ [PrinterService] ${errorMsg}`);
        return { success: false, error: errorMsg };
    }

    private configService = inject(ConfigService);

    /**
     * v0.3.0: Prepara los datos JSON para el reporte de transferencia Jasper
     */
    async imprimirReporteTransferenciaJasper(orderFullId: string, products: any[], extra: any, printerName?: string, preview?: boolean) {
        const config = this.configService.getConfig();
        
        if (printerName === undefined) printerName = config?.IMPRESORA_REPORTE || '';
        if (preview === undefined) {
            preview = (config && config.PREVIEW_REPORTE !== undefined) ? config.PREVIEW_REPORTE : true;
        }

        const resumenBultos = extra.bultos 
            ? extra.bultos.map((b: any) => `${b.nombreTipoBulto || b.label}: ${b.cantidad || b.value}`).join(", ") 
            : "S/N";

        const data = products.map(p => ({
            sucursalRecibe: extra.sucursal || '---',
            numeroDoc: orderFullId,
            fechaEmision: extra.fechaProcesamiento || extra.fecha || new Date().toLocaleString(),
            usuarioEmisor: extra.usuario || 'SISTEMA',
            bodegaOrigen: extra.bodegaOrigen || '---',
            bodegaDestino: extra.bodegaDestino || '---',
            digitador: extra.digitador || 'SISTEMA',
            resumenBultos: resumenBultos,
            codigo: p.codigoExistencia || '',
            nombre: p.nombre || '',
            medida: p.unidad || '',
            cantidad: p.despachado?.toString() || '0',
            laboratorio: p.laboratorio || ''
        }));
 
        return this.imprimirJasper('transferencia.jrxml', data, printerName, preview ?? true);
    }

    /**
     * v105.0: Prepara los datos para el reporte de despacho masivo (Picking List)
     */
    async imprimirDespachoMasivoJasper(cabecera: any, detalles: any[], printerName?: string, preview?: boolean) {
        const config = this.configService.getConfig();
        
        if (printerName === undefined) printerName = config?.IMPRESORA_REPORTE || '';
        if (preview === undefined) {
            preview = (config && config.PREVIEW_REPORTE !== undefined) ? config.PREVIEW_REPORTE : true;
        }

        // Aplanamos la cabecera en cada fila para que Jasper pueda acceder a los campos globales
        const data = detalles.map(d => ({
            ...d,
            // Datos de cabecera inyectados en cada registro
            pedidoId: cabecera.numeroSolicitud || '',
            ordenId: cabecera.ordenDespacho || '',
            fechaImpresion: cabecera.fechaImpresion || new Date().toLocaleString(),
            sucursalNombre: cabecera.nombreSucursal || '---',
            ubicacionHeader: cabecera.ubicacion || '---',
            grupoDespachoHeader: cabecera.nombreGrupoDespacho || '---',
            usuarioHeader: cabecera.usuario || 'SISTEMA'
        }));

        console.log(`[PrinterService] 📦 Generando Reporte Masivo con ${detalles.length} registros.`);
        return this.imprimirJasper('despacho_masivo.jrxml', data, printerName, preview ?? true);
    }

    /**
     * v0.3.0: Prepara los datos JSON para etiquetas térmicas Jasper
     */
    async imprimirEtiquetaJasper(orderFullId: string, bulto: any, extra: any, printerName?: string, preview?: boolean) {
        const config = this.configService.getConfig();

        if (printerName === undefined) printerName = config?.IMPRESORA_TICKET || '';
        if (preview === undefined) {
            preview = (config && config.PREVIEW_TICKET !== undefined) ? config.PREVIEW_TICKET : false;
        }

        const totalEtiquetas = Number(bulto.value) || 1; 
        const data = [];

        for (let i = 1; i <= totalEtiquetas; i++) {
            data.push({
                sucursal: extra.sucursal || '---',
                direccion: 'Provincia: GUAYAS Cantón: GUAYAQUIL', 
                fecha: extra.fecha || new Date().toLocaleDateString('es-EC'),
                pedido: orderFullId,
                bulto: i.toString(), 
                digitador: (extra.digitador || 'SISTEMA').toUpperCase(),
                nro: i,
                total: totalEtiquetas
            });
        }

        return this.imprimirJasper('etiqueta.jrxml', data, printerName, preview ?? false);
    }

    /**
     * v2.0: Imprime un bloque de texto plano (Tirilla) usando el puente Java (PrintVeris.jar)
     */
    async printTicket(text: string, printerName?: string): Promise<boolean> {
        if ((window as any).electronAPI) {
            console.log('📡 [PrinterService] Enviando Texto a Electron para impresión física...');
            const result = await (window as any).electronAPI.printText(text, printerName || '');
            if (result.success) {
                console.log('✅ [PrinterService] Impresión exitosa:', result.data);
                return true;
            } else {
                console.error('❌ [PrinterService] Error en impresión física:', result.error);
                throw new Error(result.error || 'Error desconocido en impresora');
            }
        }
        console.warn('⚠️ [PrinterService] Electron API no disponible. Simulación de impresión.');
        return false;
    }

    /**
     * v2.0: Imprime múltiples etiquetas en formato de texto una tras otra
     */
    async printLabelsText(labels: string[], printerName?: string): Promise<void> {
        for (const label of labels) {
            await this.printTicket(label, printerName);
        }
    }

    /**
     * Genera el HTML para las etiquetas basadas en los bultos seleccionados
     * v3.1: Ajuste de dimensiones y fuentes (COMPACTO) para evitar desbordamiento.
     */
    generateLabelsHtml(orderNumber: string, bultos: any[], extra: { sucursal: string, digitador: string, fecha?: string }): string {
        const dateStr = extra.fecha || new Date().toLocaleDateString('es-EC');
        const digitador = extra.digitador || 'SISTEMA';
        const sucursal = extra.sucursal || '---';

        let html = `
      <html>
        <head>
          <style>
            @page {
              size: 104mm 50.8mm landscape;
              margin: 0;
            }
            body { 
              margin: 0; 
              padding: 0; 
              width: 100%; 
              height: 100%;
              font-family: Arial, sans-serif;
            }
            .page-label {
              width: 100%;
              height: 50.8mm;
              page-break-after: always;
              display: flex;
              flex-direction: column;
              padding: 2mm 6mm;
              box-sizing: border-box;
              overflow: hidden;
              justify-content: space-around;
            }
            .header-info {
              text-align: center;
              border-bottom: 2pt solid black;
              padding-bottom: 1pt;
              margin-bottom: 2pt;
            }
            .title {
              font-size: 10pt;
              margin: 0;
              font-weight: 900 !important;
              text-transform: uppercase;
            }
            .sucursal-box {
              font-size: 34pt;
              margin: 0;
              font-weight: 900 !important;
              text-transform: uppercase;
              line-height: 1.0;
            }
            .info-line {
              font-size: 15pt;
              display: flex;
              flex-direction: row;
              gap: 8pt;
              margin-bottom: 0;
              font-weight: 900 !important;
              line-height: 1.0;
            }
            .info-label {
                font-size: 13pt;
                text-transform: uppercase;
                font-weight: 900 !important;
                min-width: 150pt;
            }
            .footer-msg {
              border-top: 1.5pt solid black;
              padding-top: 3pt;
              text-align: center;
              font-size: 11pt;
              font-weight: 900 !important;
              text-transform: uppercase;
            }
            .bold { font-weight: bold !important; }
          </style>
        </head>
        <body style="margin:0; padding:0; font-family: 'Arial Black', sans-serif;">
    `;

        bultos.forEach((b) => {
            const totalBultos = Number(b.value) || 0;
            if (totalBultos > 0) {
                for (let i = 1; i <= totalBultos; i++) {
                    html += `
            <div class="page-label">
                <div class="header-info">
                    <div class="title">CENTRO DE DISTRIBUCIÓN FARMAKEYLA</div>
                    <div class="sucursal-box">SUCURSAL : ${sucursal}</div>
                </div>

                <div class="info-line">
                    <span class="info-label">DIRECCION :</span>
                    <span>GUAYAQUIL</span>
                </div>

                <div class="info-line">
                    <span class="info-label">FECHA DE DESPACHO :</span>
                    <span>${dateStr}</span>
                </div>

                <div class="info-line">
                    <span class="info-label">BULTO # :</span>
                    <span>${b.label}: ${i} DE ${totalBultos}</span>
                </div>

                <div class="info-line">
                    <span class="info-label">PEDIDO # :</span>
                    <span>${orderNumber}</span>
                </div>

                <div class="info-line">
                    <span class="info-label">DIGITADOR :</span>
                    <span>${digitador}</span>
                </div>

                <div class="footer-msg">
                  SI ESTE SELLO VIOLADO NO ACEPTE LA CAJA
                </div>
            </div>
          `;
                }
            }
        });

        html += `
        </body>
      </html>
    `;

        return html;
    }

    /**
     * v2.0: Genera etiquetas en formato de TEXTO PLANO para la impresora térmica (Java Bridge)
     * Recrea el diseño de la imagen solicitada por el usuario (Bordes ASCII)
     */
    generateLabelsText(orderNumber: string, bultos: any[], extra: { sucursal: string, digitador: string, fecha?: string }): string[] {
        const dateStr = extra.fecha || new Date().toLocaleDateString('es-EC');
        const digitador = (extra.digitador || 'SISTEMA').substring(0, 30);
        const sucursal = (extra.sucursal || '---').substring(0, 30);
        const [solicitud, orden] = orderNumber.split('-');

        const labels: string[] = [];

        bultos.forEach((b) => {
            if (b.value > 0) {
                for (let i = 1; i <= b.value; i++) {
                    let text = "";
                    text += "+------------------------------------------+\n";
                    text += "|    CENTRO DE DISTRIBUCION FARMAKEYLA     |\n";
                    text += `| SUCURSAL : ${sucursal.padEnd(29, ' ')} |\n`;
                    text += "| Direccion: PROVINCIA GUAYAS CANTON       |\n";
                    text += "|            EL EMPALME                    |\n";
                    text += `| FECHA DE DESPACHO ${dateStr.padEnd(22, ' ')} |\n`;
                    text += `| Numero de Bulto #   ${i.toString().padEnd(4, ' ')} (de ${b.value.toString().padEnd(3, ' ')}) |\n`;
                    text += `| Numero de Pedido #  ${(solicitud + '-' + orden).padEnd(20, ' ')} |\n`;
                    text += `| Digitador: ${digitador.padEnd(29, ' ')} |\n`;
                    text += "+------------------------------------------+\n";
                    text += "|   SI ESTE SELLO VIOLADO NO ACEPTE CAJA   |\n";
                    text += "+------------------------------------------+\n";
                    text += "\n\n"; // Espacio para corte
                    labels.push(text);
                }
            }
        });

        return labels;
    }

  /**
   * Genera el HTML para el reporte de Transferencia de Mercadería
   * v3.0: Inclusión de espacios para firmas y cuadre de bultos (Ajustado para matriz)
   */
  generateTransferReportHtml(orderNumber: string, products: any[], extra: { sucursal: string, usuario: string, digitador: string, fecha?: string, fechaProcesamiento?: string, bodegaOrigen?: string, bodegaDestino?: string, bultos?: any[] }): string {
    const now = new Date();
    const dateStr = extra.fecha || now.toLocaleDateString('es-EC');
    const fullDateStr = `${dateStr} ${now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    
    // Formatear resumen de bultos en una sola línea
    const resumenBultosStr = extra.bultos && extra.bultos.length > 0
      ? extra.bultos.map(b => `${b.nombreTipoBulto || b.label}: ${b.cantidad || b.value}`).join(', ')
      : 'S/N';

    let html = `
      <html>
        <head>
          <style>
            @page { 
              size: Letter;
              margin: 10mm; 
            }
            html, body {
              height: 100%;
              margin: 0;
              padding: 0;
            }
            body { 
              font-family: 'Arial', sans-serif;
              font-size: 8pt; 
              color: black;
              background: white;
              text-transform: uppercase;
              line-height: 1.1;
            }
            .page-container {
              width: 100%;
              height: 100%;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              box-sizing: border-box;
            }
            .content-top {
                /* Este contenedor agrupa el header y la tabla */
            }
            .header-main {
              margin-bottom: 10pt;
            }
            .header-top-line {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 5pt;
            }
            .brand-name { 
              font-size: 16pt; 
              font-weight: bold;
              margin: 0;
            }
            .doc-number {
              font-size: 12pt;
              font-weight: bold;
            }
            .report-title {
              text-align: center;
              font-size: 11pt;
              font-weight: bold;
              text-decoration: underline;
              margin-bottom: 10pt;
            }
            .metadata-grid {
              display: flex;
              width: 100%;
              gap: 20pt;
              margin-bottom: 10pt;
            }
            .meta-column {
              flex: 1;
              display: grid;
              grid-template-columns: 120px 1fr;
              row-gap: 2pt;
              font-size: 8pt;
            }
            .meta-label {
              font-weight: bold;
            }
            .report-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 5pt;
            }
            .report-table th {
              border-bottom: 1pt solid black;
              border-top: 1pt solid black;
              padding: 3pt;
              text-align: left;
              font-size: 8pt;
              font-weight: bold;
            }
            .report-table td {
              padding: 2pt 3pt;
              font-size: 8pt;
            }
            .col-codigo { width: 15%; }
            .col-desc { width: 40%; }
            .col-lab { width: 20%; }
            .col-med { width: 10%; }
            .col-cant { width: 15%; text-align: right; }

            .footer-section {
              margin-top: 10pt;
              padding-bottom: 5mm;
            }
            .bultos-summary {
              margin-bottom: 10pt;
              font-size: 8pt;
            }
            .bultos-title {
              font-weight: bold;
              margin-bottom: 2pt;
            }
            .signatures-grid {
              display: flex;
              justify-content: space-between;
              width: 100%;
              margin-top: 20pt;
            }
            .signature-item {
              width: 22%;
              text-align: center;
            }
            .sig-line {
              border-top: 1pt solid black;
              padding-top: 3pt;
              font-size: 7pt;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="page-container">
            <div class="content-top">
                <header class="header-main">
                    <div class="header-top-line">
                        <h1 class="brand-name">FARMACIAS KEYLA S.A</h1>
                        <div class="doc-number">No: ${orderNumber}</div>
                    </div>
                    <div class="report-title">TRANSFERENCIA DE MERCADERIA</div>
                    
                    <div class="metadata-grid">
                        <div class="meta-column">
                            <span class="meta-label">EMISOR:</span> <span>${extra.usuario}</span>
                            <span class="meta-label">BODEGA ORIG:</span> <span>${extra.bodegaOrigen || 'CENTRO DE DISTRIBUCCION'}</span>
                            <span class="meta-label">FECHA PROCESO:</span> <span>${extra.fechaProcesamiento || fullDateStr}</span>
                        </div>
                        <div class="meta-column">
                            <span class="meta-label">DESTINO/MOV:</span> <span>${extra.sucursal}</span>
                            <span class="meta-label">BODEGA DEST:</span> <span>${extra.bodegaDestino || extra.sucursal}</span>
                            <span class="meta-label">DIGITADOR:</span> <span>${extra.digitador}</span>
                        </div>
                    </div>
                </header>

                <table class="report-table">
                    <thead>
                        <tr>
                            <th class="col-codigo">CODIGO</th>
                            <th class="col-desc">DESCRIPCION</th>
                            <th class="col-lab">LABORATORIO</th>
                            <th class="col-med">MED</th>
                            <th class="col-cant">CANT</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${products.map(p => `
                        <tr>
                            <td class="col-codigo">${p.codigoExistencia || ''}</td>
                            <td class="col-desc">${p.nombre}</td>
                            <td class="col-lab">${p.laboratorio || ''}</td>
                            <td class="col-med">${p.unidad}</td>
                            <td class="col-cant">${p.despachado}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <footer class="footer-section">
                <div class="bultos-summary">
                    <div class="bultos-title">RESUMEN DE BULTOS:</div>
                    <div class="bultos-content">${resumenBultosStr}</div>
                </div>

                <div class="signatures-grid">
                    <div class="signature-item">
                        <div class="sig-line">ELABORADO</div>
                    </div>
                    <div class="signature-item">
                        <div class="sig-line">BODEGA</div>
                    </div>
                    <div class="signature-item">
                        <div class="sig-line">REC. BULTOS</div>
                    </div>
                    <div class="signature-item">
                        <div class="sig-line">REC. SUCURSAL</div>
                    </div>
                </div>
            </footer>
          </div>
        </body>
      </html>
    `;

    return html;
  }
}
