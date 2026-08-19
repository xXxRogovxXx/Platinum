/**
 * Платиновый зал — мост Google Docs → страница, с автоподбором обложек.
 *
 * Читает документ со списком игр и отдаёт JSON вида:
 *   { "2012": [ {"t":"The Darkness 2","c":"https://...jpg","p":"pc"}, ... ], ... }
 *     t — название, c — ссылка на обложку (может быть пустой), p — платформа (ps|pc)
 *
 * Обложки ищет сам скрипт (на сервере Google, без CORS) через RAWG.io и
 * запоминает НАВСЕГДА в свойствах проекта. Каждая игра ищется один раз:
 * друг дописал новую игру → при следующем открытии подтянется только она.
 *
 * ── Установка (один раз) ────────────────────────────────────────────────
 *  1. Получи бесплатный ключ RAWG: https://rawg.io/apidocs  (Get API Key).
 *  2. В редакторе Apps Script: слева ⚙ Project Settings → Script Properties →
 *     Add property:  имя  RAWG_KEY   значение  <твой ключ>.   Save.
 *  3. Вставь этот файл целиком (Code.gs), сохрани.
 *  4. Deploy → Manage deployments → ✎ (Edit) → Version: New version → Deploy.
 *     URL (…/exec) остаётся прежним — на странице ничего менять не нужно.
 *
 * Формат документа: строка с годом ("2024 год") открывает год; далее — игры.
 * Платформа берётся из меток :rubek_gamepad: (PS5) и :Dominate: (ПК); метки
 * вычищаются из названий автоматически.
 */

var DOC_ID   = '1AFocKDI4liOhW7wmR1kBQCT1XyJhmYbjsHGeyUGabcI';
var MAX_NEW  = 30;   // сколько НОВЫХ обложек искать за один запрос (остальные — при след. заходах)

function doGet() {
  var props   = PropertiesService.getScriptProperties();
  var stored  = props.getProperties();          // читаем весь кэш разом
  var toWrite = {};
  var newDone = 0;

  var text   = DocumentApp.openById(DOC_ID).getBody().getText();
  var lines  = text.split('\n');
  var data   = {};
  var current = null;
  var yearRe = /^\s*((?:19|20)\d{2})(?:\s|\D|$)/;
  var tagRe  = /:[A-Za-z0-9_]+:/g;

  for (var i = 0; i < lines.length; i++) {
    var raw  = lines[i];
    var isPs = /:rubek_gamepad:/.test(raw);
    var title = raw.replace(tagRe, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!title) continue;

    var m = title.match(yearRe);
    if (m) { current = m[1]; if (!data[current]) data[current] = []; continue; }
    if (!current) continue;

    if (isPs && !/\(PS5\)\s*$/.test(title)) title += ' (PS5)';
    var plat = /\(PS5\)\s*$/.test(title) ? 'ps' : 'pc';

    // Обложка: из кэша, либо ищем (не более MAX_NEW новых за запрос)
    var ck = 'cov::' + title;
    var cover;
    if (stored.hasOwnProperty(ck)) {
      cover = stored[ck];                        // уже искали ('' = не нашлось)
    } else if (newDone < MAX_NEW) {
      cover = fetchCover_(title);
      toWrite[ck] = cover;
      newDone++;
    } else {
      cover = '';                                // добьём при следующем открытии
    }

    data[current].push({ t: title.replace(/\s*\(PS5\)\s*$/, ''), c: cover, p: plat });
  }

  if (newDone) props.setProperties(toWrite, false); // сохраняем новые обложки в кэш

  return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
}

/** Ищет обложку игры в RAWG. Возвращает URL или '' если не нашлось. */
function fetchCover_(title) {
  var key = PropertiesService.getScriptProperties().getProperty('RAWG_KEY');
  if (!key) return '';

  var q = title.replace(/\(PS5\)/ig, '')
               .replace(/[™®]/g, '')
               .replace(/\bdemo\b/ig, '')
               .replace(/\s+/g, ' ').trim();

  var url = 'https://api.rawg.io/api/games?key=' + encodeURIComponent(key) +
            '&search=' + encodeURIComponent(q) + '&page_size=6';

  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '';
    var results = (JSON.parse(res.getContentText()).results) || [];
    var target = norm_(q);

    // 1) точное/вложенное совпадение имени
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.background_image) continue;
      var n = norm_(r.name);
      if (n === target || n.indexOf(target) >= 0 || target.indexOf(n) >= 0) return r.background_image;
    }
    // 2) достаточное пересечение слов (защита от случайных обложек)
    for (var j = 0; j < results.length; j++) {
      if (results[j].background_image && overlap_(target, norm_(results[j].name)) >= 0.6)
        return results[j].background_image;
    }
    return '';
  } catch (e) {
    return '';
  }
}

function norm_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9а-яё ]+/gi, ' ').replace(/\s+/g, ' ').trim();
}
function overlap_(a, b) {
  var A = a.split(' '), B = {}, hit = 0;
  b.split(' ').forEach(function (w) { if (w) B[w] = 1; });
  A.forEach(function (w) { if (w && B[w]) hit++; });
  return A.length ? hit / A.length : 0;
}
