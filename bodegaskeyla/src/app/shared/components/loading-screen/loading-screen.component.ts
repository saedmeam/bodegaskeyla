import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoadingService } from '../../../core/services/loading.service';

@Component({
    selector: 'app-loading-screen',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './loading-screen.component.html',
    styleUrl: './loading-screen.component.css'
})
export class LoadingScreenComponent {
    private loadingService = inject(LoadingService);
    public isLoading = this.loadingService.isLoading;
}
