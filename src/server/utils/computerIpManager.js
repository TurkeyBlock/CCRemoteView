const ApprovalRegistry = require('./approvalRegistry');

class ComputerIpManager {
  constructor({ file = './src/server/data/computer_ips.json', legacyFile = './src/server/data/turtle_ips.json' } = {}) {
    this.registry = new ApprovalRegistry({
      file,
      legacyFile,
      keyOf: (ip) => ip,
      persistPending: true,
      revokeRemovesPending: true,
    });
  }

  get approved() { return new Set(this.registry.approvedArray()); }
  get pending()  { return new Set(this.registry.pending()); }

  isApproved(ip) { return this.registry.isApproved(ip); }
  isPending(ip)  { return this.registry.isPending(ip); }

  addPending(ip) { this.registry.addPending(ip); }
  deny(ip)       { this.registry.deny(ip); }
  approve(ip)    { this.registry.approve(ip); }
  revoke(ip)     { this.registry.revoke(ip); }

  getAll() {
    return {
      approved: this.registry.approvedArray(),
      pending: this.registry.pending(),
    };
  }
}

module.exports = ComputerIpManager;
