'use strict';

const fs         = require('fs');
const path       = require('path');
const zlib       = require('zlib');
const { Worker } = require('worker_threads');
const { AUTOSAVE_INTERVAL_MIN, SAVE_GZ_PATH, SUPPRESS_SAVE_LOGS } = require('../config');
const { state } = require('./state');

function serializeState(s) {
  const palette   = [];
  const nameToIdx = {};
  const blockData = [];
  for (const [locString, block] of Object.entries(s.world.blocks)) {
    const name = block.name;
    if (nameToIdx[name] === undefined) {
      nameToIdx[name] = palette.length;
      palette.push(name);
    }
    const [x, y, z] = locString.split(',').map(Number);
    blockData.push(x, y, z, nameToIdx[name], block.metadata ?? 0);
  }
  const computers = {};
  for (const [id, c] of Object.entries(s.computers)) {
    // entities: runtime-only sensor data, not persisted
    // glassesLiveMode: intentionally not persisted — Lua handle table is always empty
    // after a restart, so the browser must re-enable live mode and re-sync manually.
    // wsConnected/wsRequestAt: runtime connection state — always false/null after restart.
    const { entities: _e, glassesLiveMode: _lm, wsConnected: _wc, wsRequestAt: _wr, ...rest } = c;
    computers[id] = rest;
  }
  return JSON.stringify({ computers, chatLog: s.chatLog || [], world: { palette, blockData, blockDataStride: 5 } });
}

function saveStateToDisk() {
  fs.mkdirSync('./src/server/data', { recursive: true });
  const target = SAVE_GZ_PATH;
  const tmp    = `${SAVE_GZ_PATH}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(serializeState(state)));
  fs.renameSync(tmp, target);
}

function startAutoSave(onSave) {
  let busy = false;
  const worker = new Worker(path.join(__dirname, '..', 'saveState.worker.js'));
  worker.on('error', (err) => {
    console.error('[autosave] Worker error:', err);
    busy = false;
  });

  function doSave() {
    if (busy) {
      console.warn('[autosave] Previous save still running — skipping tick');
      return Promise.resolve();
    }
    busy = true;

    // Build typed array on main thread — integer ops only, no JSON/gzip work here.
    const blocks    = state.world.blocks;
    const keys      = Object.keys(blocks);
    const palette   = [];
    const nameToIdx = {};
    const typed     = new Int32Array(keys.length * 5);
    let off = 0;
    for (const locString of keys) {
      const block = blocks[locString];
      const name  = block.name;
      if (nameToIdx[name] === undefined) { nameToIdx[name] = palette.length; palette.push(name); }
      const c1 = locString.indexOf(','), c2 = locString.indexOf(',', c1 + 1);
      typed[off]   = +locString.slice(0, c1);
      typed[off+1] = +locString.slice(c1+1, c2);
      typed[off+2] = +locString.slice(c2+1);
      typed[off+3] = nameToIdx[name];
      typed[off+4] = block.metadata ?? 0;
      off += 5;
    }
    const computers = {};
    for (const [id, c] of Object.entries(state.computers)) {
      const { entities: _e, glassesLiveMode: _lm, wsConnected: _wc, wsRequestAt: _wr, ...rest } = c;
      computers[id] = rest;
    }

    const buf = typed.buffer;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.error('[autosave] Worker timed out after 60s — resetting');
        busy = false;
        resolve();
      }, 60_000);

      worker.once('message', ({ ok, error }) => {
        clearTimeout(timeout);
        busy = false;
        if (ok) {
          if (!SUPPRESS_SAVE_LOGS) console.log(`[autosave] Saved ${off / 5} blocks, ${Object.keys(computers).length} computers`);
        } else {
          console.error('[autosave] Save failed:', error);
        }
        resolve();
      });
      worker.postMessage(
        { palette, buffer: buf, bufLen: off, computers, chatLog: state.chatLog, savePath: SAVE_GZ_PATH, tmpPath: `${SAVE_GZ_PATH}.tmp` },
        [buf],
      );
    });
  }

  function tick() {
    doSave()
      .then(() => { onSave?.(); })
      .catch(err => console.error('[autosave] Unexpected error in doSave:', err))
      .finally(() => setTimeout(tick, AUTOSAVE_INTERVAL_MIN * 60 * 1000));
  }
  tick();
}

module.exports = { serializeState, saveStateToDisk, startAutoSave };
