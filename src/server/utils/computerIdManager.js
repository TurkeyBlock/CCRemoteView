const ApprovalRegistry = require('./approvalRegistry');

class ComputerIdManager {
  constructor({ file = './src/server/data/computer_ids.json', legacyFile = './src/server/data/turtle_ids.json' } = {}) {
    this.registry = new ApprovalRegistry({
      file,
      legacyFile,
      keyOf: (entry) => entry.id,
      persistPending: false, // pending is not persisted — computers re-request on reconnect
      revokeRemovesPending: false,
      extraFields: [{ name: 'allowByIp', default: true }],
    });
  }

  get pendingIds()  { return this.registry.pending(); }
  get approvedIds() { return new Set(this.registry.approvedArray()); }
  get allowByIp()   { return this.registry.getExtra('allowByIp'); }

  isPending(id)  { return this.registry.isPending(String(id)); }
  isApproved(id) { return this.allowByIp || this.registry.isApproved(String(id)); }

  addPending(id, ip) {
    this.registry.addPending({ id: String(id), ip, requestedAt: Date.now() });
  }

  approve(id) { this.registry.approve(String(id)); }
  deny(id)    { this.registry.deny(String(id)); }
  revoke(id)  { this.registry.revoke(String(id)); }

  setAllowByIp(enabled) { this.registry.setExtra('allowByIp', enabled); }

  getAll() {
    return {
      pending: this.registry.pending(),
      approved: this.registry.approvedArray(),
      allowByIp: this.allowByIp,
    };
  }
}

module.exports = ComputerIdManager;
