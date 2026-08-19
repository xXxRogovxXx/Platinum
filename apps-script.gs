/**
 * Платиновый зал — мост Google Docs → страница, с автоподбором обложек.
 *
 * Читает документ со списком игр и отдаёт JSON вида:
 *   { "2012": [ {"t":"The Darkness 2","c":"…/library_600x900.jpg",
 *               "h":"…/header.jpg","p":"pc"}, ... ], ... }
 *     t — название, c — вертикальная обложка, h — запасная (хедер), p — платформа (ps|pc)
 *
 * Обложки ищет сам скрипт (на сервере Google, без CORS) в Steam — БЕЗ ключа и
 * регистрации — и запоминает НАВСЕГДА в свойствах проекта. Каждая игра ищется
 * один раз: друг дописал новую → при следующем открытии подтянется только она.
 *
 * ── Установка (один раз) ────────────────────────────────────────────────
 *  1. В Google Документе со списком: Расширения → Apps Script.
 *  2. Вставь этот файл целиком (Code.gs), сохрани. Никаких ключей не нужно.
 *  3. Первый раз: Deploy → New deployment → Web app
 *        Execute as: Me   |   Who has access: Anyone   → Deploy → авторизуй.
 *     Обновление кода позже: Deploy → Manage deployments → ✎ Edit →
 *        Version: New version → Deploy (URL …/exec остаётся прежним).
 *
 * Формат документа: строка с годом ("2024 год") открывает год; далее — игры.
 * Платформа берётся из меток :rubek_gamepad: (PS5) и :Dominate: (ПК); метки
 * вычищаются из названий автоматически.
 */

var DOC_ID  = '1AFocKDI4liOhW7wmR1kBQCT1XyJhmYbjsHGeyUGabcI';
var MAX_NEW = 30;   // сколько НОВЫХ обложек искать за один запрос (остальные — при след. заходах)
var STEAM   = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';

// Ручные правки: точное название из дока → Steam appid ('' = принудительно без обложки).
// Сюда попадают игры, которые не находятся автопоиском (русские SKU, издания и т.п.).
var OVERRIDES = {
  'ЗВЁЗДНЫЕ ВОЙНЫ Джедаи: Павший Орден'        : '1172380', // STAR WARS Jedi: Fallen Order
  'Borderlands 2 RU'                            : '49520',   // Borderlands 2
  'Metro Exodus Enhanced Edition'               : '1449560',
  'Deus Ex: Human Revolution - Director\'s Cut' : '238010',
  'State of Decay: YOSE Day One Edition'        : '329430',  // State of Decay: YOSE
  'Brothers - A Tale of Two Sons'               : '225080'
};

/**
 * Запусти эту функцию ОДИН раз в редакторе (▶ Run) и выдай доступ
 * «Connect to an external service» — она открывает скрипту выход в интернет.
 * После этого поиск обложек в Steam заработает.
 */
function authorize() {
  var r = UrlFetchApp.fetch('https://store.steampowered.com/api/storesearch/?term=portal&cc=us&l=en',
                            { muteHttpExceptions: true });
  Logger.log('Steam ответил кодом: ' + r.getResponseCode());
}

function doGet(e) {
  e = e || {};
  var p = e.parameter || {};
  // Диагностика: ?debug=portal — показать, что скрипт получает от Steam.
  if (p.debug) return probe_(p.debug);
  // Сброс кэша обложек: ?reset=platinum — очистить и перезапросить заново.
  if (p.reset === 'platinum') {
    PropertiesService.getScriptProperties().deleteAllProperties();
    return json_({ cleared: true });
  }

  var props   = PropertiesService.getScriptProperties();
  var stored  = props.getProperties();
  var toWrite = {};
  var newDone = 0;

  var text    = DocumentApp.openById(DOC_ID).getBody().getText();
  var lines   = text.split('\n');
  var data    = {};
  var current = null;
  var yearRe  = /^\s*((?:19|20)\d{2})(?:\s|\D|$)/;
  var tagRe   = /:[A-Za-z0-9_]+:/g;

  for (var i = 0; i < lines.length; i++) {
    var raw   = lines[i];
    var isPs  = /:rubek_gamepad:/.test(raw);
    var title = raw.replace(tagRe, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!title) continue;

    var m = title.match(yearRe);
    if (m) { current = m[1]; if (!data[current]) data[current] = []; continue; }
    if (!current) continue;

    if (isPs && !/\(PS5\)\s*$/.test(title)) title += ' (PS5)';
    var plat  = /\(PS5\)\s*$/.test(title) ? 'ps' : 'pc';
    var clean = title.replace(/\s*\(PS5\)\s*$/, '');

    // Steam appid: из кэша, либо ищем (не более MAX_NEW новых за запрос)
    var ck = 'app::' + clean;
    var appid;
    if (OVERRIDES.hasOwnProperty(clean)) {
      appid = OVERRIDES[clean];
    } else if (stored.hasOwnProperty(ck)) {
      appid = stored[ck];
    } else if (newDone < MAX_NEW) {
      appid = steamAppId_(clean);
      toWrite[ck] = appid;
      newDone++;
    } else {
      appid = '';
    }

    var item = { t: clean, c: '', h: '', p: plat };
    if (appid) {
      item.c = STEAM + appid + '/library_600x900.jpg';
      item.h = STEAM + appid + '/header.jpg';
    }
    data[current].push(item);
  }

  if (newDone) props.setProperties(toWrite, false);

  return json_(data);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Диагностика: что реально возвращает Steam на запрос из Apps Script. */
function probe_(q) {
  var url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(q) + '&cc=us&l=en';
  var out = { term: q };
  try {
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    out.code = r.getResponseCode();
    var b = r.getContentText();
    out.len = b.length;
    out.sample = b.slice(0, 180);
  } catch (err) {
    out.error = String(err);
  }
  return json_(out);
}

/** Ищет игру в Steam по названию. Возвращает appid (строкой) или '' если надёжного совпадения нет. */
function steamAppId_(title) {
  var q = title.replace(/[™®]/g, '').replace(/\bdemo\b/ig, '').replace(/\s+/g, ' ').trim();
  var url = 'https://store.steampowered.com/api/storesearch/?term=' +
            encodeURIComponent(q) + '&cc=us&l=en';
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '';
    var items = (JSON.parse(res.getContentText()).items) || [];
    if (!items.length) return '';

    var target = norm_(q);
    var tWords = target.split(' ').length;

    // 1) точное совпадение имени
    for (var i = 0; i < items.length; i++) {
      if (items[i].id && norm_(items[i].name) === target) return String(items[i].id);
    }
    // 2) название результата НАЧИНАЕТСЯ с искомого (издание/подзаголовок).
    //    Для одного слова — только если это лучший (первый) результат.
    for (var k = 0; k < items.length; k++) {
      if (!items[k].id) continue;
      var n = norm_(items[k].name);
      if (n.indexOf(target + ' ') === 0 && (tWords >= 2 || k === 0)) return String(items[k].id);
    }
    // 3) искомое начинается с (более короткого) официального имени первого результата
    if (items[0].id) {
      var n0 = norm_(items[0].name);
      if (n0.split(' ').length >= 2 && target.indexOf(n0 + ' ') === 0) return String(items[0].id);
    }
    return '';
  } catch (e) {
    return '';
  }
}

var ROMAN = { i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6', vii:'7', viii:'8', ix:'9', x:'10' };
function norm_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9а-яё ]+/gi, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(function (w) { return ROMAN[w] || w; }).join(' ');  // римские = арабские
}
