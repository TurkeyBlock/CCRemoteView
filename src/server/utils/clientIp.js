'use strict';

function getClientIp(req) {
  return req.headers['cf-connecting-ip']
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress;
}

module.exports = { getClientIp };
