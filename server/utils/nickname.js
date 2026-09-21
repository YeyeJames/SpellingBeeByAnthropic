/**
 * 暱稱驗證。
 *
 * 原本這裡還有 PIN 碼的雜湊與比對。拿掉了——這台機器只有我跟孩子在用，
 * 家裡沒有外人，PIN 擋不到任何人，只會讓孩子每次玩之前多按四下。
 * 帳號就是「選一個名字」，如此而已。
 */

const NICKNAME_PATTERN = /^[\p{L}\p{N} _-]{1,20}$/u;

function isValidNickname(nickname) {
  return typeof nickname === 'string' && NICKNAME_PATTERN.test(nickname.trim());
}

module.exports = { isValidNickname };
