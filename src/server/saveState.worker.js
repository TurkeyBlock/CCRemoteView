'use strict';

const { parentPort } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

parentPort.on('message', ({ palette, buffer, bufLen, computers, savePath, tmpPath }) => {
  try {
    // Array.from converts the transferred Int32Array to a plain array for JSON serialisation.
    const blockData = Array.from(new Int32Array(buffer, 0, bufLen));
    const json = JSON.stringify({ computers, world: { palette, blockData, blockDataStride: 5 } });
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(tmpPath, zlib.gzipSync(json));
    fs.renameSync(tmpPath, savePath);
    parentPort.postMessage({ ok: true });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
});
