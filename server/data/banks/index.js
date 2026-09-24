/**
 * 有哪幾本單字庫。
 *
 * 兩個孩子各有各的課本，結構一樣（四個 Part + Week 1~18）但內容不同，
 * 所以各是一本，各自獨立。帳號上記著他用哪一本（user.wordBankId）。
 *
 * ── 要加一本新的課本 ──────────────────────────────────────
 *   1. 在這個資料夾放一個新檔案，格式照 g3a.js
 *   2. idPrefix 一定要給一個**沒有人用過**的值
 *   3. 加進下面這張表
 *
 * idPrefix 為什麼不能省：錄音是跨帳號共用的（只用 wordId 當鍵），
 * 兩本課本如果都有 `w01-path`，Pierce 錄的聲音會被播到 Allen 那個完全
 * 不同的字上面，而且不會有任何錯誤訊息。細節見 ../build-bank.js 的檔頭。
 */

const g3a = require('./g3a');
const allen = require('./allen');

/* 排前面的是預設：沒有指定課本的舊帳號會拿到它 */
const BANK_SOURCES = [g3a, allen];

module.exports = { BANK_SOURCES };
