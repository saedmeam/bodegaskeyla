import { Component, OnInit, OnDestroy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationService } from '../../services/navigation.service';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-header',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './header.component.html',
    styleUrl: './header.component.css'
})
export class HeaderComponent implements OnInit, OnDestroy {
    public navService = inject(NavigationService);
    public authService = inject(AuthService);
    public currentTime = signal<string>('');
    private intervalId: any;

    // v103.0: Dynamic session data instead of mock
    public userData = computed(() => this.authService.getStoredUser());

    public get cajero() {
        return this.userData()?.username || 'ANÓNIMO';
    }

    public get empresa() {
        return this.userData()?.empresa?.nombreComercial || this.userData()?.empresa?.nombreEmpresa || 'SIN EMPRESA';
    }

    public get sucursal() {
        return this.userData()?.sucursal?.nombreSucursal || 'SIN SUCURSAL';
    }

    public get caja() {
        return this.userData()?.caja?.nombreCaja || this.userData()?.caja?.codigoCaja || 'N/A';
    }

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
}
