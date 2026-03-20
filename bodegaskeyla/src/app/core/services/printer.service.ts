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
   * v2.6: Formato específico 10.5cm x 5.1cm según solicitud usuario
   */
  generateLabelsHtml(orderNumber: string, bultos: any[], extra: { sucursal: string, digitador: string, fecha?: string }): string {
    const dateStr = extra.fecha || new Date().toLocaleDateString('es-EC');
    const digitador = extra.digitador || 'SISTEMA';
    const sucursal = extra.sucursal || '---';
    const [solicitud, orden] = orderNumber.split('-');

    let html = `
      <html>
        <head>
          <style>
            @page { 
              size: 10.5cm 5.1cm;
              margin: 0; 
            }
            body { 
              margin: 0; 
              padding: 0;
              width: 10.5cm;
              height: 5.1cm;
              background: white;
              overflow: hidden;
            }
            .label-page {
              width: 10.5cm;
              height: 5.1cm;
              page-break-after: always;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .inner-border {
              width: 10.2cm;
              height: 4.8cm;
              border: 3px solid black;
              padding: 8px 15px;
              box-sizing: border-box;
              font-family: 'Arial Narrow', Arial, sans-serif;
              display: flex;
              flex-direction: column;
              text-align: left;
            }
            .header-corp {
              font-weight: bold;
              font-size: 13pt;
              margin-bottom: 0px;
              color: #444;
            }
            .sucursal-title {
              font-weight: 800;
              font-size: 17pt;
              margin-bottom: 4px;
              text-transform: uppercase;
            }
            .direccion-line {
              font-size: 9pt;
              margin-bottom: 5px;
              color: #666;
            }
            .info-row {
              display: flex;
              margin-bottom: 4px;
              align-items: center;
            }
            .info-label {
              font-weight: bold;
              font-size: 10pt;
              width: 155px;
              text-transform: uppercase;
            }
            .info-value {
              font-size: 11pt;
              font-weight: normal;
            }
            .box-outline {
              border: 2px solid black;
              padding: 1px 12px;
              font-weight: 900;
              font-size: 15pt;
              display: inline-block;
              min-width: 80px;
              text-align: center;
            }
            .footer-warning {
              margin-top: auto;
              text-align: center;
              font-weight: bold;
              font-size: 9pt;
              text-transform: uppercase;
              border-top: 1px solid #ccc;
              padding-top: 4px;
            }
          </style>
        </head>
        <body>
    `;

    bultos.forEach((b) => {
      if (b.value > 0) {
        for (let i = 1; i <= b.value; i++) {
          html += `
            <div class="label-page">
              <div class="inner-border">
                <div class="header-corp">CENTRO DE DISTRIBUCIÓN FARMAKEYLA</div>
                <div class="sucursal-title">SUCURSAL : ${sucursal}</div>
                
                <div class="direccion-line">Dirección : </div>
                
                <div class="info-row">
                  <span class="info-label">FECHA DE DESPACHO</span>
                  <span class="info-value">${dateStr}</span>
                </div>
                
                <div class="info-row">
                  <span class="info-label">Número de Bulto #</span>
                  <span class="box-outline">${i}</span>
                  <span style="font-size: 8pt; margin-left: 5px;">(de ${b.value} ${b.label})</span>
                </div>
                
                <div class="info-row">
                  <span class="info-label">Número de Pedido #</span>
                  <span class="box-outline">${solicitud}-${orden}</span>
                </div>
                
                <div class="info-row" style="margin-top: 2px;">
                  <span class="info-label" style="font-size: 9pt;">Digitador :</span>
                  <span class="info-value" style="font-size: 10pt;">${digitador}</span>
                </div>
                
                <div class="footer-warning">SI ESTE SELLO VIOLADO NO ACEPTE LA CAJA</div>
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
   * v2.7: Formato A4 profesional según fotografía del cliente
   */
  generateTransferReportHtml(orderNumber: string, products: any[], extra: { sucursal: string, usuario: string, digitador: string, fecha?: string }): string {
    const now = new Date();
    const dateStr = extra.fecha || now.toLocaleDateString('es-EC');
    const fullDateStr = `${dateStr} ${now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    const [solicitud, orden] = orderNumber.split('-');

    let html = `
      <html>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
          <style>
            @page { 
              size: A4;
              margin: 1.2cm; 
            }
            body { 
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 9pt;
              margin: 0;
              padding: 0;
              color: #1a202c;
              line-height: 1.5;
            }
            .page-container {
              width: 100%;
            }
            .header-main {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 25px;
            }
            .branding {
              display: flex;
              flex-direction: column;
            }
            .brand-name {
              font-size: 18pt;
              font-weight: 800;
              color: #004a99;
              letter-spacing: -0.5px;
              margin: 0;
            }
            .report-type {
              font-size: 11pt;
              font-weight: 700;
              color: #4a5568;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .doc-id-box {
              text-align: right;
              background: #f8fafc;
              padding: 10px 15px;
              border-radius: 8px;
              border: 1px solid #e2e8f0;
            }
            .doc-number {
              font-size: 13pt;
              font-weight: 800;
              color: #2d3748;
              display: block;
            }
            .doc-date {
              font-size: 8.5pt;
              color: #718096;
              font-weight: 500;
            }
            .info-section {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px;
              margin-bottom: 25px;
              background: #fff;
              padding: 15px;
              border: 1px solid #edf2f7;
              border-radius: 8px;
            }
            .info-group {
              display: flex;
              flex-direction: column;
              gap: 4px;
            }
            .info-label {
              font-size: 7.5pt;
              font-weight: 700;
              color: #a0aec0;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .info-value {
              font-size: 9.5pt;
              font-weight: 600;
              color: #2d3748;
            }
            .table-container {
              margin-top: 20px;
              min-height: 400px;
            }
            .report-table {
              width: 100%;
              border-collapse: separate;
              border-spacing: 0;
            }
            .report-table th {
              background: #f1f5f9;
              color: #475569;
              font-weight: 700;
              text-transform: uppercase;
              font-size: 8pt;
              padding: 12px 10px;
              text-align: left;
              border-bottom: 2px solid #cbd5e1;
            }
            .report-table td {
              padding: 10px;
              border-bottom: 1px solid #f1f5f9;
              font-size: 8.5pt;
              vertical-align: middle;
            }
            .report-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .col-codigo { width: 15%; font-family: monospace; font-size: 9pt; color: #1e293b; }
            .col-desc { width: 45%; font-weight: 500; }
            .col-medida { width: 15%; color: #64748b; }
            .col-cant { width: 10%; text-align: right; font-weight: 800; font-size: 10pt; color: #004a99; }
            
            .footer-signatures {
              margin-top: 60px;
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 40px;
              text-align: center;
            }
            .sig-line {
              border-top: 1.5px solid #1a202c;
              padding-top: 10px;
              font-size: 8pt;
              font-weight: 700;
              color: #4a5568;
              text-transform: uppercase;
            }
            .sig-subtext {
              font-size: 7pt;
              font-weight: 400;
              color: #718096;
              margin-top: 4px;
            }
            .watermark {
              position: absolute;
              bottom: 20px;
              left: 0;
              right: 0;
              text-align: center;
              font-size: 7.5pt;
              color: #cbd5e1;
              font-weight: 500;
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
                <span class="doc-date">No. Documento</span>
                <span class="doc-number">${solicitud}${orden}</span>
                <span class="doc-date">Fecha: ${dateStr}</span>
              </div>
            </header>

            <section class="info-section">
              <div class="info-group">
                <span class="info-label">Usuario Emisor</span>
                <span class="info-value">${extra.usuario}</span>
                <span class="info-label" style="margin-top:5px">Fecha/Hora Proceso</span>
                <span class="info-value" style="font-size:8pt">${fullDateStr}</span>
              </div>
              <div class="info-group">
                <span class="info-label">Destino / Movimiento</span>
                <span class="info-value">${solicitud}-${orden} | ${extra.sucursal}</span>
                <span class="info-label" style="margin-top:5px">Digitador</span>
                <span class="info-value">${extra.digitador}</span>
              </div>
            </section>

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

            <footer class="footer-signatures">
              <div class="info-group">
                <div class="sig-line">Elaborado por</div>
                <div class="sig-subtext">${extra.usuario}</div>
              </div>
              <div class="info-group">
                <div class="sig-line">Revisado por</div>
                <div class="sig-subtext">Control de Bodega</div>
              </div>
              <div class="info-group">
                <div class="sig-line">Despachado por</div>
                <div class="sig-subtext">Logística / Despacho</div>
              </div>
            </footer>

            <div class="watermark">
              Documento Interno - Farmacias Keyla S.A - Generado por Sistema Revisor Bodega
            </div>
          </div>
        </body>
      </html>
    `;

    return html;
  }
}
