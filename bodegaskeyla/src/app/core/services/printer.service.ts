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
   * v2.7: Formato robusto con estilos en línea para evitar PDF en Blanco
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
              size: A4; 
              margin: 0; 
            }
            body { 
              margin: 0; 
              padding: 0; 
              background: white; 
              font-family: Arial, sans-serif;
              color: black;
            }
            .page-label {
              width: 10.5cm;
              height: 5.1cm;
              page-break-after: always;
              position: relative;
              overflow: hidden;
              /* v160.40: Borde de guía opcional */
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
            <div class="page-label" style="padding: 0; font-weight: 900;">
              <div style="width: 9.8cm; height: 4.5cm; border: 2.5px solid black; margin: 0.1cm auto; padding: 3px; box-sizing: border-box; line-height: 1.1; font-weight: 900;">
                <div style="font-weight: 900; font-size: 13px; text-align: left;">CENTRO DE DISTRIBUCIÓN FARMAKEYLA</div>
                <div style="font-weight: 900; font-size: 16px; text-align: left; margin-top: 1px;">SUCURSAL :${sucursal}</div>
                
                <div style="font-size: 10px; margin-top: 2px; font-weight: 900;">Dirección :</div>
                
                <div style="font-weight: 900; font-size: 12px; margin-top: 3px;">
                  FECHA DE DESPACHO <span style="margin-left: 10px; font-weight: 900;">${dateStr}</span>
                </div>
                
                <div style="margin-top: 5px; font-size: 13px; display: flex; align-items: center; font-weight: 900;">
                  <b style="width: 140px; display: inline-block; font-weight: 900;">Número de Bulto # :</b>
                  <span style="font-size: 22px; border: 2px solid black; padding: 0 8px; font-weight: 900;">${i}</span>
                  <span style="font-size: 10px; margin-left: 5px; font-weight: 900;">(de ${totalBultos} ${b.label})</span>
                </div>
                
                <div style="margin-top: 5px; font-size: 13px; font-weight: 900;">
                  <b style="width: 140px; display: inline-block; font-weight: 900;">Número de Pedido # :</b>
                  <span style="font-size: 17px; border: 2px solid black; padding: 1px 6px; font-weight: 900;">${orderNumber}</span>
                </div>
                
                <div style="margin-top: 5px; font-size: 11px; font-weight: 900;">
                  <b style="width: 70px; display: inline-block; font-weight: 900;">Digitador :</b>
                  <span style="font-weight: 900;">${digitador}</span>
                </div>
                
                <div style="width: 100%; text-align: center; font-weight: 900; font-size: 10px; text-transform: uppercase; margin-top: 6px; border-top: 1px dashed black; padding-top: 2px;">
                  SI ESTE SELLO VIOLADO NO ACEPTE LA CAJA
                </div>
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
   * v2.8: Optimizado para IMPRESORA MATRICIAL (Alto contraste, sin fondos grises)
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
              margin: 1cm 1.2cm; 
            }
            body { 
              font-family: Arial, Helvetica, sans-serif;
              font-size: 11pt; 
              margin: 0;
              padding: 0;
              color: black;
              line-height: 1.1;
              background: white;
              font-weight: 900 !important; /* v160.41: TODO EN NEGRITA MÁXIMA */
            }
            .page-container {
              width: 100%;
              min-height: 27cm;
              position: relative;
              display: flex;
              flex-direction: column;
              font-weight: 900 !important;
            }
            .header-main {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 20px;
              border-bottom: 4px solid black; 
              padding-bottom: 10px;
            }
            .branding {
              display: flex;
              flex-direction: column;
            }
            .brand-name {
              font-size: 18pt;
              font-weight: 900;
              margin: 0;
            }
            .report-type {
              font-size: 14pt;
              font-weight: 900;
              text-transform: uppercase;
              text-decoration: underline;
            }
            .doc-id-box {
              text-align: right;
              padding: 8px;
              border: 3px solid black;
            }
            .doc-number {
              font-size: 14pt;
              font-weight: 900;
              display: block;
            }
            .doc-date {
              font-size: 11pt;
              font-weight: 900;
            }
            .info-section {
              display: grid;
              grid-template-columns: 1fr 1.2fr 1fr;
              gap: 15px;
              margin-bottom: 20px;
              border: 3px solid black;
              padding: 12px;
            }
            .info-group {
              display: flex;
              flex-direction: column;
            }
            .info-label {
              font-size: 10pt;
              font-weight: 900;
              text-transform: uppercase;
            }
            .info-value {
              font-size: 11pt;
              margin-bottom: 6px;
              font-weight: 900;
            }
            .table-container {
              flex-grow: 1;
            }
            .report-table {
              width: 100%;
              border-collapse: collapse;
              border: 2px solid black; 
            }
            .report-table th {
              border-top: 4px solid black;
              border-bottom: 4px solid black;
              border-left: 1px solid black;
              border-right: 1px solid black;
              font-weight: 900;
              text-transform: uppercase;
              font-size: 11pt;
              padding: 10px 6px;
              text-align: left;
              background: white;
            }
            .report-table td {
              padding: 8px 6px;
              border-bottom: 2px solid black; 
              border-left: 1px solid black;
              border-right: 1px solid black;
              font-size: 11pt;
              font-weight: 900 !important;
            }
            .col-codigo { width: 140px; font-family: 'Courier New', Courier, monospace; font-size: 13pt !important; font-weight: 900; } 
            .col-desc { width: auto; font-size: 11pt; font-weight: 900; }
            .col-medida { width: 80px; text-align: center; font-weight: 900; }
            .col-cant { width: 80px; text-align: right; font-weight: 900; font-size: 14pt; }
            
            .section-bultos {
                margin-top: 20px;
                border: 3px solid black;
                padding: 15px;
            }
            .bultos-title {
                font-weight: 900;
                font-size: 12pt;
                text-transform: uppercase;
                margin-bottom: 10px;
                border-bottom: 2px solid black;
                display: inline-block;
            }
            .bultos-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 20px;
            }
            .bulto-item {
                font-size: 13pt;
                font-weight: 900;
            }
            .report-footer {
              margin-top: auto; 
              padding-top: 80px; 
              page-break-inside: avoid;
            }
            .footer-signatures {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 20px;
              text-align: center;
              margin-bottom: 25px;
            }
            .sig-line {
              border-top: 2px solid black;
              padding-top: 5px;
              font-size: 10pt;
              font-weight: 900;
              text-transform: uppercase;
            }
            .sig-name {
                font-size: 9pt;
                margin-top: 2px;
                font-weight: 900;
            }
            .watermark {
              text-align: center;
              font-size: 9pt;
              color: black;
              border-top: 1px dashed black;
              padding-top: 8px;
              font-weight: 900;
            }
          </style>
        </head>
        <body>
          <div class="page-container">
            <header class="header-main">
              <div class="branding">
                <h1 class="brand-name">FARMACIAS KEYLA S.A</h1>
                <span class="report-type">Transferencia de Mercadería</span>
              </div>
              <div class="doc-id-box">
                No. Documento: <b>${solicitud}${orden}</b><br>
                Fecha: ${dateStr}
              </div>
            </header>

            <table style="width:100%; border:2px solid black; padding:10px; margin-bottom:20px; border-collapse:collapse;">
              <tr>
                <td style="width:33%; vertical-align:top;">
                  <span class="info-label">Usuario Emisor</span><br>
                  <span class="info-value">${extra.usuario}</span><br>
                  <span class="info-label">Fecha/Hora Proceso</span><br>
                  <span class="info-value">${fullDateStr}</span>
                </td>
                <td style="width:33%; vertical-align:top;">
                   <span class="info-label">Destino / Movimiento</span><br>
                   <span class="info-value">${solicitud}-${orden} | ${extra.sucursal}</span><br>
                   <span class="info-label">Digitador</span><br>
                   <span class="info-value">${extra.digitador}</span>
                </td>
                <td style="width:33%; vertical-align:top;">
                   <span class="info-label">Bodega Origen</span><br>
                   <span class="info-value">${extra.bodegaOrigen || 'Origen N/A'}</span><br>
                   <span class="info-label">Bodega Destino</span><br>
                   <span class="info-value">${extra.bodegaDestino || extra.sucursal}</span>
                </td>
              </tr>
            </table>

            <div class="table-container">
              <table class="report-table">
                <thead>
                  <tr>
                    <th class="col-codigo">Código</th>
                    <th class="col-desc">Descripción Producto</th>
                    <th class="col-medida">Medida</th>
                    <th class="col-cant">Cant.</th>
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
                <div class="bultos-title">Resumen de Despacho (Bultos)</div>
                <div class="bultos-grid">
                    ${extra.bultos.map(b => `
                        <div class="bulto-item">${b.nombreTipoBulto}: ${b.cantidad}</div>
                    `).join('')}
                </div>
            </section>
            ` : ''}

            <div class="report-footer">
              <footer class="footer-signatures">
                <div class="info-group">
                  <div class="sig-line">Elaborado por</div>
                  <div class="sig-name">${extra.usuario}</div>
                </div>
                <div class="info-group">
                  <div class="sig-line">Revisado por</div>
                  <div class="sig-name">Control de Bodega</div>
                </div>
                <div class="info-group">
                  <div class="sig-line">Despachado por</div>
                  <div class="sig-name">Logística / Despacho</div>
                </div>
              </footer>

              <div class="watermark">
                Documento Interno - Farmacias Keyla S.A - Generado por Sistema Revisor Bodega
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    return html;
  }
}
