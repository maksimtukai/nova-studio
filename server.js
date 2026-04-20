const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 43219;
const ROOT = __dirname;
const USERS_FILE = path.join(ROOT, 'users.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8').trim();
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 65536) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleAuth(action, req, res) {
  try {
    const bodyText = await readBody(req);
    const body = JSON.parse(bodyText || '{}');
    const users = readUsers();

    if (action === 'register') {
      const name = String(body.name || '').replace(/[\x00-\x1f]/g, '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const pass = String(body.password || '');
      if (!name || !email || !pass) return sendJson(res, 400, { message: 'Заполните все поля.' });
      if (pass.length < 6) return sendJson(res, 400, { message: 'Пароль должен быть от 6 символов.' });
      if (users.find(u => u.email === email)) return sendJson(res, 409, { message: 'Email уже зарегистрирован.' });
      users.push({ name, email, password: pass });
      writeUsers(users);
      return sendJson(res, 200, { message: 'Регистрация успешна.' });
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const pass = String(body.password || '');
      const found = users.find(u => u.email === email && u.password === pass);
      if (!found) return sendJson(res, 401, { message: 'Неверный email или пароль.' });
      return sendJson(res, 200, { message: 'Успешный вход.', name: found.name, email: found.email });
    }

    if (action === 'reset') {
      const email = String(body.email || '').trim().toLowerCase();
      const newPass = String(body.newPassword || '');
      if (newPass.length < 6) return sendJson(res, 400, { message: 'Пароль должен быть от 6 символов.' });
      const idx = users.findIndex(u => u.email === email);
      if (idx < 0) return sendJson(res, 400, { message: 'Email не найден.' });
      users[idx].password = newPass;
      writeUsers(users);
      return sendJson(res, 200, { message: 'Пароль обновлён.' });
    }

    sendJson(res, 404, { message: 'Unknown action.' });
  } catch (e) {
    sendJson(res, 400, { message: 'Ошибка запроса.' });
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel.startsWith('nova/')) rel = rel.slice(5);
  else if (rel === 'nova') rel = '';
  if (!rel) rel = 'index.html';
  if (rel.includes('..')) { res.writeHead(403); return res.end('403'); }

  const full = path.join(ROOT, rel);
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(full).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    const cache = ['.html'].includes(ext)
      ? 'no-store, no-cache, must-revalidate'
      : (MIME[ext] ? 'public, max-age=3600' : 'no-cache');
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning'
    });
    return res.end();
  }

  const authMatch = pathname.toLowerCase().match(/^\/nova\/api\/auth\/(login|register|reset)$/);
  if (req.method === 'POST' && authMatch) {
    return handleAuth(authMatch[1], req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405); res.end('405');
});

server.listen(PORT, () => {
  console.log(`Nova server running on port ${PORT}`);
});
