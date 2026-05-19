'use strict';

const IS_PROD = process.env.NODE_ENV !== 'development';

function getClientIp(req) {
  if (IS_PROD) return req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  return req.socket.remoteAddress;
}

module.exports = { getClientIp };
