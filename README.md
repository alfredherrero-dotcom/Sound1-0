# 🧾 Tickets de gastos

Una app web para el móvil que guarda los tickets de gastos en tu Google Drive:

1. **Haces una foto** del ticket (o eliges una de la galería).
2. La app **lee el ticket** con el OCR de Google y rellena fecha, hora, comercio e importe. Tú los revisas (los que no ha podido leer salen en amarillo) y eliges **categoría** y, si quieres, **proyecto**.
   - La app recuerda la categoría de cada comercio y el último proyecto usado.
3. Al pulsar **Guardar**:
   - se crea un **PDF** con la foto y los datos, listo para presentar, en
     `<tu carpeta> / 2026 / 11 - Noviembre /`
   - la foto original se guarda en la subcarpeta `Fotos originales`
   - se añade una fila a la hoja de cálculo: `Fecha | Hora | Comercio | Categoría | Proyecto | Importe`. El nombre del comercio enlaza al PDF.

### 📊 Totales
- En la app, pestaña **Totales**: eliges el periodo (este mes, mes pasado, trimestre, año o fechas a mano) y el proyecto (todos, uno concreto o "sin proyecto"). Ves el total, el número de tickets y el desglose por categoría y por proyecto.
- En la hoja de cálculo, pestaña **Resumen**: cambias *Desde*, *Hasta* y *Proyecto* (las celdas amarillas) y se recalculan el total y los desgloses.

### ⚙️ Ajustes (desde la app)
- **Carpeta de Drive**: navega por tus carpetas, crea una nueva o pega el enlace de una carpeta. Los tickets nuevos se guardan allí; los anteriores se quedan donde estaban.
- **Nombre de la hoja de cálculo**: con la casilla *Seguir usando la hoja actual* marcada, se renombra la hoja y se mueve a la carpeta elegida. Desmarcada, se empieza otra hoja: se usa la que ya tenga ese nombre en la carpeta o se crea una nueva. Sirve, por ejemplo, para tener una hoja por año.
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
- En la hoja puedes poner `=SUMA(D:D)` en otra celda para ver el total, o usar filtros por fechas.
