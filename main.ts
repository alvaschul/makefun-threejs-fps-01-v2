// FREIGHTLINE — the threejs-fps-01 entry program (Node 22, standard library only).
// The game itself is the game/ folder beside this file: plain static files a desktop
// browser loads as ES modules, with three.js 0.187.0 vendored under game/vendor/three/
// and reached through the single import map in game/index.html. Nothing is built,
// installed or fetched: served by any static file server, the game plays single-player
// against bots fully offline.
//
// This program hands the entry in. It copies game/ and screenshots/ from beside this
// file to /output and writes /output/dossier.json — the summary the judge reads —
// with buildDossier from vendor/makefun-threejs.ts, the kit's library, unchanged.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The gate's own caps, passed so this program refuses exactly what the scorer would
// refuse: at most 4 screenshots and 256 KiB each, at most 993 entries and 48 MiB in
// game/, no game path over 1,000 bytes — game/ shares /output's 1,000-entry cap with
// screenshots/ and dossier.json. Only text_max_bytes shapes the dossier's bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
