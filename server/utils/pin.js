const bcrypt = require('bcryptjs');

const PIN_PATTERN = /^\d{4}$/;
const NICKNAME_PATTERN = /^[\p{L}\p{N} _-]{1,20}$/u;

function isValidPin(pin) {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

function isValidNickname(nickname) {
  return typeof nickname === 'string' && NICKNAME_PATTERN.test(nickname.trim());
}

async function hashPin(pin) {
  return bcrypt.hash(pin, 10);
}

async function verifyPin(pin, hash) {
  return bcrypt.compare(pin, hash);
}

module.exports = { isValidPin, isValidNickname, hashPin, verifyPin };
