import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class NavigationService {
    public isMenuOpen = signal<boolean>(false);

    toggleMenu() {
        this.isMenuOpen.update(v => !v);
    }

    closeMenu() {
        this.isMenuOpen.set(false);
    }
}
