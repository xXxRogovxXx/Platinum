/**
 * Платиновый зал — робот обогащения данных.
 *
 * Читает список игр из Google Doc (через /exec), сам находит в Steam:
 *   • appid (→ обложка), • топ‑3 самых редких достижения,
 * и пишет covers.json + achievements.json. Кэш (data/cache.json) хранит уже
 * решённые игры — на следующих запусках обрабатываются только новые.
 *
 * Запускается GitHub Action по расписанию и вручную. Node 20+ (global fetch).
 */

const fs = require('fs');
const path = require('path');

const DATA_URL = 'https://script.google.com/macros/s/AKfycbyzAzmNzRyW9m_iqBTzffF2yZZn5nWRG87h78qwnq_QIiJorY0HWGh-8dWpj8el8t-1/exec';

// Ручные правки: точное название → Steam appid ('' = принудительно без обложки).
const OVERRIDES = {
  'ЗВЁЗДНЫЕ ВОЙНЫ Джедаи: Павший Орден'        : '1172380',
  'Borderlands 2 RU'                            : '49520',
  'Metro Exodus Enhanced Edition'               : '1449560',
  "Deus Ex: Human Revolution - Director's Cut" : '238010',
  'State of Decay: YOSE Day One Edition'        : '329430',
  'Brothers - A Tale of Two Sons'               : '225080',
  'Call of Duty: Modern Warfare 2'              : '10180',
  'Call of Duty: Modern Warfare 3'              : '42680',
  'Half-Life 2: Episode One'                    : '380',
  'Hell Yeah!'                                  : '205230',
  'Darkness Within: In Pursuit of Loath Nolder' : ''
};

const ROMAN = { i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6', vii:'7', viii:'8', ix:'9', x:'10' };
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9а-яё ]+/gi,' ').replace(/\s+/g,' ').trim()
  .split(' ').map(w => ROMAN[w] || w).join(' ');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (PlatinumVaultBot)' } });
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(500 * (i + 1));
  }
  return '';
}
const getJson = async url => { const t = await getText(url); try { return JSON.parse(t); } catch { return null; } };

// Список игр из Google Doc: [{title, plat}]
async function readGames() {
  const data = await getJson(DATA_URL + (DATA_URL.includes('?') ? '&' : '?') + 't=' + Date.now());
  const games = [];
  if (data) for (const year of Object.keys(data)) {
    for (const it of data[year]) {
      const title = (typeof it === 'string' ? it : it.t || '').replace(/\s*\(PS5\)\s*$/, '').trim();
      if (title) games.push(title);
    }
  }
  return [...new Set(games)];
}

// Поиск Steam appid по названию (storesearch) с защитой от ложных совпадений.
async function resolveAppId(title) {
  if (Object.prototype.hasOwnProperty.call(OVERRIDES, title)) return OVERRIDES[title];
  const q = title.replace(/[™®]/g, '').replace(/\bdemo\b/ig, '').replace(/\s+/g, ' ').trim();
  const url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(q) + '&cc=us&l=en';
  const data = await getJson(url);
  const items = (data && data.items) || [];
  if (!items.length) return '';
  const target = norm(q), tW = target.split(' ').length;
  for (const it of items) if (it.id && norm(it.name) === target) return String(it.id);
  for (let k = 0; k < items.length; k++) {
    const it = items[k]; if (!it.id) continue;
    if (norm(it.name).indexOf(target + ' ') === 0 && (tW >= 2 || k === 0)) return String(it.id);
  }
  if (items[0].id) { const n0 = norm(items[0].name); if (n0.split(' ').length >= 2 && target.indexOf(n0 + ' ') === 0) return String(items[0].id); }
  return '';
}

function decode(s) {
  return s.replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&apos;/g,"'")
          .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&#(\d+);/g, (m,n) => String.fromCharCode(+n));
}

// Топ‑3 самых редких достижения игры (страница глобальной статистики Steam).
async function topAchievements(appid) {
  const html = await getText('https://steamcommunity.com/stats/' + appid + '/achievements/');
  if (!html) return [];
  const chunks = html.split('class="achieveRow'); chunks.shift();
  const list = [];
  for (const c of chunks) {
    const icon = (c.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
    const pct  = (c.match(/achievePercent">\s*([0-9.]+)%/) || [])[1];
    const name = (c.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1];
    const desc = (c.match(/<h5>([\s\S]*?)<\/h5>/) || [])[1] || '';
    if (name && pct !== undefined) list.push({ n: decode(name.trim()), d: decode(desc.trim()), p: parseFloat(pct), i: icon });
  }
  return list.sort((a, b) => a.p - b.p).slice(0, 3);
}

async function main() {
  const root = path.join(__dirname, '..');
  const cachePath = path.join(root, 'data', 'cache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}

  const games = await readGames();
  console.log('games in doc:', games.length);

  let resolved = 0;
  for (const title of games) {
    let e = cache[title];
    if (!e) {
      // Новая игра — ищем appid и достижения.
      const appid = await resolveAppId(title);
      await sleep(150);
      const ach = appid ? await topAchievements(appid) : [];
      if (appid) await sleep(150);
      e = { appid: appid || '', ach: ach || [], ts: Date.now() };
      cache[title] = e;
      resolved++;
    } else if (e.appid && (!e.ach || e.ach.length === 0)) {
      // Добираем достижения, если раньше их не было (игра могла выйти позже).
      const ach = await topAchievements(e.appid);
      await sleep(150);
      if (ach && ach.length) { e.ach = ach; e.ts = Date.now(); }
    }
    // Иначе — запись не трогаем: без изменений → без лишних коммитов.
  }

  // Собираем выходные файлы из кэша (только для игр, что есть в доке сейчас).
  const covers = {}, achievements = {};
  for (const title of games) {
    const e = cache[title]; if (!e) continue;
    if (e.appid) covers[title] = e.appid;
    if (e.ach && e.ach.length) achievements[title] = e.ach;
  }

  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  fs.writeFileSync(path.join(root, 'covers.json'), JSON.stringify(covers));
  fs.writeFileSync(path.join(root, 'achievements.json'), JSON.stringify(achievements));

  console.log(`new lookups: ${resolved} | covers: ${Object.keys(covers).length} | achievements: ${Object.keys(achievements).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
