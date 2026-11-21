# 🧾 Tickets de gastos

Una app web para el móvil que guarda los tickets de gastos en tu Google Drive:

1. **Haces una foto** del ticket (o eliges una de la galería).
2. La app **lee el ticket** con el OCR de Google y rellena fecha, hora, comercio e importe. Tú los revisas (los que no ha podido leer salen en amarillo) y eliges **categoría** y, si quieres, **proyecto**.
   - La app recuerda la categoría de cada comercio y el último proyecto usado.
3. Al pulsar **Guardar**:
   - se crea un **PDF** con la foto y los datos, listo para presentar:
     - con proyecto, en `<tu carpeta> / <Proyecto> /`
     - sin proyecto, en `<tu carpeta> / Sin proyecto / 2026 / 11 - Noviembre /`
   - la foto original se guarda al lado, en la subcarpeta `Fotos originales`
   - se añade una fila a la hoja de cálculo: `Fecha | Hora | Comercio | Categoría | Proyecto | Importe`. El nombre del comercio enlaza al PDF.

### 📁 Proyectos (una hoja de cálculo por proyecto)
- **Nuevo proyecto** (botón «+ Nuevo» o «+» junto al desplegable): crea en Drive la carpeta del proyecto y su hoja `Gastos - <Proyecto>`.
- Al guardar un ticket eliges en el **desplegable** el proyecto al que va. Solo aparecen los proyectos activos.
- **Candado verde 🔓**: cierra el proyecto. Tras confirmar:
  - se calcula el total,
  - se crea la pestaña **Informe** en su hoja (resumen, desglose por categoría y detalle con enlace a cada ticket),
  - se guarda un **PDF del informe** en su carpeta, listo para presentar y cobrar,
  - el proyecto desaparece del desplegable.
- **Firma del informe** (⚙️ Ajustes → *Tus datos para el informe*):
  - escribe tu nombre y apellidos y tu DNI/NIE (se comprueba la letra),
  - firma con el dedo en el recuadro o carga una foto de tu firma (el fondo blanco se vuelve transparente).

  Al cerrar un proyecto, el informe PDF y la pestaña *Informe* incluyen un bloque «Presentado por» con nombre, DNI, fecha y firma. En el diálogo de cierre puedes desmarcar «Firmar el informe»; si no hay datos, salen los espacios en blanco para firmar a mano.
- **El informe PDF es autónomo**: lleva un anexo con una página por ticket y su foto, numerada como en el detalle. No tiene enlaces a Drive, así que quien lo recibe no necesita ninguna cuenta de Google.
- **Enviar por correo** (al cerrar el proyecto o desde Histórico): manda el PDF **adjunto** desde tu Gmail, con el asunto y el mensaje ya redactados. Recuerda el último destinatario. La primera vez, Google te pedirá permiso para enviar correos: ejecuta `configurar` en el editor y acéptalo.
- **Histórico**: lista los proyectos cerrados con su total, el informe y la hoja. Con **Reabrir** vuelve al desplegable; si lo cierras otra vez, el informe se rehace.
- Además, todos los tickets se apuntan solos en el **Registro general (no tocar)**, en la carpeta principal. No aparece en la app: lo usan los Totales y sirve de copia de seguridad.

### 📊 Totales
- En la app, pestaña **Totales**: eliges el periodo (este mes, mes pasado, trimestre, año o fechas a mano) y el proyecto (todos, uno concreto o "sin proyecto"). Ves el total, el número de tickets y el desglose por categoría y por proyecto.
- En la hoja de cálculo, pestaña **Resumen**: cambias *Desde*, *Hasta* y *Proyecto* (las celdas amarillas) y se recalculan el total y los desgloses.

### ⚙️ Ajustes (desde la app)
- **Carpeta de Drive**: navega por tus carpetas, crea una nueva o pega el enlace de una carpeta. Dentro, cada proyecto tiene su subcarpeta. Los tickets nuevos se guardan allí; los anteriores se quedan donde estaban.
- **Categorías**: una por línea.

Funciona con Google Apps Script, dentro de tu propia cuenta de Google: no hay servidor externo y no hay que pagar nada. Los tickets solo los ves tú.

## Instalación (unos 5 minutos, una sola vez)

1. Entra en <https://script.google.com> y pulsa **Nuevo proyecto**. Ponle de nombre `Tickets de gastos`.
2. **Code.gs**: borra lo que trae y pega el contenido de [`tickets-gastos/Code.gs`](tickets-gastos/Code.gs).
3. **Index.html**: pulsa **+** → **HTML**, llámalo `Index` (sin `.html`) y pega [`tickets-gastos/Index.html`](tickets-gastos/Index.html).
4. **Activa el servicio de Drive**: en la barra lateral, **Servicios** (+) → **Drive API** → versión **v3** → **Añadir**. Es lo que usa el OCR.
5. **Zona horaria**: en ⚙️ **Configuración del proyecto**, comprueba que la zona horaria es `(GMT+01:00) Madrid`, o la tuya.
6. **Autoriza**: elige la función `configurar` en el desplegable de arriba y pulsa **Ejecutar**. Acepta los permisos. Si sale "Google no ha verificado esta aplicación", pulsa **Configuración avanzada → Ir a Tickets de gastos**: es tu propio script. Esto crea la carpeta y la hoja de cálculo en tu Drive.
7. **Publica**: **Implementar → Nueva implementación** → tipo **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Solo yo**

   Pulsa **Implementar** y copia la URL que termina en `/exec`.
8. **En el móvil**: abre esa URL en Chrome o Safari y añádela a la pantalla de inicio (Chrome: ⋮ → *Añadir a pantalla de inicio*; Safari: Compartir → *Añadir a pantalla de inicio*). A partir de ahí se abre como una app.

> Si más adelante cambias el código: **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión** para que la URL use el código nuevo.

### Alternativa con `clasp` (para desarrolladores)

```bash
npm i -g @google/clasp
clasp login
cd tickets-gastos
clasp create --type webapp --title "Tickets de gastos"
clasp push      # sube Code.gs, Index.html y appsscript.json (que ya incluye Drive API v3)
```

Después, sigue desde el paso 6.

## Notas

- La carpeta, la hoja y las categorías se cambian desde ⚙️ Ajustes. Los valores de partida están en `CONFIG`, al principio de `Code.gs`.
- Si mueves o renombras la carpeta o la hoja desde Drive, la app las sigue encontrando, porque guarda sus IDs. Si las borras, se crean de nuevo.
- **¿Ya usabas la versión anterior?** Pega el `Code.gs` y el `Index.html` nuevos y crea una nueva versión de la implementación. La primera vez que abras la app, se añaden solas las columnas *Categoría* y *Proyecto* (los tickets anteriores quedan con esas celdas vacías) y la pestaña *Resumen*.

## Consejos

- Haz la foto con buena luz y con el ticket recto y entero: el OCR acierta mucho más.
- Revisa siempre el importe antes de guardar. La app busca la línea "TOTAL", pero algunos tickets son raros.
- Para totales por periodo o proyecto, usa la pestaña **Totales** de la app o la pestaña **Resumen** de la hoja.
