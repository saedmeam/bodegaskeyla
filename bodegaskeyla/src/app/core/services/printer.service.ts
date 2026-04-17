import { Injectable } from '@angular/core';

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
    async imprimirJasper(reportFileName: string, jsonData: any, printerName?: string, preview: boolean = true): Promise<boolean> {
        if ((window as any).electronAPI && (window as any).electronAPI.printJasper) {
            console.log(`📡 [PrinterService] Solicitando impresión Jasper: ${reportFileName} (Vista Previa: ${preview})`);
            const result = await (window as any).electronAPI.printJasper({ 
                printerName: printerName || '', 
                reportFileName, 
                jsonData,
                preview
            });
            return result.success;
        }
        console.error('❌ [PrinterService] Electron API for Jasper not available');
        return false;
    }

    /**
     * Prepara los datos JSON para el reporte de transferencia Jasper
     */
    async imprimirReporteTransferenciaJasper(orderFullId: string, products: any[], extra: any, printerName?: string) {
        // ... (data mapping remains same)
        const resumenBultos = extra.bultos 
            ? extra.bultos.map((b: any) => `${b.nombreTipoBulto || b.label}: ${b.cantidad || b.value}`).join(", ") 
            : "S/N";

        const data = products.map(p => ({
            sucursalRecibe: extra.sucursal || '---',
            numeroDoc: orderFullId,
            fechaEmision: extra.fecha || new Date().toLocaleString(),
            usuarioEmisor: extra.usuario || 'SISTEMA',
            bodegaOrigen: extra.bodegaOrigen || '---',
            bodegaDestino: extra.bodegaDestino || '---',
            digitador: extra.digitador || 'SISTEMA',
            resumenBultos: resumenBultos,
            codigo: p.item || p.codigoBarras || '',
            nombre: p.nombre || '',
            medida: p.unidad || '',
            cantidad: p.despachado?.toString() || '0'
        }));

        return this.imprimirJasper('transferencia.jrxml', data, printerName, true);
    }

    /**
     * Prepara los datos JSON para etiquetas térmicas Jasper (Soporta múltiples etiquetas)
     */
    async imprimirEtiquetaJasper(orderFullId: string, bulto: any, extra: any, printerName?: string) {
        const totalEtiquetas = 1; // v5.1: Forzado a 1 sola etiqueta para pruebas (evitar desperdicio)
        const data = [];

        // v3.8: Generamos un registro por cada etiqueta para que Jasper cree un reporte multi-página
        for (let i = 1; i <= totalEtiquetas; i++) {
            data.push({
                sucursal: extra.sucursal || '---',
                direccion: 'Provincia: GUAYAS Canton: GUAYAQUIL', // v5.2: Fijo por requerimiento
                fecha: extra.fecha || new Date().toLocaleDateString('es-EC'),
                pedido: orderFullId,
                bulto: i.toString(), // v5.2: Solo el número del bulto
                digitador: (extra.digitador || 'SISTEMA').toUpperCase(),
                nro: i,
                total: totalEtiquetas
            });
        }

        console.log(`[PrinterService] 🏷️ Generando lote de ${totalEtiquetas} etiquetas para: ${bulto.label}`);
        return this.imprimirJasper('etiqueta.jrxml', data, printerName, true);
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
   * v3.0: Inclusión de espacios para firmas y cuadre de bultos
   */
  generateTransferReportHtml(orderNumber: string, products: any[], extra: { sucursal: string, usuario: string, digitador: string, fecha?: string, bodegaOrigen?: string, bodegaDestino?: string, bultos?: any[] }): string {
    const now = new Date();
    const dateStr = extra.fecha || now.toLocaleDateString('es-EC');
    const fullDateStr = `${dateStr} ${now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    const [solicitud, orden] = orderNumber.split('-');

    let html = `
      <html>
        <head>
          <style>
            @page { 
              size: A4;
              margin: 10mm; 
            }
            body { 
              font-family: 'Arial Black', Gadget, sans-serif;
              font-size: 11pt; 
              margin: 0;
              padding: 0;
              color: black;
              line-height: 1.0;
              background: white;
              font-weight: 900 !important;
              text-transform: uppercase;
            }
            .page-container {
              width: 100%;
              position: relative;
              display: flex;
              flex-direction: column;
            }
            .header-main {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 5pt;
            }
            .brand-name { 
              font-size: 16pt; 
            }
            .report-type { 
              font-size: 11pt; 
              margin-top: 5pt; 
            }
            .doc-id-box {
              text-align: right;
              font-size: 10pt;
            }
            .info-label {
              font-size: 9pt;
              font-weight: bold !important;
              text-transform: uppercase;
            }
            .info-value {
              font-size: 10pt;
              font-weight: normal !important;
            }
            .report-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20pt;
            }
            .report-table th {
              font-weight: 900 !important;
              text-transform: uppercase;
              font-size: 10pt;
              padding: 4pt 5pt;
              border: none;
              text-align: left;
            }
            .report-table td {
              padding: 1pt 5pt;
              font-size: 9pt;
              font-weight: 900 !important;
              border: none;
            }
            .col-codigo { 
                width: 120px; 
                text-align: left;
            } 
            .col-desc { font-weight: 900 !important; }
            .col-cant { font-size: 10pt !important; text-align: right; }

            .section-bultos {
                margin-top: 15px;
                padding: 10px;
                position: relative;
            }
            .bultos-title {
                font-weight: 900 !important;
                font-size: 11pt;
                text-transform: uppercase;
                margin-bottom: 5px;
            }
            .signature-box-bultos {
                position: absolute;
                right: 20px;
                top: 30px;
                width: 200px;
                text-align: center;
            }
            .sig-line-compact {
                border-top: 1px solid black;
                padding-top: 5px;
                font-size: 8pt;
                font-weight: bold !important;
                text-transform: uppercase;
            }

            .report-footer {
              margin-top: 40pt;
            }
            .footer-signatures {
              width: 100%;
              margin-top: 30pt;
              border-collapse: collapse;
            }
            .footer-signatures td {
                width: 25%;
                padding: 0 5pt;
                vertical-align: top;
                text-align: center;
            }
            .sig-line {
              border-top: 1.5pt solid black;
              padding-top: 5pt;
              font-weight: 900 !important;
              text-transform: uppercase;
              font-size: 9pt;
              line-height: 1.1;
            }
          </style>
        </head>
        <body>
          <div class="page-container">
            <header class="header-main">
              <div class="branding">
                <h1 class="brand-name">FARMACIAS KEYLA S.A</h1>
                <span class="report-type">TRANSFERENCIA DE MERCADERIA</span>
              </div>
              <div class="doc-id-box">
                <b>NO. DOCUMENTO: ${solicitud}${orden}</b><br>
                <b>FECHA: ${dateStr}</b>
              </div>
            </header>

            <table style="width:100%; border-collapse:collapse;">
              <tr>
                <td style="width:33%; vertical-align:top;">
                  <span class="info-label">USUARIO EMISOR:</span><br>
                  <span class="info-value">${extra.usuario}</span><br>
                  <span class="info-label">FECHA/HORA PROCESO:</span><br>
                  <span class="info-value">${fullDateStr}</span>
                </td>
                <td style="width:34%; vertical-align:top;">
                   <span class="info-label">DESTINO / MOVIMIENTO:</span><br>
                   <span class="info-value" style="font-size: 10pt;">${solicitud}-${orden} | ${extra.sucursal}</span><br>
                   <span class="info-label">DIGITADOR:</span><br>
                   <span class="info-value">${extra.digitador}</span>
                </td>
                <td style="width:33%; vertical-align:top;">
                   <span class="info-label">BODEGA ORIGEN:</span><br>
                   <span class="info-value">${extra.bodegaOrigen || 'CENTRO DE DISTRIBUCCION'}</span><br>
                   <span class="info-label">BODEGA DESTINO:</span><br>
                   <span class="info-value">${extra.bodegaDestino || extra.sucursal}</span>
                </td>
              </tr>
            </table>

            <div class="table-container" style="flex-grow: 1;">
              <table class="report-table">
                <thead>
                  <tr>
                    <th class="col-codigo"><b>CODIGO</b></th>
                    <th class="col-desc"><b>DESCRIPCION PRODUCTO</b></th>
                    <th class="col-medida"><b>MEDIDA</b></th>
                    <th class="col-cant" style="width: 50px;"><b>CANT.</b></th>
                  </tr>
                </thead>
                <tbody>
                  ${products.map(p => `
                    <tr>
                      <td class="col-codigo">${p.item}</td>
                      <td class="col-desc">${p.nombre}</td>
                      <td class="col-medida">${p.unidad}</td>
                      <td class="col-cant">${p.despachado}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            ${extra.bultos && extra.bultos.length > 0 ? `
            <section class="section-bultos">
                <div class="bultos-title">RESUMEN DE DESPACHO (BULTOS)</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${extra.bultos.map(b => `
                        <div style="font-size: 12pt; font-weight: normal !important;">${b.nombreTipoBulto}: ${b.cantidad}</div>
                    `).join('')}
                </div>
            </section>
            ` : ''}

            <div class="report-footer">
              <table class="footer-signatures">
                <tr>
                  <td>
                    <div class="sig-line">ELABORADO POR ${extra.usuario}</div>
                  </td>
                  <td>
                    <div class="sig-line">REVISADO POR CONTROL DE BODEGA</div>
                  </td>
                  <td>
                    <div class="sig-line">RECIBIDO POR (CONTEO BULTOS)</div>
                  </td>
                  <td>
                    <div class="sig-line">RECIBIDO POR LOGISTICA SUCURSAL</div>
                  </td>
                </tr>
              </table>
            </div>
          </div>
        </body>
      </html>
    `;

    return html;
  }
}
