import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    // Premium Notification Signals
    message = signal("");
    title = signal("");
    isError = signal(false);

    /**
     * Shows a premium pill-style notification.
     * @param message The primary message text.
     * @param isError Whether it's an error (red) or success (green).
     * @param title Optional header title.
     * @param duration Milliseconds before auto-hiding (default 4000).
     */
    show(message: string, isError: boolean = false, title?: string, duration: number = 4000) {
        this.isError.set(isError);
        this.message.set(message);

        const defaultTitle = isError ? 'ERROR' : 'ÉXITO';
        this.title.set(title || defaultTitle);

        // Auto-hide logic
        setTimeout(() => {
            if (this.message() === message) {
                this.clear();
            }
        }, duration);
    }

    clear() {
        this.message.set("");
        this.title.set("");
        this.isError.set(false);
    }
}
