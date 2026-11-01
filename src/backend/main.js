// moocat backend for the tinyjs app: the session (core.js) over a TCP or TLS
// socket, SMud graphics in windows of their own (smud.html) floating over
// the main one, and the saved worlds in a file.
import { createSession } from './core.js';

const enc = new TextEncoder();

let app;

const session = createSession({
  push: (event, data) => app.push(event, data),

  async connect(world) {
    const sock = await tjs.connect(world.tls ? 'tls' : 'tcp', world.host, Number(world.port),
                                   { noDelay: true, keepAliveDelay: 60 });
    const { readable, writable } = await sock.opened;
    const writer = writable.getWriter();
    return { readable, write: (bytes) => writer.write(bytes), close: () => sock.close() };
  },

  openGraphic: (win, { title, width, height }) =>
    app.win.open(win, { page: 'smud.html', title, size: `${width}x${height}`, parent: true }),
  pushGraphic: (win, event, data) => app.window(win).push(event, data),
  closeGraphic: (win) => app.window(win).close(),
});

// Closed by the user.
export const onWindowClosed = (win) => session.onWindowClosed(win);

// --- worlds -------------------------------------------------------------

// [{ name, host, port, tls, login, smud }]; login is sent after connecting
// (e.g. "connect wizard"), so the file may hold a password: it's mode 600.
// smud: announce the SMud client, for worlds with SMud graphics (Rupert).
let worldsPath;

async function readWorlds() {
  try {
    return JSON.parse(new TextDecoder().decode(await tjs.readFile(worldsPath)));
  } catch {
    return [
      { name: 'Rupert', host: 'rupert.twyst.org', port: 9040, tls: false, login: '', smud: true },
      { name: 'Local ToastCore', host: '127.0.0.1', port: 17777, tls: false, login: 'connect wizard' },
    ];
  }
}

async function writeWorlds(worlds) {
  const tmp = worldsPath + '.tmp';
  const f = await tjs.open(tmp, 'w', 0o600);
  await f.write(enc.encode(JSON.stringify(worlds, null, 2) + '\n'));
  await f.close();
  await tjs.rename(tmp, worldsPath);
}

// --- api ----------------------------------------------------------------

export const api = {
  ...session.api,

  worlds: () => readWorlds(),

  async saveWorlds({ worlds }) {
    await writeWorlds(worlds.map(({ name, host, port, tls, login, smud }) => (
      { name: String(name), host: String(host), port: Number(port), tls: !!tls, login: String(login ?? ''),
        smud: !!smud })));
    return true;
  },
};

export async function init(a) {
  app = a;
  worldsPath = (await app.paths()).data + '/worlds.json';
}
