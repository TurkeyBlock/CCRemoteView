'use strict';

const { browserClients } = require('./state');

function broadcastToClients(data) {
  if (browserClients.size === 0) return;
  const msg = JSON.stringify(data);
  for (const ws of browserClients) {
    if (ws.readyState !== ws.OPEN) continue;
    try {
      ws.send(msg);
    } catch {
      browserClients.delete(ws);
    }
  }
}

// Strip glassesScene from computer states before broadcasting. Canvas state is
// subscription-only and delivered via targeted canvasUpdate messages in browserWs.js.
function broadcastTransaction(transaction) {
  const hasCanvas = Object.values(transaction.computers).some(c => c?.glassesScene);
  const stripped = hasCanvas
    ? { ...transaction, computers: Object.fromEntries(
        Object.entries(transaction.computers).map(([id, c]) => {
          if (!c?.glassesScene) return [id, c];
          const { glassesScene: _, ...rest } = c;
          return [id, rest];
        })
      )}
    : transaction;
  broadcastToClients({ transactions: { [stripped.id]: stripped } });
}

module.exports = { broadcastToClients, broadcastTransaction };
