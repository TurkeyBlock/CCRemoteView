'use strict';

function requireOperator(handler) {
  return function (msg, ctx) {
    if (!ctx.wsIsOperator && !ctx.wsIsAdmin) {
      ctx.ws.send(JSON.stringify({ type: 'error', message: 'Operator access required' }));
      return;
    }
    return handler(msg, ctx);
  };
}

module.exports = { requireOperator };
