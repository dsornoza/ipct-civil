/* Pruebas de js/usuarios.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { rolesAsignables, puedeGestionar, validarUsuario, mensajeUsuario, aTitulo, parsearTabla, planImportacion,
         guardarUsuario, aplicarImportacion, usoAlmacenamiento, exportarRespaldo, textoTamano,
         normalizarCedula, filasPlantilla, ENCABEZADOS_PLANTILLA,
         evaluables, cargarAniosHabilitados, cargarParticipantes, aniosPorUsuario, anioAnterior, fijarParticipacion, copiarParticipantes } from "../../../js/usuarios.js";
import { crearSbFalso } from "./sb_falso.mjs";

const RESP = { id: "r", rol: "responsable_ipct" }, ADMIN = { id: "a", rol: "superadmin" }, DOC = { id: "d", rol: "docente" };
const EXISTENTES = [
    { id: "u1", email: "ana@unesum.edu.ec", nombre: "Ana Pérez", rol: "docente", cedula: "1300000001", apellidos_nombres: null, facultad: "Ciencias Técnicas", programa: "Ingeniería Civil" },
    { id: "u2", email: "luis@unesum.edu.ec", nombre: "Luis Mora", rol: "docente", cedula: null },
    { id: "u3", email: "admin@unesum.edu.ec", nombre: "Admin", rol: "superadmin", cedula: null },
];

test("roles asignables y a quién se puede gestionar", () => {
    assert.deepEqual(rolesAsignables(RESP), ["docente", "calidad", "coordinadora"]);
    assert.equal(rolesAsignables(ADMIN).length, 5);
    assert.deepEqual(rolesAsignables(DOC), []);
    assert.equal(puedeGestionar(RESP, { rol: "docente" }), true);
    assert.equal(puedeGestionar(RESP, { rol: "responsable_ipct" }), false);
    assert.equal(puedeGestionar(RESP, { rol: "superadmin" }), false);
    assert.equal(puedeGestionar(ADMIN, { rol: "superadmin" }), true);
    assert.equal(puedeGestionar(DOC, { rol: "docente" }), false);
});

test("validarUsuario: nombre, correo institucional y cédula", () => {
    const ok = { nombre: "Ana", email: "ana@unesum.edu.ec", cedula: "1300000001" };
    assert.equal(validarUsuario(ok, { dominio: "unesum.edu.ec" }), null);
    assert.match(validarUsuario({ ...ok, nombre: " " }), /nombre/);
    assert.match(validarUsuario({ ...ok, email: "ana" }), /no es válido/);
    assert.match(validarUsuario({ ...ok, email: "ana@gmail.com" }, { dominio: "unesum.edu.ec" }), /institucional/);
    assert.match(validarUsuario({ ...ok, cedula: "130-000" }), /sin guiones/);
    assert.equal(validarUsuario({ nombre: "Ana", email: "x" }, { esNuevo: false }), null);   // al editar no se revisa el correo
});

test("mensajeUsuario y aTitulo", () => {
    assert.match(mensajeUsuario({ code: "23505" }), /correo o esa cédula/);
    assert.match(mensajeUsuario({ code: "42501" }), /No tiene permiso/);
    assert.match(mensajeUsuario({ code: "PGRST116" }), /responsables ni superadministradores/);
    assert.equal(aTitulo("SORNOZA PARRALES diego"), "Sornoza Parrales Diego");
});

test("parsearTabla: tabulaciones de Excel, punto y coma, comillas y encabezados con tildes", () => {
    const t = parsearTabla("Correo\tApellidos y nombres\tCédula\n ana@unesum.edu.ec \tPÉREZ ANA\t1300000001\nluis@unesum.edu.ec\t\t");
    assert.deepEqual(t.columnas, ["correo", "apellidos_nombres", "cedula"]);
    assert.equal(t.filas.length, 2);
    assert.deepEqual([t.filas[0].correo, t.filas[0].apellidos_nombres, t.filas[0].cedula, t.filas[0]._linea], ["ana@unesum.edu.ec", "PÉREZ ANA", "1300000001", 2]);
    const c = parsearTabla('email;apellidos_nombres;carrera\nana@unesum.edu.ec;"PÉREZ; ANA";Civil');
    assert.equal(c.filas[0].apellidos_nombres, "PÉREZ; ANA");
    assert.equal(c.filas[0].programa, "Civil");
    assert.match(parsearTabla("solo una linea").error, /encabezados/);
    assert.match(parsearTabla("nombre,cedula\nAna,1").error, /correo/);
});

test("planImportacion: crea, actualiza, ignora sin cambios y reporta errores", () => {
    const { filas } = parsearTabla([
        "correo\tapellidos y nombres\tcédula",
        "ana@unesum.edu.ec\tPÉREZ ANA\t1300000001",       // existe: solo cambia apellidos
        "luis@unesum.edu.ec\tMORA LUIS\t1300000002",       // existe: cédula y apellidos
        "nueva@unesum.edu.ec\tGARCÍA NUEVA\t1300000003",   // se crea
        "otra@gmail.com\tOTRA\t1",                         // dominio
        "admin@unesum.edu.ec\tADMIN\t1300000009",          // la responsable no lo modifica
        "dup@unesum.edu.ec\tDUP\t1300000001",              // cédula de Ana
        "nueva@unesum.edu.ec\tGARCÍA NUEVA\t1300000003",   // repetida en la tabla
        "ana@unesum.edu.ec\tPÉREZ ANA\t1300000001",        // repetida también
    ].join("\n"));
    const p = planImportacion(filas, EXISTENTES, RESP, { dominio: "unesum.edu.ec" });
    assert.deepEqual(p.actualizar.map(a => [a.correo, Object.keys(a.cambios).sort()]),
        [["ana@unesum.edu.ec", ["apellidos_nombres"]], ["luis@unesum.edu.ec", ["apellidos_nombres", "cedula"]]]);
    assert.equal(p.crear.length, 1);
    assert.deepEqual([p.crear[0].email, p.crear[0].nombre, p.crear[0].rol, p.crear[0].programa, p.crear[0].evaluado],
        ["nueva@unesum.edu.ec", "García Nueva", "docente", "Ingeniería Civil", true]);
    assert.equal(p.errores.length, 5);
    assert.ok(p.errores.some(e => /institucional/.test(e.mensaje)));
    assert.ok(p.errores.some(e => /Solo el superadministrador/.test(e.mensaje)));
    assert.ok(p.errores.some(e => /cédula 1300000001 ya pertenece/.test(e.mensaje)));
    assert.equal(p.errores.filter(e => /repetido/.test(e.mensaje)).length, 2);
    // Sin cambios
    const igual = planImportacion(parsearTabla("correo\tcédula\nana@unesum.edu.ec\t1300000001").filas, EXISTENTES, RESP);
    assert.deepEqual([igual.sinCambios, igual.actualizar.length, igual.crear.length], [1, 0, 0]);
    // El superadmin sí puede modificar al superadmin y crear con rol
    const adm = planImportacion(parsearTabla("correo\trol\tnombre\nc@unesum.edu.ec\tcalidad\tCal\nz@unesum.edu.ec\tsuperadmin\tZ").filas, EXISTENTES, ADMIN);
    assert.deepEqual(adm.crear.map(c => c.rol), ["calidad", "superadmin"]);
    const resp = planImportacion(parsearTabla("correo\trol\tnombre\nz@unesum.edu.ec\tsuperadmin\tZ").filas, EXISTENTES, RESP);
    assert.match(resp.errores[0].mensaje, /No puede crear personas con el rol/);
});

test("guardarUsuario y aplicarImportacion: insertan y actualizan; los fallos no detienen al resto", async () => {
    const sb = crearSbFalso({ tablas: { usuarios: [{ id: "u1", email: "ana@unesum.edu.ec", nombre: "Ana" }] } });
    await guardarUsuario(sb, { email: "n@unesum.edu.ec", nombre: "Nuevo" });
    await guardarUsuario(sb, { id: "u1", cedula: "1300000001" });
    assert.equal(sb.tablas.usuarios.length, 2);
    assert.equal(sb.tablas.usuarios[0].cedula, "1300000001");
    await assert.rejects(guardarUsuario(sb, { id: "no-existe", cedula: "1" }), e => e.code === "PGRST116");

    const sb2 = crearSbFalso({ tablas: { usuarios: [{ id: "u1", email: "ana@unesum.edu.ec" }] }, fallos: {} });
    const r = await aplicarImportacion(sb2, { crear: [{ email: "x@unesum.edu.ec", nombre: "X" }], actualizar: [{ id: "u1", correo: "ana@unesum.edu.ec", cambios: { cedula: "1" } }, { id: "no", correo: "no@unesum.edu.ec", cambios: { cedula: "2" } }] });
    assert.equal(r.hechos, 2);
    assert.equal(r.fallos.length, 1);
    assert.match(r.fallos[0].mensaje, /No tiene permiso/);
});

test("almacenamiento, respaldo y tamaño legible", async () => {
    const sb = crearSbFalso({ rpcs: { uso_almacenamiento: () => [{ usado: 2097152, cuota: 1073741824, archivos: 7 }], exportar_respaldo: () => ({ usuarios: [] }) } });
    assert.equal((await usoAlmacenamiento(sb)).archivos, 7);
    assert.deepEqual(await exportarRespaldo(sb), { usuarios: [] });
    assert.deepEqual(await usoAlmacenamiento(crearSbFalso({ rpcs: { uso_almacenamiento: () => [] } })), { usado: 0, cuota: 0, archivos: 0 });
    assert.equal(textoTamano(2097152), "2.0 MB");
    assert.equal(textoTamano(51200), "50 KB");
});

test("normalizarCedula repone el cero que Excel quita y no toca pasaportes", () => {
    assert.equal(normalizarCedula("912345678"), "0912345678");
    assert.equal(normalizarCedula("1309205720"), "1309205720");
    assert.equal(normalizarCedula("912345678.0"), "0912345678");
    assert.equal(normalizarCedula("AB123456"), "AB123456");
    assert.equal(normalizarCedula(""), "");
    assert.equal(parsearTabla("correo\tcédula\na@unesum.edu.ec\t912345678").filas[0].cedula, "0912345678");
});

test("la plantilla trae las personas actuales y sus encabezados se reconocen al volver a subirla", () => {
    const filas = filasPlantilla([{ email: "ana@unesum.edu.ec", nombre: "Ana Pérez", apellidos_nombres: "PÉREZ ANA", cedula: "0912345678", facultad: "Ciencias Técnicas", programa: "Ingeniería Civil" },
                                  { email: "luis@unesum.edu.ec", nombre: "Luis Mora" }]);
    assert.deepEqual(filas[0], ENCABEZADOS_PLANTILLA);
    assert.deepEqual(filas[2], ["luis@unesum.edu.ec", "", "", "", "", "Luis Mora"]);
    // Ida y vuelta: lo que se descarga se puede subir sin cambios y no produce errores ni cambios
    const texto = filas.map(f => f.join("\t")).join("\n");
    const t = parsearTabla(texto);
    assert.equal(t.error, null);
    assert.deepEqual(t.columnas, ["correo", "apellidos_nombres", "cedula", "facultad", "programa", "nombre"]);
    const existentes = [{ id: "u1", email: "ana@unesum.edu.ec", nombre: "Ana Pérez", rol: "docente", apellidos_nombres: "PÉREZ ANA", cedula: "0912345678", facultad: "Ciencias Técnicas", programa: "Ingeniería Civil" },
                        { id: "u2", email: "luis@unesum.edu.ec", nombre: "Luis Mora", rol: "docente" }];
    const p = planImportacion(t.filas, existentes, { rol: "responsable_ipct" }, { dominio: "unesum.edu.ec" });
    assert.deepEqual([p.errores.length, p.actualizar.length, p.crear.length, p.sinCambios], [0, 0, 0, 2]);
});

test("participantes por año: quién es evaluable, años por persona y año anterior", () => {
    const us = [{ id: "a", rol: "docente", evaluado: true }, { id: "b", rol: "calidad", evaluado: true },
                { id: "c", rol: "responsable_ipct", evaluado: false }, { id: "d", rol: "superadmin", evaluado: true }];
    assert.deepEqual(evaluables(us).map(u => u.id), ["a", "d"]);
    const por = aniosPorUsuario([{ usuario_id: "a", anio: 2026 }, { usuario_id: "a", anio: 2027 }, { usuario_id: "d", anio: 2026 }]);
    assert.deepEqual(por, { a: [2027, 2026], d: [2026] });
    const anios = [{ anio: 2027 }, { anio: 2026 }, { anio: 2025 }];
    assert.equal(anioAnterior(anios, 2027), 2026);
    assert.equal(anioAnterior(anios, 2025), null);
    assert.equal(anioAnterior([{ anio: 2030 }, { anio: 2026 }], 2030), 2026);   // el anterior habilitado, aunque haya huecos
});

test("participantes por año: lectura y llamadas a la base de datos", async () => {
    const llamadas = [];
    const sb = crearSbFalso({
        tablas: { periodos: [{ anio: 2026, abierto: true }, { anio: 2027, abierto: false }], usuarios_anios: [{ usuario_id: "a", anio: 2026 }] },
        rpcs: { fijar_participacion: a => llamadas.push(a), copiar_participantes: () => 3 } });
    assert.deepEqual((await cargarAniosHabilitados(sb)).map(a => a.anio), [2027, 2026]);
    assert.equal((await cargarParticipantes(sb)).length, 1);
    await fijarParticipacion(sb, "a", 2027, false);
    assert.deepEqual(llamadas, [{ p_usuario: "a", p_anio: 2027, p_participa: false }]);
    assert.equal(await copiarParticipantes(sb, 2026, 2027), 3);
    const falla = crearSbFalso({ fallos: { "rpc.copiar_participantes": { code: "23514", message: "Primero habilite el año 2030" } } });
    await assert.rejects(copiarParticipantes(falla, 2026, 2030), e => /habilite/.test(e.message));
});
