# Sistema del IPCT · Ingeniería Civil UNESUM

Sistema piloto para que los docentes de la Carrera de Ingeniería Civil (UNESUM) carguen evidencias de sus actividades del **IPCT** (Índice de Producción Científica y Tecnológica), una responsable las valide y el sistema calcule el índice, el nivel y un ranking solo con evidencia validada.

Normativa: *Reforma del Instructivo para el reconocimiento y estímulo al personal académico y estudiantes con actividades de I+D+i y vinculación* (UNESUM, OCS, 4 de marzo de 2022, SE Nº ROCS-05-Nº-12-2022).

URL de piloto: <https://dsornoza.github.io/ipct-civil/>

> **Estado:** etapa 5b de 7 (archivos por tipo, datos de la matriz de investigación, coautoría y cierre de carga, sobre el ranking y el PDF del docente). Las secciones marcadas con **[etapa N]** se completan al avanzar el proyecto.

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
| `index.html`, `docente.html`, `validacion.html`, `ranking.html`, `css/`, `assets/` | Páginas y logos de la Comisión de Investigación |
| `js/cliente.js`, `js/comun.js`, `js/ui.js` | Cliente de Supabase, sesión, menú por rol y utilidades de interfaz |
| `js/catalogo.js`, `js/evidencias.js`, `js/puntaje.js` | Lógica del catálogo, validación de PDF, evidencias, puntaje y ranking (sin DOM; se prueban con Node) |
| `js/pdf.js` | Reporte PDF (jsPDF 2.5.1 y autotable 3.5.31 desde cdnjs con SRI; se cargan solo al pedir el PDF) |
| `js/index.js`, `js/docente.js`, `js/validacion.js`, `js/ranking.js` | Inicio de sesión, «Mis evidencias», validación y ranking |
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
| `periodos` | Cierre de carga por año: interruptor manual y fecha de cierre automático |
| `bitacora` | Acciones de gestión (apertura y cierre de la carga) |
| `historial` | Auditoría de cada cambio de estado, edición y baja |

**Ranking y puntaje:** el ranking (`ranking.html`) lo ven todos los usuarios autorizados, nunca el público; cuenta solo evidencias validadas y se actualiza al abrirlo, con el botón «Actualizar» y cada minuto. Cada docente ve su IPCT validado, el nivel, lo que le falta para el siguiente, los topes aplicados y su evolución por año en «Mis evidencias», y puede descargar su PDF. Todo se calcula en la base de datos (`ranking`, `evolucion`, `detalle_docente`).

**Etapa 5b: lo que define cada tipo de evidencia.** El campo `esquema` de `tipos_evidencia` (migración `0010`) indica, por tipo: los `campos` que llena el docente; los datos que completa la responsable al validar (`validador`, la matriz de investigación; los campos con `mostrar_si` aparecen según otra respuesta); los `archivos` obligatorios del docente y de la responsable; la lista de `verificacion` (basada en el Modelo MECCAIIC, indicadores 20 y 22) que se marca antes de validar; si admite `coautores`. Para cambiar un formulario basta con modificar ese JSON.

- **Coautoría:** el autor registra a sus coautores (docentes evaluados del sistema) y la evidencia aparece en su cuenta sin volver a subirla. Cada docente tiene su propia fila (su puntaje y su fila en los reportes); los archivos son los del titular; la responsable valida una vez y el resultado se copia a todos. Quien figura como coautor no puede validar esa evidencia. Un coautor puede retirarse mientras no esté validada.
- **La responsable** puede reclasificar un artículo dentro de su mismo tipo (p. ej. de Q3 a Q1) y adjuntar capturas; todo queda en el historial.
- **Cierre de carga:** la responsable o el superadmin cierran la carga de un año (o fijan una fecha de cierre automático, inclusive). Bloqueado en la base de datos: nadie registra, edita ni elimina evidencias de ese año ni sube archivos; la validación continúa.
- **Usuarios:** la responsable da de alta, edita y desactiva docentes, calidad y coordinadora (cédula, facultad, carrera, `evaluado`); solo el superadmin asigna los roles de responsable y superadmin. La pantalla de gestión llega en la etapa 6.

Roles: `docente`, `responsable_ipct`, `calidad`, `coordinadora`, `superadmin`.

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

## 4. Administrar usuarios **[etapa 6]**

Provisional (hasta que exista el panel de superadmin): Supabase > SQL Editor.

```sql
-- Alta de un docente
insert into public.usuarios (email, nombre, rol) values ('nombre@unesum.edu.ec', 'Nombre Apellido', 'docente');
-- Baja (conserva sus evidencias)
update public.usuarios set activo = false where email = 'nombre@unesum.edu.ec';
-- Cambio de rol
update public.usuarios set rol = 'responsable_ipct' where email = 'nombre@unesum.edu.ec';
```

Los correos van en minúsculas y deben terminar en el dominio de `public.ajustes` (`dominio_permitido`).

## 5. Respaldo y restauración **[etapa 6]**

- **Datos:** el superadmin exportará un JSON completo (`public.exportar_respaldo()`). También sirve Supabase > Database > Backups (el plan gratuito no incluye copias descargables automáticas: exporte periódicamente).
- **Archivos:** Supabase > Storage > `evidencias`; o descargar los PDF con el panel de superadmin.
- **Restauración:** crear un proyecto nuevo, ejecutar las migraciones `0001` a `0010`, importar el JSON y subir los PDF respetando la ruta `usuario_id/evidencia_id/archivo.pdf`. Procedimiento detallado en la etapa 6.

## 6. Límites del plan gratuito

- **Pausa por inactividad (~1 semana):** `.github/workflows/mantener-activo.yml` consulta la API cada día (requiere las variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` en GitHub).
- **Almacenamiento (1 GB):** PDF ≤ 5 MB; el panel mostrará el uso. Alternativas al crecer: plan de pago de Supabase, o mover los PDF a Google Drive y guardar solo el enlace **[detallar en etapa 7]**.
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
