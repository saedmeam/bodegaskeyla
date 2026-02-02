import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationService } from '../../services/navigation.service';

@Component({
    selector: 'app-header',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './header.component.html',
    styleUrl: './header.component.css'
})
export class HeaderComponent implements OnInit, OnDestroy {
    public navService = inject(NavigationService);
    public currentTime = signal<string>('');
    private intervalId: any;

    ngOnInit() {
        this.updateTime();
        this.intervalId = setInterval(() => this.updateTime(), 1000);
    }

    ngOnDestroy() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }

    private updateTime() {
        const now = new Date();
        const options: Intl.DateTimeFormatOptions = {
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        this.currentTime.set(now.toLocaleString('es-EC', options).replace(',', ''));
    }

    // Mock data para simular la captura
    public cajero = "DFAJARDO";
    public empresa = "FARMACIAS NEU360";
    public sucursal = "NEU360 GARZOTA";
    public caja = "1";
}
