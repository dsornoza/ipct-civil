/* Pruebas de js/aval.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { obraDe, llevaAval, firmantesPropuestos, leerMiembros, datosAval, miembrosDelPeriodo, periodoDe, etiquetaPeriodo, claveMiembros, textoAval, fraseFecha, nombreArchivoAval } from "../../../js/aval.js";

const USUARIOS = [{ id: "m1", nombre: "Ing. Uno, MSc.", activo: true }, { id: "m2", nombre: "Ing. Dos, MSc.", activo: true },
                  { id: "m3", nombre: "Ing. Tres, MSc.", activo: true }, { id: "m4", nombre: "Ing. Cuatro, MSc.", activo: false }];

test("el aval solo aplica a obras validadas que derivan de un proyecto", () => {
    const base = { estado: "validada", datos: { deriva_proyecto: "Sí" } };
    assert.equal(llevaAval(base), true);
    assert.equal(llevaAval({ ...base, estado: "pendiente" }), false);
    assert.equal(llevaAval({ ...base, datos: { deriva_proyecto: "No" } }), false);
    assert.equal(llevaAval({ ...base, titular_id: "x" }), false);   // coautoría: el aval va con la del titular
    assert.equal(llevaAval(null), false);
});

test("cada tipo de obra usa su propio texto", () => {
    assert.equal(obraDe({ id: "q3", grupo_dedup: "articulo" }).obj, "artículo");
    assert.equal(obraDe({ id: "lib_inv", grupo_dedup: "libro" }).obj, "libro");
    assert.equal(obraDe({ id: "capitulo", grupo_dedup: "capitulo" }).obj, "capítulo de libro");
    assert.equal(obraDe({ id: "x", grupo_dedup: "ponencia" }).art, "la");
    assert.equal(obraDe({ id: "software", grupo_dedup: "software" }).obj, "registro de propiedad intelectual");
    assert.equal(obraDe({ id: "pat", grupo_dedup: "patente" }).obj, "registro de propiedad intelectual");
});

test("quien es autor de la obra no firma y se avisa", () => {
    const r = firmantesPropuestos(["m1", "m2", "m3", "m4", "no-existe"], ["m2"], USUARIOS);
    assert.deepEqual(r.propuestos.map(u => u.id), ["m1", "m3"]);
    assert.deepEqual(r.excluidos.map(u => u.id), ["m2"]);
});

test("miembros guardados: JSON inválido o con otros tipos no rompe", () => {
    assert.deepEqual(leerMiembros('["a","b"]'), ["a", "b"]);
    assert.deepEqual(leerMiembros("basura"), []);
    assert.deepEqual(leerMiembros('{"a":1}'), []);
    assert.deepEqual(leerMiembros(null), []);
});

test("textos del aval", () => {
    const e = { anio: 2026, datos: { titulo: "Estudio de puentes", deriva_proyecto: "Sí", tipo_proyecto: "Vinculación", proyecto_titulo: "Puentes seguros" } };
    const a = datosAval(e, { id: "x", grupo_dedup: "ponencia" }, [{ nombre: "B Autor", posicion: 2 }, { nombre: "A Autor", posicion: 1 }], [USUARIOS[0]], new Date(2026, 10, 7));
    assert.deepEqual(a.autores, ["A Autor", "B Autor"]);
    assert.deepEqual(a.firmantes, [{ nombre: "Ing. Uno, MSc.", cargo: "Revisor" }]);
    const b = datosAval(e, { id: "x" }, [], [{ nombre: "Resp", cargo: "Responsable de la Comisión" }, "Rev"], new Date(2026, 0, 2));
    assert.deepEqual(b.firmantes.map(f => f.cargo), ["Responsable de la Comisión", "Revisor"]);
    const t = textoAval(a);
    assert.match(t.intro, /siguiente ponencia:$/);
    assert.match(t.certifica, /la ponencia antes mencionada ES resultado/);
    assert.match(t.alcance, /relación de la ponencia con el proyecto/);
    assert.equal(t.obra, "“Estudio de puentes”");
    assert.match(t.emision, /Jipijapa, a los 7 días del mes de noviembre de 2026\.$/);
    const libro = textoAval(datosAval(e, { id: "lib_inv" }, [], [], new Date(2026, 0, 1)));
    assert.match(libro.alcance, /relación del libro/);
    assert.match(libro.emision, /al primer día del mes de enero de 2026/);
    assert.equal(fraseFecha(new Date(2026, 11, 31)), "a los 31 días del mes de diciembre de 2026");
    assert.equal(nombreArchivoAval(a, 2026), "AVAL-PONENCIA-2026-A-AUTOR.pdf");
});

test("los períodos académicos son abril–septiembre y noviembre–marzo", () => {
    assert.equal(periodoDe(new Date(2026, 3, 1)), "2026-A");     // abril
    assert.equal(periodoDe(new Date(2026, 8, 30)), "2026-A");    // septiembre
    assert.equal(periodoDe(new Date(2026, 9, 15)), "2026-B");    // octubre: pasa al período que empieza en noviembre
    assert.equal(periodoDe(new Date(2026, 10, 7)), "2026-B");    // noviembre
    assert.equal(periodoDe(new Date(2026, 11, 31)), "2026-B");
    assert.equal(periodoDe(new Date(2027, 0, 5)), "2026-B");     // enero pertenece al período iniciado en noviembre
    assert.equal(periodoDe(new Date(2027, 2, 31)), "2026-B");    // marzo
    assert.equal(etiquetaPeriodo("2026-A"), "abril–septiembre 2026");
    assert.equal(etiquetaPeriodo("2026-B"), "noviembre 2026 – marzo 2027");
});

test("los miembros de la Comisión se definen por período y se hereda el anterior", () => {
    const aj = [{ clave: "comision_miembros_2025-B", valor: '["a","b"]' }, { clave: "comision_miembros_2026-B", valor: '["c"]' }, { clave: "comision_miembros", valor: '["viejo"]' }];
    assert.deepEqual(miembrosDelPeriodo(aj, "2025-B"), ["a", "b"]);
    assert.deepEqual(miembrosDelPeriodo(aj, "2026-A"), ["a", "b"]);   // sin lista propia: la del período anterior
    assert.deepEqual(miembrosDelPeriodo(aj, "2026-B"), ["c"]);
    assert.deepEqual(miembrosDelPeriodo(aj, "2028-A"), ["c"]);
    assert.deepEqual(miembrosDelPeriodo(aj, "2025-A"), ["viejo"]);    // antes de la primera lista: la general antigua
    assert.deepEqual(miembrosDelPeriodo([], "2026-A"), []);
    assert.equal(claveMiembros("2026-A"), "comision_miembros_2026-A");
});
