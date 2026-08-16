/**
 * Платиновый зал — мост между Google Документом и страницей.
 *
 * Читает документ со списком игр и отдаёт его в виде JSON:
 *   { "2012": ["The Darkness 2", ...], "2013": [...], ... }
 *
 * Как поставить:
 *  1. Открой Google Документ со списком.
 *  2. Меню: Расширения → Apps Script.
 *  3. Удали всё, вставь этот файл целиком.
 *  4. Deploy → New deployment → тип "Web app":
 *        Execute as: Me
 *        Who has access: Anyone
 *     Deploy → разреши доступ → скопируй "Web app URL" (…/exec).
 *  5. Вставь этот URL в index.html в переменную DATA_URL.
 *
 * Формат документа: строка с четырёхзначным годом (например "2024 год")
 * открывает новый год; каждая следующая непустая строка — название игры.
 * Платформа берётся из эмодзи-меток в документе:
 *   :rubek_gamepad: → платина на PS5      :Dominate: → 100% на ПК
 * Метки вычищаются из названий автоматически. Если метки нет, платину на
 * PS5 можно пометить суффиксом " (PS5)" — например "Astro Bot (PS5)".
 */

var DOC_ID = '1AFocKDI4liOhW7wmR1kBQCT1XyJhmYbjsHGeyUGabcI';

function doGet() {
  var text = DocumentApp.openById(DOC_ID).getBody().getText();
  var lines = text.split('\n');
  var data = {};
  var current = null;
  var yearRe = /^\s*((?:19|20)\d{2})(?:\s|\D|$)/; // строка, начинающаяся с года
  var tagRe  = /:[A-Za-z0-9_]+:/g;               // эмодзи-метки вида :Dominate:

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var isPs = /:rubek_gamepad:/.test(raw);       // метка PS5-платины

    // Убираем метки и лишние пробелы
    var title = raw.replace(tagRe, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!title) continue;                          // строка была только меткой — пропускаем

    var m = title.match(yearRe);
    if (m) {                                       // заголовок года
      current = m[1];
      if (!data[current]) data[current] = [];
      continue;
    }
    if (!current) continue;

    // Метка геймпада = PS5: гарантируем суффикс (PS5), чтобы страница показала платформу
    if (isPs && !/\(PS5\)\s*$/.test(title)) title += ' (PS5)';
    data[current].push(title);
  }

  return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
}
