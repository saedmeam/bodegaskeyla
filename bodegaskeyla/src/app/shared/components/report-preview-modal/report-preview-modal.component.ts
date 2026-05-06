import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-report-preview-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal-container" (click)="$event.stopPropagation()">
        <header class="modal-header">
          <div class="header-left">
            <span class="icon">📄</span>
            <h3>{{ title }}</h3>
          </div>
          <button class="close-btn" (click)="close.emit()">&times;</button>
        </header>
        
        <div class="modal-body">
          <div class="report-frame">
            <div class="report-preview" [innerHTML]="safeHtml()"></div>
          </div>
        </div>
        
        <footer class="modal-footer">
          <div class="footer-info">
            <span class="badge">VISTA PREVIA INTERNA</span>
          </div>
          <div class="footer-actions">
            <button class="btn-modal btn-cancel" (click)="close.emit()">Cerrar</button>
            <button class="btn-modal btn-print" (click)="print.emit()">
                <span class="icon">🖨️</span> Imprimir
            </button>
          </div>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      animation: fadeIn 0.3s ease-out;
    }

    .modal-container {
      width: 90%;
      height: 90%;
      max-width: 1000px;
      background: #f8f9fa;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .modal-header {
      padding: 16px 24px;
      background: #1e293b;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-left .icon {
      font-size: 1.5rem;
    }

    .header-left h3 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .close-btn {
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.6);
      font-size: 2rem;
      cursor: pointer;
      transition: color 0.2s;
      line-height: 1;
    }

    .close-btn:hover {
      color: white;
    }

    .modal-body {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
      background: #e2e8f0;
      display: flex;
      justify-content: center;
    }

    .report-frame {
      background: white;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      width: 100%;
      max-width: 800px;
      min-height: 100%;
      padding: 20px;
      border-radius: 4px;
    }

    .report-preview {
      width: 100%;
      height: 100%;
      transform-origin: top center;
    }

    .modal-footer {
      padding: 16px 24px;
      background: white;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .badge {
      background: #f1f5f9;
      color: #64748b;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid #e2e8f0;
    }

    .footer-actions {
      display: flex;
      gap: 12px;
    }

    .btn-modal {
      padding: 10px 24px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
    }

    .btn-cancel {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #475569;
    }

    .btn-cancel:hover {
      background: #e2e8f0;
    }

    .btn-print {
      background: #2563eb;
      border: none;
      color: white;
      box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
    }

    .btn-print:hover {
      background: #1d4ed8;
      transform: translateY(-1px);
      box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.3);
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `]
})
export class ReportPreviewModalComponent {
  @Input() title: string = 'Vista Previa de Reporte';
  @Input() set htmlContent(value: string) {
    this.safeHtml.set(this.sanitizer.bypassSecurityTrustHtml(value));
  }
  
  @Output() print = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  safeHtml = signal<SafeHtml>('');

  constructor(private sanitizer: DomSanitizer) {}
}
