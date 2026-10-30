# Sistema del IPCT · Ingeniería Civil UNESUM

Sistema piloto para que los docentes de la Carrera de Ingeniería Civil (UNESUM) carguen evidencias de sus actividades del **IPCT** (Índice de Producción Científica y Tecnológica), una responsable las valide y el sistema calcule el índice, el nivel y un ranking solo con evidencia validada.

Normativa: *Reforma del Instructivo para el reconocimiento y estímulo al personal académico y estudiantes con actividades de I+D+i y vinculación* (UNESUM, OCS, 4 de marzo de 2022, SE Nº ROCS-05-Nº-12-2022).

URL de piloto: <https://dsornoza.github.io/ipct-civil/>

> **Estado:** etapa 6 de 7 (informes, gestión de personas, respaldo y almacenamiento, sobre las evidencias por tipo, la coautoría y los años habilitados). Las secciones marcadas con **[etapa N]** se completan al avanzar el proyecto.

## 1. Arquitectura

```
Navegador (HTML + JS estático, sin paso de build)
   │  supabase-js (CDN, versión fijada)
   ▼
Supabase (plan gratuito)
   ├─ Auth ........ inicio de sesión con Google
   ├─ Postgres .... datos + RLS + funciones SQL (cálculo del IPCT)
   └─ Storage ..... bucket privado «evidencias» (PDF ≤ 5 MB, URLs firmadas)
```

- **Sitio:** archivos estáticos publicados con GitHub Pages desde `main`. Todas las rutas son relativas; puede alojarse en cualquier carpeta de cualquier servidor.
- **Seguridad:** toda la autorización está en la base de datos (políticas RLS y de Storage). La interfaz solo refleja permisos. El repositorio es público y contiene únicamente la clave `anon` (pública por diseño); **nunca** se sube la clave `service_role`.
- **Única fuente de verdad del cálculo:** las funciones SQL de `supabase/migrations/0003_calculo_ipct.sql`. El IPCT, el nivel y el ranking nunca se calculan en el navegador.

### Estructura del repositorio

| Ruta | Contenido |
|---|---|
| `config.js` | **Único** archivo con configuración dependiente del entorno |
| `index.html`, `docente.html`, `validacion.html`, `ranking.html`, `informes.html`, `gestion.html`, `css/`, `assets/` | Páginas y logos de la Comisión de Investigación |
| `js/cliente.js`, `js/comun.js`, `js/ui.js` | Cliente de Supabase, sesión, menú por rol y utilidades de interfaz |
| `js/catalogo.js`, `js/evidencias.js`, `js/puntaje.js` | Lógica del catálogo, validación de PDF, evidencias, puntaje y ranking (sin DOM; se prueban con Node) |
| `js/pdf.js` | Reporte PDF (jsPDF 2.5.1 y autotable 3.5.31 desde cdnjs con SRI; se cargan solo al pedir el PDF) |
| `js/index.js`, `js/docente.js`, `js/validacion.js`, `js/ranking.js`, `js/informes_pagina.js`, `js/gestion.js` | Inicio de sesión, «Mis evidencias», validación, ranking, informes y gestión |
| `js/archivo_anio.js`, `js/zip.js` | Copia ZIP verificada de un año y liberación de espacio (JSZip 3.10.1 desde cdnjs con SRI) |
| `js/informes.js`, `js/usuarios.js`, `js/excel.js` | Matrices de investigación, estadísticas y CSV; reglas de personas e importación; generador de Excel (sin DOM salvo `excel.js`) |
| `supabase/migrations/` | Migraciones SQL numeradas (se ejecutan en orden) |
| `supabase/semilla_usuarios.sql` | Plantilla para dar de alta al primer superadmin |
| `supabase/pruebas/` | Pruebas automáticas de la lógica y de la RLS en PostgreSQL local |
| `docs/guia-supabase-google.md` | Guía paso a paso de Supabase y Google Cloud |
| `.github/workflows/` | Acción diaria que evita la pausa del proyecto gratuito |

### Modelo de datos

| Tabla | Para qué |
|---|---|
| `usuarios` | Lista blanca de correos, nombre, rol, activo y `evaluado` (false = cuenta de gestión, p. ej. la de la Comisión: no carga evidencias ni aparece en el ranking) |
| `tipos_evidencia` | Catálogo (equivale al `CONFIG` del simulador): puntos, tope por bloque, formulario (JSON) |
| `niveles` | Umbrales de nivel y estímulos (Art. 5 y 8) |
| `ajustes` | Dominio permitido, año de inicio, cuota |
| `evidencias` | Una por actividad; estado `pendiente / observada / rechazada / validada` |
| `archivos` | Varios por evidencia, cada uno con su función (`rol`) y su origen: `docente` (solo PDF) o `validador` (PDF o captura de pantalla de la Comisión) |
| `usuarios_anios` | Personas evaluadas que participan en cada año (quién puede registrar y aparece en el ranking) |
| `periodos` | Años habilitados para la carga: abierto/cerrado y fecha de cierre automático (sin fila = año no habilitado) |
| `bitacora` | Acciones de gestión (apertura y cierre de la carga) |
| `historial` | Auditoría de cada cambio de estado, edición y baja |

**Ranking y puntaje:** el ranking (`ranking.html`) lo ven todos los usuarios autorizados, nunca el público; cuenta solo evidencias validadas y se actualiza al abrirlo, con el botón «Actualizar» y cada minuto. Cada docente ve su IPCT validado, el nivel, lo que le falta para el siguiente, los topes aplicados y su evolución por año en «Mis evidencias», y puede descargar su PDF. Todo se calcula en la base de datos (`ranking`, `evolucion`, `detalle_docente`).

**Etapa 5b: lo que define cada tipo de evidencia.** El campo `esquema` de `tipos_evidencia` (migración `0010`) indica, por tipo: los `campos` que llena el docente; los datos que completa la responsable al validar (`validador`, la matriz de investigación; los campos con `mostrar_si` aparecen según otra respuesta); los `archivos` obligatorios del docente y de la responsable; la lista de `verificacion` (basada en el Modelo MECCAIIC, indicadores 20 y 22) que se marca antes de validar; si admite `coautores`. Para cambiar un formulario basta con modificar ese JSON.

- **Coautoría:** el autor registra a sus coautores (docentes evaluados del sistema) y la evidencia aparece en su cuenta sin volver a subirla. Cada docente tiene su propia fila (su puntaje y su fila en los reportes); los archivos son los del titular; la responsable valida una vez y el resultado se copia a todos. Quien figura como coautor no puede validar esa evidencia. Un coautor puede retirarse mientras no esté validada.
- **La responsable** puede reclasificar un artículo dentro de su mismo tipo (p. ej. de Q3 a Q1) y adjuntar capturas; todo queda en el historial.
- **Años habilitados:** un año nace **cerrado**. La responsable o el superadmin lo habilitan en el panel de validación («Habilitar carga») y pueden programar su cierre automático o cerrarlo a mano («Cerrar carga», «Reabrir carga»). Los docentes registran solo en los años habilitados y abiertos, y siguen viendo sus resultados de los años cerrados. Se aplica en la base de datos: nadie registra, edita ni elimina evidencias ni sube archivos de un año no habilitado o cerrado; la validación continúa. No hace falta tocar nada cada enero: se habilita el año siguiente cuando se decida (el selector del panel llega hasta el año siguiente).
- **Participantes por año:** el personal contratado entra y sale, así que cada año tiene su lista de personas evaluadas (`usuarios_anios`). Solo quien figura en un año puede registrar evidencias de ese año y aparece en su ranking. Quien se va conserva los años en que estuvo: puede terminar de cargar su último año mientras esté abierto aunque ya no trabaje en la facultad, y no puede registrar en los siguientes (tampoco lo ve). Un año recién habilitado empieza **sin participantes**: en Gestión > «Participantes por año» se copia la lista del año anterior y se desmarca a quienes ya no están. Quien ingresa mientras hay años abiertos queda en ellos. No hace falta desactivar a nadie para que deje de cargar: desactivar (`activo`) solo impide iniciar sesión, y conviene hacerlo cuando ya no tenga ningún año abierto. Un desactivado sigue apareciendo en el ranking y los informes de los años en que figuraba.
- **Usuarios:** la responsable da de alta, edita y desactiva docentes, calidad y coordinadora (cédula, facultad, carrera, `evaluado`); solo el superadmin asigna los roles de responsable y superadmin. Se hace desde la página «Gestión».

Roles: `docente`, `responsable_ipct`, `calidad`, `coordinadora`, `director_investigacion`, `superadmin`. Calidad, coordinadora y director de investigación son de **solo lectura** (ven todas las evidencias, archivos, ranking e informes y pueden descargar informes y la copia ZIP de un año, que incluye cédulas); no cargan ni modifican nada. En Gestión, junto al selector de rol, un signo «?» explica qué puede hacer cada uno.

**Acceso con vencimiento:** cada persona puede tener «acceso hasta» (fecha inclusive, opcional, editable cuando haga falta por la responsable o el superadmin). Pasada la fecha no puede ingresar, sin necesidad de desactivarla; la pantalla de acceso lo indica. Útil para revisores externos, como el Director de Investigación cuando recibe el informe.

Reglas principales (verificadas por `supabase/pruebas/`):

- Solo cuentan evidencias **validadas**. Los topes (3 proyectos externos, 3 internos, 2 de vinculación; cada grupo por separado) se aplican priorizando mayor puntaje.
- Nivel 1 ≥ 50, Nivel 2: 40–49, Nivel 3: 30–39, Nivel 4: 20–29, menos de 20 «Sin nivel».
- Una evidencia validada no la puede editar ni borrar el docente. Una observada o rechazada se corrige y vuelve a `pendiente`.
- Nadie valida sus propias evidencias: las de la responsable las valida otra persona con rol de validación (el superadmin o la cuenta de la Comisión).
- `calidad` y `coordinadora` son de solo lectura: ven las evidencias y los PDF (pantalla «Evidencias») pero no cargan ni modifican nada.
- La validación la hacen `responsable_ipct` y `superadmin`. Observar o rechazar exige comentario; validar exige PDF. Una evidencia validada puede devolverse a «Observada» si hubo un error.

## 2. Configurar Supabase y Google Cloud

Ver **[docs/guia-supabase-google.md](docs/guia-supabase-google.md)**.

## 3. Cambiar de dominio

Si el sitio pasa a otra URL (por ejemplo `https://ingenieriacivil.unesum.edu.ec/ipct/`):

1. Editar `config.js` si se cambia de proyecto de Supabase. `URL_RETORNO` se calcula sola a partir de la carpeta donde esté el sitio.
2. **Supabase** > Authentication > URL Configuration: poner la nueva URL en *Site URL* y añadirla en *Redirect URLs* (con la barra final).
3. **Google Cloud**: la *URI de redirección autorizada* es la de Supabase (`https://<ref>.supabase.co/auth/v1/callback`) y **no cambia** al mover el sitio. Solo habría que tocar Google si cambia el proyecto de Supabase.
4. Actualizar `Settings > Variables` de GitHub si el repositorio también cambia.

## 4. Administrar usuarios

Desde la página **Gestión** (responsable del IPCT y superadmin):

- **Alta, edición y baja** de personas: correo institucional (no se cambia después: enlaza con el inicio de sesión), nombre para mostrar, apellidos y nombres para los informes, cédula, facultad, carrera, rol, «evaluado» y «activo». Dar de baja es desactivar: se conservan sus evidencias.
- **Quién puede qué:** la responsable gestiona docentes, calidad y coordinadora; solo el superadmin crea o modifica responsables y superadmins (lo exige la base de datos).
- **Plantilla de Excel:** el botón «Descargar plantilla (Excel)» trae a las personas actuales (las que puede gestionar), con la columna de cédula en formato texto para conservar el cero inicial, y una hoja de instrucciones. Se completa y se sube con «Subir archivo (Excel o CSV)».
- **Cargar datos desde una tabla:** pegar filas copiadas de Excel con encabezados (`correo` obligatorio; apellidos y nombres, cédula, facultad, carrera, nombre). Las personas existentes se actualizan y las nuevas se crean como docentes; antes de guardar se muestra un resumen y los errores (correo de otro dominio, cédula repetida, filas repetidas).
- **Para los informes de investigación** cada docente debe tener cédula y «apellidos y nombres» (primero los apellidos): el sistema avisa al descargar si falta alguno.

Plan B si el sitio no estuviera disponible (Supabase > SQL Editor):

```sql
insert into public.usuarios (email, nombre, rol) values ('nombre@unesum.edu.ec', 'Nombre Apellido', 'docente');
update public.usuarios set activo = false where email = 'nombre@unesum.edu.ec';
```

Los correos van en minúsculas y deben terminar en el dominio de `public.ajustes` (`dominio_permitido`).

### Informes

La página **Informes** la ven la responsable, calidad, coordinadora y el superadmin. Todo se genera en el navegador con evidencias **validadas**:

- **Coordinación y calidad:** resumen estadístico del programa por año (docentes, con puntaje, promedio, mediana, desviación, mínimo y máximo, distribución por nivel, promedio por indicador, producción por actividad, evolución por año), informe del programa en PDF, docentes y evidencias en CSV, y el reporte PDF de cada docente.
- **Dirección de Investigación:** matriz de publicaciones (Excel con las hojas REVISTAS, LIBROS, CAPITULOS y PONENCIAS) y matriz de otras actividades de investigación (Excel), con los mismos encabezados de los formatos oficiales. Los datos de la Comisión (base, ISSN, cuartil, línea, período, proyecto) salen de lo que completó la responsable al validar. En capítulos y ponencias el formato usa la columna PARTICIPACION para la posición del autor. Las columnas de enlaces a Drive (aval, certificados) quedan para que las complete la Comisión, porque los archivos de este sistema son privados.
- El Excel se genera con SheetJS 0.18.5 (cdnjs, con comprobación de integridad) y el PDF con jsPDF; ambos se cargan solo al pedir la descarga.

## 5. Respaldo y restauración

- **Datos:** el superadmin descarga desde **Gestión** un JSON completo (`public.exportar_respaldo()`: personas, evidencias, historial, catálogo, años habilitados y bitácora). Contiene cédulas y evidencias: guárdelo fuera de este sistema y trátelo como confidencial. Hágalo antes de cada cierre de año. También sirve Supabase > Database > Backups (el plan gratuito no incluye copias descargables automáticas).
- **Archivos:** no van en el JSON del respaldo. Están en Supabase > Storage > `evidencias` (ruta `usuario_id/evidencia_id/archivo`). Los años ya archivados tienen su copia ZIP (ver «Archivar un año»). **[detallar en etapa 7]**
- **Restauración:** crear un proyecto nuevo, ejecutar las migraciones `0001` a `0015`, importar el JSON y subir los archivos respetando la ruta. **[procedimiento detallado en la etapa 7]**
- **Almacenamiento:** Gestión muestra cuánto se usa del límite configurado y avisa al pasar del 80 %.

## 6. Límites del plan gratuito

- **Pausa por inactividad (~1 semana):** `.github/workflows/mantener-activo.yml` consulta la API cada día (requiere las variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` en GitHub).
- **Almacenamiento (1 GB):** cada archivo ≤ 5 MB. **Gestión** muestra el uso y avisa al pasar del 80 %. Los archivos son lo que ocupa el espacio; los datos pesan muy poco. Para liberar espacio use **Archivar un año** (ver abajo). Otras alternativas: plan de pago de Supabase, o mover los archivos a Google Drive y guardar solo el enlace **[detallar en etapa 7]**.

### Archivar un año para liberar espacio (solo superadmin)

En **Gestión > Archivar un año** (solo aparecen los años **cerrados**):

1. **Descargar la copia.** El navegador baja todos los archivos del año, comprueba cada uno contra su huella SHA-256 y entrega ZIP de unos 100 MB. La parte 1 incluye además `datos-AAAA.json` (personas, evidencias, historial y registro de archivos del año), los informes del año (matrices de investigación en Excel y CSV) y un `LEEME.txt`; cada parte trae su `manifiesto-parte-N.csv` con la ruta original de cada archivo. Si algún archivo falta o no coincide, la copia se declara incompleta y no se permite liberar espacio.
2. **Guardar los ZIP** fuera del sistema (disco externo o Drive institucional) y con acceso restringido: contienen cédulas y evidencias, y son la única copia de los archivos.
3. **Liberar el espacio.** Se escribe `ARCHIVAR AAAA` para confirmar y se borran esos archivos del almacenamiento. Cada archivo queda marcado como «archivado» (`archivos.archivado_en`).

Qué se conserva: las evidencias, los puntajes, el ranking, los informes y el historial. Qué cambia: los archivos de ese año dejan de poder abrirse (se muestran como «archivados») y el año **ya no puede reabrirse**. Para recuperar un archivo, súbalo de nuevo al almacenamiento con su ruta original (columna `ruta_original` del manifiesto) y quite la marca `archivado_en`. La base de datos impide borrar archivos de años abiertos y de quien no sea superadmin.
- **Sin soporte:** esta documentación es la referencia.

## 7. Pruebas

Requiere PostgreSQL instalado localmente (`initdb`, `pg_ctl`, `psql`). No toca Supabase.

```bash
supabase/pruebas/ejecutar.sh
```

Pruebas de la interfaz (flujo de carga, rollback ante fallos, rutas de Storage), sin red, con un Supabase falso en memoria. Requiere Node 20 o superior:

```bash
node --test supabase/pruebas/js
```

En macOS, PostgreSQL necesita una configuración regional válida; el script usa `en_US.UTF-8` si no hay otra (`LC_ALL`). La primera aplica las migraciones sobre una base temporal (dos veces, para comprobar idempotencia) y ejecuta pruebas de topes, niveles, ranking, duplicados, estados y RLS.

## 8. Protección de datos

Son datos de empleados (LOPDP, Ecuador). Se guarda solo lo necesario: correo institucional, nombre y rol, más las evidencias. No se registran cédulas ni teléfonos. Las páginas llevan `noindex` y los PDF están en un bucket privado.
