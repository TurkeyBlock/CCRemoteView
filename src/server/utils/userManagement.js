const fs = require('fs');

function getDateDiffString(date) {
  const diff = date - Date.now();
  const rtf = new Intl.RelativeTimeFormat('en', { style: 'narrow' });
  const diffSec = diff / 1000;
  if (Math.abs(diffSec) < 60) return rtf.format(Math.trunc(diffSec), 'second');
  if (Math.abs(diffSec) < 3600) return rtf.format(Math.trunc(diffSec / 60), 'minute');
  if (Math.abs(diffSec) < 86400) return rtf.format(Math.trunc(diffSec / 3600), 'hour');
  return rtf.format(Math.trunc(diffSec / 86400), 'day');
}

class UserManagement {
  users = {};
  saveFile = './src/server/saved/users.json';

  constructor() {
    this.load();
  }

  _createUser(sub, username) {
    this.users[sub] = { username, actionCount: 0, lastActive: Date.now() };
  }

  updateLastActive(sub, username) {
    if (!this.users[sub]) this._createUser(sub, username);
    this.users[sub].lastActive = Date.now();
    // keep username fresh in case it changed on the main site
    if (username) this.users[sub].username = username;
  }

  incrementActionCount(sub) {
    if (this.users[sub]) this.users[sub].actionCount++;
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
    fs.mkdirSync('./src/server/saved', { recursive: true });
    fs.writeFileSync(this.saveFile, JSON.stringify(this.users));
  }

  load() {
    try {
      this.users = JSON.parse(fs.readFileSync(this.saveFile, 'utf8'));
    } catch { }
  }
}

module.exports = UserManagement;