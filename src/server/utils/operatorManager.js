const fs = require('fs');
const { atomicJsonSave } = require('./atomicJsonSave');

class OperatorManager {
  operators = []; // [{ sub, email }]
  requests = []; // [{ sub, email, requestedAt }]

  constructor({ operatorsFile = './src/server/data/operators.json', requestsFile = './src/server/data/operator_requests.json' } = {}) {
    this.operatorsFile = operatorsFile;
    this.requestsFile  = requestsFile;
    this.load();
  }

  isOperator(sub) {
    return this.operators.some(o => o.sub === sub);
  }

  // Returns 'ok' | 'already_operator' | 'already_requested'
  addRequest(sub, email) {
    if (this.isOperator(sub)) return 'already_operator';
    if (this.requests.find(r => r.sub === sub)) return 'already_requested';
    this.requests.push({ sub, email, requestedAt: Date.now() });
    this.saveRequests();
    return 'ok';
  }

  approveRequest(sub) {
    const req = this.requests.find(r => r.sub === sub);
    this.requests = this.requests.filter(r => r.sub !== sub);
    this.operators.push({ sub, email: req?.email ?? null });
    this.saveOperators();
    this.saveRequests();
  }

  denyRequest(sub) {
    this.requests = this.requests.filter(r => r.sub !== sub);
    this.saveRequests();
  }

  revokeOperator(sub) {
    this.operators = this.operators.filter(o => o.sub !== sub);
    this.saveOperators();
  }

  getRequests() { return this.requests; }
  getOperators() { return this.operators; }

  saveOperators() {
    try { atomicJsonSave(this.operatorsFile, this.operators); }
    catch (err) { console.error('[operatorManager] Save operators failed:', err); }
  }
  saveRequests() {
    try { atomicJsonSave(this.requestsFile, this.requests); }
    catch (err) { console.error('[operatorManager] Save requests failed:', err); }
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.operatorsFile, 'utf8'));
      // Backward compat: old format was a plain string array
      if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
        this.operators = raw.map(sub => ({ sub, email: null }));
      } else {
        this.operators = raw;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[operatorManager] Load operators failed:', err);
    }
    try {
      this.requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[operatorManager] Load requests failed:', err);
    }
  }
}

module.exports = OperatorManager;
