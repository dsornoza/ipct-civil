/* Pruebas de js/catalogo.js y js/evidencias.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { agruparCatalogo, resumenEvidencia, normalizarDatos, esPdf, validarArchivo, sha256Hex, mensajeError, enlaceDe, puedeCargar, ROLES_LECTURA, ROLES_VALIDA, ROLES_CARGA }
    from "../../../js/catalogo.js";
import { crearEvidencia, actualizarEvidencia, eliminarEvidencia, listarMias, cargarAnioInicio,
         cargarUsuarios, listarPorAnio, historialDe, evidenciasConMismaHuella, resolverEvidencia }
    from "../../../js/evidencias.js";
import { crearSbFalso } from "./sb_falso.mjs";

const CFG = { BUCKET: "evidencias" };
const pdf = (nombre = "cert.pdf", extra = "") => new File(["%PDF-1.4 " + extra], nombre, { type: "application/pdf" });
const USUARIO = "u-1";

test("agruparCatalogo respeta el orden y los topes", () => {
    const g = agruparCatalogo([
        { id: "b", indicador: "IVs", bloque: "v", bloque_titulo: "Vinc", tope: 2, orden: 90 },
        { id: "a", indicador: "Ii", bloque: "art", bloque_titulo: "Art", tope: null, orden: 10 },
        { id: "c", indicador: "Ii", bloque: "art", bloque_titulo: "Art", tope: null, orden: 11 },
    ]);
    assert.deepEqual(g.map(i => i.indicador), ["Ii", "IVs"]);
    assert.deepEqual(g[0].bloques[0].tipos.map(t => t.id), ["a", "c"]);
    assert.equal(g[1].bloques[0].tope, 2);
});

test("resumenEvidencia usa el primer campo obligatorio con valor", () => {
    const esq = { campos: [{ nombre: "doi" }, { nombre: "titulo", requerido: true }] };
    assert.equal(resumenEvidencia({ doi: "10.1/x", titulo: " Hormigón " }, esq), "Hormigón");
    assert.equal(resumenEvidencia({}, esq), "(sin descripción)");
});

test("normalizarDatos recorta y descarta vacíos", () => {
    assert.deepEqual(normalizarDatos({ a: " x ", b: "", c: "  ", d: 0 }), { a: "x", d: 0 });
});

test("validación de archivos: tipo, tamaño y cabecera", async () => {
    assert.equal(await esPdf(pdf()), true);
    assert.equal(await esPdf(new File(["hola"], "a.pdf", { type: "application/pdf" })), false);
    assert.match(await validarArchivo(null, 100), /Adjunte/);
    assert.match(await validarArchivo(pdf("g.pdf", "x".repeat(200)), 100), /máximo/);
    assert.match(await validarArchivo(new File(["texto"], "a.pdf"), 1000), /no es un PDF/);
    assert.equal(await validarArchivo(pdf(), 1000), null);
    assert.equal((await sha256Hex(pdf())).length, 64);
});

test("mensajeError traduce los códigos conocidos", () => {
    assert.match(mensajeError({ code: "23505" }), /Ya registró/);
    assert.equal(mensajeError({ code: "23514", message: "Falta el campo obligatorio: Título" }), "Falta el campo obligatorio: Título");
    assert.match(mensajeError({ code: "PGRST116" }), /ya fue validada/);
    assert.match(mensajeError({ message: "new row violates row-level security policy" }), /permiso/);
});

test("crearEvidencia: guarda, sube el PDF con la ruta esperada y registra el archivo", async () => {
    const sb = crearSbFalso();
    const ev = await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: { titulo: "T" }, archivo: pdf() });
    assert.deepEqual(sb.llamadas, ["evidencias.insert", "storage.upload", "archivos.insert"]);
    const ruta = sb.tablas.archivos[0].ruta;
    assert.match(ruta, new RegExp(`^${USUARIO}/${ev.id}/[0-9a-f-]{36}\\.pdf$`));
    assert.ok(sb.objetos.has(ruta));
    assert.equal(sb.tablas.archivos[0].nombre, "cert.pdf");
    assert.equal(sb.tablas.archivos[0].sha256.length, 64);
});

test("crearEvidencia: duplicado no sube ningún archivo", async () => {
    const sb = crearSbFalso({ fallos: { "evidencias.insert": { code: "23505", message: "dup" } } });
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivo: pdf() }),
        e => e.code === "23505");
    assert.deepEqual(sb.llamadas, ["evidencias.insert"]);
});

test("crearEvidencia: si falla la subida, deshace la evidencia", async () => {
    const sb = crearSbFalso({ fallos: { "storage.upload": { message: "boom" } } });
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivo: pdf() }));
    assert.equal(sb.tablas.evidencias.length, 0);
});

test("crearEvidencia: si falla el registro del archivo, deshace evidencia y PDF", async () => {
    const sb = crearSbFalso({ fallos: { "archivos.insert": { message: "boom" } } });
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivo: pdf() }));
    assert.equal(sb.tablas.evidencias.length, 0);
    assert.equal(sb.objetos.size, 0);
});

test("actualizarEvidencia: primero los datos; con archivo nuevo reemplaza y borra el anterior", async () => {
    const sb = crearSbFalso();
    const ev = await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: { titulo: "A" }, archivo: pdf("viejo.pdf") });
    const rutaVieja = sb.tablas.archivos[0].ruta;
    sb.llamadas.length = 0;
    sb.tablas.evidencias[0].estado = "observada";
    await actualizarEvidencia(sb, CFG, {
        evidencia: { ...ev, docente_id: USUARIO, archivo: { ruta: rutaVieja } },
        anio: 2026, datos: { titulo: "B" }, archivo: pdf("nuevo.pdf"),
    });
    assert.deepEqual(sb.llamadas, ["evidencias.update", "storage.upload", "archivos.update", "storage.remove"]);
    assert.equal(sb.tablas.evidencias[0].estado, "pendiente");
    assert.equal(sb.tablas.archivos[0].nombre, "nuevo.pdf");
    assert.ok(!sb.objetos.has(rutaVieja));
});

test("actualizarEvidencia: sin filas (validada) da error y no toca el archivo", async () => {
    const sb = crearSbFalso();
    await assert.rejects(actualizarEvidencia(sb, CFG, { evidencia: { id: "no-existe" }, anio: 2026, datos: {}, archivo: pdf() }),
        e => e.code === "PGRST116");
    assert.deepEqual(sb.llamadas, ["evidencias.update"]);
});

test("eliminarEvidencia: borra el PDF antes que la fila", async () => {
    const sb = crearSbFalso();
    const ev = await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivo: pdf() });
    sb.llamadas.length = 0;
    await eliminarEvidencia(sb, CFG, { ...ev, archivo: { ruta: sb.tablas.archivos[0].ruta } });
    assert.deepEqual(sb.llamadas, ["storage.remove", "evidencias.delete"]);
    assert.equal(sb.tablas.evidencias.length, 0);
});

test("listarMias acepta archivo como objeto o como lista", async () => {
    const sb = crearSbFalso({ tablas: { evidencias: [
        { id: "1", docente_id: USUARIO, anio: 2026, tipos_evidencia: { nombre: "Q1" }, archivos: [{ ruta: "r" }] },
        { id: "2", docente_id: USUARIO, anio: 2026, tipos_evidencia: { nombre: "Q2" }, archivos: { ruta: "s" } },
    ] } });
    const l = await listarMias(sb, USUARIO, 2026);
    assert.deepEqual(l.map(e => e.archivo.ruta), ["r", "s"]);
    assert.equal(l[0].tipo.nombre, "Q1");
});

test("cargarAnioInicio usa el ajuste y nunca supera el año actual", async () => {
    const sb = crearSbFalso({ tablas: { ajustes: [{ clave: "anio_inicio", valor: "2026" }] } });
    assert.equal(await cargarAnioInicio(sb, 2027), 2026);
    assert.equal(await cargarAnioInicio(sb, 2025), 2025);
    assert.equal(await cargarAnioInicio(crearSbFalso(), 2026), 2026);
});

test("enlaceDe: URL y DOI se vuelven enlaces seguros; el resto no", () => {
    assert.equal(enlaceDe({ tipo: "url", nombre: "url" }, "https://ejemplo.org/a"), "https://ejemplo.org/a");
    assert.equal(enlaceDe({ tipo: "url", nombre: "url" }, "javascript:alert(1)"), null);
    assert.equal(enlaceDe({ tipo: "texto", nombre: "doi" }, "https://doi.org/10.3389/frsus.2026.1"), "https://doi.org/10.3389/frsus.2026.1");
    assert.equal(enlaceDe({ tipo: "texto", nombre: "doi" }, "10.1000/abc"), "https://doi.org/10.1000/abc");
    assert.equal(enlaceDe({ tipo: "texto", nombre: "doi" }, "no es doi"), null);
    assert.equal(enlaceDe({ tipo: "texto", nombre: "titulo" }, "https://x.org"), null);
});

test("roles: validar es un subconjunto de leer; calidad lee pero no valida ni carga", () => {
    assert.ok(ROLES_VALIDA.every(r => ROLES_LECTURA.includes(r)));
    assert.ok(ROLES_LECTURA.includes("calidad") && !ROLES_VALIDA.includes("calidad") && !ROLES_CARGA.includes("calidad"));
});

test("listarPorAnio incluye tipo y archivo; evidencias de otros años no", async () => {
    const sb = crearSbFalso({ tablas: {
        tipos_evidencia: [{ id: "q1", nombre: "Q1", puntos: 6 }],
        archivos: [{ evidencia_id: "1", ruta: "r", sha256: "h" }],
        evidencias: [{ id: "1", tipo_id: "q1", anio: 2026 }, { id: "2", tipo_id: "q1", anio: 2025 }] } });
    const l = await listarPorAnio(sb, 2026);
    assert.equal(l.length, 1);
    assert.equal(l[0].tipo.puntos, 6);
    assert.equal(l[0].archivo.ruta, "r");
});

test("resolverEvidencia guarda estado y comentario (vacío = null)", async () => {
    const sb = crearSbFalso({ tablas: { evidencias: [{ id: "1", estado: "pendiente" }, { id: "2", estado: "pendiente" }] } });
    await resolverEvidencia(sb, "1", "observada", "  Falta el DOI  ");
    await resolverEvidencia(sb, "2", "validada", "");
    assert.deepEqual(sb.tablas.evidencias.map(e => [e.estado, e.comentario]), [["observada", "Falta el DOI"], ["validada", null]]);
    await assert.rejects(resolverEvidencia(sb, "no-existe", "validada"), e => e.code === "PGRST116");
});

test("evidenciasConMismaHuella excluye la propia y no consulta sin huella", async () => {
    const sb = crearSbFalso({ tablas: { archivos: [
        { evidencia_id: "1", sha256: "h" }, { evidencia_id: "2", sha256: "h" }, { evidencia_id: "3", sha256: "otro" }] } });
    assert.deepEqual((await evidenciasConMismaHuella(sb, "h", "1")).map(a => a.evidencia_id), ["2"]);
    assert.deepEqual(await evidenciasConMismaHuella(sb, null, "1"), []);
});

test("cargarUsuarios e historialDe filtran correctamente", async () => {
    const sb = crearSbFalso({ tablas: {
        usuarios: [{ id: "u", nombre: "Ana" }],
        historial: [{ evidencia_id: "1", estado_nuevo: "pendiente" }, { evidencia_id: "2", estado_nuevo: "validada" }] } });
    assert.equal((await cargarUsuarios(sb))[0].nombre, "Ana");
    assert.deepEqual((await historialDe(sb, "1")).map(h => h.estado_nuevo), ["pendiente"]);
});

test("puedeCargar: exige rol permitido y evaluado (por defecto sí)", () => {
    assert.equal(puedeCargar({ rol: "docente" }), true);
    assert.equal(puedeCargar({ rol: "responsable_ipct", evaluado: true }), true);
    assert.equal(puedeCargar({ rol: "responsable_ipct", evaluado: false }), false);
    assert.equal(puedeCargar({ rol: "calidad", evaluado: true }), false);
});
