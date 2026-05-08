import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class LoadingService {
    private loadingCount = 0;
    public isLoading = signal<boolean>(false);

    show() {
        this.loadingCount++;
        this.isLoading.set(true);
    }

    hide() {
        this.loadingCount--;
        if (this.loadingCount <= 0) {
            this.loadingCount = 0;
            this.isLoading.set(false);
        }
    }

    forceHide() {
        this.loadingCount = 0;
        this.isLoading.set(false);
    }
}
