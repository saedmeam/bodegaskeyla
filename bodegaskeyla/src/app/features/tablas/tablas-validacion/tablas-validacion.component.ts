import { Component, signal, effect, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TablasService, Laboratorio } from '../services/tablas.service';

@Component({
    selector: 'app-tablas-validacion',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './tablas-validacion.component.html',
    styleUrl: './tablas-validacion.component.css'
})
export class TablasValidacionComponent implements OnInit {
    private tablasService = inject(TablasService);

    // Estados de UI sincronizados
    codigo = "";
    nombre = "";
    vendedor = "";
    porcentaje = 0;
    ingreso = "";
    despacho = "";

    notificationMessage = signal("");

    // Proyecciones del servicio
    isLocked = this.tablasService.isLocked;
    laboratorioActual = this.tablasService.laboratorioActual;

    constructor() {
        // Efecto para reaccionar a cambios en el laboratorio consultado
        effect(() => {
            const lab = this.laboratorioActual();
            if (lab) {
                this.nombre = lab.nombre;
                this.vendedor = lab.vendedor;
                this.porcentaje = lab.porcentaje;
                this.ingreso = lab.ingreso;
                this.despacho = lab.despacho;
            } else {
                this.limpiarFormulario(false);
            }
        });
    }

    ngOnInit() {
        // Inicia bloqueado por defecto (v9.5 Standard)
    }

    buscarLaboratorio() {
        if (!this.codigo || this.codigo.trim() === "") {
            this.tablasService.executeProcess('CLEAN', null);
            this.notificationMessage.set("");
            return;
        }

        this.notificationMessage.set(`Buscando Laboratorio [${this.codigo}]...`);
        this.tablasService.executeProcess('LOAD', { codigo: this.codigo });

        // Limpiamos la notificación tras un breve tiempo una vez que se carguen los datos
        setTimeout(() => {
            this.notificationMessage.set("");
        }, 1200);
    }

    private limpiarFormulario(incluirCodigo: boolean) {
        if (incluirCodigo) this.codigo = "";
        this.nombre = "";
        this.vendedor = "";
        this.porcentaje = 0;
        this.ingreso = "";
        this.despacho = "";
    }
}
