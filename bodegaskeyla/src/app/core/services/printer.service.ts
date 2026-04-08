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
        if ((window as any).electronAPI) {
            const result = await (window as any).electronAPI.printLabels({ html, printerName, options, preview });
            return result.success;
        }
        return false;
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
              size: landscape;
              margin: 0;
            }
            body {
              margin: 0;
              padding: 0;
              background: white;
              font-family: Arial, sans-serif;
              color: black;
              font-weight: 900 !important;
            }
            .page-label {
              width: 95%;
              height: 88vh;
              page-break-after: always;
              position: relative;
              overflow: hidden;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              padding: 40px 20px 20px 20px;
              margin: 5vh auto 0 auto;
              box-sizing: border-box;
              border: 2px solid black;
            }
            .title {
              font-size: 20px;
              text-align: left;
              font-weight: 900;
              margin-bottom: 2px;
            }
            .sucursal-box {
              font-size: 38px;
              text-align: left;
              margin-bottom: 10px;
              padding-bottom: 5px;
              font-weight: 900;
              text-transform: uppercase;
              border-bottom: 2px solid black;
            }
            .label-text {
              font-size: 26px !important;
              font-weight: 900 !important;
              text-transform: uppercase;
            }
            .id-box {
              padding: 5px 30px;
              font-size: 90px !important;
              font-weight: 900 !important;
              text-align: center;
              display: inline-block;
              min-width: 120px;
              border: 2px solid black;
            }
            .pedido-box {
              font-size: 55px !important;
              font-weight: 900 !important;
              text-align: right;
              display: inline-block;
              min-width: 200px;
            }
            table { width: 100%; border-collapse: collapse; line-height: 1.1; }
            td { vertical-align: middle; padding: 5px 0; }
            .footer {
              font-size: 18px;
              padding-top: 5px;
              font-weight: 900;
              border-top: 2px solid black;
            }
            .seal-msg {
              width: 100%;
              text-align: center;
              font-size: 16px;
              text-transform: uppercase;
              margin-top: 5px;
              padding-top: 5px;
              font-weight: 900;
              border-top: 2px dashed black;
            }
          </style>
        </head>
        <body>
    `;

        bultos.forEach((b) => {
            const totalBultos = Number(b.value) || 0;
            if (totalBultos > 0) {
                for (let i = 1; i <= totalBultos; i++) {
                    html += `
            <div class="page-label">
                <div class="title">CENTRO DE DISTRIBUCIÓN FARMAKEYLA</div>
                <div class="sucursal-box">
                    SUCURSAL: ${sucursal}
                </div>

                <table style="margin-top: 10px;">
                  <tr>
                    <td class="label-text" style="width: 65%;">
                      DIR: GUAYAS - EL EMPALME<br>
                      FECHA DESPACHO: ${dateStr}
                    </td>
                    <td style="width: 35%; text-align: right;">
                        <span style="font-size: 28px;">BULTO #</span>
                        <div class="id-box">${i}</div>
                    </td>
                  </tr>
                  <tr>
                    <td class="label-text">
                      NÚMERO DE PEDIDO:
                    </td>
                    <td style="text-align: right;">
                        <div class="pedido-box">${orderNumber}</div>
                    </td>
                  </tr>
                </table>

                <div class="footer">
                  DIGITADOR: ${digitador}
                </div>

                <div class="seal-msg">
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
              margin: 0.5cm; 
            }
            body { 
              font-family: Arial, Helvetica, sans-serif;
              font-size: 10pt; 
              margin: 0;
              padding: 0;
              color: black;
              line-height: 1.1;
              background: white;
              font-weight: 900 !important;
            }
            .page-container {
              width: 100%;
              min-height: 25cm;
              position: relative;
              display: flex;
              flex-direction: column;
            }
            .header-main {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 10px;
              padding-bottom: 5px;
            }
            .brand-name {
              font-size: 18pt;
              font-weight: 900 !important;
              margin: 0;
            }
            .report-type {
              font-size: 14pt;
              font-weight: 900 !important;
              text-transform: uppercase;
            }
            .doc-id-box {
              text-align: right;
              padding: 5px;
            }
            .info-label {
              font-size: 9pt;
              font-weight: 700;
              text-transform: uppercase;
            }
            .info-value {
              font-size: 11pt;
              font-weight: 900 !important;
            }
            .report-table {
              width: 100%;
              border-collapse: collapse;
            }
            .report-table th {
              font-weight: 900 !important;
              text-transform: uppercase;
              font-size: 11pt;
              padding: 8px 5px;
              background: white;
            }
            .report-table td {
              padding: 6px 5px;
              font-size: 10pt;
              font-weight: 900 !important;
            }
            .col-codigo { 
                width: 150px; 
                text-align: center;
            } 
            .col-desc { font-weight: 900 !important; }
            .col-cant { font-size: 12pt !important; text-align: right; }

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
                margin-top: 30px;
                font-size: 9pt;
                font-weight: 900 !important;
                text-transform: uppercase;
            }

            .report-footer {
              margin-top: auto;
              padding-top: 30px;
            }
            .footer-signatures {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 15px;
              text-align: center;
            }
            .sig-line {
              padding-top: 5px;
              font-weight: 900 !important;
              text-transform: uppercase;
              font-size: 10pt;
            }
          </style>
        </head>
        <body>
          <div class="page-container">
            <header class="header-main">
              <div class="branding">
                <h1 class="brand-name">FARMACIAS KEYLA S.A</h1>
                <span class="report-type">TRANSFERENCIA DE MERCADERÍA</span>
              </div>
              <div class="doc-id-box">
                <b>No. Documento: ${solicitud}${orden}</b><br>
                <b>Fecha: ${dateStr}</b>
              </div>
            </header>

            <table style="width:100%; padding:8px; margin-bottom:15px; border-collapse:collapse;">
              <tr>
                <td style="width:33%; vertical-align:top;">
                  <span class="info-label">Usuario Emisor:</span><br>
                  <span class="info-value">${extra.usuario}</span><br>
                  <span class="info-label">Fecha/Hora Proceso:</span><br>
                  <span class="info-value">${fullDateStr}</span>
                </td>
                <td style="width:34%; vertical-align:top;">
                   <span class="info-label">Destino / Movimiento:</span><br>
                   <span class="info-value">${solicitud}-${orden} | ${extra.sucursal}</span><br>
                   <span class="info-label">Digitador:</span><br>
                   <span class="info-value">${extra.digitador}</span>
                </td>
                <td style="width:33%; vertical-align:top;">
                   <span class="info-label">Bodega Origen:</span><br>
                   <span class="info-value">${extra.bodegaOrigen || 'CENTRO DE DISTRIBUCCION'}</span><br>
                   <span class="info-label">Bodega Destino:</span><br>
                   <span class="info-value">${extra.bodegaDestino || extra.sucursal}</span>
                </td>
              </tr>
            </table>

            <div class="table-container" style="flex-grow: 1;">
              <table class="report-table">
                <thead>
                  <tr>
                    <th class="col-codigo">CÓDIGO</th>
                    <th class="col-desc">DESCRIPCIÓN PRODUCTO</th>
                    <th class="col-medida">MEDIDA</th>
                    <th class="col-cant">CANT.</th>
                  </tr>
                </thead>
                <tbody>
                  ${products.map(p => `
                    <tr>
                      <td class="col-codigo"><b>${p.item}</b></td>
                      <td class="col-desc"><b>${p.nombre}</b></td>
                      <td class="col-medida"><b>${p.unidad}</b></td>
                      <td class="col-cant"><b>${p.despachado}</b></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            ${extra.bultos && extra.bultos.length > 0 ? `
            <section class="section-bultos" style="min-height: 120px;">
                <div class="bultos-title">RESUMEN DE DESPACHO (BULTOS)</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${extra.bultos.map(b => `
                        <div style="font-size: 14pt; font-weight: 900 !important;"><b>${b.nombreTipoBulto}: ${b.cantidad}</b></div>
                    `).join('')}
                </div>
                <div class="signature-box-bultos">
                    <div class="sig-line-compact">RECIBIDO POR (CONTEO BULTOS)</div>
                </div>
            </section>
            ` : ''}

            <div class="report-footer">
              <footer class="footer-signatures">
                <div class="info-group">
                  <div class="sig-line">ELABORADO POR ${extra.usuario}</div>
                </div>
                <div class="info-group">
                  <div class="sig-line">REVISADO POR CONTROL DE BODEGA</div>
                </div>
                <div class="info-group">
                  <div class="sig-line">RECIBIDO POR LOGÍSTICA / SUCURSAL</div>
                </div>
              </footer>
            </div>
          </div>
        </body>
      </html>
    `;

    return html;
  }
}
