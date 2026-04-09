const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { exec } = require("child_process");

let MOD_DIR = `${process.env.USERPROFILE}/curseforge/minecraft/Instances/computercraft thing/mods`.replaceAll('\\', '/');

function extractTexturesFromJar(fileName) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(fileName)
      .pipe(unzipper.Parse())
      .on('entry', function (entry) {
        const fileName = entry.path;
        let regex = /assets\/(?<modname>.*)\/textures\/(?<textureType>.*)\/.*\.png$/m;
        let match = regex.exec(fileName);
        if (match && match.groups.textureType == "blocks") {
          const blockPath = `textures/blocks/${match.groups.modname}`;
          fs.mkdirSync(blockPath, { recursive: true });
          entry.pipe(fs.createWriteStream(`${blockPath}/${path.parse(fileName).base}`));
        } else if (match && match.groups.textureType == "items") {
          const itemPath = `textures/items/${match.groups.modname}`;
          fs.mkdirSync(itemPath, { recursive: true });
          entry.pipe(fs.createWriteStream(`${itemPath}/${path.parse(fileName).base}`));
        } else {
          entry.autodrain();
        }
      })
      .on('finish', resolve)
      .on('error', reject);
  });
}

function extractTexturesFromZip(zipPath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', function (entry) {
        const entryPath = entry.path;
        let textureType = null;
        let file = null;
        let modname = 'minecraft';

        // try: assets/minecraft/textures/blocks/stone.png
        let m = /assets\/(?<mod>[^/]+)\/textures\/(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(entryPath);
        if (m) {
          textureType = m.groups.type;
          file = m.groups.f;
          modname = m.groups.mod;
        }

        // try: textures/blocks/stone.png
        if (!m) {
          m = /textures\/(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(entryPath);
          if (m) { textureType = m.groups.type; file = m.groups.f; }
        }

        // try bare: blocks/stone.png or items/stone.png
        if (!m) {
          m = /^(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(entryPath);
          if (m) { textureType = m.groups.type; file = m.groups.f; }
        }

        if (textureType && file) {
          const outDir = `textures/${textureType}/${modname}`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/${file}`));
        } else {
          entry.autodrain();
        }
      })
      .on('finish', resolve)
      .on('error', reject);
  });
}

function renderBlockTextures() {
  fs.mkdirSync('grab/rendered', { recursive: true });
  return new Promise((resolve, reject) => {
    exec("node node_modules/minecraft-blocks-render/bin/index.js render --type png --scale 4 --renderTransparent --renderSides", (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`);
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`);
      }
      resolve();
    });
  });
}

function createBlockTextures() {
  return new Promise(async (resolve) => {
    const blockTexturePath = 'textures/blocks/'
    for (let modName of fs.readdirSync(blockTexturePath)) {
      copyFolderSync(blockTexturePath + modName, 'grab/blocks');
      await renderBlockTextures();
      copyFolderSync('grab/rendered', 'textures/items/' + modName);
      fs.rmSync('grab', { recursive: true });
    }
    resolve();
  });
}

function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    if (fs.lstatSync(path.join(from, element)).isFile()) {
      fs.copyFileSync(path.join(from, element), path.join(to, element));
    } else {
      copyFolderSync(path.join(from, element), path.join(to, element));
    }
  });
}

function pickMultiFaceBlockDisplaySide() {
  fs.readdirSync('textures/blocks/').forEach(modName => {
    const modDir = 'textures/blocks/' + modName;
    fs.readdirSync(modDir).forEach(fileName => {
      const filePath = modDir + '/' + fileName;
      if (fileName.endsWith('_front.png') && !fs.existsSync(modDir + '/' + fileName.replace('_front', '')))
        fs.copyFileSync(filePath, modDir + '/' + fileName.replace('_front', ''));
      else if (fileName.endsWith('_top.png') && !fs.existsSync(modDir + '/' + fileName.replace('_top', '')))
        fs.copyFileSync(filePath, modDir + '/' + fileName.replace('_top', ''));
      else if (fileName.endsWith('_still.png') && !fs.existsSync(modDir + '/' + fileName.replace('_still', '')))
        fs.copyFileSync(filePath, modDir + '/' + fileName.replace('_still', ''));
    });
  });
}

if (!process.argv[2])
  throw new Error("Usage: node build-textures.js <mcJarOrZip> <optional: modJarsDir>\nExample: node build-textures.js /path/to/1.18.jar /path/to/mods");

const MC_FILE = process.argv[2].replaceAll('\\\\', '/').replaceAll('\\', '/');
MOD_DIR = process.argv[3] ? process.argv[3].replaceAll('\\\\', '/').replaceAll('\\', '/') : null;

(async () => {
  process.stdout.write("Gathering textures...");

  if (MC_FILE.endsWith('.jar')) {
    await extractTexturesFromJar(MC_FILE);
  } else {
    await extractTexturesFromZip(MC_FILE);
  }

  if (MOD_DIR) {
    const modJars = fs.readdirSync(MOD_DIR).filter(f => f.endsWith('.jar'));
    for (const fileName of modJars) {
      await extractTexturesFromJar(MOD_DIR + '/' + fileName);
    }
  }

  process.stdout.write("DONE\nRendering blocks for display as items...");
  await createBlockTextures();

  process.stdout.write("DONE\nSelecting appropriate side image to display for multi side blocks...");
  pickMultiFaceBlockDisplaySide();
  process.stdout.write("DONE\nBuilding texture index...");
  const index = [];
  function buildIndex(dir, base) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.lstatSync(full).isDirectory()) {
        buildIndex(full, base ? `${base}/${entry}` : entry);
      } else if (entry.endsWith('.png')) {
        index.push(base ? `${base}/${entry}` : entry);
      }
    }
  }
  buildIndex('textures/blocks', '');
  fs.writeFileSync('textures/texture-index.json', JSON.stringify(index));
  process.stdout.write("DONE\n");
  console.log("DONE\n\u001b[33mIF YOU GET ANY ERRORS, JUST RERUN THE COMMAND UNTIL NO ERRORS POP UP. Also please make sure to run this command at least twice to also get some basic support for multi side blocks like the furnace!\u001b[0m");
})();