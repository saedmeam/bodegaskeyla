import { Component, OnInit, inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { EncryptionService } from '../../../core/services/encryption.service';
import { CajaService } from '../../../core/services/caja.service';
import { Empresa, Sucursal, Caja, FinalUserData } from '../../../shared/models/auth.model';
import { firstValueFrom } from 'rxjs';
import { LoadingService } from '../../../core/services/loading.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './login.component.html',
    styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
    private authService = inject(AuthService);
    private encryptionService = inject(EncryptionService);
    private cajaService = inject(CajaService);
    private router = inject(Router);
    private loadingService = inject(LoadingService);
    private ngZone = inject(NgZone);
    private cdr = inject(ChangeDetectorRef);

    // Flow State
    step: number = 1;
    loading: boolean = false;
    error: string = '';

    // Form Data
    username: string = '';
    password: string = '';

    onUsernameChange() {
        this.username = this.username.toUpperCase();
    }

    // Selection Lists
    empresas: Empresa[] = [];
    sucursales: Sucursal[] = [];
    cajas: Caja[] = [];

    // Selections
    selectedEmpresa: Empresa | null = null;
    selectedSucursal: Sucursal | null = null;
    selectedCaja: Caja | null = null;

    showEmpresaDropdown: boolean = false;
    showSucursalDropdown: boolean = false;

    // Search & Filter
    searchTermEmpresa: string = '';
    searchTermSucursal: string = '';
    empresasFiltradas: Empresa[] = [];
    sucursalesFiltradas: Sucursal[] = [];

    // Technical Context
    xposToken: string = '';
    secuenciaPersonal: number | null = null;
    codigoCentroCosto: number | null = null;

    async ngOnInit() {
        // We always show the login screen upon app start as per user request
        this.authService.logout(); // Clear any previous session to ensure a fresh start
    }

    /**
     * STEP 1: Process Login
     */
    async handleStep1() {
        if (!this.username || !this.password) {
            this.error = 'Por favor complete todos los campos';
            return;
        }

        this.loadingService.show();
        this.loading = true;
        this.error = '';

        try {
            // Parallelize token generation and password encryption
            const [token, encrypted] = await Promise.all([
                firstValueFrom(this.authService.getXPosToken()),
                this.encryptionService.encrypt(this.password)
            ]);

            this.xposToken = token;
            const loginRes = await firstValueFrom(this.authService.login(this.username, encrypted, this.xposToken));

            if (loginRes.mensaje === 'OK' || loginRes.codigo === '000') {
                const rawEmpresas = await firstValueFrom(this.cajaService.getEmpresas(this.xposToken));
                this.ngZone.run(() => {
                    this.empresas = rawEmpresas.map((e: any) => ({
                        codigoEmpresa: e.codigoEmpresa,
                        nombreEmpresa: e.nombreEmpresa,
                        ruc: e.ruc,
                        esActivo: e.esActivo
                    }));
                    this.empresasFiltradas = [...this.empresas];
                    this.step = 2;
                    this.error = '';
                    this.cdr.detectChanges();
                });
            } else {
                this.ngZone.run(() => {
                    this.error = loginRes.mensaje || 'Credenciales inválidas';
                    this.cdr.detectChanges();
                });
            }
        } catch (e: any) {
            this.ngZone.run(() => {
                this.error = e.message || 'Error en el inicio de sesión';
                this.cdr.detectChanges();
            });
        } finally {
            this.ngZone.run(() => {
                this.loadingService.hide();
                this.loading = false;
                this.cdr.detectChanges();
            });
        }
    }

    filterEmpresas() {
        const term = this.searchTermEmpresa.toLowerCase().trim();
        if (!term) {
            this.empresasFiltradas = [...this.empresas];
        } else {
            this.empresasFiltradas = this.empresas.filter(e =>
                e.nombreEmpresa.toLowerCase().includes(term) ||
                e.codigoEmpresa.toString().includes(term)
            );
        }
    }

    async goToStep3() {
        if (!this.selectedEmpresa) return;

        this.loadingService.show();
        this.error = '';

        try {
            // Get user basic data and branches in parallel
            const [userData, authorizedRaw] = await Promise.all([
                firstValueFrom(this.cajaService.getUsuarioSistema(this.xposToken)),
                firstValueFrom(this.cajaService.getSucursalesAutorizadas(this.selectedEmpresa.codigoEmpresa, this.xposToken))
            ]);

            this.secuenciaPersonal = userData?.secuenciaPersonal;

            if (this.secuenciaPersonal) {
                const personal = await firstValueFrom(this.cajaService.getPersonalXEmpresa(this.selectedEmpresa.codigoEmpresa, this.xposToken));
                const entry = personal.find((p: any) => p.secuenciaPersonal === this.secuenciaPersonal && p.esActivo === 'S');
                this.codigoCentroCosto = entry?.codigoCentroCosto;
            }

            const myBranches = authorizedRaw.filter((a: any) => a.codigoUsuario.toUpperCase() === this.username.toUpperCase() && a.esActivo === 'S');

            this.ngZone.run(() => {
                this.sucursales = myBranches.map((b: any) => ({
                    codigoSucursal: b.codigoSucursal,
                    nombreSucursal: b.identificacionSucursal || `Sucursal ${b.codigoSucursal}`,
                    codigoEmpresa: b.codigoEmpresa,
                    esActivo: 'S'
                }));
                this.sucursalesFiltradas = [...this.sucursales];
                this.step = 3;
                this.selectedSucursal = null;
                this.searchTermSucursal = '';
                this.cdr.detectChanges();
            });
        } catch (e: any) {
            this.ngZone.run(() => {
                this.error = 'Error al cargar datos de la empresa';
                this.cdr.detectChanges();
            });
        } finally {
            this.ngZone.run(() => {
                this.loadingService.hide();
            });
        }
    }

    filterSucursales() {
        const term = this.searchTermSucursal.toLowerCase().trim();
        if (!term) {
            this.sucursalesFiltradas = [...this.sucursales];
        } else {
            this.sucursalesFiltradas = this.sucursales.filter(s =>
                s.nombreSucursal.toLowerCase().includes(term) ||
                s.codigoSucursal.toString().includes(term)
            );
        }
    }

    async finishLoginWithoutCaja() {
        if (!this.selectedSucursal) return;

        this.loadingService.show();
        this.error = '';

        try {
            const finalData: FinalUserData = {
                username: this.username.toUpperCase(),
                token: this.xposToken,
                secuenciaPersonal: this.secuenciaPersonal || undefined,
                codigoCentroCosto: this.codigoCentroCosto || undefined,
                empresa: this.selectedEmpresa!,
                sucursal: this.selectedSucursal!
            };

            this.ngZone.run(() => {
                this.authService.saveSession(finalData);
                this.router.navigate(['/despacho-lista']);
                this.cdr.detectChanges();
            });
        } catch (e: any) {
            this.ngZone.run(() => {
                this.error = 'Error al finalizar el inicio de sesión';
                this.cdr.detectChanges();
            });
        } finally {
            this.ngZone.run(() => {
                this.loadingService.hide();
            });
        }
    }

    selectEmpresa(empresa: Empresa) {
        this.selectedEmpresa = empresa;
        this.searchTermEmpresa = empresa.nombreEmpresa;
        this.showEmpresaDropdown = false;
    }

    selectSucursal(sucursal: Sucursal) {
        this.selectedSucursal = sucursal;
        this.searchTermSucursal = sucursal.nombreSucursal;
        this.showSucursalDropdown = false;
    }

    toggleEmpresaDropdown() {
        this.showEmpresaDropdown = !this.showEmpresaDropdown;
        if (this.showEmpresaDropdown) {
            this.showSucursalDropdown = false;
            // Focus search input after some delay
            setTimeout(() => {
                const input = document.querySelector('.search-box input') as HTMLInputElement;
                input?.focus();
            }, 100);
        }
    }

    toggleSucursalDropdown() {
        this.showSucursalDropdown = !this.showSucursalDropdown;
        if (this.showSucursalDropdown) {
            this.showEmpresaDropdown = false;
            setTimeout(() => {
                const input = document.querySelector('.search-box input') as HTMLInputElement;
                input?.focus();
            }, 100);
        }
    }

    /**
     * STEP 4: Process Box Selection & Finish
     */
    async finishLogin(caja: Caja) {
        this.selectedCaja = caja;

        const finalData: FinalUserData = {
            username: this.username.toUpperCase(),
            token: this.xposToken,
            secuenciaPersonal: this.secuenciaPersonal || undefined,
            codigoCentroCosto: this.codigoCentroCosto || undefined,
            empresa: this.selectedEmpresa!,
            sucursal: this.selectedSucursal!,
            caja: caja
        };

        this.ngZone.run(() => {
            this.authService.saveSession(finalData);
            this.router.navigate(['/revisor']);
        });
    }

    goBack() {
        if (this.step > 1) {
            this.step--;
            this.error = '';
        }
    }
}
