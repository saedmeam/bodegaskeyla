# Script de Automatización de Build para BodegasKeyla
# EJECUTAR ESTE ARCHIVO COMO ADMINISTRADOR

Write-Host "1. Cerrando procesos existentes..." -ForegroundColor Yellow
taskkill /F /IM BodegasKeyla.exe /T 2>$null
taskkill /F /IM electron.exe /T 2>$null
taskkill /F /IM node.exe /T /FI "STATUS eq RUNNING" 2>$null

Write-Host "2. Limpiando directorios de build..." -ForegroundColor Yellow
Remove-Item -Recurse -Force dist, release -ErrorAction SilentlyContinue
mkdir dist
mkdir release

Write-Host "3. Compilando aplicación Angular..." -ForegroundColor Cyan
npm run build

Write-Host "4. Empaquetando archivos para el instalador (Electron)..." -ForegroundColor Cyan
$env:CSC_LINK="none"
npx electron-builder build --windows --dir

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " PROCESO COMPLETADO CON ÉXITO " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Ahora puedes abrir el archivo 'installer.iss' en"
Write-Host "Inno Setup Compiler y presionar COMPILE (o F9)."
Write-Host "El instalador final se generará en la carpeta 'Output'."
Write-Host "==========================================================" -ForegroundColor Green
pause
