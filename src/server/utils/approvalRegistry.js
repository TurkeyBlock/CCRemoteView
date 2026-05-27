const fs = require('fs');
const { atomicJsonSave } = require('./atomicJsonSave');

/**
 * Generic pending/approved registry shared by computerIdManager and computerIpManager.
 *
 * State machine:
 *   addPending(entry)  — no-op if key is already pending or already approved
 *   approve(key)       — removes any pending entry with this key, adds key to approved
 *   deny(key)          — removes any pending entry with this key
 *   revoke(key)        — removes key from approved (and from pending too, if configured)
 *
 * Options:
 *   file              — primary JSON path
 *   legacyFile        — optional fallback path read on load for migration
 *   keyOf(entry)      — function that returns the dedup key for a pending entry.
 *                       Default: identity (entry is itself the key string).
 *   persistPending    — if true, pending is serialized in save() / restored on load().
 *                       Default: false.
 *   revokeRemovesPending — if true, revoke() also removes the key from pending.
 *                          Default: false.
 *   extraFields       — array of { name, default } extra scalar fields to persist
 *                       alongside approved (used by idManager.allowByIp).
 */
class ApprovalRegistry {
  constructor(opts) {
    this.file = opts.file;
    this.legacyFile = opts.legacyFile || null;
    this.keyOf = opts.keyOf || ((entry) => entry);
    this.persistPending = !!opts.persistPending;
    this.revokeRemovesPending = !!opts.revokeRemovesPending;
    this.extraFields = opts.extraFields || [];

    // pendingList preserves insertion order and supports rich entries
    // (e.g. { id, ip, requestedAt }). pendingKeys is a Set for O(1) dedup.
    this.pendingList = [];
    this.pendingKeys = new Set();
    this.approved = new Set();
    this.extras = {};
    for (const f of this.extraFields) this.extras[f.name] = f.default;

    this.load();
  }

  isPending(key)  { return this.pendingKeys.has(String(key)); }
  isApproved(key) { return this.approved.has(String(key)); }

  addPending(entry) {
    const key = String(this.keyOf(entry));
    if (this.pendingKeys.has(key) || this.approved.has(key)) return;
    this.pendingList.push(entry);
    this.pendingKeys.add(key);
    this.save();
  }

  approve(key) {
    const normalizedKey = String(key);
    this._removePending(normalizedKey);
    this.approved.add(normalizedKey);
    this.save();
  }

  deny(key) {
    this._removePending(String(key));
    this.save();
  }

  revoke(key) {
    const normalizedKey = String(key);
    this.approved.delete(normalizedKey);
    if (this.revokeRemovesPending) this._removePending(normalizedKey);
    this.save();
  }

  setExtra(name, value) {
    this.extras[name] = value;
    this.save();
  }

  getExtra(name) {
    return this.extras[name];
  }

  pending() { return this.pendingList; }
  approvedArray() { return [...this.approved]; }

  _removePending(key) {
    if (!this.pendingKeys.has(key)) return;
    this.pendingKeys.delete(key);
    this.pendingList = this.pendingList.filter(e => String(this.keyOf(e)) !== key);
  }

  save() {
    const data = { approved: [...this.approved] };
    if (this.persistPending) data.pending = this.pendingList;
    for (const f of this.extraFields) data[f.name] = this.extras[f.name];
    try {
      atomicJsonSave(this.file, data);
    } catch (err) {
      console.error(`[approvalRegistry] Save failed (${this.file}):`, err);
    }
  }

  load() {
    try {
      const src = fs.existsSync(this.file)
        ? this.file
        : (this.legacyFile && fs.existsSync(this.legacyFile) ? this.legacyFile : this.file);
      const data = JSON.parse(fs.readFileSync(src, 'utf8'));
      this.approved = new Set(data.approved || []);
      if (this.persistPending && Array.isArray(data.pending)) {
        this.pendingList = data.pending.slice();
        this.pendingKeys = new Set(this.pendingList.map(e => String(this.keyOf(e))));
      }
      for (const f of this.extraFields) {
        this.extras[f.name] = data[f.name] !== undefined ? data[f.name] : f.default;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[approvalRegistry] Load failed (${this.file}):`, err);
    }
  }
}

module.exports = ApprovalRegistry;
