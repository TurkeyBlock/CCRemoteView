const fs = require('fs');

class TurtleIpManager {
  saveFile = './src/server/saved/turtle_ips.json';
  approved = new Set();
  pending = new Set();

  constructor() {
    this.load();
  }

  isApproved(ip) { return this.approved.has(ip); }
  isPending(ip) { return this.pending.has(ip); }

  addPending(ip) {
    this.pending.add(ip);
    this.save();
  }

  deny(ip) {
    this.pending.delete(ip);
    this.save();
  }

  approve(ip) {
    this.pending.delete(ip);
    this.approved.add(ip);
    this.save();
  }

  revoke(ip) {
    this.approved.delete(ip);
    this.pending.delete(ip);
    this.save();
  }

  getAll() {
    return {
      approved: [...this.approved],
      pending: [...this.pending],
    };
  }

  save() {
    fs.mkdirSync('./src/server/saved', { recursive: true });
    fs.writeFileSync(this.saveFile, JSON.stringify({
      approved: [...this.approved],
      pending: [...this.pending],
    }));
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.saveFile, 'utf8'));
      this.approved = new Set(data.approved || []);
      this.pending = new Set(data.pending || []);
    } catch { }
  }
}

module.exports = TurtleIpManager;