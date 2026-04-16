const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");

function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
}

function uuid() {
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

/**
 * v3.0: Módulo de impresión profesional con JasperReports.
 */
module.exports = {
    /**
     * Imprime un archivo de texto plano (Legado)
     */
    imprimir: (printName, data) => {
        return new Promise((resolve, reject) => {
            try {
                const pathTemp = os.tmpdir();
                const pathCarpetaTemp = path.join(pathTemp, "keyla-prints");
                if (!fs.existsSync(pathCarpetaTemp)) fs.mkdirSync(pathCarpetaTemp, { recursive: true });
                
                const fileName = `print_${Date.now()}_${uuid()}.txt`;
                const pathFileTemp = path.join(pathCarpetaTemp, fileName);
                fs.writeFileSync(pathFileTemp, data, 'utf8');

                const possiblePaths = [
                    path.join(process.cwd(), "PrintVeris.jar"),
                    path.join(__dirname, "PrintVeris.jar"),
                    path.join(process.resourcesPath, "PrintVeris.jar")
                ];

                const executeJar = possiblePaths.find(p => fs.existsSync(p)) || path.join(process.cwd(), "PrintVeris.jar");
                const finalPrinterName = printName || "";
                const commandArgs = ["-jar", executeJar, pathFileTemp, finalPrinterName];

                const child = spawn("java", commandArgs, { cwd: path.dirname(executeJar) });
                child.on("close", (code) => {
                    try { if (fs.existsSync(pathFileTemp)) fs.unlinkSync(pathFileTemp); } catch (e) {}
                    if (code !== 0) return reject(new Error(`Error ${code}`));
                    resolve("OK");
                });
            } catch (error) { reject(error); }
        });
    },

    /**
     * v3.0: Ejecuta un reporte de JasperReports usando JasperStarter
     * pathJasper: Nombre del archivo .jasper (debe estar en la carpeta de recursos)
     * jsonData: Objeto JSON con la información
     */
    imprimirJasper: (printName, reportFileName, jsonData, preview = false) => {
        return new Promise((resolve, reject) => {
            try {
                const pathTemp = os.tmpdir();
                const pathCarpetaTemp = path.join(pathTemp, "keyla-jasper-data");
                if (!fs.existsSync(pathCarpetaTemp)) fs.mkdirSync(pathCarpetaTemp, { recursive: true });

                const jsonPath = path.join(pathCarpetaTemp, `data_${Date.now()}.json`);
                fs.writeFileSync(jsonPath, JSON.stringify(jsonData), 'utf8');

                // v4.1: Detección ultra-robusta de JasperStarter (Prioridad: Empaquetado > Sistema)
                let jasperStarterExe = path.join(process.resourcesPath, "..", "JasperStarter", "bin", "jasperstarter.exe");
                
                if (!fs.existsSync(jasperStarterExe)) {
                    // Si no existe en la carpeta de la app (Modo Desarrollo), usamos la ruta global
                    jasperStarterExe = "C:\\Program Files (x86)\\JasperStarter\\bin\\jasperstarter.exe";
                }
                
                console.log(`[Jasper] 🔍 Usando motor en: ${jasperStarterExe}`);
                // v3.6: Lógica robusta de rutas para Desarrollo y Producción
                let reportDir;
                const devPath = path.join(process.cwd(), 'src', 'assets', 'reports');
                const prodPath = path.join(process.resourcesPath, 'reports');

                if (fs.existsSync(devPath)) {
                    reportDir = devPath;
                } else if (fs.existsSync(prodPath)) {
                    reportDir = prodPath;
                } else {
                    // Fallback a la carpeta donde esté el script
                    reportDir = path.join(__dirname, 'src', 'assets', 'reports');
                }
                
                const reportPath = path.join(reportDir, reportFileName);
                console.log(`[Jasper] 🔍 Buscando reporte en: ${reportPath}`);
                
                if (!fs.existsSync(reportPath)) {
                    return reject(new Error(`No se encontró el archivo .jasper en: ${reportPath}. Verifique que el archivo exista en src/assets/reports/`));
                }

                let args = [
                    "process",
                    "-t", "json",
                    "--data-file", jsonPath,
                    "--json-query", "",
                    "-f", "pdf"
                ];

                let pdfPath = "";
                if (preview) {
                    pdfPath = path.join(pathCarpetaTemp, `view_${Date.now()}`);
                    args.push("-o", pdfPath);
                } else {
                    // v6.3: "Blindaje Total": Si no es vista previa, SIEMPRE indicamos una acción de impresión
                    if (printName && printName.trim() !== "") {
                        args.push("-P", printName);
                    } else {
                        args.push("-p"); // Disparador para impresora por defecto si no hay nombre
                    }
                }
                
                // Si preview es false y no hay printName, JasperStarter usará la impresora predeterminada del sistema.

                // El archivo fuente (.jrxml) al final para compilación al vuelo
                args.push(reportPath);

                console.log(`[Jasper] 🚀 Ejecutando: ${jasperStarterExe} ${args.join(" ")}`);

                const child = spawn(jasperStarterExe, args);
                let stderr = "";
                child.stderr.on("data", (data) => stderr += data.toString());

                child.on("close", (code) => {
                    try { if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath); } catch (e) {}
                    
                    if (code !== 0) return reject(new Error(`Error JasperStarter: ${stderr}`));
                    
                    if (preview) {
                        // JasperStarter añade .pdf automáticamente al output
                        const finalPdf = pdfPath + ".pdf";
                        if (fs.existsSync(finalPdf)) {
                            resolve(finalPdf);
                        } else {
                            reject(new Error("No se pudo generar el archivo de vista previa."));
                        }
                    } else {
                        resolve("Impresión OK");
                    }
                });
            } catch (error) { reject(error); }
        });
    }
};
