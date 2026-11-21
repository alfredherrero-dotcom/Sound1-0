/**
 * Tickets de gastos — Google Apps Script
 *
 * - Haces una foto del ticket desde el móvil.
 * - Se lee automáticamente (OCR de Google Drive) para sugerir fecha, hora,
 *   comercio e importe; tú los revisas, eliges categoría y proyecto.
 * - Se guarda en Drive como PDF (más la foto original) en
 *   "<carpeta elegida>/AAAA/MM - Mes".
 * - Se añade una fila a la hoja de cálculo:
 *   Fecha | Hora | Comercio | Categoría | Proyecto | Importe
 *   (el comercio enlaza al PDF).
 * - Totales por periodo y proyecto en la app y en la pestaña "Resumen".
 * - Carpeta, nombre de la hoja y categorías se cambian desde ⚙️ Ajustes.
 */

/** Valores por defecto (se pueden cambiar desde la pantalla de Ajustes). */
const CONFIG = {
  NOMBRE_CARPETA: 'Tickets de gastos',
  NOMBRE_HOJA: 'Registro general (no tocar)',   // registro automático con todos los tickets
  NOMBRE_HOJA_ANTIGUO: 'Gastos - Tickets',
  NOMBRE_PESTANA: 'Gastos',
  NOMBRE_RESUMEN: 'Resumen',
  SUBCARPETA_FOTOS: 'Fotos originales',
  CATEGORIAS: ['Comida', 'Transporte', 'Combustible', 'Alojamiento', 'Parking y peajes',
    'Material', 'Teléfono e internet', 'Otros'],
};

const COL = { FECHA: 1, HORA: 2, COMERCIO: 3, CATEGORIA: 4, PROYECTO: 5, IMPORTE: 6 };
const NCOLS = 6;
const CABECERAS = ['Fecha', 'Hora', 'Comercio', 'Categoría', 'Proyecto', 'Importe'];
const MAX_RECORDADOS = 100; // comercios cuya categoría se recuerda

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
  revisarResumen_(hoja.getParent());
  console.log('Carpeta: ' + carpeta.getUrl());
  console.log('Hoja de cálculo: ' + hoja.getParent().getUrl());
}

/** Datos para la pantalla principal: listas, enlaces y últimos tickets. */
function obtenerResumen() {
  const carpeta = obtenerCarpetaRaiz_();
  const hoja = obtenerHoja_();
  try { revisarResumen_(hoja.getParent()); } catch (e) { console.warn('Resumen: ' + e); }
  const tz = Session.getScriptTimeZone();
  const ultimaFila = hoja.getLastRow();
  const ultimos = [];
  const proyectos = {};
  const mes = { total: 0, tickets: 0 };

  if (ultimaFila > 1) {
    const n = ultimaFila - 1;
    const hoy = new Date();
    hoja.getRange(2, 1, n, NCOLS).getValues().forEach(function (v) {
      const p = String(v[COL.PROYECTO - 1]).trim();
      if (p) proyectos[p] = true;
      const f = v[COL.FECHA - 1];
      const imp = Number(v[COL.IMPORTE - 1]);
      if (f instanceof Date && !isNaN(imp) &&
          f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth()) {
        mes.total += imp;
        mes.tickets++;
      }
    });
    mes.total = redondear_(mes.total);

    const desde = Math.max(2, ultimaFila - 4);
    const k = ultimaFila - desde + 1;
    const valores = hoja.getRange(desde, 1, k, NCOLS).getValues();
    const enlaces = hoja.getRange(desde, COL.COMERCIO, k, 1).getRichTextValues();
    for (let i = valores.length - 1; i >= 0; i--) {
      const v = valores[i];
      ultimos.push({
        fecha: v[0] instanceof Date ? Utilities.formatDate(v[0], tz, 'dd/MM/yyyy') : String(v[0]),
        hora: v[1] instanceof Date ? Utilities.formatDate(v[1], tz, 'HH:mm') : String(v[1]),
        comercio: String(v[2]),
        categoria: String(v[3]),
        proyecto: String(v[4]),
        importe: Number(v[5]) || 0,
        url: enlaces[i][0] ? enlaces[i][0].getLinkUrl() : null,
      });
    }
  }

  return {
    carpetaUrl: carpeta.getUrl(),
    hojaUrl: hoja.getParent().getUrl(),
    nombreHoja: hoja.getParent().getName(),
    ultimos: ultimos,
    mes: mes,
    listaProyectos: listarProyectos(),
    categorias: obtenerCategorias_(),
    proyectos: Object.keys(proyectos).sort(function (a, b) { return a.localeCompare(b, 'es'); }),
    ultimoProyecto: props_().getProperty('ULTIMO_PROYECTO') || '',
    categoriaPorComercio: leerRecordados_(),
    firmante: firmanteParaPantalla_(false),
    destinatario: props_().getProperty('ULTIMO_DESTINATARIO') || '',
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
  const comercio = encontrado.comercio || '';
  return {
    fecha: encontrado.fecha || Utilities.formatDate(ahora, tz, 'yyyy-MM-dd'),
    hora: encontrado.hora || Utilities.formatDate(ahora, tz, 'HH:mm'),
    comercio: comercio,
    importe: encontrado.importe != null ? encontrado.importe : '',
    categoria: comercio ? (leerRecordados_()[normalizar_(comercio)] || '') : '',
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
 *          comercio:string, categoria:string, proyectoId:string,
 *          importe:(number|string)}} datos
 */
function guardarTicket(datos) {
  const fecha = String(datos.fecha || '');
  const hora = String(datos.hora || '');
  const comercio = String(datos.comercio || '').trim();
  const categoria = String(datos.categoria || '').trim();
  const importe = aNumero_(String(datos.importe));
  const proyectoId = String(datos.proyectoId || '').trim();
  const p = proyectoId ? obtenerProyecto_(proyectoId) : null;
  if (p && p.estado === 'cerrado') throw new Error('El proyecto «' + p.nombre + '» está cerrado. Reábrelo desde Histórico.');
  const proyecto = p ? p.nombre : '';

  const mFecha = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mFecha) throw new Error('La fecha no es válida.');
  if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error('La hora no es válida.');
  if (!comercio) throw new Error('Falta el nombre del comercio.');
  if (!categoria) throw new Error('Elige una categoría.');
  if (importe == null || isNaN(importe)) throw new Error('El importe no es válido.');
  if (!datos.imagenBase64) throw new Error('Falta la foto del ticket.');

  const anio = mFecha[1];
  const mes = Number(mFecha[2]);
  const dia = Number(mFecha[3]);

  // Carpetas:
  //   con proyecto: carpeta del proyecto (con su hoja) / Fotos originales
  //   sin proyecto: <carpeta elegida> / Sin proyecto / 2026 / 11 - Noviembre / Fotos originales
  let destino;
  if (p) {
    destino = carpetaProyecto_(p);
  } else {
    const raiz = obtenerCarpetaRaiz_();
    const sinProyecto = obtenerSubcarpeta_(raiz, 'Sin proyecto');
    const carpetaAnio = obtenerSubcarpeta_(sinProyecto, anio);
    destino = obtenerSubcarpeta_(carpetaAnio, pad2_(mes) + ' - ' + MESES[mes - 1]);
  }

  const importeTexto = importe.toFixed(2).replace('.', ',') + ' €';
  const nombreBase = fecha + ' ' + hora.replace(':', 'h') + ' - ' +
    limpiarNombre_(comercio) + ' - ' + importeTexto;

  const mime = datos.mimeType || 'image/jpeg';
  const extension = mime === 'image/png' ? '.png' : '.jpg';
  const imagen = Utilities.newBlob(
    Utilities.base64Decode(datos.imagenBase64), mime, nombreBase + extension);

  const info = [
    'Fecha: ' + pad2_(dia) + '/' + pad2_(mes) + '/' + anio + '   Hora: ' + hora,
    'Comercio: ' + comercio,
    'Categoría: ' + categoria + (proyecto ? '   Proyecto: ' + proyecto : ''),
    'Importe: ' + importeTexto,
  ];

  // Primero se prepara el PDF; si algo falla después, se borra lo creado
  // para no dejar archivos sueltos.
  const blobPdf = crearPdf_(imagen, nombreBase, info);
  const creados = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const pdf = destino.createFile(blobPdf);
    creados.push(pdf);
    const foto = obtenerSubcarpeta_(destino, CONFIG.SUBCARPETA_FOTOS).createFile(imagen);
    creados.push(foto);
    pdf.setDescription('Ticket de gasto. Foto original: ' + foto.getUrl());

    // Fila en la hoja de cálculo
    const hoja = obtenerHoja_();
    const fila = hoja.getLastRow() + 1;
    hoja.getRange(fila, 1, 1, NCOLS).setValues([[
      new Date(Number(anio), mes - 1, dia), hora, comercio, categoria, proyecto, importe]]);
    hoja.getRange(fila, COL.COMERCIO).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText(comercio).setLinkUrl(pdf.getUrl()).build());

    // Fila en la hoja del proyecto
    if (p) {
      const hp = hojaProyecto_(p);
      const filaP = hp.getLastRow() + 1;
      hp.getRange(filaP, 1, 1, P_NCOLS).setValues([[
        new Date(Number(anio), mes - 1, dia), hora, comercio, categoria, importe]]);
      hp.getRange(filaP, PCOL.COMERCIO).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText(comercio).setLinkUrl(pdf.getUrl()).build());
      p.tickets = (p.tickets || 0) + 1;
      p.total = redondear_((p.total || 0) + importe);
      guardarProyecto_(p);
    }
    SpreadsheetApp.flush();

    recordarCategoria_(comercio, categoria);
    props_().setProperty('ULTIMO_PROYECTO', proyectoId);
    return { pdfUrl: pdf.getUrl(), nombre: pdf.getName() };
  } catch (e) {
    creados.forEach(function (f) { try { f.setTrashed(true); } catch (x) { /* ignorar */ } });
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Totales entre dos fechas (incluidas), opcionalmente de un proyecto.
 * @param {string} desde AAAA-MM-DD
 * @param {string} hasta AAAA-MM-DD
 * @param {string} proyecto '' = todos, '__sin__' = sin proyecto
 */
function obtenerTotales(desde, hasta, proyecto) {
  const d = fechaDesdeIso_(desde);
  const h = fechaDesdeIso_(hasta);
  if (!d || !h) throw new Error('Elige las fechas del periodo.');
  if (d > h) throw new Error('La fecha "Desde" es posterior a "Hasta".');
  const hFin = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1); // exclusivo

  const hoja = obtenerHoja_();
  const n = hoja.getLastRow() - 1;
  const res = { total: 0, tickets: 0, porCategoria: [], porProyecto: [] };
  if (n < 1) return res;

  const porCat = {};
  const porPro = {};
  hoja.getRange(2, 1, n, NCOLS).getValues().forEach(function (v) {
    const fecha = v[COL.FECHA - 1];
    const importe = Number(v[COL.IMPORTE - 1]);
    if (!(fecha instanceof Date) || isNaN(importe)) return;
    if (fecha < d || fecha >= hFin) return;
    const pro = String(v[COL.PROYECTO - 1]).trim();
    if (proyecto === '__sin__' ? pro !== '' : (proyecto && pro !== proyecto)) return;
    const cat = String(v[COL.CATEGORIA - 1]).trim() || 'Sin categoría';
    res.total += importe;
    res.tickets++;
    porCat[cat] = (porCat[cat] || 0) + importe;
    const clavePro = pro || 'Sin proyecto';
    porPro[clavePro] = (porPro[clavePro] || 0) + importe;
  });

  const aLista = function (obj) {
    return Object.keys(obj).map(function (k) { return { nombre: k, total: redondear_(obj[k]) }; })
      .sort(function (a, b) { return b.total - a.total; });
  };
  res.total = redondear_(res.total);
  res.porCategoria = aLista(porCat);
  res.porProyecto = aLista(porPro);
  return res;
}

/* ------------------------------------------------------------------ */
/* Proyectos: cada uno con su carpeta y su hoja de cálculo             */
/* ------------------------------------------------------------------ */

const PREFIJO_PROYECTO = 'PROY_';
const PCOL = { FECHA: 1, HORA: 2, COMERCIO: 3, CATEGORIA: 4, IMPORTE: 5 };
const P_NCOLS = 5;
const P_CABECERAS = ['Fecha', 'Hora', 'Comercio', 'Categoría', 'Importe'];
const NOMBRE_INFORME = 'Informe';
const FORMATO_EUROS = '#,##0.00 [$€-C0A]';

/** Proyectos activos (para el desplegable) y cerrados (histórico). */
function listarProyectos() {
  const todos = leerProyectos_().map(function (p) {
    return {
      id: p.id,
      nombre: p.nombre,
      estado: p.estado,
      tickets: p.tickets || 0,
      total: p.total || 0,
      creado: p.creado,
      cerrado: p.cerrado || null,
      hojaUrl: 'https://docs.google.com/spreadsheets/d/' + p.id + '/edit',
      carpetaUrl: 'https://drive.google.com/drive/folders/' + p.carpetaId,
      informeUrl: p.informeUrl || null,
      desde: p.desde || null,
      hasta: p.hasta || null,
      enviado: p.enviado || null,
      enviadoA: p.enviadoA || null,
    };
  });
  return {
    activos: todos.filter(function (p) { return p.estado !== 'cerrado'; })
      .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }),
    cerrados: todos.filter(function (p) { return p.estado === 'cerrado'; })
      .sort(function (a, b) { return String(b.cerrado).localeCompare(String(a.cerrado)); }),
  };
}

/** Crea un proyecto: carpeta + hoja "Gastos - <nombre>". */
function crearProyecto(nombre) {
  nombre = String(nombre || '').replace(/\s+/g, ' ').trim();
  if (!nombre) throw new Error('Escribe un nombre para el proyecto.');
  if (nombre.length > 80) throw new Error('El nombre es demasiado largo.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const repetido = leerProyectos_().some(function (p) {
      return p.estado !== 'cerrado' && normalizar_(p.nombre) === normalizar_(nombre);
    });
    if (repetido) throw new Error('Ya hay un proyecto activo con ese nombre.');

    const carpeta = obtenerSubcarpeta_(obtenerCarpetaRaiz_(), limpiarNombre_(nombre));
    const ss = SpreadsheetApp.create('Gastos - ' + nombre);
    DriveApp.getFileById(ss.getId()).moveTo(carpeta);
    const hoja = ss.getSheets()[0].setName(CONFIG.NOMBRE_PESTANA);
    hoja.getRange(1, 1, 1, P_NCOLS).setValues([P_CABECERAS]).setFontWeight('bold').setBackground('#e8f0fe');
    hoja.setFrozenRows(1);
    hoja.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
    hoja.getRange('B2:D').setNumberFormat('@');
    hoja.getRange('E2:E').setNumberFormat(FORMATO_EUROS);
    [100, 70, 240, 160, 100].forEach(function (ancho, i) { hoja.setColumnWidth(i + 1, ancho); });
    hoja.getRange(2, PCOL.CATEGORIA, hoja.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(obtenerCategorias_(), true).setAllowInvalid(true).build());

    const p = {
      id: ss.getId(),
      nombre: nombre,
      carpetaId: carpeta.getId(),
      estado: 'abierto',
      creado: new Date().toISOString(),
      cerrado: null,
      tickets: 0,
      total: 0,
    };
    guardarProyecto_(p);
    props_().setProperty('ULTIMO_PROYECTO', p.id);
    return { proyecto: p.id, lista: listarProyectos() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cierra un proyecto: calcula el total, crea la pestaña "Informe" en su hoja
 * y un PDF del informe en su carpeta, y lo pasa al histórico.
 */
function cerrarProyecto(id, opciones) {
  const firmar = !opciones || opciones.firmar !== false;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = obtenerProyecto_(id);
    if (p.estado === 'cerrado') throw new Error('Este proyecto ya está cerrado.');

    const ss = SpreadsheetApp.openById(p.id);
    const datos = leerTicketsProyecto_(ss);
    const ahora = new Date();

    const firmante = firmar ? leerFirmante_() : { nombre: '', dni: '', blob: null };
    crearPestanaInforme_(ss, p, datos, ahora, firmante);

    // Si se había cerrado antes (y se reabrió), se sustituye el informe anterior.
    if (p.informeId) {
      try { DriveApp.getFileById(p.informeId).setTrashed(true); } catch (e) { /* ya no existe */ }
    }
    const pdf = carpetaProyecto_(p).createFile(crearInformePdf_(p, datos, ahora, firmante));

    p.estado = 'cerrado';
    p.cerrado = ahora.toISOString();
    p.tickets = datos.tickets.length;
    p.total = datos.total;
    p.desde = datos.desde;
    p.hasta = datos.hasta;
    p.informeId = pdf.getId();
    p.informeUrl = pdf.getUrl();
    guardarProyecto_(p);
    if (props_().getProperty('ULTIMO_PROYECTO') === id) props_().deleteProperty('ULTIMO_PROYECTO');

    return {
      nombre: p.nombre,
      total: p.total,
      tickets: p.tickets,
      informeUrl: p.informeUrl,
      hojaUrl: ss.getUrl(),
      lista: listarProyectos(),
    };
  } finally {
    lock.releaseLock();
  }
}

/** Recupera un proyecto del histórico: vuelve a aparecer en el desplegable. */
function reabrirProyecto(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const p = obtenerProyecto_(id);
    const repetido = leerProyectos_().some(function (o) {
      return o.id !== p.id && o.estado !== 'cerrado' && normalizar_(o.nombre) === normalizar_(p.nombre);
    });
    if (repetido) throw new Error('Ya hay un proyecto activo con el nombre «' + p.nombre + '».');
    p.estado = 'abierto';
    guardarProyecto_(p);
    return listarProyectos();
  } finally {
    lock.releaseLock();
  }
}

function leerProyectos_() {
  const todas = props_().getProperties();
  return Object.keys(todas)
    .filter(function (k) { return k.indexOf(PREFIJO_PROYECTO) === 0; })
    .map(function (k) { try { return JSON.parse(todas[k]); } catch (e) { return null; } })
    .filter(Boolean);
}

function obtenerProyecto_(id) {
  const v = props_().getProperty(PREFIJO_PROYECTO + id);
  if (!v) throw new Error('No encuentro ese proyecto.');
  return JSON.parse(v);
}

function guardarProyecto_(p) {
  props_().setProperty(PREFIJO_PROYECTO + p.id, JSON.stringify(p));
}

function carpetaProyecto_(p) {
  try {
    const c = DriveApp.getFolderById(p.carpetaId);
    if (!c.isTrashed()) return c;
  } catch (e) { /* se recrea */ }
  const c = obtenerSubcarpeta_(obtenerCarpetaRaiz_(), limpiarNombre_(p.nombre));
  p.carpetaId = c.getId();
  guardarProyecto_(p);
  return c;
}

function hojaProyecto_(p) {
  let ss;
  try {
    ss = SpreadsheetApp.openById(p.id);
  } catch (e) {
    throw new Error('No encuentro la hoja del proyecto «' + p.nombre + '». ¿La has borrado?');
  }
  return ss.getSheetByName(CONFIG.NOMBRE_PESTANA) || ss.getSheets()[0];
}

/** Lee los tickets de la hoja del proyecto y calcula totales. */
function leerTicketsProyecto_(ss) {
  const hoja = ss.getSheetByName(CONFIG.NOMBRE_PESTANA) || ss.getSheets()[0];
  const n = hoja.getLastRow() - 1;
  const tz = Session.getScriptTimeZone();
  const tickets = [];
  if (n > 0) {
    const valores = hoja.getRange(2, 1, n, P_NCOLS).getValues();
    const enlaces = hoja.getRange(2, PCOL.COMERCIO, n, 1).getRichTextValues();
    valores.forEach(function (v, i) {
      const importe = Number(v[PCOL.IMPORTE - 1]);
      if (!v[PCOL.COMERCIO - 1] && !importe) return;
      const fecha = v[PCOL.FECHA - 1];
      const hora = v[PCOL.HORA - 1];
      tickets.push({
        fecha: fecha instanceof Date ? fecha : null,
        hora: hora instanceof Date ? Utilities.formatDate(hora, tz, 'HH:mm') : String(hora),
        comercio: String(v[PCOL.COMERCIO - 1]),
        categoria: String(v[PCOL.CATEGORIA - 1]) || 'Sin categoría',
        importe: isNaN(importe) ? 0 : importe,
        url: enlaces[i][0] ? enlaces[i][0].getLinkUrl() : null,
      });
    });
  }
  tickets.sort(function (a, b) { return (a.fecha ? a.fecha.getTime() : 0) - (b.fecha ? b.fecha.getTime() : 0); });

  const porCat = {};
  let total = 0;
  tickets.forEach(function (t) {
    total += t.importe;
    porCat[t.categoria] = (porCat[t.categoria] || 0) + t.importe;
  });
  const fechas = tickets.filter(function (t) { return t.fecha; }).map(function (t) { return t.fecha; });
  const fmt = function (d) { return Utilities.formatDate(d, tz, 'dd/MM/yyyy'); };
  return {
    tickets: tickets,
    total: redondear_(total),
    porCategoria: Object.keys(porCat).map(function (k) { return { nombre: k, total: redondear_(porCat[k]) }; })
      .sort(function (a, b) { return b.total - a.total; }),
    desde: fechas.length ? fmt(fechas[0]) : null,
    hasta: fechas.length ? fmt(fechas[fechas.length - 1]) : null,
    fmt: fmt,
  };
}

/** Pestaña "Informe" con valores fijos (sin fórmulas): resumen + detalle. */
function crearPestanaInforme_(ss, p, d, ahora, firmante) {
  const anterior = ss.getSheetByName(NOMBRE_INFORME);
  if (anterior) ss.deleteSheet(anterior);
  const h = ss.insertSheet(NOMBRE_INFORME, 0);

  h.getRange('A1').setValue('Informe de gastos').setFontSize(16).setFontWeight('bold');
  h.getRange('A2').setValue(p.nombre).setFontSize(13).setFontWeight('bold').setFontColor('#3949ab');
  h.getRange('A4:B7').setValues([
    ['Periodo', d.desde ? d.desde + ' – ' + d.hasta : '—'],
    ['Fecha de cierre', d.fmt(ahora)],
    ['Nº de tickets', d.tickets.length],
    ['TOTAL', d.total],
  ]);
  h.getRange('A4:A7').setFontWeight('bold');
  h.getRange('B7').setNumberFormat(FORMATO_EUROS).setFontWeight('bold').setFontSize(13);
  h.getRange('A7:B7').setBackground('#e8eaf6');

  let fila = 9;
  h.getRange(fila, 1, 1, 2).setValues([['Categoría', 'Total']]).setFontWeight('bold').setBackground('#e8f0fe');
  fila++;
  if (d.porCategoria.length) {
    h.getRange(fila, 1, d.porCategoria.length, 2)
      .setValues(d.porCategoria.map(function (c) { return [c.nombre, c.total]; }));
    h.getRange(fila, 2, d.porCategoria.length, 1).setNumberFormat(FORMATO_EUROS);
    fila += d.porCategoria.length;
  }

  fila += 1;
  h.getRange(fila, 1).setValue('Detalle de tickets').setFontWeight('bold').setFontSize(12);
  fila++;
  h.getRange(fila, 1, 1, 5).setValues([['Fecha', 'Hora', 'Comercio', 'Categoría', 'Importe']])
    .setFontWeight('bold').setBackground('#e8f0fe');
  fila++;
  if (d.tickets.length) {
    const inicio = fila;
    h.getRange(inicio, 1, d.tickets.length, 5).setValues(d.tickets.map(function (t) {
      return [t.fecha || '', t.hora, t.comercio, t.categoria, t.importe];
    }));
    h.getRange(inicio, 1, d.tickets.length, 1).setNumberFormat('dd/mm/yyyy');
    h.getRange(inicio, 2, d.tickets.length, 1).setNumberFormat('@');
    h.getRange(inicio, 5, d.tickets.length, 1).setNumberFormat(FORMATO_EUROS);
    const ricos = d.tickets.map(function (t) {
      const b = SpreadsheetApp.newRichTextValue().setText(t.comercio || ' ');
      if (t.url) b.setLinkUrl(t.url);
      return [b.build()];
    });
    h.getRange(inicio, 3, d.tickets.length, 1).setRichTextValues(ricos);
    fila += d.tickets.length;
  }
  h.getRange(fila, 4, 1, 2).setValues([['TOTAL', d.total]]).setFontWeight('bold').setBackground('#e8eaf6');
  h.getRange(fila, 5).setNumberFormat(FORMATO_EUROS);

  // Presentado por (nombre, DNI y firma)
  fila += 2;
  h.getRange(fila, 1).setValue('Presentado por').setFontWeight('bold').setFontSize(12);
  h.getRange(fila + 1, 1, 3, 2).setValues([
    ['Nombre y apellidos', firmante.nombre || ''],
    ['DNI', firmante.dni || ''],
    ['Fecha', d.fmt(ahora)],
  ]);
  h.getRange(fila + 1, 1, 3, 1).setFontWeight('bold');
  h.getRange(fila + 4, 1).setValue('Firma').setFontWeight('bold');
  if (firmante.blob) {
    try {
      const img = h.insertImage(firmante.blob, 2, fila + 4);
      const escala = Math.min(1, 220 / img.getWidth(), 90 / img.getHeight());
      img.setWidth(Math.round(img.getWidth() * escala)).setHeight(Math.round(img.getHeight() * escala));
      h.setRowHeight(fila + 4, 95);
    } catch (e) {
      console.warn('No se pudo insertar la firma en la hoja: ' + e);
    }
  }

  [110, 110, 240, 160, 110].forEach(function (ancho, i) { h.setColumnWidth(i + 1, ancho); });
  ss.setActiveSheet(h);
}

/** PDF del informe para presentar (resumen, desglose y detalle con enlaces). */
function crearInformePdf_(p, d, ahora, firmante) {
  const titulo = 'Informe - ' + limpiarNombre_(p.nombre) + ' - ' +
    Utilities.formatDate(ahora, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const doc = DocumentApp.create(titulo);
  const docId = doc.getId();
  const euros = function (n) { return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €'; };
  try {
    const cuerpo = doc.getBody();
    cuerpo.setMarginTop(48).setMarginBottom(48).setMarginLeft(54).setMarginRight(54);

    const cabecera = cuerpo.getParagraphs()[0];
    cabecera.setText('Informe de gastos');
    cabecera.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    cuerpo.appendParagraph(p.nombre).setHeading(DocumentApp.ParagraphHeading.HEADING2);

    [
      'Periodo: ' + (d.desde ? d.desde + ' – ' + d.hasta : '—'),
      'Fecha de cierre: ' + d.fmt(ahora),
      'Número de tickets: ' + d.tickets.length,
    ].forEach(function (linea) { cuerpo.appendParagraph(linea); });

    const total = cuerpo.appendParagraph('Total a cobrar: ' + euros(d.total));
    total.setSpacingBefore(10);
    total.setSpacingAfter(14);
    total.editAsText().setBold(true).setFontSize(16);

    if (d.porCategoria.length) {
      cuerpo.appendParagraph('Desglose por categoría').setHeading(DocumentApp.ParagraphHeading.HEADING3);
      const filasCat = [['Categoría', 'Total']].concat(d.porCategoria.map(function (c) { return [c.nombre, euros(c.total)]; }));
      estilarTabla_(cuerpo.appendTable(filasCat), [300, 140], [1]);
    }

    cuerpo.appendParagraph('Detalle de tickets').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    if (d.tickets.length) {
      const filas = [['Nº', 'Fecha', 'Comercio', 'Categoría', 'Importe']].concat(d.tickets.map(function (t, i) {
        return [String(i + 1), t.fecha ? d.fmt(t.fecha) : '', t.comercio || ' ', t.categoria, euros(t.importe)];
      }));
      filas.push(['', '', '', 'TOTAL', euros(d.total)]);
      const tabla = cuerpo.appendTable(filas);
      estilarTabla_(tabla, [30, 70, 175, 105, 80], [0, 4]);
      tabla.getRow(filas.length - 1).editAsText().setBold(true);
      const nota = cuerpo.appendParagraph('La foto de cada ticket está en el anexo, al final del informe, con el mismo número.');
      nota.editAsText().setFontSize(9).setForegroundColor('#5f6368');
    } else {
      cuerpo.appendParagraph('Este proyecto no tiene tickets.');
    }

    // Presentado por: nombre, DNI, fecha y firma
    const presentado = cuerpo.appendParagraph('Presentado por');
    presentado.setHeading(DocumentApp.ParagraphHeading.HEADING3);
    presentado.setSpacingBefore(22);
    [
      ['Nombre y apellidos: ', firmante.nombre || '________________________________________'],
      ['DNI: ', firmante.dni || '____________________'],
      ['Fecha: ', d.fmt(ahora)],
    ].forEach(function (par) {
      const linea = cuerpo.appendParagraph(par[0] + par[1]);
      linea.editAsText().setBold(0, par[0].length - 1, true);
    });
    const etiquetaFirma = cuerpo.appendParagraph('Firma:');
    etiquetaFirma.setSpacingBefore(8);
    etiquetaFirma.editAsText().setBold(true);
    if (firmante.blob) {
      const img = cuerpo.appendImage(firmante.blob);
      const escala = Math.min(1, 200 / img.getWidth(), 80 / img.getHeight());
      img.setWidth(Math.round(img.getWidth() * escala)).setHeight(Math.round(img.getHeight() * escala));
    } else {
      const hueco = cuerpo.appendParagraph('\n\n________________________________');
      hueco.editAsText().setForegroundColor('#9aa0a6');
    }

    // Anexo: una página por ticket con su foto (sin enlaces externos)
    const anchoMax = cuerpo.getPageWidth() - 108;
    const altoMax = cuerpo.getPageHeight() - 96 - 90;
    d.tickets.forEach(function (t, i) {
      cuerpo.appendPageBreak();
      const cab = cuerpo.appendParagraph('Anexo · Ticket ' + (i + 1) + ' de ' + d.tickets.length);
      cab.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      const info = cuerpo.appendParagraph([t.fecha ? d.fmt(t.fecha) : '', t.comercio, t.categoria, euros(t.importe)]
        .filter(Boolean).join('  ·  '));
      info.setSpacingAfter(10);
      info.editAsText().setFontSize(10).setForegroundColor('#3c4043');
      const foto = fotoDeTicket_(t.url);
      if (foto) {
        try {
          const img = cuerpo.appendImage(foto);
          const escala = Math.min(1, anchoMax / img.getWidth(), altoMax / img.getHeight());
          img.setWidth(Math.floor(img.getWidth() * escala)).setHeight(Math.floor(img.getHeight() * escala));
          return;
        } catch (e) {
          console.warn('No se pudo añadir la foto del ticket ' + (i + 1) + ': ' + e);
        }
      }
      const falta = cuerpo.appendParagraph('(No se ha encontrado la foto de este ticket)');
      falta.editAsText().setItalic(true).setForegroundColor('#80868b');
    });

    doc.saveAndClose();
    return DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(titulo + '.pdf');
  } finally {
    DriveApp.getFileById(docId).setTrashed(true);
  }
}

/**
 * Devuelve la foto original de un ticket a partir del enlace a su PDF:
 * primero por la descripción del PDF ("Foto original: <url>") y, si no,
 * buscando en "Fotos originales" un archivo con el mismo nombre.
 */
function fotoDeTicket_(urlPdf) {
  const id = extraerIdArchivo_(urlPdf);
  if (!id) return null;
  try {
    const pdf = DriveApp.getFileById(id);
    const m = String(pdf.getDescription() || '').match(/Foto original:\s*(\S+)/);
    const idFoto = m ? extraerIdArchivo_(m[1]) : null;
    if (idFoto) {
      try {
        const f = DriveApp.getFileById(idFoto);
        if (!f.isTrashed()) return f.getBlob();
      } catch (e) { /* se busca por nombre */ }
    }
    const base = pdf.getName().replace(/\.pdf$/i, '');
    const padres = pdf.getParents();
    while (padres.hasNext()) {
      const fotos = padres.next().getFoldersByName(CONFIG.SUBCARPETA_FOTOS);
      while (fotos.hasNext()) {
        const carpeta = fotos.next();
        for (const ext of ['.jpg', '.png']) {
          const it = carpeta.getFilesByName(base + ext);
          if (it.hasNext()) return it.next().getBlob();
        }
      }
    }
  } catch (e) {
    console.warn('Foto no encontrada para ' + urlPdf + ': ' + e);
  }
  return null;
}

function extraerIdArchivo_(url) {
  const m = String(url || '').match(/\/d\/([-\w]{10,})/) || String(url || '').match(/[?&]id=([-\w]{10,})/);
  return m ? m[1] : null;
}

/**
 * Envía por correo el informe PDF de un proyecto cerrado, como adjunto,
 * desde la cuenta de Gmail de quien usa la app.
 * @param {string} id proyecto
 * @param {{para:string, asunto:string, mensaje:string}} correo
 */
function enviarInforme(id, correo) {
  const p = obtenerProyecto_(id);
  if (!p.informeId) throw new Error('Este proyecto todavía no tiene informe. Ciérralo primero.');
  const para = String(correo.para || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (!para.length) throw new Error('Escribe el correo del destinatario.');
  const malos = para.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  if (malos.length) throw new Error('Revisa este correo: ' + malos.join(', '));
  if (MailApp.getRemainingDailyQuota() < para.length) {
    throw new Error('Has llegado al límite diario de correos de Google. Prueba mañana o descarga el PDF y envíalo a mano.');
  }

  let pdf;
  try {
    pdf = DriveApp.getFileById(p.informeId);
  } catch (e) {
    throw new Error('No encuentro el PDF del informe. Reabre el proyecto y vuelve a cerrarlo.');
  }
  if (pdf.getSize() > 24 * 1024 * 1024) {
    throw new Error('El informe pesa demasiado para enviarlo por correo (más de 24 MB). Descárgalo y compártelo con un enlace.');
  }

  const firmante = leerFirmante_();
  MailApp.sendEmail({
    to: para.join(','),
    subject: String(correo.asunto || ('Informe de gastos - ' + p.nombre)).slice(0, 200),
    body: String(correo.mensaje || ''),
    name: firmante.nombre || 'Tickets de gastos',
    attachments: [pdf.getBlob()],
  });
  props_().setProperty('ULTIMO_DESTINATARIO', para.join(', '));
  p.enviado = new Date().toISOString();
  p.enviadoA = para.join(', ');
  guardarProyecto_(p);
  return { para: para.join(', '), lista: listarProyectos() };
}

function estilarTabla_(tabla, anchos, columnasDerecha) {
  tabla.setBorderColor('#c5cae9');
  anchos.forEach(function (a, i) { tabla.setColumnWidth(i, a); });
  for (let f = 0; f < tabla.getNumRows(); f++) {
    const fila = tabla.getRow(f);
    for (let c = 0; c < fila.getNumCells(); c++) {
      const celda = fila.getCell(c);
      celda.setPaddingTop(4);
      celda.setPaddingBottom(4);
      celda.editAsText().setFontSize(10);
      if (columnasDerecha.indexOf(c) !== -1) {
        celda.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
      if (f === 0) celda.setBackgroundColor('#e8eaf6');
    }
  }
  tabla.getRow(0).editAsText().setBold(true);
}

/* ------------------------------------------------------------------ */
/* Firmante: nombre, DNI y firma para los informes                     */
/* ------------------------------------------------------------------ */

const NOMBRE_ARCHIVO_FIRMA = 'Firma para informes (no borrar).png';

function leerFirmante_() {
  const p = props_();
  let blob = null;
  const id = p.getProperty('FIRMA_ID');
  if (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (!f.isTrashed()) blob = f.getBlob();
    } catch (e) { /* firma borrada */ }
  }
  return {
    nombre: p.getProperty('FIRMANTE_NOMBRE') || '',
    dni: p.getProperty('FIRMANTE_DNI') || '',
    blob: blob,
  };
}

/** Para la app. Con conImagen, incluye la firma como data URL para verla. */
function firmanteParaPantalla_(conImagen) {
  const f = conImagen ? leerFirmante_() : null;
  const p = props_();
  return {
    nombre: p.getProperty('FIRMANTE_NOMBRE') || '',
    dni: p.getProperty('FIRMANTE_DNI') || '',
    tieneFirma: conImagen ? !!f.blob : !!p.getProperty('FIRMA_ID'),
    firma: conImagen && f.blob
      ? 'data:' + f.blob.getContentType() + ';base64,' + Utilities.base64Encode(f.blob.getBytes())
      : null,
  };
}

/**
 * @param {{nombre:string, dni:string, firmaBase64:(string|undefined), borrarFirma:boolean}} f
 *   firmaBase64: PNG nuevo (sin el prefijo data:). Si no viene, se conserva la firma actual.
 */
function guardarFirmante_(f) {
  const p = props_();
  const nombre = String(f.nombre || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  let dni = String(f.dni || '').trim();
  if (dni) {
    const valido = dniValido_(dni);
    if (!valido) throw new Error('El DNI/NIE no es válido. Revisa los números y la letra (ej.: 12345678Z).');
    dni = valido;
  }
  p.setProperty('FIRMANTE_NOMBRE', nombre);
  p.setProperty('FIRMANTE_DNI', dni);

  const anterior = p.getProperty('FIRMA_ID');
  const quitarAnterior = function () {
    if (!anterior) return;
    try { DriveApp.getFileById(anterior).setTrashed(true); } catch (e) { /* ya no existe */ }
    p.deleteProperty('FIRMA_ID');
  };
  if (f.firmaBase64) {
    const bytes = Utilities.base64Decode(f.firmaBase64);
    if (bytes.length > 1024 * 1024) throw new Error('La imagen de la firma es demasiado grande.');
    const archivo = obtenerCarpetaRaiz_().createFile(
      Utilities.newBlob(bytes, 'image/png', NOMBRE_ARCHIVO_FIRMA));
    archivo.setDescription('Firma que se añade a los informes de cierre de proyecto.');
    quitarAnterior();
    p.setProperty('FIRMA_ID', archivo.getId());
  } else if (f.borrarFirma) {
    quitarAnterior();
  }
}

/** Devuelve el DNI/NIE normalizado (12345678Z) si la letra es correcta, o null. */
function dniValido_(s) {
  const t = String(s || '').toUpperCase().replace(/[\s.\-]/g, '');
  const letras = 'TRWAGMYFPDXBNJZSQVHLCKE';
  let m = t.match(/^(\d{8})([A-Z])$/);
  if (m) return letras[Number(m[1]) % 23] === m[2] ? t : null;
  m = t.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (m) {
    const num = Number('XYZ'.indexOf(m[1]) + m[2]);
    return letras[num % 23] === m[3] ? t : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Ajustes                                                             */
/* ------------------------------------------------------------------ */

function obtenerConfiguracion() {
  const carpeta = obtenerCarpetaRaiz_();
  const libro = obtenerHoja_().getParent();
  return {
    carpeta: { id: carpeta.getId(), nombre: carpeta.getName(), ruta: rutaCarpeta_(carpeta) },
    nombreHoja: libro.getName(),
    hojaUrl: libro.getUrl(),
    categorias: obtenerCategorias_(),
    firmante: firmanteParaPantalla_(true),
  };
}

/**
 * Lista las subcarpetas de una carpeta de Drive (para el selector).
 * @param {string=} idOEnlace ID o enlace de la carpeta; vacío = Mi unidad.
 */
function listarCarpetas(idOEnlace) {
  let carpeta;
  if (!idOEnlace) {
    carpeta = DriveApp.getRootFolder();
  } else {
    try {
      carpeta = DriveApp.getFolderById(extraerIdDrive_(idOEnlace));
      carpeta.getName();
    } catch (e) {
      throw new Error('No encuentro esa carpeta. Revisa el enlace o que tengas acceso.');
    }
  }
  const subcarpetas = [];
  const it = carpeta.getFolders();
  while (it.hasNext() && subcarpetas.length < 300) {
    const f = it.next();
    if (!f.isTrashed()) subcarpetas.push({ id: f.getId(), nombre: f.getName() });
  }
  subcarpetas.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  const ruta = rutaCarpeta_(carpeta);
  return {
    id: carpeta.getId(),
    nombre: ruta[ruta.length - 1].nombre,
    ruta: ruta,
    subcarpetas: subcarpetas,
  };
}

function crearCarpeta(idPadre, nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('Escribe un nombre para la carpeta.');
  const padre = idPadre ? DriveApp.getFolderById(idPadre) : DriveApp.getRootFolder();
  return listarCarpetas(padre.createFolder(nombre).getId());
}

/**
 * Guarda los ajustes.
 * @param {{carpetaId:string, categorias:string[], firmante:Object}} cfg
 *   Si cambia la carpeta, el registro general se mueve con ella.
 */
function guardarConfiguracion(cfg) {
  const p = props_();
  if (cfg.firmante) guardarFirmante_(cfg.firmante);

  const vistas = {};
  const categorias = (cfg.categorias || []).map(function (c) { return String(c).trim(); })
    .filter(function (c) {
      const k = c.toLowerCase();
      if (!c || vistas[k]) return false;
      vistas[k] = true;
      return true;
    });
  if (!categorias.length) throw new Error('Añade al menos una categoría.');

  let carpeta;
  try {
    carpeta = DriveApp.getFolderById(extraerIdDrive_(cfg.carpetaId));
    carpeta.getName();
  } catch (e) {
    throw new Error('No encuentro la carpeta elegida.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    p.setProperty('CARPETA_ID', carpeta.getId());
    p.setProperty('CATEGORIAS', JSON.stringify(categorias));

    // El registro general acompaña siempre a la carpeta principal.
    const hoja = obtenerHoja_();
    const registro = DriveApp.getFileById(hoja.getParent().getId());
    if (!estaEnCarpeta_(registro, carpeta)) registro.moveTo(carpeta);
    aplicarValidacionCategorias_(hoja);
  } finally {
    lock.releaseLock();
  }
  return obtenerConfiguracion();
}

/* ------------------------------------------------------------------ */
/* Drive y hoja de cálculo                                            */
/* ------------------------------------------------------------------ */

function props_() {
  return PropertiesService.getScriptProperties();
}

function obtenerCategorias_() {
  try {
    const c = JSON.parse(props_().getProperty('CATEGORIAS'));
    if (Array.isArray(c) && c.length) return c;
  } catch (e) { /* por defecto */ }
  return CONFIG.CATEGORIAS.slice();
}

function obtenerCarpetaRaiz_() {
  const p = props_();
  const id = p.getProperty('CARPETA_ID');
  if (id) {
    try {
      const carpeta = DriveApp.getFolderById(id);
      if (!carpeta.isTrashed()) return carpeta;
    } catch (e) { /* se volverá a crear */ }
  }
  const existentes = DriveApp.getFoldersByName(CONFIG.NOMBRE_CARPETA);
  const carpeta = existentes.hasNext() ? existentes.next() : DriveApp.createFolder(CONFIG.NOMBRE_CARPETA);
  p.setProperty('CARPETA_ID', carpeta.getId());
  return carpeta;
}

function obtenerSubcarpeta_(padre, nombre) {
  const existentes = padre.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : padre.createFolder(nombre);
}

function estaEnCarpeta_(archivo, carpeta) {
  const padres = archivo.getParents();
  while (padres.hasNext()) {
    if (padres.next().getId() === carpeta.getId()) return true;
  }
  return false;
}

let idRaiz_ = null;
function rutaCarpeta_(carpeta) {
  if (!idRaiz_) idRaiz_ = DriveApp.getRootFolder().getId();
  const ruta = [];
  let actual = carpeta;
  for (let i = 0; i < 25 && actual; i++) {
    const esRaiz = actual.getId() === idRaiz_;
    ruta.unshift({ id: actual.getId(), nombre: esRaiz ? 'Mi unidad' : actual.getName() });
    if (esRaiz) break;
    const padres = actual.getParents();
    actual = padres.hasNext() ? padres.next() : null;
  }
  return ruta;
}

function extraerIdDrive_(s) {
  s = String(s || '').trim();
  const m = s.match(/folders\/([-\w]{10,})/) || s.match(/[?&]id=([-\w]{10,})/);
  return m ? m[1] : s;
}

function buscarLibroEnCarpeta_(carpeta, nombre) {
  const it = carpeta.getFilesByName(nombre);
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS && !f.isTrashed()) {
      return SpreadsheetApp.openById(f.getId());
    }
  }
  return null;
}

function crearLibro_(carpeta, nombre) {
  const ss = SpreadsheetApp.create(nombre);
  DriveApp.getFileById(ss.getId()).moveTo(carpeta);
  return ss;
}

function obtenerLibro_() {
  const p = props_();
  const id = p.getProperty('HOJA_ID');
  if (id) {
    try {
      const archivo = DriveApp.getFileById(id);
      if (!archivo.isTrashed()) {
        marcarComoRegistro_(archivo);
        return SpreadsheetApp.openById(id);
      }
    } catch (e) { /* se buscará o creará */ }
  }
  const carpeta = obtenerCarpetaRaiz_();
  const ss = buscarLibroEnCarpeta_(carpeta, CONFIG.NOMBRE_HOJA) ||
    buscarLibroEnCarpeta_(carpeta, CONFIG.NOMBRE_HOJA_ANTIGUO) ||
    crearLibro_(carpeta, CONFIG.NOMBRE_HOJA);
  p.setProperty('HOJA_ID', ss.getId());
  marcarComoRegistro_(DriveApp.getFileById(ss.getId()));
  return ss;
}

/** La hoja general pasa a ser un registro automático: nombre fijo y descripción. */
function marcarComoRegistro_(archivo) {
  const p = props_();
  if (p.getProperty('REGISTRO_MARCADO') === archivo.getId()) return;
  if (archivo.getName() !== CONFIG.NOMBRE_HOJA) archivo.setName(CONFIG.NOMBRE_HOJA);
  archivo.setDescription('Registro automático de todos los tickets de todos los proyectos. ' +
    'Lo usa la app para los Totales y como copia de seguridad. No hace falta tocarlo.');
  p.setProperty('REGISTRO_MARCADO', archivo.getId());
}

/** Devuelve la pestaña "Gastos" (la crea o actualiza si hace falta). */
function obtenerHoja_() {
  const ss = obtenerLibro_();
  let hoja = ss.getSheetByName(CONFIG.NOMBRE_PESTANA);
  if (!hoja) {
    const primera = ss.getSheets()[0];
    if (primera.getLastRow() === 0 && primera.getName() !== CONFIG.NOMBRE_RESUMEN) {
      hoja = primera.setName(CONFIG.NOMBRE_PESTANA);
    } else {
      hoja = ss.insertSheet(CONFIG.NOMBRE_PESTANA, 0);
    }
    formatearHojaGastos_(hoja);
  } else if (hoja.getLastColumn() === 4 &&
      String(hoja.getRange(1, 3).getValue()) === 'Comercio' &&
      String(hoja.getRange(1, 4).getValue()) === 'Importe') {
    // Hoja de la versión anterior (sin Categoría ni Proyecto): se añaden las columnas.
    hoja.insertColumnsAfter(COL.COMERCIO, 2);
    formatearHojaGastos_(hoja);
  }
  if (!ss.getSheetByName(CONFIG.NOMBRE_RESUMEN)) crearHojaResumen_(ss);
  return hoja;
}

function formatearHojaGastos_(hoja) {
  hoja.getRange(1, 1, 1, NCOLS)
    .setValues([CABECERAS])
    .setFontWeight('bold')
    .setBackground('#e8f0fe');
  hoja.setFrozenRows(1);
  hoja.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
  hoja.getRange('B2:B').setNumberFormat('@');
  hoja.getRange('C2:E').setNumberFormat('@');
  hoja.getRange('F2:F').setNumberFormat('#,##0.00 [$€-C0A]');
  [100, 70, 240, 150, 160, 100].forEach(function (ancho, i) { hoja.setColumnWidth(i + 1, ancho); });
  aplicarValidacionCategorias_(hoja);
}

function aplicarValidacionCategorias_(hoja) {
  const regla = SpreadsheetApp.newDataValidation()
    .requireValueInList(obtenerCategorias_(), true)
    .setAllowInvalid(true)
    .build();
  hoja.getRange(2, COL.CATEGORIA, Math.max(1, hoja.getMaxRows() - 1), 1).setDataValidation(regla);
}

/**
 * Pestaña "Resumen": eliges Desde / Hasta / Proyecto y muestra el total,
 * el número de tickets y el desglose por categoría y por proyecto.
 */
function crearHojaResumen_(ss) {
  const r = ss.insertSheet(CONFIG.NOMBRE_RESUMEN);
  const g = "'" + CONFIG.NOMBRE_PESTANA + "'!";
  const hoy = new Date();

  r.getRange('A1').setValue('Resumen de gastos').setFontSize(14).setFontWeight('bold');
  r.getRange('A3:A5').setValues([['Desde'], ['Hasta'], ['Proyecto']]).setFontWeight('bold');
  r.getRange('B3:B4').setValues([[new Date(hoy.getFullYear(), hoy.getMonth(), 1)],
    [new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())]]).setNumberFormat('dd/mm/yyyy');
  r.getRange('B3:B5').setBackground('#fef7e0');
  r.getRange('C3').setValue('← cambia las fechas');
  r.getRange('C5').setValue('← vacío = todos los proyectos');
  r.getRange('C3:C5').setFontColor('#80868b');
  r.getRange('B5').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(CONFIG.NOMBRE_PESTANA).getRange('E2:E'), true)
    .setAllowInvalid(true).build());

  const fechas = g + 'A2:A, ">="&B3, ' + g + 'A2:A, "<="&B4';
  const deProyecto = ', ' + g + 'E2:E, B5';
  const formulas = {
    B7: '=IF(B5="", SUMIFS(' + g + 'F2:F, ' + fechas + '), SUMIFS(' + g + 'F2:F, ' + fechas + deProyecto + '))',
    B8: '=IF(B5="", COUNTIFS(' + fechas + ', ' + g + 'F2:F, "<>"), COUNTIFS(' + fechas + ', ' + g + 'F2:F, "<>"' + deProyecto + '))',
  };
  r.getRange('A7:A8').setValues([['Total'], ['Nº de tickets']]).setFontWeight('bold');
  r.getRange('B7').setNumberFormat('#,##0.00 [$€-C0A]').setFontWeight('bold').setFontSize(12);
  r.getRange('B8').setNumberFormat('0');

  const isoFecha = function (celda) {
    return 'TEXT(YEAR(' + celda + '),"0000")&"-"&TEXT(MONTH(' + celda + '),"00")&"-"&TEXT(DAY(' + celda + '),"00")';
  };
  const donde = '" where A >= date \'"&' + isoFecha('B3') + '&"\' and A <= date \'"&' + isoFecha('B4') +
    '&"\' and F is not null"&IF(B5="", "", " and E = \'"&B5&"\'")';
  const consulta = function (col, titulo) {
    return '=IFERROR(QUERY(' + g + 'A2:F, "select ' + col + ', sum(F)"&' + donde +
      '&" group by ' + col + ' order by sum(F) desc label ' + col + ' \'' + titulo +
      '\', sum(F) \'Total\'", 0), "Sin gastos en el periodo")';
  };
  formulas.A11 = consulta('D', 'Categoría');
  formulas.D11 = consulta('E', 'Proyecto');
  r.getRange('A10').setValue('Por categoría').setFontWeight('bold');
  r.getRange('D10').setValue('Por proyecto').setFontWeight('bold');
  ponerFormulas_(r, formulas);
  r.getRange('B12:B200').setNumberFormat('#,##0.00 [$€-C0A]');
  r.getRange('E12:E200').setNumberFormat('#,##0.00 [$€-C0A]');
  r.setColumnWidth(1, 160);
  r.setColumnWidth(2, 120);
  r.setColumnWidth(3, 40);
  r.setColumnWidth(4, 160);
  r.setColumnWidth(5, 120);
}

/**
 * Escribe las fórmulas. Si alguna da error de análisis (hojas configuradas
 * para usar ";" como separador), se vuelve a escribir con ";".
 */
function ponerFormulas_(hoja, formulas) {
  Object.keys(formulas).forEach(function (celda) {
    hoja.getRange(celda).setFormula(formulas[celda]);
  });
  SpreadsheetApp.flush();
  Object.keys(formulas).forEach(function (celda) {
    const rango = hoja.getRange(celda);
    if (/^#ERROR/.test(rango.getDisplayValue())) {
      rango.setFormula(aPuntoYComa_(formulas[celda]));
    }
  });
}

/** Cambia las comas separadoras de argumentos por ";" (sin tocar los textos). */
function aPuntoYComa_(formula) {
  let salida = '';
  let enTexto = false;
  for (let i = 0; i < formula.length; i++) {
    const c = formula[i];
    if (c === '"') enTexto = !enTexto;
    salida += (c === ',' && !enTexto) ? ';' : c;
  }
  return salida;
}

/** Si la pestaña Resumen muestra errores (versión anterior), se rehace. */
function revisarResumen_(ss) {
  const r = ss.getSheetByName(CONFIG.NOMBRE_RESUMEN);
  if (!r) return;
  const valores = ['B7', 'B8', 'A11', 'D11'].map(function (c) { return r.getRange(c).getDisplayValue(); });
  if (valores.some(function (v) { return /^#ERROR/.test(v); })) {
    const pos = r.getIndex();
    ss.deleteSheet(r);
    crearHojaResumen_(ss);
    ss.setActiveSheet(ss.getSheetByName(CONFIG.NOMBRE_RESUMEN));
    ss.moveActiveSheet(pos);
  }
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

    const cabecera = cuerpo.getParagraphs()[0];
    cabecera.setText(titulo);
    cabecera.setHeading(DocumentApp.ParagraphHeading.HEADING3);
    lineasInfo.forEach(function (linea) {
      cuerpo.appendParagraph(linea).editAsText().setFontSize(10);
    });

    const img = cuerpo.appendImage(imagen);
    const ancho = img.getWidth();
    const alto = img.getHeight();
    const anchoMax = cuerpo.getPageWidth() - 2 * margen;
    const altoMax = cuerpo.getPageHeight() - 2 * margen - 130; // espacio para la cabecera
    const escala = Math.min(1, anchoMax / ancho, altoMax / alto);
    img.setWidth(Math.floor(ancho * escala)).setHeight(Math.floor(alto * escala));

    doc.saveAndClose();
    return DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(titulo + '.pdf');
  } finally {
    DriveApp.getFileById(docId).setTrashed(true);
  }
}

/* ------------------------------------------------------------------ */
/* Recordar la categoría de cada comercio                              */
/* ------------------------------------------------------------------ */

function leerRecordados_() {
  try {
    const lista = JSON.parse(props_().getProperty('CATEGORIA_POR_COMERCIO') || '[]');
    const mapa = {};
    lista.forEach(function (par) { mapa[par[0]] = par[1]; });
    return mapa;
  } catch (e) {
    return {};
  }
}

function recordarCategoria_(comercio, categoria) {
  const clave = normalizar_(comercio);
  if (!clave) return;
  let lista;
  try { lista = JSON.parse(props_().getProperty('CATEGORIA_POR_COMERCIO') || '[]'); } catch (e) { lista = []; }
  lista = lista.filter(function (par) { return par[0] !== clave; });
  lista.push([clave, categoria]);
  if (lista.length > MAX_RECORDADOS) lista = lista.slice(-MAX_RECORDADOS);
  props_().setProperty('CATEGORIA_POR_COMERCIO', JSON.stringify(lista));
}

function fechaDesdeIso_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function redondear_(n) {
  return Math.round(n * 100) / 100;
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

/** "Mercadona, S.A." -> "mercadona s a" (para recordar la categoría) */
function normalizar_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

// Permite probar el parser con Node (no afecta a Apps Script).
if (typeof module !== 'undefined') {
  module.exports = { parsearTextoTicket_, aNumero_, formatearNombre_, normalizar_, obtenerTotales, dniValido_ };
}
