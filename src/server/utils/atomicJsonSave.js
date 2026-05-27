const fs = require('fs');
const path = require('path');

/**
 * Crash-safe JSON write: serialize to a sibling .tmp file, then rename over the target.
 * The rename is atomic on POSIX and on Windows (when both paths are on the same volume),
 * so readers never observe a partially-written file.
 */
function atomicJsonSave(targetPath, data) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = targetPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, targetPath);
}

module.exports = { atomicJsonSave };
