---
description: Alternar entre configuración de Pruebas (DEV) y Pase a Preprod/Prod
---

Este flujo de trabajo define los cambios necesarios para alternar entre una versión de desarrollo/pruebas y una versión limpia para producción/preproducción.

### Escenario A: Configuración de "Pruebas" (DEV)
- **main.js**: Habilitar `devTools: true` y ejecutar `win.webContents.openDevTools()`.
- **config.json**: Establecer `"DEV_TOOLS": 1`.
- **installer.iss**: Cambiar `OutputBaseFilename` a `BodegasKeyla_Setup_dev`.

### Escenario B: Configuración de "Pase" (PROD/PRE)
- **main.js**: Deshabilitar `devTools: false` y comentar/quitar `win.webContents.openDevTools()`.
- **config.json**: Establecer `"DEV_TOOLS": 0`.
- **installer.iss**: Cambiar `OutputBaseFilename` a `BodegasKeyla_Setup`.

// turbo
1. Aplicar cambios en los archivos correspondientes según el escenario solicitado.
2. Ejecutar `generar_build.ps1` (opcional si se requiere regenerar el build antes del instalador).
