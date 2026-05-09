const fs = require('fs');

class ComputerIdManager {
  pendingIds = []; // [{ id, ip, requestedAt }]
  approvedIds = new Set();
  allowByIp = true; // default: original behaviour — individual approval is opt-in
  idFile = './src/server/saved/computer_ids.json';

  constructor() { this.load(); }

  isPending(id)  { return this.pendingIds.some(t => t.id === String(id)); }
  isApproved(id) { return this.allowByIp || this.approvedIds.has(String(id)); }

  addPending(id, ip) {
    if (this.isPending(id) || this.approvedIds.has(String(id))) return;
    this.pendingIds.push({ id: String(id), ip, requestedAt: Date.now() });
    this.save();
  }

  approve(id) {
    this.pendingIds = this.pendingIds.filter(t => t.id !== String(id));
    this.approvedIds.add(String(id));
    this.save();
  }

  deny(id) {
    this.pendingIds = this.pendingIds.filter(t => t.id !== String(id));
    this.save();
  }

  revoke(id) {
    this.approvedIds.delete(String(id));
    this.save();
  }

  setAllowByIp(enabled) {
    this.allowByIp = enabled;
    this.save();
  }

  getAll() {
    return {
      pending: this.pendingIds,
      approved: [...this.approvedIds],
      allowByIp: this.allowByIp,
    };
  }

  save() {
    fs.mkdirSync('./src/server/saved', { recursive: true });
    const tmp = this.idFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      approved: [...this.approvedIds],
      allowByIp: this.allowByIp,
      // pending is not persisted — computers re-request on reconnect
    }));
    fs.renameSync(tmp, this.idFile);
  }

  load() {
    try {
      // Support migration from old turtle_ids.json filename
      const legacy = './src/server/saved/turtle_ids.json';
      const src = fs.existsSync(this.idFile) ? this.idFile : legacy;
      const data = JSON.parse(fs.readFileSync(src, 'utf8'));
      this.approvedIds = new Set(data.approved ?? []);
      this.allowByIp   = data.allowByIp ?? true;
    } catch {}
  }
}

module.exports = ComputerIdManager;
