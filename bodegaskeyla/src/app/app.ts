import { Component, signal, inject, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MenuPrincipalComponent } from './core/components/menu-principal/menu-principal.component';
import { HeaderComponent } from './core/components/header/header.component';
import { NavigationService } from './core/services/navigation.service';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [RouterOutlet, MenuPrincipalComponent, HeaderComponent],
    templateUrl: './app.html',
    styleUrl: './app.css'
})
export class App {
    protected readonly title = signal('bodegaskeyla');
    private navService = inject(NavigationService);

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        // Shift + TAB: Toggle Menu
        if (event.shiftKey && event.key === 'Tab') {
            event.preventDefault();
            this.navService.toggleMenu();
        }

        // Shift + Q: Salir (Cerrar App)
        if (event.shiftKey && event.key.toLowerCase() === 'q') {
            event.preventDefault();
            this.exitApp();
        }
    }

    private exitApp() {
        if (window && (window as any).process && (window as any).process.type === 'renderer') {
            // Intentar cerrar vía window.close() o enviar mensaje IPC si fuera necesario
            window.close();
        } else {
            console.log('Saliendo de la aplicación...');
        }
    }
}
