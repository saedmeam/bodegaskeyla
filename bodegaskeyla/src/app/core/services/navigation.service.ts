import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class NavigationService {
    public isMenuOpen = signal<boolean>(false);
    public showNav = signal<boolean>(true);

    toggleMenu() {
        this.isMenuOpen.update(v => !v);
    }

    closeMenu() {
        this.isMenuOpen.set(false);
    }

    setShowNav(show: boolean) {
        this.showNav.set(show);
    }
}
