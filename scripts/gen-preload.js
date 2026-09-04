/*
 * 產生各頁面的 <link rel="modulepreload"> 標籤。
 *
 * 為什麼需要：瀏覽器要先下載 practice.js 才知道它 import 了哪些檔案，
 * 下載完那些又發現還有下一層，形成多段瀑布，切換分頁會明顯變慢。
 * 事先把整張相依圖列出來，就能一次平行下載。
 *
 * 改動任何 import 之後執行：npm run gen-preload
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

const PAGES = {
  'index.html': '/js/login.js',
  'practice.html': '/js/practice.js',
  'wordbank.html': '/js/wordbank.js',
  'shop.html': '/js/shop.js',
  'profile.html': '/js/profile.js'
};

// 用明確的標記包住整段，重複執行才不會愈跑愈亂
const START = '<!-- modulepreload:start 由 npm run gen-preload 產生，請勿手動編輯 -->';
const END = '<!-- modulepreload:end -->';

/** 從進入點遞迴解析靜態 import，得出整張相依圖 */
function graph(entry, seen = new Set()) {
  const abs = path.join(PUB, entry);
  if (seen.has(entry) || !fs.existsSync(abs)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(abs, 'utf8');
  const re = /^\s*import\s[^'"]*['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src))) {
    if (!m[1].startsWith('.')) continue;
    const dep = '/' + path.normalize(path.join(path.dirname(entry), m[1])).replace(/^\/+/, '');
    graph(dep, seen);
  }
  return seen;
}

let changed = 0;
for (const [page, entry] of Object.entries(PAGES)) {
  const file = path.join(PUB, page);
  const before = fs.readFileSync(file, 'utf8');

  const block = [
    '  ' + START,
    ...[...graph(entry)].map((m) => `  <link rel="modulepreload" href="${m}" />`),
    '  ' + END
  ].join('\n');

  // 清掉舊的：先移除標記區塊，再掃掉任何殘留的 modulepreload 標籤與舊註解
  let html = before.replace(
    new RegExp(`[ \\t]*${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\n?`, 'g'),
    ''
  );
  html = html.replace(/[ \t]*<link rel="modulepreload"[^>]*>[ \t]*\n?/g, '');
  html = html.replace(/[ \t]*<!-- 一次預載整張模組相依圖[\s\S]*?-->[ \t]*\n?/g, '');

  // 標籤一律插在 </head> 之前——位置固定，不必依賴前面有什麼元素
  if (!/\n<\/head>/.test(html)) html = html.replace(/([ \t]*)<\/head>/, '\n$1</head>');
  html = html.replace(/\n([ \t]*)<\/head>/, `\n${block}\n$1</head>`);

  if (html !== before) changed += 1;
  fs.writeFileSync(file, html);
  console.log(`${page}: ${[...graph(entry)].length} 個模組`);
}
console.log(changed ? `✅ 更新了 ${changed} 個頁面` : '✅ 已經是最新狀態');
