/* Página de entrada: inicio de sesión con Google y verificación de la lista blanca. */
import { configuracionCompleta, sb, ROLES, iniciarSesion, cerrarSesion, sesionActual, obtenerPerfil, diagnostico }
    from "./cliente.js";
import { puedeCargar, ROLES_LECTURA, ROLES_VALIDA } from "./catalogo.js";

const $ = id => document.getElementById(id);

// Muestra solo una de las vistas: cargando, config, login, sin-acceso, panel.
function mostrar(vista) {
    for (const v of ["cargando", "config", "login", "sin-acceso", "panel"]) {
        $("vista-" + v).hidden = v !== vista;
    }
}

function mensajeError(texto) {
    const el = $("error-login");
    el.textContent = texto;
    el.hidden = !texto;
}

async function mostrarSinAcceso(session) {
    $("sin-acceso-correo").textContent = session.user.email || "";
    try {
        const d = await diagnostico();
        if (d) {
            $("diag").textContent =
                `Correo: ${d.email} · Proveedor: ${d.proveedor || "(ninguno)"} · ` +
                `Dominio permitido: ${d.dominio_correcto ? "sí" : "no"} · ` +
                `En la lista: ${d.en_lista ? "sí" : "no"} · Activo: ${d.activo ? "sí" : "no"}`;
        }
    } catch (e) { /* el diagnóstico es opcional */ }
    mostrar("sin-acceso");
}

async function iniciar() {
    if (!configuracionCompleta()) { mostrar("config"); return; }

    // Errores devueltos por el proveedor en la URL (por ejemplo, el usuario canceló).
    const params = new URLSearchParams(window.location.search);
    const errorOAuth = params.get("error_description") || params.get("error");

    let session = await sesionActual();
    if (!session) {
        if (errorOAuth) mensajeError("No se pudo iniciar sesión: " + errorOAuth);
        mostrar("login");
        return;
    }

    try {
        const perfil = await obtenerPerfil();
        if (!perfil) { await mostrarSinAcceso(session); return; }
        $("perfil-nombre").textContent = perfil.nombre;
        $("perfil-correo").textContent = perfil.email;
        $("perfil-rol").textContent = ROLES[perfil.rol] || perfil.rol;
        $("enlace-evidencias").hidden = !puedeCargar(perfil);
        $("enlace-validacion").hidden = !ROLES_LECTURA.includes(perfil.rol);
        $("enlace-validacion").textContent = ROLES_VALIDA.includes(perfil.rol) ? "Validar evidencias" : "Ver evidencias";
        mostrar("panel");
        // Limpia el ?code= de la barra de direcciones.
        if (window.location.search) history.replaceState(null, "", window.location.pathname);
    } catch (e) {
        mostrar("login");
        mensajeError("No se pudo verificar su acceso. Intente de nuevo. (" + (e.message || e) + ")");
    }
}

$("btn-google").addEventListener("click", async () => {
    mensajeError("");
    const { error } = await iniciarSesion();
    if (error) mensajeError("No se pudo iniciar el acceso con Google: " + error.message);
});
for (const id of ["btn-salir", "btn-salir-2"]) {
    $(id).addEventListener("click", async () => { await cerrarSesion(); window.location.reload(); });
}

// Si la sesión cambia en otra pestaña, se refleja aquí.
if (sb) sb.auth.onAuthStateChange(evento => { if (evento === "SIGNED_OUT") mostrar("login"); });

iniciar();
