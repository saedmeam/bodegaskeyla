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
 * v2.0: Módulo de impresión física para el Revisor de Bodegas Keyla.
 * Utiliza PrintVeris.jar para hablar con los drivers de la impresora térmica.
 */
module.exports = {
    imprimir: (printName, data) => {
        return new Promise((resolve, reject) => {
            let pathCarpetaTemp;

            try {
                // Dirección de la carpeta temporal del sistema operativo
                const pathTemp = os.tmpdir();
                // Nombre de la carpeta que se creará dentro de la carpeta de temporal
                const folderName = "keyla-prints";
                // ID único para el archivo temporal
                const fileName = `print_${Date.now()}_${uuid()}`;
                // Extensión del archivo
                const ext = ".txt";
                
                // Armado de la ruta final de la carpeta temporal
                pathCarpetaTemp = path.join(pathTemp, folderName);

                // Asegurar que carpeta exista
                if (!fs.existsSync(pathCarpetaTemp)) {
                    fs.mkdirSync(pathCarpetaTemp, { recursive: true });
                }

                const java = "java";

                // Definir posibles rutas para el JAR (Dev y Prod)
                const possiblepaths = [
                    path.join(process.cwd(), "PrintVeris.jar"), // Dev / Root
                    path.join(process.resourcesPath, "PrintVeris.jar"), // Electron Prod (resources folder)
                    path.join(path.dirname(process.execPath), "PrintVeris.jar"), // Next to executable
                    path.join(__dirname, "PrintVeris.jar") // Local fallback
                ];

                let executeJar = possiblepaths.find(p => fs.existsSync(p));

                if (!executeJar) {
                    console.warn("⚠️ No se encontró PrintVeris.jar en ninguna ruta esperada. Usando fallback default.");
                    executeJar = path.join(process.cwd(), "PrintVeris.jar");
                } else {
                    console.log(`✅ PrintVeris.jar encontrado en: ${executeJar}`);
                }

                const pathFileTemp = path.join(pathCarpetaTemp, fileName + ext);

                // v2.1: Validación de contenido antes de escribir
                if (data === undefined || data === null) {
                    return reject(new Error("No hay contenido para imprimir."));
                }

                // Escribir el contenido al archivo temporal (UTF-8)
                fs.writeFileSync(pathFileTemp, data, 'utf8');

                // Argumentos para el comando Java
                // java -jar PrintVeris.jar <archivo_temp> <nombre_impresora>
                const finalPrinterName = printName || ""; // Si está vacío, el JAR suele usar la default
                const commandArgs = ["-jar", executeJar, pathFileTemp, finalPrinterName];

                console.log(`[Printer] 🖨️ Ejecutando comando de impresión: ${java} ${commandArgs.join(" ")}`);

                const child = spawn(java, commandArgs, {
                    cwd: path.dirname(executeJar),
                });

                let stdout = "";
                let stderr = "";

                child.stdout.on("data", (data) => {
                    stdout += data.toString();
                });

                child.stderr.on("data", (data) => {
                    stderr += data.toString();
                });

                child.on("error", (err) => {
                    reject(new Error(`Error al iniciar proceso Java: ${err.message}. Asegúrese de tener JRE instalado.`));
                });

                child.on("close", (code) => {
                    // Eliminar archivo temporal
                    if (pathFileTemp && fs.existsSync(pathFileTemp)) {
                        try {
                            fs.unlinkSync(pathFileTemp);
                            console.log(`[Printer] Archivo temporal eliminado: ${pathFileTemp}`);
                        } catch (e) {
                            console.error(`[Printer] No se pudo eliminar ${pathFileTemp}:`, e.message);
                        }
                    }

                    if (code !== 0) {
                        return reject(
                            new Error(
                                `Proceso de impresión finalizó con código ${code}.\nSTDERR: ${stderr}`
                            )
                        );
                    }

                    resolve(stdout);
                });
            } catch (error) {
                reject(error);
            }
        });
    }
};
