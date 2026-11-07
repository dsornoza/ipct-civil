/* Pruebas de js/aval.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { obraDe, llevaAval, firmantesPropuestos, leerMiembros, datosAval, textoAval, fraseFecha, nombreArchivoAval } from "../../../js/aval.js";

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
