const fs = require('fs');

class ComputerIpManager {
  saveFile = './src/server/data/computer_ips.json';
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
    fs.mkdirSync('./src/server/data', { recursive: true });
    const tmp = this.saveFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      approved: [...this.approved],
      pending: [...this.pending],
    }));
    fs.renameSync(tmp, this.saveFile);
  }

  load() {
    try {
      // Support migration from old turtle_ips.json filename
      const legacy = './src/server/data/turtle_ips.json';
      const src = fs.existsSync(this.saveFile) ? this.saveFile : legacy;
      const data = JSON.parse(fs.readFileSync(src, 'utf8'));
      this.approved = new Set(data.approved || []);
      this.pending = new Set(data.pending || []);
    } catch { }
  }
}

module.exports = ComputerIpManager;
