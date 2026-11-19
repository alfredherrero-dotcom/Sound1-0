/**
 * Tickets de gastos — Google Apps Script
 *
 * - Haces una foto del ticket desde el móvil.
 * - Se lee automáticamente (OCR de Google Drive) para sugerir fecha, hora,
 *   comercio e importe; tú los revisas y corriges si hace falta.
 * - Se guarda en Drive como PDF (más la foto original) en
 *   "Tickets de gastos/AAAA/MM - Mes".
 * - Se añade una fila a la hoja de cálculo "Gastos - Tickets":
 *   Fecha | Hora | Comercio | Importe  (el comercio enlaza al PDF).
 */

const CONFIG = {
  NOMBRE_CARPETA: 'Tickets de gastos',
  NOMBRE_HOJA: 'Gastos - Tickets',
  NOMBRE_PESTANA: 'Gastos',
  SUBCARPETA_FOTOS: 'Fotos originales',
};

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/* ------------------------------------------------------------------ */
/* Web app                                                             */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Tickets de gastos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/**
 * Ejecuta esta función una vez desde el editor para autorizar permisos
 * y crear la carpeta y la hoja de cálculo.
 */
function configurar() {
  const carpeta = obtenerCarpetaRaiz_();
  const hoja = obtenerHoja_();
  console.log('Carpeta: ' + carpeta.getUrl());
  console.log('Hoja de cálculo: ' + hoja.getParent().getUrl());
}

/** Datos para la pantalla principal: enlaces y últimos tickets. */
function obtenerResumen() {
  const carpeta = obtenerCarpetaRaiz_();
  const hoja = obtenerHoja_();
  const tz = Session.getScriptTimeZone();
  const ultimaFila = hoja.getLastRow();
  const ultimos = [];
  if (ultimaFila > 1) {
    const desde = Math.max(2, ultimaFila - 4);
    const rango = hoja.getRange(desde, 1, ultimaFila - desde + 1, 4);
    const valores = rango.getValues();
    const enlaces = hoja.getRange(desde, 3, ultimaFila - desde + 1, 1).getRichTextValues();
    for (let i = valores.length - 1; i >= 0; i--) {
      const [fecha, hora, comercio, importe] = valores[i];
      ultimos.push({
        fecha: fecha instanceof Date ? Utilities.formatDate(fecha, tz, 'dd/MM/yyyy') : String(fecha),
        hora: hora instanceof Date ? Utilities.formatDate(hora, tz, 'HH:mm') : String(hora),
        comercio: String(comercio),
        importe: Number(importe) || 0,
        url: enlaces[i][0] ? enlaces[i][0].getLinkUrl() : null,
      });
    }
  }
  return {
    carpetaUrl: carpeta.getUrl(),
    hojaUrl: hoja.getParent().getUrl(),
    ultimos: ultimos,
  };
}

/**
 * Lee el ticket con el OCR de Google Drive y sugiere los datos.
 * No guarda nada todavía.
 */
function analizarTicket(imagenBase64, mimeType) {
  const blob = Utilities.newBlob(
    Utilities.base64Decode(imagenBase64), mimeType || 'image/jpeg', 'ticket.jpg');

  let texto = '';
  let docId = null;
  try {
    const doc = Drive.Files.create(
      { name: 'tmp-ocr-ticket', mimeType: MimeType.GOOGLE_DOCS },
      blob,
      { ocrLanguage: 'es', fields: 'id' });
    docId = doc.id;
    texto = DocumentApp.openById(docId).getBody().getText();
  } catch (e) {
    console.warn('OCR no disponible: ' + e);
  } finally {
    if (docId) {
      try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { /* ignorar */ }
    }
  }

  const tz = Session.getScriptTimeZone();
  const ahora = new Date();
  const encontrado = parsearTextoTicket_(texto);
  return {
    fecha: encontrado.fecha || Utilities.formatDate(ahora, tz, 'yyyy-MM-dd'),
    hora: encontrado.hora || Utilities.formatDate(ahora, tz, 'HH:mm'),
    comercio: encontrado.comercio || '',
    importe: encontrado.importe != null ? encontrado.importe : '',
    detectado: {
      fecha: !!encontrado.fecha,
      hora: !!encontrado.hora,
      comercio: !!encontrado.comercio,
      importe: encontrado.importe != null,
    },
  };
}

/**
 * Guarda el ticket: PDF + foto original en Drive y fila en la hoja.
 * @param {{imagenBase64:string, mimeType:string, fecha:string, hora:string,
 *          comercio:string, importe:(number|string)}} datos
 */
function guardarTicket(datos) {
  const fecha = String(datos.fecha || '');
  const hora = String(datos.hora || '');
  const comercio = String(datos.comercio || '').trim();
  const importe = aNumero_(String(datos.importe));

  const mFecha = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mFecha) throw new Error('La fecha no es válida.');
  if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error('La hora no es válida.');
  if (!comercio) throw new Error('Falta el nombre del comercio.');
  if (importe == null || isNaN(importe)) throw new Error('El importe no es válido.');
  if (!datos.imagenBase64) throw new Error('Falta la foto del ticket.');

  const anio = mFecha[1];
  const mes = Number(mFecha[2]);
  const dia = Number(mFecha[3]);

  // Carpetas: Tickets de gastos / 2026 / 11 - Noviembre / Fotos originales
  const raiz = obtenerCarpetaRaiz_();
  const carpetaAnio = obtenerSubcarpeta_(raiz, anio);
  const carpetaMes = obtenerSubcarpeta_(carpetaAnio, pad2_(mes) + ' - ' + MESES[mes - 1]);
  const carpetaFotos = obtenerSubcarpeta_(carpetaMes, CONFIG.SUBCARPETA_FOTOS);

  const importeTexto = importe.toFixed(2).replace('.', ',') + ' €';
  const nombreBase = fecha + ' ' + hora.replace(':', 'h') + ' - ' +
    limpiarNombre_(comercio) + ' - ' + importeTexto;

  const mime = datos.mimeType || 'image/jpeg';
  const extension = mime === 'image/png' ? '.png' : '.jpg';
  const imagen = Utilities.newBlob(
    Utilities.base64Decode(datos.imagenBase64), mime, nombreBase + extension);

  const foto = carpetaFotos.createFile(imagen);
  const pdf = carpetaMes.createFile(crearPdf_(imagen, nombreBase, [
    'Fecha: ' + pad2_(dia) + '/' + pad2_(mes) + '/' + anio + '   Hora: ' + hora,
    'Comercio: ' + comercio,
    'Importe: ' + importeTexto,
  ]));
  pdf.setDescription('Ticket de gasto. Foto original: ' + foto.getUrl());

  // Fila en la hoja de cálculo (con bloqueo por si se guardan dos a la vez).
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const hoja = obtenerHoja_();
    const fila = hoja.getLastRow() + 1;
    hoja.getRange(fila, 1, 1, 4).setValues([[new Date(Number(anio), mes - 1, dia), hora, comercio, importe]]);
    hoja.getRange(fila, 3).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText(comercio).setLinkUrl(pdf.getUrl()).build());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return { pdfUrl: pdf.getUrl(), nombre: pdf.getName() };
}

/* ------------------------------------------------------------------ */
/* Drive y hoja de cálculo                                            */
/* ------------------------------------------------------------------ */

function obtenerCarpetaRaiz_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_ID');
  if (id) {
    try {
      const carpeta = DriveApp.getFolderById(id);
      if (!carpeta.isTrashed()) return carpeta;
    } catch (e) { /* se volverá a crear */ }
  }
  const existentes = DriveApp.getFoldersByName(CONFIG.NOMBRE_CARPETA);
  const carpeta = existentes.hasNext() ? existentes.next() : DriveApp.createFolder(CONFIG.NOMBRE_CARPETA);
  props.setProperty('CARPETA_ID', carpeta.getId());
  return carpeta;
}

function obtenerSubcarpeta_(padre, nombre) {
  const existentes = padre.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : padre.createFolder(nombre);
}

/** Devuelve la pestaña "Gastos" de la hoja; la crea si no existe. */
function obtenerHoja_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('HOJA_ID');
  let ss = null;
  if (id) {
    try {
      if (!DriveApp.getFileById(id).isTrashed()) ss = SpreadsheetApp.openById(id);
    } catch (e) { /* se volverá a crear */ }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.NOMBRE_HOJA);
    DriveApp.getFileById(ss.getId()).moveTo(obtenerCarpetaRaiz_());
    props.setProperty('HOJA_ID', ss.getId());
  }

  let hoja = ss.getSheetByName(CONFIG.NOMBRE_PESTANA);
  if (!hoja) {
    hoja = ss.getSheets()[0];
    if (hoja.getLastRow() > 0) hoja = ss.insertSheet();
    hoja.setName(CONFIG.NOMBRE_PESTANA);
    hoja.getRange(1, 1, 1, 4)
      .setValues([['Fecha', 'Hora', 'Comercio', 'Importe']])
      .setFontWeight('bold')
      .setBackground('#e8f0fe');
    hoja.setFrozenRows(1);
    hoja.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
    hoja.getRange('B2:B').setNumberFormat('@');
    hoja.getRange('D2:D').setNumberFormat('#,##0.00 [$€-C0A]');
    hoja.setColumnWidth(1, 100);
    hoja.setColumnWidth(2, 70);
    hoja.setColumnWidth(3, 260);
    hoja.setColumnWidth(4, 100);
  }
  return hoja;
}

/** Crea un PDF con la foto del ticket y sus datos en la cabecera. */
function crearPdf_(imagen, titulo, lineasInfo) {
  const doc = DocumentApp.create(titulo);
  const docId = doc.getId();
  try {
    const cuerpo = doc.getBody();
    const margen = 36;
    cuerpo.setMarginTop(margen).setMarginBottom(margen)
      .setMarginLeft(margen).setMarginRight(margen);

    cuerpo.getParagraphs()[0].setText(titulo).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    lineasInfo.forEach(function (linea) {
      cuerpo.appendParagraph(linea).setFontSize(10);
    });

    const img = cuerpo.appendImage(imagen);
    const ancho = img.getWidth();
    const alto = img.getHeight();
    const anchoMax = cuerpo.getPageWidth() - 2 * margen;
    const altoMax = cuerpo.getPageHeight() - 2 * margen - 110; // espacio para la cabecera
    const escala = Math.min(1, anchoMax / ancho, altoMax / alto);
    img.setWidth(Math.floor(ancho * escala)).setHeight(Math.floor(alto * escala));

    doc.saveAndClose();
    return DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(titulo + '.pdf');
  } finally {
    DriveApp.getFileById(docId).setTrashed(true);
  }
}

/* ------------------------------------------------------------------ */
/* Lectura del texto del ticket (funciones puras, sin servicios)       */
/* ------------------------------------------------------------------ */

/**
 * Extrae fecha (AAAA-MM-DD), hora (HH:MM), comercio e importe del texto OCR.
 * Devuelve null en cada campo que no encuentre.
 */
function parsearTextoTicket_(texto) {
  const res = { fecha: null, hora: null, comercio: null, importe: null };
  if (!texto) return res;
  const lineas = String(texto).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

  // Fecha: 19/11/2026, 19-11-26, 19.11.2026 o 2026-11-19
  let m;
  const reFecha = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/g;
  while (!res.fecha && (m = reFecha.exec(texto))) {
    let anio = Number(m[3]);
    if (anio < 100) anio += 2000;
    res.fecha = fechaValida_(anio, Number(m[2]), Number(m[1]));
  }
  const reFechaIso = /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
  while (!res.fecha && (m = reFechaIso.exec(texto))) {
    res.fecha = fechaValida_(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  // Hora: 14:35 o 14:35:12
  m = texto.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  if (m) res.hora = pad2_(Number(m[1])) + ':' + m[2];

  // Importe
  res.importe = buscarImporte_(lineas);

  // Comercio: primera línea "con nombre" de la cabecera del ticket
  const excluir = /factura|ticket|simplificad|c\.?i\.?f|n\.?i\.?f|\btel|telf|tfno|www|http|@|fecha|hora|\bc\/|calle|avda|avenida|plaza|^\d|bienvenid|gracias|caja|cajer/i;
  for (let i = 0; i < Math.min(lineas.length, 8); i++) {
    const linea = lineas[i];
    const letras = (linea.match(/[a-záéíóúüñ]/gi) || []).length;
    if (letras >= 3 && !excluir.test(linea)) {
      res.comercio = formatearNombre_(linea);
      break;
    }
  }
  return res;
}

function buscarImporte_(lineas) {
  const reNum = /(?:^|[^\d])(\d{1,3}(?:[.\s]\d{3})+[.,]\d{2}|\d+[.,]\d{2})(?!\d)/g;
  const numerosEn = function (linea) {
    const nums = [];
    let m;
    reNum.lastIndex = 0;
    while ((m = reNum.exec(linea))) {
      const n = aNumero_(m[1]);
      if (n != null && n > 0 && n < 100000) nums.push(n);
    }
    return nums;
  };
  const candidatosEn = function (filtro, exclusion) {
    const c = [];
    lineas.forEach(function (linea, i) {
      if (filtro.test(linea) && !(exclusion && exclusion.test(linea))) {
        let nums = numerosEn(linea);
        if (!nums.length && i + 1 < lineas.length) nums = numerosEn(lineas[i + 1]);
        Array.prototype.push.apply(c, nums);
      }
    });
    return c;
  };

  // 1) Líneas con "TOTAL" (no subtotal, base imponible, cuotas, descuentos...)
  let c = candidatosEn(/total/i, /sub\s*-?\s*total|base|cuota|descuento|ahorro|art[ií]culos|unidades|\buds\b|puntos/i);
  if (c.length) return Math.max.apply(null, c);

  // 2) Otras palabras típicas del importe pagado
  c = candidatosEn(/importe|a pagar|pagado|tarjeta|visa|mastercard|efectivo|\beur\b|€/i, /cambio|devol/i);
  if (c.length) return Math.max.apply(null, c);

  // 3) El mayor importe del ticket
  c = [];
  lineas.forEach(function (l) { Array.prototype.push.apply(c, numerosEn(l)); });
  return c.length ? Math.max.apply(null, c) : null;
}

/** "1.234,56" / "1,234.56" / "12,50" / "12.50" -> número */
function aNumero_(s) {
  if (s == null) return null;
  s = String(s).replace(/[\s€]/g, '');
  if (!s) return null;
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let n;
  if (sep === -1) {
    n = Number(s);
  } else {
    const decimales = s.slice(sep + 1);
    const entero = s.slice(0, sep).replace(/[.,]/g, '');
    // "1.234" sin decimales reales: separador de miles
    n = decimales.length === 3 && sep > 0 ? Number(entero + decimales) : Number(entero + '.' + decimales);
  }
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function fechaValida_(anio, mes, dia) {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 2000 || anio > 2100) return null;
  const d = new Date(anio, mes - 1, dia);
  if (d.getMonth() !== mes - 1) return null;
  return anio + '-' + pad2_(mes) + '-' + pad2_(dia);
}

/** "MERCADONA, S.A." -> "Mercadona, S.A." (solo si viene todo en mayúsculas) */
function formatearNombre_(linea) {
  let s = linea.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-'(])([a-záéíóúüñ])/g, function (_, a, b) { return a + b.toUpperCase(); })
      .replace(/\b(S\.?l\.?u?|S\.?a\.?)(?=$|[\s.,])/gi, function (x) { return x.toUpperCase(); });
  }
  return s;
}

function limpiarNombre_(s) {
  return s.replace(/[\\\/:*?"<>|#%]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Comercio';
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

// Permite probar el parser con Node (no afecta a Apps Script).
if (typeof module !== 'undefined') {
  module.exports = { parsearTextoTicket_, aNumero_, formatearNombre_ };
}
