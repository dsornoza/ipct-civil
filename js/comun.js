/* Comportamiento común de las páginas internas: exige sesión autorizada,
   muestra el usuario en la cabecera y conecta «Cerrar sesión». */
import { configuracionCompleta, ROLES, sesionActual, obtenerPerfil, cerrarSesion } from "./cliente.js";

export async function iniciarPagina() {
    const volver = () => { window.location.replace("index.html"); return null; };
    if (!configuracionCompleta()) return volver();
    const sesion = await sesionActual();
    if (!sesion) return volver();
    const perfil = await obtenerPerfil();
    if (!perfil) return volver();           // index.html explica por qué no tiene acceso

    document.getElementById("usuario-nombre").textContent = perfil.nombre;
    document.getElementById("usuario-rol").textContent = ROLES[perfil.rol] || perfil.rol;
    document.getElementById("btn-salir").addEventListener("click", async () => {
        await cerrarSesion();
        window.location.replace("index.html");
    });
    return perfil;
}
