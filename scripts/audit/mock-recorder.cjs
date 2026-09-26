// 步驟八：把測試假造的伺服器回應全部記下來（NODE_OPTIONS=--require 掛上去）。
// 每一筆寫一行 JSON 到 MOCK_LOG：{ test, url, status, body }
const fs = require('fs');
const path = require('path');
const net = require(path.join(__dirname, '../../node_modules/playwright-core/lib/client/network.js'));
const Route = net.Route;
const orig = Route.prototype.fulfill;
Route.prototype.fulfill = async function (options = {}) {
  try {
    let body = options.body;
    if (options.json !== undefined) body = JSON.stringify(options.json);
    const url = this.request().url();
    if (/\/api\//.test(url) && typeof body === 'string') {
      fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({ test: process.env.MOCK_TEST, url, method: this.request().method(), status: options.status || 200, body }) + '\n');
    }
  } catch (e) { /* 記錄失敗不影響測試 */ }
  return orig.call(this, options);
};
