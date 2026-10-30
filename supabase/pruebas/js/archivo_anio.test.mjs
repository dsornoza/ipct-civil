/* Pruebas de js/archivo_anio.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { nombreSeguro, rutaEnZip, agruparEnPartes, verificarArchivo, nombreParte, textoLeeme, exportarAnio, liberarEspacio, resumenAnio }
    from "../../../js/archivo_anio.js";
import { sha256Hex } from "../../../js/catalogo.js";
import { crearSbFalso } from "./sb_falso.mjs";

const CFG = { BUCKET: "evidencias" };
const blob = txt => new Blob([txt]);

async function fila(id, docente, contenido, extra = {}) {
    const b = blob(contenido);
    return { archivo_id: id, evidencia_id: "e-" + id, docente_id: "d", docente, tipo_nombre: "Artículos Q1", resumen: "IA for net zero",
             ruta: `d/e-${id}/${id}.pdf`, nombre: "articulo.pdf", tamano: b.size, sha256: await sha256Hex(b), rol: "principal", origen: "docente", archivado_en: null, ...extra };
}

// ZIP falso: recuerda lo agregado
function zipFalso() {
    const partes = [];
    return { partes, crear: async () => { const entradas = new Map(); const z = { entradas, agregar: (r, c) => entradas.set(r, c), generar: async () => new Blob([JSON.stringify([...entradas.keys()])]) }; partes.push(z); return z; } };
}

test("nombreSeguro: sin tildes ni caracteres raros, con tope", () => {
    assert.equal(nombreSeguro("PÉREZ ÑANDÚ: Ana / Luis"), "PEREZ NANDU_ Ana _ Luis");
    assert.equal(nombreSeguro("  ...  "), "sin-nombre");
    assert.equal(nombreSeguro(null), "sin-nombre");
    assert.equal(nombreSeguro("x".repeat(100), 10).length, 10);
    assert.ok(!/[\\/:*?"<>|]/.test(nombreSeguro('a\\b/c:d*e?f"g<h>i|j')));
});

test("rutaEnZip: docente/actividad/archivo, con marca de la Comisión y sin choques", () => {
    const f = { archivo_id: "12345678-aaaa", docente: "SORNOZA PARRALES DIEGO", tipo_nombre: "Artículos Q1", resumen: "IA: for net zero", rol: "principal", nombre: "mi artículo.pdf", origen: "docente" };
    assert.equal(rutaEnZip(f), "archivos/SORNOZA PARRALES DIEGO/Articulos Q1-IA_ for net zero/12345678-principal-mi articulo.pdf");
    assert.match(rutaEnZip({ ...f, origen: "validador", rol: "indexacion" }), /12345678-comision-indexacion-/);
    assert.notEqual(rutaEnZip(f), rutaEnZip({ ...f, archivo_id: "87654321-bbbb" }));
});

test("agruparEnPartes: respeta el tope y deja un archivo grande solo", () => {
    const a = [{ tamano: 40 }, { tamano: 40 }, { tamano: 40 }, { tamano: 300 }, { tamano: 10 }];
    assert.deepEqual(agruparEnPartes(a, 100).map(p => p.map(x => x.tamano)), [[40, 40], [40], [300], [10]]);
    assert.deepEqual(agruparEnPartes([], 100), []);
});

test("verificarArchivo: tamaño y huella", async () => {
    const f = await fila("a", "X", "contenido");
    assert.deepEqual(await verificarArchivo(f, blob("contenido")), { ok: true, huella: "verificada" });
    assert.match((await verificarArchivo(f, blob("otra cosa distinta"))).motivo, /tamaño/);
    assert.match((await verificarArchivo(f, blob("contenidX"))).motivo, /SHA-256/);       // mismo tamaño, otro contenido
    assert.match((await verificarArchivo(f, null)).motivo, /descargar/);
    assert.deepEqual(await verificarArchivo({ ...f, sha256: null }, blob("contenido")), { ok: true, huella: "solo tamaño" });
});

test("nombreParte y LEEME", () => {
    assert.equal(nombreParte(2026, 0, 3), "IPCT-2026-copia-parte-1-de-3.zip");
    const t = textoLeeme({ anio: 2026, partes: 3, archivos: 120, bytes: 52428800, fecha: new Date(2027, 0, 20) });
    assert.match(t, /AÑO 2026/);
    assert.match(t, /120 archivo\(s\), 50\.0 MB, repartidos en 3 ZIP/);
    assert.match(t, /única copia/);
});

test("exportarAnio: ZIP por partes con datos, informes y manifiesto; solo los pendientes", async () => {
    const a = await fila("a1111111", "PEREZ ANA", "pdf de ana");
    const b = await fila("b2222222", "MORA LUIS", "pdf de luis largo largo");
    const ya = await fila("c3333333", "MORA LUIS", "ya archivado", { archivado_en: "2026-12-01" });
    const sb = crearSbFalso({ rpcs: { datos_anio: () => ({ anio: 2026, evidencias: [1] }), archivos_anio: () => [a, b, ya] } });
    sb.contenidos.set(a.ruta, blob("pdf de ana")); sb.contenidos.set(b.ruta, blob("pdf de luis largo largo"));
    const z = zipFalso(), entregados = [], progreso = [];
    const r = await exportarAnio(sb, CFG, 2026, { crearZip: z.crear, entregar: async (n, bl) => entregados.push(n), onProgreso: p => progreso.push(p.texto),
        extras: [{ ruta: "informes/ranking.csv", contenido: "a,b" }], maxParte: a.tamano + 1, fecha: new Date(2027, 0, 20) });
    assert.equal(r.completo, true);
    assert.equal(r.partes, 2);
    assert.equal(r.archivos, 2);
    assert.deepEqual(entregados, ["IPCT-2026-copia-parte-1-de-2.zip", "IPCT-2026-copia-parte-2-de-2.zip"]);
    const p1 = [...z.partes[0].entradas.keys()], p2 = [...z.partes[1].entradas.keys()];
    assert.ok(p1.includes("datos-2026.json") && p1.includes("LEEME.txt") && p1.includes("informes/ranking.csv") && p1.includes("manifiesto-parte-1.csv"));
    assert.ok(p1.some(x => x.startsWith("archivos/PEREZ ANA/")));
    assert.ok(p2.some(x => x.startsWith("archivos/MORA LUIS/")) && !p2.includes("datos-2026.json"), "los datos solo van en la parte 1");
    assert.ok(!p1.concat(p2).some(x => x.includes("c3333333")), "el ya archivado no se vuelve a pedir");
    assert.match(z.partes[0].entradas.get("manifiesto-parte-1.csv"), /verificada/);
    assert.match(z.partes[0].entradas.get("manifiesto-parte-1.csv"), /ruta_original/);
    assert.deepEqual(JSON.parse(z.partes[0].entradas.get("datos-2026.json")), { anio: 2026, evidencias: [1] });
    assert.ok(progreso.some(t => /Descargando/.test(t)) && progreso.some(t => /Armando/.test(t)));
    assert.equal(sb.llamadas.filter(l => l === "storage.download").length, 2);
});

test("exportarAnio: un archivo que falta o no coincide impide dar la copia por completa", async () => {
    const a = await fila("a1111111", "PEREZ ANA", "pdf de ana");
    const b = await fila("b2222222", "MORA LUIS", "pdf de luis");
    const c = await fila("c3333333", "MORA LUIS", "pdf tres");
    const sb = crearSbFalso({ rpcs: { datos_anio: () => ({}), archivos_anio: () => [a, b, c] } });
    sb.contenidos.set(a.ruta, blob("pdf de ana"));
    sb.contenidos.set(b.ruta, blob("pdf de luiX"));          // mismo tamaño, contenido distinto
    // c no está en el almacenamiento
    const z = zipFalso();
    const r = await exportarAnio(sb, CFG, 2026, { crearZip: z.crear, entregar: async () => {} });
    assert.equal(r.completo, false);
    assert.equal(r.archivos, 1);
    assert.deepEqual(r.fallos.map(f => f.archivo.archivo_id).sort(), ["b2222222", "c3333333"]);
    assert.match(r.fallos.find(f => f.archivo.archivo_id === "b2222222").motivo, /SHA-256/);
    assert.match(r.fallos.find(f => f.archivo.archivo_id === "c3333333").motivo, /descargar/);
    // Lo que no se verificó no entra al ZIP
    assert.ok(![...z.partes[0].entradas.keys()].some(x => x.includes("b2222222") || x.includes("c3333333")));
});

test("exportarAnio: un año sin archivos igual entrega los datos; los errores de la base de datos se propagan", async () => {
    const sb = crearSbFalso({ rpcs: { datos_anio: () => ({ anio: 2025 }), archivos_anio: () => [] } });
    const z = zipFalso();
    const r = await exportarAnio(sb, CFG, 2025, { crearZip: z.crear, entregar: async () => {} });
    assert.deepEqual([r.completo, r.partes, r.archivos], [true, 1, 0]);
    assert.ok(z.partes[0].entradas.has("datos-2025.json"));
    const mal = crearSbFalso({ fallos: { "rpc.datos_anio": { code: "42501", message: "Solo el superadmin" } }, rpcs: { archivos_anio: () => [] } });
    await assert.rejects(exportarAnio(mal, CFG, 2025, { crearZip: z.crear, entregar: async () => {} }), e => e.code === "42501");
});

test("liberarEspacio: borra por lotes y marca solo lo que realmente se borró", async () => {
    const marcados = [];
    const sb = crearSbFalso({ rpcs: { marcar_archivados: a => { marcados.push(...a.p_ids); return a.p_ids.length; } } });
    const lista = ["a", "b", "c", "d", "e"].map(id => ({ archivo_id: id, ruta: `r/${id}.pdf` }));
    for (const f of lista) sb.objetos.add(f.ruta);
    sb.objetos.delete("r/c.pdf");                               // ya no estaba (o un permiso lo impidió)
    const progreso = [];
    const r = await liberarEspacio(sb, CFG, lista, { lote: 2, onProgreso: p => progreso.push(p.actual) });
    assert.equal(r.borrados, 4);
    assert.deepEqual(r.noBorrados.map(f => f.archivo_id), ["c"]);
    assert.deepEqual(marcados.sort(), ["a", "b", "d", "e"]);
    assert.equal(sb.llamadas.filter(l => l === "storage.remove").length, 3);
    assert.deepEqual(progreso, [0, 2, 4]);
    assert.equal(sb.objetos.size, 0);
});

test("liberarEspacio: un error de almacenamiento detiene el proceso sin marcar nada de ese lote", async () => {
    const marcados = [];
    const sb = crearSbFalso({ fallos: { "storage.remove": { message: "sin permiso" } }, rpcs: { marcar_archivados: a => marcados.push(a) } });
    await assert.rejects(liberarEspacio(sb, CFG, [{ archivo_id: "a", ruta: "r/a.pdf" }]), e => /sin permiso/.test(e.message));
    assert.deepEqual(marcados, []);
    const mal = crearSbFalso({ fallos: { "rpc.marcar_archivados": { code: "23514", message: "Solo se pueden archivar archivos de años cerrados" } } });
    mal.objetos.add("r/a.pdf");
    await assert.rejects(liberarEspacio(mal, CFG, [{ archivo_id: "a", ruta: "r/a.pdf" }]), e => e.code === "23514");
});

test("resumenAnio: pendientes, archivados y peso", () => {
    assert.deepEqual(resumenAnio([{ tamano: 100, archivado_en: null }, { tamano: 50, archivado_en: "2026-01-01" }, { tamano: 25, archivado_en: null }]),
        { total: 3, pendientes: 2, archivados: 1, bytes: 125 });
});
