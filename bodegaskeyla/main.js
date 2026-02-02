const electron = require('electron');
const { app, BrowserWindow } = electron;
const path = require('path');
let win;
function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false // Simplifica el acceso a Node para principiantes, pero nota de seguridad abajo
        }
    });
    // Apunta al archivo index.html generado por Angular después de hacer 'ng build'
    win.loadFile(path.join(__dirname, 'dist/bodegaskeyla/browser/index.html'));
    win.setMenu(null);
    win.on('closed', () => {
        win = null;
    });
}
app.on('ready', createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('activate', () => {
    if (win === null) {
        createWindow();
    }
});
