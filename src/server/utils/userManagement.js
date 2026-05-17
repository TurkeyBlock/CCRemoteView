const fs = require('fs');
const { atomicJsonSave } = require('./atomicJsonSave');
const { SECONDS_PER_HOUR, SECONDS_PER_DAY } = require('../config');

function getDateDiffString(date) {
  const diff = date - Date.now();
  const rtf = new Intl.RelativeTimeFormat('en', { style: 'narrow' });
  const diffSec = diff / 1000;
  if (Math.abs(diffSec) < 60) return rtf.format(Math.trunc(diffSec), 'second');
  if (Math.abs(diffSec) < SECONDS_PER_HOUR) return rtf.format(Math.trunc(diffSec / 60), 'minute');
  if (Math.abs(diffSec) < SECONDS_PER_DAY) return rtf.format(Math.trunc(diffSec / SECONDS_PER_HOUR), 'hour');
  return rtf.format(Math.trunc(diffSec / SECONDS_PER_DAY), 'day');
}

class UserManagement {
  users = {};

  constructor({ file = './src/server/data/users.json', saveIntervalMs = 30_000 } = {}) {
    this.saveFile = file;
    this.load();
    this._dirty = false;
    setInterval(() => {
      if (this._dirty) {
        try {
          atomicJsonSave(this.saveFile, this.users);
          this._dirty = false;
        } catch (err) {
          console.error('[userManagement] Periodic save failed:', err);
        }
      }
    }, saveIntervalMs);
  }

  _createUser(sub, username) {
    this.users[sub] = { username, actionCount: 0, lastActive: Date.now() };
  }

  updateLastActive(sub, username) {
    if (!this.users[sub]) this._createUser(sub, username);
    this.users[sub].lastActive = Date.now();
    // keep username fresh in case it changed on the main site
    if (username) this.users[sub].username = username;
    this._dirty = true;
  }

  incrementActionCount(sub) {
    if (this.users[sub]) {
      this.users[sub].actionCount++;
      this._dirty = true;
    }
  }

  getUserDataString() {
    const list = Object.entries(this.users)
      .map(([sub, u]) => ({ sub, ...u }))
      .sort((a, b) => a.lastActive - b.lastActive);

    return list.map(u =>
      `{ sub: '${u.sub}', username: '${u.username ?? 'unset'}', lastActive: ${getDateDiffString(u.lastActive)}, actionCount: ${u.actionCount} }`
    ).join('\n');
  }

  save() {
    try {
      atomicJsonSave(this.saveFile, this.users);
    } catch (err) {
      console.error('[userManagement] Save failed:', err);
    }
  }

  load() {
    try {
      this.users = JSON.parse(fs.readFileSync(this.saveFile, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[userManagement] Load failed:', err);
    }
  }
}

module.exports = UserManagement;