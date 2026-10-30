/* Pruebas de js/catalogo.js y js/evidencias.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { agruparCatalogo, resumenEvidencia, normalizarDatos, esPdf, validarArchivo, sha256Hex, mensajeError, enlaceDe, puedeCargar, ROLES_LECTURA, ROLES_VALIDA, ROLES_CARGA,
         archivosDe, archivosFaltantes, camposVisibles, verificacionFaltante, tiposReclasificables, agruparCoautorias, diferenciaCoautores,
         tipoDeArchivo, validarAdjunto, textoPeriodo }
    from "../../../js/catalogo.js";
import { crearEvidencia, actualizarEvidencia, eliminarEvidencia, listarMias, cargarAnioInicio,
         cargarUsuarios, listarPorAnio, historialDe, evidenciasConMismaHuella, resolverEvidencia,
         subirAdjunto, quitarAdjunto, buscarDocentes, cargarCoautorias, estadoPeriodo, fijarPeriodo, aniosVisibles }
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
    const ev = await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: { titulo: "T" }, archivos: { principal: pdf() } });
    assert.deepEqual(sb.llamadas, ["evidencias.insert", "storage.upload", "archivos.insert"]);
    const ruta = sb.tablas.archivos[0].ruta;
    assert.match(ruta, new RegExp(`^${USUARIO}/${ev.id}/[0-9a-f-]{36}\\.pdf$`));
    assert.ok(sb.objetos.has(ruta));
    assert.equal(sb.tablas.archivos[0].nombre, "cert.pdf");
    assert.equal(sb.tablas.archivos[0].sha256.length, 64);
    assert.equal(sb.tablas.archivos[0].rol, "principal");
    assert.equal(sb.tablas.archivos[0].origen, "docente");
});

test("crearEvidencia: duplicado no sube ningún archivo", async () => {
    const sb = crearSbFalso({ fallos: { "evidencias.insert": { code: "23505", message: "dup" } } });
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivos: { principal: pdf() } }),
        e => e.code === "23505");
    assert.deepEqual(sb.llamadas, ["evidencias.insert"]);
});

test("crearEvidencia: si falla la subida, deshace la evidencia", async () => {
    const sb = crearSbFalso({ fallos: { "storage.upload": { message: "boom" } } });
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivos: { principal: pdf() } }));
    assert.equal(sb.tablas.evidencias.length, 0);
});

test("crearEvidencia: si falla el registro del archivo, deshace evidencia y PDF", async () => {
    const sb = crearSbFalso({ fallos: { "archivos.insert": { message: "boom" } } });
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivos: { principal: pdf() } }));
    assert.equal(sb.tablas.evidencias.length, 0);
    assert.equal(sb.objetos.size, 0);
});

test("actualizarEvidencia: primero los datos; con archivo nuevo reemplaza y borra el anterior", async () => {
    const sb = crearSbFalso();
    const ev = await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: { titulo: "A" }, archivos: { principal: pdf("viejo.pdf") } });
    const previo = { ...sb.tablas.archivos[0] };
    sb.llamadas.length = 0;
    sb.tablas.evidencias[0].estado = "observada";
    await actualizarEvidencia(sb, CFG, {
        evidencia: { ...ev, docente_id: USUARIO, archivos: [{ ...previo }] },
        anio: 2026, datos: { titulo: "B" }, archivos: { principal: pdf("nuevo.pdf") },
    });
    assert.deepEqual(sb.llamadas, ["evidencias.update", "storage.upload", "archivos.update", "storage.remove"]);
    assert.equal(sb.tablas.evidencias[0].estado, "pendiente");
    assert.equal(sb.tablas.archivos[0].nombre, "nuevo.pdf");
    assert.ok(!sb.objetos.has(previo.ruta));
});

test("actualizarEvidencia: un archivo de una función nueva se agrega sin borrar los demás", async () => {
    const sb = crearSbFalso();
    const ev = await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "lib_inv", anio: 2026, datos: {}, archivos: { principal: pdf("libro.pdf") } });
    sb.llamadas.length = 0;
    await actualizarEvidencia(sb, CFG, { evidencia: { ...ev, docente_id: USUARIO, archivos: [{ ...sb.tablas.archivos[0] }] },
        anio: 2026, datos: {}, archivos: { aval: pdf("aval.pdf") } });
    assert.deepEqual(sb.llamadas, ["evidencias.update", "storage.upload", "archivos.insert"]);
    assert.deepEqual(sb.tablas.archivos.map(a => a.rol).sort(), ["aval", "principal"]);
});

test("actualizarEvidencia: sin filas (validada) da error y no toca el archivo", async () => {
    const sb = crearSbFalso();
    await assert.rejects(actualizarEvidencia(sb, CFG, { evidencia: { id: "no-existe" }, anio: 2026, datos: {}, archivos: { principal: pdf() } }),
        e => e.code === "PGRST116");
    assert.deepEqual(sb.llamadas, ["evidencias.update"]);
});

test("eliminarEvidencia: borra los archivos propios antes que la fila", async () => {
    const sb = crearSbFalso();
    const ev = await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivos: { principal: pdf() } });
    sb.llamadas.length = 0;
    await eliminarEvidencia(sb, CFG, { ...ev, archivos: [{ ruta: sb.tablas.archivos[0].ruta, origen: "docente" }] });
    assert.deepEqual(sb.llamadas, ["storage.remove", "evidencias.delete"]);
    assert.equal(sb.tablas.evidencias.length, 0);
});

test("eliminarEvidencia: retirarse de una coautoría no toca los archivos del titular", async () => {
    const sb = crearSbFalso({ tablas: { evidencias: [{ id: "c", titular_id: "t" }] } });
    await eliminarEvidencia(sb, CFG, { id: "c", titular_id: "t", archivos: [{ ruta: "del-titular.pdf", origen: "docente" }] });
    assert.deepEqual(sb.llamadas, ["evidencias.delete"]);
});

test("listarMias devuelve la lista de archivos; en una coautoría, los del titular", async () => {
    const sb = crearSbFalso({ tablas: {
        evidencias: [
            { id: "1", docente_id: USUARIO, anio: 2026, tipos_evidencia: { nombre: "Q1" }, archivos: [{ ruta: "r" }, { ruta: "r2" }] },
            { id: "2", docente_id: USUARIO, anio: 2026, titular_id: "9", tipos_evidencia: { nombre: "Q2" }, archivos: [] },
        ],
        archivos: [{ evidencia_id: "9", ruta: "del-titular" }, { evidencia_id: "8", ruta: "otro" }] } });
    const l = await listarMias(sb, USUARIO, 2026);
    assert.deepEqual(l[0].archivos.map(a => a.ruta), ["r", "r2"]);
    assert.deepEqual(l[1].archivos.map(a => a.ruta), ["del-titular"]);
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

test("listarPorAnio incluye tipo y archivos; evidencias de otros años no", async () => {
    const sb = crearSbFalso({ tablas: {
        tipos_evidencia: [{ id: "q1", nombre: "Q1", puntos: 6 }],
        archivos: [{ evidencia_id: "1", ruta: "r", sha256: "h" }],
        evidencias: [{ id: "1", tipo_id: "q1", anio: 2026 }, { id: "2", tipo_id: "q1", anio: 2025 }] } });
    const l = await listarPorAnio(sb, 2026);
    assert.equal(l.length, 1);
    assert.equal(l[0].tipo.puntos, 6);
    assert.equal(l[0].archivos.length, 1);
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

// ---------- Etapa 5b: archivos por tipo, coautores, adjuntos y cierre de carga ----------
const png = (nombre = "captura.png") => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])], nombre, { type: "image/png" });
const TIPO_LIBRO = { esquema: { archivos: [
    { rol: "principal", etiqueta: "Libro", quien: "docente", obligatorio: true },
    { rol: "pares", etiqueta: "Pares", quien: "docente", obligatorio: true },
    { rol: "aval", etiqueta: "Aval", quien: "docente", obligatorio: false },
    { rol: "soporte", etiqueta: "Soporte", quien: "validador", obligatorio: true }] } };

test("archivosDe y archivosFaltantes: por origen, con valor por defecto para tipos antiguos", () => {
    assert.deepEqual(archivosDe(TIPO_LIBRO, "docente").map(a => a.rol), ["principal", "pares", "aval"]);
    assert.deepEqual(archivosDe(TIPO_LIBRO, "validador").map(a => a.rol), ["soporte"]);
    assert.deepEqual(archivosDe({ esquema: {} }, "docente").map(a => a.rol), ["principal"]);
    assert.deepEqual(archivosDe({ esquema: {} }, "validador"), []);
    const subidos = [{ rol: "principal", origen: "docente" }];
    assert.deepEqual(archivosFaltantes(TIPO_LIBRO, subidos, "docente").map(a => a.rol), ["pares"]);
    assert.deepEqual(archivosFaltantes(TIPO_LIBRO, subidos, "validador").map(a => a.rol), ["soporte"]);
    // Un archivo de la responsable no cubre uno del docente aunque tenga el mismo rol
    assert.deepEqual(archivosFaltantes(TIPO_LIBRO, [{ rol: "soporte", origen: "docente" }], "validador").map(a => a.rol), ["soporte"]);
});

test("camposVisibles: «mostrar_si» solo aparece con los valores indicados", () => {
    const campos = [{ nombre: "resultado_de" },
        { nombre: "proyecto", mostrar_si: { campo: "resultado_de", en: ["Proyecto de investigación", "Proyecto de vinculación"] } }];
    assert.deepEqual(camposVisibles(campos, { resultado_de: "Ninguno" }).map(c => c.nombre), ["resultado_de"]);
    assert.deepEqual(camposVisibles(campos, {}).map(c => c.nombre), ["resultado_de"]);
    assert.deepEqual(camposVisibles(campos, { resultado_de: "Proyecto de vinculación" }).map(c => c.nombre), ["resultado_de", "proyecto"]);
});

test("verificacionFaltante y tiposReclasificables", () => {
    const tipo = { esquema: { verificacion: [{ id: "a", texto: "Uno" }, { id: "b", texto: "Dos" }] } };
    assert.deepEqual(verificacionFaltante(tipo, ["a"]), ["Dos"]);
    assert.deepEqual(verificacionFaltante(tipo, ["a", "b"]), []);
    assert.deepEqual(verificacionFaltante({ esquema: {} }, []), []);
    const cat = [{ id: "q1", grupo_dedup: "articulo" }, { id: "q2", grupo_dedup: "articulo" }, { id: "pe", grupo_dedup: "proy" }];
    assert.deepEqual(tiposReclasificables(cat[0], cat).map(t => t.id), ["q2"]);
});

test("agruparCoautorias pone al titular primero y ordena por posición", () => {
    const g = agruparCoautorias([
        { grupo_id: "g", nombre: "C", es_titular: false, posicion: 3 },
        { grupo_id: "g", nombre: "B", es_titular: false, posicion: 2 },
        { grupo_id: "g", nombre: "A", es_titular: true, posicion: 1 },
        { grupo_id: "h", nombre: "Z", es_titular: true, posicion: 1 }]);
    assert.deepEqual(g.g.map(m => m.nombre), ["A", "B", "C"]);
    assert.equal(g.h.length, 1);
    assert.deepEqual(agruparCoautorias(null), {});
});

test("diferenciaCoautores: agregar, quitar y actualizar", () => {
    const actuales = [{ docente_id: "a", posicion: 2, participacion: "Coautor" }, { docente_id: "b", posicion: 3, participacion: "Coautor" }];
    const nuevos = [{ docente_id: "a", posicion: 4, participacion: "Coautor" }, { docente_id: "c", posicion: 5, participacion: "Coautor" }];
    const d = diferenciaCoautores(actuales, nuevos);
    assert.deepEqual(d.agregar.map(x => x.docente_id), ["c"]);
    assert.deepEqual(d.quitar.map(x => x.docente_id), ["b"]);
    assert.deepEqual(d.actualizar.map(x => x.docente_id), ["a"]);
    assert.deepEqual(diferenciaCoautores(actuales, actuales), { agregar: [], quitar: [], actualizar: [] });
});

test("tipoDeArchivo y validarAdjunto: PDF o imagen por su cabecera, no por la extensión", async () => {
    assert.equal(await tipoDeArchivo(pdf()), "pdf");
    assert.equal(await tipoDeArchivo(png()), "png");
    assert.equal(await tipoDeArchivo(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "a.jpg")), "jpg");
    assert.equal(await tipoDeArchivo(new File(["RIFF....WEBPxxxx"], "a.webp")), "webp");
    assert.equal(await tipoDeArchivo(new File(["MZ ejecutable"], "captura.png")), null);
    assert.equal(await validarAdjunto(png(), 1000), null);
    assert.equal(await validarAdjunto(pdf(), 1000), null);
    assert.match(await validarAdjunto(new File(["MZ ejecutable"], "captura.png"), 1000), /PDF o una imagen/);
    assert.match(await validarAdjunto(png(), 5), /máximo/);
    assert.match(await validarAdjunto(null, 5), /Seleccione/);
});

test("textoPeriodo: cerrado, con fecha de cierre y abierto sin fecha", () => {
    assert.match(textoPeriodo({ abierto: false }, 2026), /cerrada.*validación continúa/);
    assert.match(textoPeriodo({ abierto: true, cierra_el: "2027-01-15" }, 2026), /se cierra el 15 de enero de 2027/);
    assert.equal(textoPeriodo({ abierto: true, cierra_el: null }, 2026), null);
});

test("crearEvidencia con varios archivos: sube y registra uno por función", async () => {
    const sb = crearSbFalso();
    await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "lib_inv", anio: 2026, datos: {},
        archivos: { principal: pdf("libro.pdf"), pares: pdf("pares.pdf"), aval: pdf("aval.pdf") } });
    assert.deepEqual(sb.llamadas, ["evidencias.insert", "storage.upload", "archivos.insert", "storage.upload", "archivos.insert", "storage.upload", "archivos.insert"]);
    assert.deepEqual(sb.tablas.archivos.map(a => a.rol), ["principal", "pares", "aval"]);
    assert.ok(sb.tablas.archivos.every(a => a.origen === "docente" && a.ruta.endsWith(".pdf")));
});

test("crearEvidencia: si falla el segundo archivo, quita el primero y deshace la evidencia", async () => {
    const sb = crearSbFalso();
    const original = sb.storage.from;
    let n = 0;
    sb.storage.from = () => { const b = original(); const up = b.upload; b.upload = async (...a) => (++n === 2 ? { data: null, error: { message: "boom" } } : up(...a)); return b; };
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "lib_inv", anio: 2026, datos: {},
        archivos: { principal: pdf("libro.pdf"), pares: pdf("pares.pdf") } }));
    assert.equal(sb.tablas.evidencias.length, 0);
    assert.equal(sb.objetos.size, 0);
});

test("crearEvidencia con coautores: envía la autoría y llama a agregar_coautor", async () => {
    const llamadas = [];
    const sb = crearSbFalso({ rpcs: { agregar_coautor: a => { llamadas.push(a); return "id"; } } });
    await crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, autoria: { posicion: 1, participacion: "Autor" },
        archivos: { principal: pdf() }, coautores: [{ docente_id: "d2", posicion: 2, participacion: "Coautor" }] });
    assert.deepEqual(sb.tablas.evidencias[0].autoria, { posicion: 1, participacion: "Autor" });
    assert.equal(llamadas.length, 1);
    assert.deepEqual([llamadas[0].p_docente, llamadas[0].p_posicion, llamadas[0].p_participacion], ["d2", 2, "Coautor"]);
});

test("crearEvidencia: si falla un coautor, la evidencia queda guardada y el error lo indica", async () => {
    const sb = crearSbFalso({ fallos: { "rpc.agregar_coautor": { code: "23514", message: "Esa persona ya registró esta publicación" } } });
    await assert.rejects(crearEvidencia(sb, CFG, { perfilId: USUARIO, tipoId: "q1", anio: 2026, datos: {}, archivos: { principal: pdf() },
        coautores: [{ docente_id: "d2", posicion: 2 }] }),
        e => e.creada === true && /coautores/.test(e.parcial) && mensajeError(e) === "Esa persona ya registró esta publicación");
    assert.equal(sb.tablas.evidencias.length, 1);
});

test("actualizarEvidencia sincroniza coautores: quita, agrega y actualiza", async () => {
    const ops = [];
    const rpcs = { quitar_coautor: a => ops.push(["quitar", a.p_docente]), agregar_coautor: a => ops.push(["agregar", a.p_docente]),
                   actualizar_autoria: a => ops.push(["actualizar", a.p_docente, a.p_posicion]) };
    const sb = crearSbFalso({ rpcs, tablas: { evidencias: [{ id: "e1", docente_id: USUARIO }] } });
    await actualizarEvidencia(sb, CFG, {
        evidencia: { id: "e1", docente_id: USUARIO, archivos: [], coautores: [
            { docente_id: "a", posicion: 2, participacion: "Coautor" }, { docente_id: "b", posicion: 3, participacion: "Coautor" }] },
        anio: 2026, datos: {}, coautores: [
            { docente_id: "a", posicion: 4, participacion: "Coautor" }, { docente_id: "c", posicion: 5, participacion: "Coautor" }] });
    assert.deepEqual(ops, [["quitar", "b"], ["agregar", "c"], ["actualizar", "a", 4]]);
});

test("subirAdjunto (responsable): ruta del docente, imagen permitida, origen validador; quitarAdjunto lo borra", async () => {
    const sb = crearSbFalso();
    const fila = await subirAdjunto(sb, CFG, { evidencia: { id: "e1", docente_id: "d1" }, rol: "indexacion", archivo: png() });
    assert.match(fila.ruta, /^d1\/e1\/[0-9a-f-]{36}\.png$/);
    assert.equal(fila.origen, "validador");
    assert.equal(fila.rol, "indexacion");
    assert.ok(sb.objetos.has(fila.ruta));
    await quitarAdjunto(sb, CFG, fila);
    assert.equal(sb.tablas.archivos.length, 0);
    assert.ok(!sb.objetos.has(fila.ruta));
});

test("subirAdjunto: si falla el registro, no deja el archivo huérfano", async () => {
    const sb = crearSbFalso({ fallos: { "archivos.insert": { code: "42501", message: "row-level security" } } });
    await assert.rejects(subirAdjunto(sb, CFG, { evidencia: { id: "e1", docente_id: "d1" }, rol: "x", archivo: png() }));
    assert.equal(sb.objetos.size, 0);
});

test("resolverEvidencia guarda también los datos de la Comisión, la lista de verificación y el tipo", async () => {
    const sb = crearSbFalso({ tablas: { evidencias: [{ id: "1", estado: "pendiente", tipo_id: "q3" }] } });
    await resolverEvidencia(sb, "1", "validada", "", { tipoId: "q1", datosValidacion: { cuartil: "Q1" }, verificacion: ["a", "b"] });
    assert.deepEqual([sb.tablas.evidencias[0].tipo_id, sb.tablas.evidencias[0].datos_validacion, sb.tablas.evidencias[0].verificacion],
        ["q1", { cuartil: "Q1" }, ["a", "b"]]);
    await resolverEvidencia(sb, "1", "observada", "x");
    assert.equal(sb.tablas.evidencias[0].tipo_id, "q1");          // sin «extra» no toca esos campos
    assert.deepEqual(sb.tablas.evidencias[0].verificacion, ["a", "b"]);
});

test("coautores, docentes y cierre de carga: llamadas a las funciones de la base", async () => {
    const guardado = [];
    const sb = crearSbFalso({ rpcs: {
        buscar_docentes: () => [{ id: "d2", nombre: "Ana" }],
        coautorias: a => [{ grupo_id: "g", anio: a.p_anio }],
        estado_periodo: a => [{ anio: a.p_anio, abierto: false, cierra_el: null, cierre_manual: true }],
        fijar_periodo: a => guardado.push(a) } });
    assert.equal((await buscarDocentes(sb))[0].nombre, "Ana");
    assert.equal((await cargarCoautorias(sb, 2026))[0].anio, 2026);
    assert.equal((await estadoPeriodo(sb, 2026)).abierto, false);
    await fijarPeriodo(sb, 2026, true, "2027-01-15");
    assert.deepEqual(guardado, [{ p_anio: 2026, p_abierto: true, p_cierra_el: "2027-01-15" }]);
    // Sin fila devuelta, el año se considera no habilitado
    const vacio = await estadoPeriodo(crearSbFalso({ rpcs: { estado_periodo: () => [] } }), 2027);
    assert.deepEqual([vacio.abierto, vacio.configurado], [false, false]);
});

test("aniosVisibles devuelve los años habilitados; textoPeriodo avisa si un año no está habilitado", async () => {
    const sb = crearSbFalso({ rpcs: { periodos_visibles: () => [{ anio: 2027, abierto: false }, { anio: 2026, abierto: true }] } });
    assert.deepEqual((await aniosVisibles(sb)).map(a => a.anio), [2027, 2026]);
    assert.deepEqual(await aniosVisibles(crearSbFalso({ rpcs: { periodos_visibles: () => null } })), []);
    assert.match(textoPeriodo({ abierto: false, configurado: false }, 2028), /aún no está habilitado/);
    assert.match(textoPeriodo({ abierto: false, configurado: true }, 2026), /cerrada/);
});
