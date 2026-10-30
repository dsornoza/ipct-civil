/* Comportamiento común de las páginas internas: exige sesión autorizada,
   muestra el usuario en la cabecera y conecta «Cerrar sesión». */
import { configuracionCompleta, ROLES, sesionActual, obtenerPerfil, cerrarSesion } from "./cliente.js";
import { puedeCargar, ROLES_LECTURA, ROLES_VALIDA } from "./catalogo.js";

// Opciones del menú según el rol. Las etapas siguientes añaden aquí ranking, reportes y administración.
function opcionesMenu(perfil) {
    const op = [{ href: "index.html", texto: "Inicio" }];
    if (puedeCargar(perfil)) op.push({ href: "docente.html", texto: "Mis evidencias" });
    if (ROLES_LECTURA.includes(perfil.rol)) {
        op.push({ href: "validacion.html", texto: ROLES_VALIDA.includes(perfil.rol) ? "Validación" : "Evidencias" });
    }
    op.push({ href: "ranking.html", texto: "Ranking" });      // lo ven todos los usuarios autorizados
    return op;
}

function pintarMenu(perfil) {
    const nav = document.getElementById("menu");
    if (!nav) return;
    const actual = window.location.pathname.split("/").pop() || "index.html";
    for (const o of opcionesMenu(perfil)) {
        const a = document.createElement("a");
        a.href = o.href;
        a.textContent = o.texto;
        if (o.href === actual) a.setAttribute("aria-current", "page");
        nav.append(a);
    }
}

export async function iniciarPagina() {
    const volver = () => { window.location.replace("index.html"); return null; };
    if (!configuracionCompleta()) return volver();
    const sesion = await sesionActual();
    if (!sesion) return volver();
    const perfil = await obtenerPerfil();
    if (!perfil) return volver();           // index.html explica por qué no tiene acceso

    pintarMenu(perfil);
    document.getElementById("usuario-nombre").textContent = perfil.nombre;
    document.getElementById("usuario-rol").textContent = ROLES[perfil.rol] || perfil.rol;
    document.getElementById("btn-salir").addEventListener("click", async () => {
        await cerrarSesion();
        window.location.replace("index.html");
    });
    return perfil;
}
