import { Component, signal, inject, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MenuPrincipalComponent } from './core/components/menu-principal/menu-principal.component';
import { HeaderComponent } from './core/components/header/header.component';
import { NavigationService } from './core/services/navigation.service';
import { LoadingScreenComponent } from './shared/components/loading-screen/loading-screen.component';
import { LoadingService } from './core/services/loading.service';
import { NotificationService } from './core/services/notification.service';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { filter, take } from 'rxjs';
import { NavigationEnd } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { ConfigService } from './core/services/config.service';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [RouterOutlet, MenuPrincipalComponent, HeaderComponent, LoadingScreenComponent, CommonModule],
    templateUrl: './app.html',
    styleUrl: './app.css'
})
export class App {
    protected readonly title = signal('bodegaskeyla');
    public navService = inject(NavigationService);
    public loadingService = inject(LoadingService);
    public notificationService = inject(NotificationService);
    private authService = inject(AuthService);
    private configService = inject(ConfigService);
    private router = inject(Router);

    constructor() {
        // Monitorear ruta para ocultar/mostrar elementos de navegación
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event: any) => {
            const isLogin = event.urlAfterRedirects.includes('/login');
            this.navService.setShowNav(!isLogin);
        });

        this.checkInitialSession();
    }

    private checkInitialSession() {
        console.log('[App] 🚀 Verificando sesión inicial...');
        const user = this.authService.getStoredUser();
        const currentUrl = window.location.hash || window.location.pathname;

        if (user && user.token) {
            console.log('[App] ✅ Sesión válida detectada. Redirigiendo a despacho-lista...');
            // Solo redirigimos si estamos en la raíz o login
            if (currentUrl.includes('/login') || currentUrl === '/' || currentUrl === '') {
                this.router.navigate(['/despacho-lista']);
            }
        } else {
            console.log('[App] ℹ️ No hay sesión activa. Iniciando en Login.');
        }
    }

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
