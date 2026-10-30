/* Pruebas de js/catalogo.js y js/evidencias.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { agruparCatalogo, resumenEvidencia, normalizarDatos, esPdf, validarArchivo, sha256Hex, mensajeError }
    from "../../../js/catalogo.js";
import { crearEvidencia, actualizarEvidencia, eliminarEvidencia, listarMias, cargarAnioInicio }
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
