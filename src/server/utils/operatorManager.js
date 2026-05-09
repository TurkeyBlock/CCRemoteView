const fs = require('fs');

class OperatorManager {
  operators = []; // [{ sub, email }]
  requests = []; // [{ sub, email, requestedAt }]
  operatorsFile = './src/server/saved/operators.json';
  requestsFile = './src/server/saved/operator_requests.json';

  constructor() {
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

  saveAtomic(targetPath, data) {
    fs.mkdirSync('./src/server/saved', { recursive: true });
    const tmp = targetPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, targetPath);
  }

  saveOperators() { this.saveAtomic(this.operatorsFile, this.operators); }
  saveRequests()  { this.saveAtomic(this.requestsFile, this.requests); }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.operatorsFile, 'utf8'));
      // Backward compat: old format was a plain string array
      if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
        this.operators = raw.map(sub => ({ sub, email: null }));
      } else {
        this.operators = raw;
      }
    } catch {}
    try {
      this.requests = JSON.parse(fs.readFileSync(this.requestsFile, 'utf8'));
    } catch {}
  }
}

module.exports = OperatorManager;
