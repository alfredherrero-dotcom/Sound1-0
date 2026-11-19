# 🧾 Tickets de gastos

Una app web para el móvil que guarda los tickets de gastos en tu Google Drive:

1. **Haces una foto** del ticket (o eliges una de la galería).
2. La app **lee el ticket** con el OCR de Google y rellena fecha, hora, comercio e importe. Tú los revisas; los campos que no ha podido leer salen en amarillo.
3. Al pulsar **Guardar**:
   - se crea un **PDF** con la foto y los datos, listo para presentar, en
     `Tickets de gastos / 2026 / 11 - Noviembre /`
   - la foto original se guarda en la subcarpeta `Fotos originales`
   - se añade una fila a la hoja de cálculo **Gastos - Tickets**: `Fecha | Hora | Comercio | Importe`. El nombre del comercio enlaza al PDF.

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

## Personalización

Al principio de `Code.gs`:

```js
const CONFIG = {
  NOMBRE_CARPETA: 'Tickets de gastos',   // carpeta raíz en Drive
  NOMBRE_HOJA: 'Gastos - Tickets',       // hoja de cálculo
  NOMBRE_PESTANA: 'Gastos',
  SUBCARPETA_FOTOS: 'Fotos originales',
};
```

Si mueves o renombras la carpeta o la hoja, la app las sigue encontrando, porque guarda sus IDs. Si las borras, se crean de nuevo.

## Consejos

- Haz la foto con buena luz y con el ticket recto y entero: el OCR acierta mucho más.
- Revisa siempre el importe antes de guardar. La app busca la línea "TOTAL", pero algunos tickets son raros.
- En la hoja puedes poner `=SUMA(D:D)` en otra celda para ver el total, o usar filtros por fechas.
