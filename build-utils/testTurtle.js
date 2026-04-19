// Simulates a turtle connecting to the server for visual testing.
// Run with: npm run test:turtle
// The turtle's IP (::1 or 127.0.0.1) must be approved in the admin UI before state updates begin.

const BASE_URL = 'http://localhost';
const TURTLE_ID = 999;
const POLL_INTERVAL_MS = 2000;

const headers = { 'Content-Type': 'application/json' };

// CC rot values as observed in the renderer:
//   rot=0 → West  (-X)
//   rot=1 → North (-Z)
//   rot=2 → East  (+X)
//   rot=3 → South (+Z)
// (The renderer places the face one step CCW from the naive 0=N,1=E,2=S,3=W mapping,
//  so every direction is shifted +1.)
const DIRECTIONS = [
  { dx: -1, dz:  0 }, // rot=0 → West
  { dx:  0, dz: -1 }, // rot=1 → North
  { dx:  1, dz:  0 }, // rot=2 → East
  { dx:  0, dz:  1 }, // rot=3 → South
];
const ROT_NAMES = ['West', 'North', 'East', 'South'];

function buildSpiral() {
  // Start with 8, then decreasing pairs down to 1.
  const segments = [8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1];
  const frames = [];
  let x = 0, z = 0, rot = 2; // start facing East (rot=2)

  for (let s = 0; s < segments.length; s++) {
    const len = segments[s];
    const nextRot = (rot + 1) % 4; // right turn

    for (let i = 0; i < len; i++) {
      x += DIRECTIONS[rot].dx;
      z += DIRECTIONS[rot].dz;
      frames.push({ x, z, rot });
    }

    // Insert a turn-in-place frame before the next segment — same position,
    // new rotation. This must be its own update, not bundled with the move.
    if (s < segments.length - 1) {
      frames.push({ x, z, rot: nextRot });
    }

    rot = nextRot;
  }

  return frames;
}

const SPIRAL_FRAMES = buildSpiral();

function makeComputerState(frameIndex) {
  const { x, z, rot } = SPIRAL_FRAMES[frameIndex];

  const dirtBelow = (Math.abs(x) + Math.abs(z)) % 2 === 0
    ? { name: 'minecraft:dirt', state: {} }
    : null;

  if (dirtBelow) {
    console.log(`  [dirt below at (${x}, 63, ${z})]`);
  }

  return {
    id: TURTLE_ID,
    label: 'Test Turtle',
    fuelLevel: 100 - frameIndex,
    fuelLimit: 100,
    loc: { x, y: 64, z },
    rot,
    view: { top: null, bottom: dirtBelow, front: null },
    inv: new Array(16).fill(undefined),
  };
}

async function checkApproved() {
  console.log(`Test turtle starting (ID: ${TURTLE_ID})`);
  console.log('Waiting for approval — approve the pending IP in the admin panel.');

  let dotted = false;
  while (true) {
    const res = await fetch(`${BASE_URL}/api/getCommand`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: TURTLE_ID }),
    }).catch(() => null);

    if (!res) {
      if (dotted) { console.log(); dotted = false; }
      console.log('Cannot reach server. Is it running? (npm run server:dev)');
    } else if (res.status === 200) {
      if (dotted) console.log();
      console.log('Approved!');
      return;
    } else if (res.status === 403) {
      process.stdout.write('.');
      dotted = true;
    } else {
      if (dotted) { console.log(); dotted = false; }
      console.log(`Unexpected status: ${res.status}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }
}

async function sendState(frameIndex) {
  const res = await fetch(`${BASE_URL}/api/state`, {
    method: 'POST',
    headers,
    body: JSON.stringify(makeComputerState(frameIndex)),
  }).catch(() => null);

  if (!res?.ok) console.log(`State update failed: ${res?.status ?? 'network error'}`);
}

async function pollCommand() {
  const res = await fetch(`${BASE_URL}/api/getCommand`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: TURTLE_ID }),
  }).catch(() => null);

  if (!res) return;
  const text = await res.text();
  if (!text) return;

  console.log(`\nReceived command: ${text}`);
  await fetch(`${BASE_URL}/api/commandResult`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      turtleId: TURTLE_ID,
      result: { succ: true, ret: `[test turtle] executed: ${text}` },
    }),
  }).catch(() => null);
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function testSpiral() {
  console.log(`Running spiral test (${SPIRAL_FRAMES.length} steps).\n`);

  let prevRot = null;
  for (let i = 0; i < SPIRAL_FRAMES.length; i++) {
    const { x, z, rot } = SPIRAL_FRAMES[i];

    if (rot !== prevRot) {
      console.log(`  ROTATION: rot=${rot} (${ROT_NAMES[rot]})`);
      prevRot = rot;
    }

    console.log(`Step ${String(i + 1).padStart(3)}/${SPIRAL_FRAMES.length} → (${String(x).padStart(3)}, 64, ${String(z).padStart(3)})  rot=${rot} (${ROT_NAMES[rot]})`);

    await Promise.all([sendState(i), pollCommand()]);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log('\nSpiral complete. Turtle has stopped at center.');
}

async function testBox() {
  console.log('Running box scan test.');

  // Place turtle at origin so the server has a position to anchor the scan.
  const stateRes = await fetch(`${BASE_URL}/api/state`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: TURTLE_ID,
      label: 'Test Turtle',
      fuelLevel: 100,
      fuelLimit: 100,
      loc: { x: 0, y: 64, z: 0 },
      rot: 2, // East
      view: { top: null, bottom: null, front: null },
      inv: new Array(16).fill(undefined),
    }),
  }).catch(() => null);

  if (!stateRes?.ok) { console.log('Box test: initial state failed'); return; }

  // 5x5x5 scan: stone shell, air interior — matches what a real Plethora scanner returns.
  // Air blocks allow the server to clear any previously-recorded blocks in that space.
  const blocks = [];
  for (let x = -2; x <= 2; x++) {
    for (let y = -2; y <= 2; y++) {
      for (let z = -2; z <= 2; z++) {
        const isInterior = Math.abs(x) <= 1 && Math.abs(y) <= 1 && Math.abs(z) <= 1;
        blocks.push({ x, y, z, name: isInterior ? 'minecraft:air' : 'minecraft:stone' });
      }
    }
  }
  const stoneCount = blocks.filter(b => b.name !== 'minecraft:air').length;
  console.log(`Sending scan: ${blocks.length} blocks total (${stoneCount} stone, ${blocks.length - stoneCount} air).`);

  const scanRes = await fetch(`${BASE_URL}/api/scan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: TURTLE_ID, blocks }),
  }).catch(() => null);

  if (!scanRes?.ok) console.log(`Box test: scan failed (${scanRes?.status ?? 'network error'})`);
  else console.log('Box test complete.');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const TESTS = { spiral: testSpiral, box: testBox };
const testName = process.argv[2];

if (!testName || !TESTS[testName]) {
  console.log('Usage: npm run test:turtle -- <test>');
  console.log('Available tests:');
  for (const name of Object.keys(TESTS)) console.log(`  ${name}`);
  process.exit(1);
}

async function main() {
  await checkApproved();
  await TESTS[testName]();
}

main().catch(console.error);
