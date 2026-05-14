const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Load .env
try { require('fs').readFileSync(require('path').join(__dirname,'.env'),'utf8').split('\n').forEach(l=>{const[k,...v]=l.split('=');if(k&&v.length)process.env[k.trim()]=v.join('=').trim();}); } catch {}

const PORT = process.env.PORT || 43219;
const ROOT = __dirname;
const USERS_FILE = path.join(ROOT, 'users.json');
const ADMIN_KEY = process.env.ADMIN_KEY || (() => { try { return fs.readFileSync(path.join(ROOT, 'admin.key'), 'utf8').trim(); } catch { return '1234567890'; } })();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const SERVER_START = new Date().toISOString();
const ERRORS_FILE = path.join(ROOT, 'errors.log');

function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(ERRORS_FILE, line); } catch {}
}

process.on('uncaughtException', e => logError('uncaughtException: ' + e.message));
process.on('unhandledRejection', e => logError('unhandledRejection: ' + (e && e.message || e)));

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

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$210000$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const value = String(stored || '');
  const parts = value.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return value === password;
  }

  const [, iterationsRaw, salt, expectedHex] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function hasPlaintextPassword(user) {
  return user && typeof user.password === 'string' && !user.password.startsWith('pbkdf2_sha256$');
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

async function askClaude(messages) {
  if (!ANTHROPIC_KEY) return null;
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: `Ты — вежливый и дружелюбный менеджер веб-студии Nova Studio. Ты общаешься с потенциальными клиентами в чате на сайте.
Nova Studio занимается созданием сайтов, мобильных приложений, дизайном и продвижением.
Отвечай кратко (1-3 предложения), по-русски, дружелюбно. Если клиент интересуется услугами — предложи оставить контакты или задать вопрос подробнее.
Не выдумывай цены и сроки — скажи что менеджер уточнит детали.`,
      messages
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).content[0].text); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
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
      users.push({ name, email, password: hashPassword(pass) });
      writeUsers(users);
      return sendJson(res, 200, { message: 'Регистрация успешна.' });
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const pass = String(body.password || '');
      const found = users.find(u => u.email === email && verifyPassword(pass, u.password));
      if (!found) return sendJson(res, 401, { message: 'Неверный email или пароль.' });
      if (hasPlaintextPassword(found)) {
        found.password = hashPassword(pass);
        writeUsers(users);
      }
      return sendJson(res, 200, { message: 'Успешный вход.', name: found.name, email: found.email });
    }

    if (action === 'reset') {
      const email = String(body.email || '').trim().toLowerCase();
      const newPass = String(body.newPassword || '');
      if (newPass.length < 6) return sendJson(res, 400, { message: 'Пароль должен быть от 6 символов.' });
      const idx = users.findIndex(u => u.email === email);
      if (idx < 0) return sendJson(res, 400, { message: 'Email не найден.' });
      users[idx].password = hashPassword(newPass);
      writeUsers(users);
      return sendJson(res, 200, { message: 'Пароль обновлён.' });
    }

    sendJson(res, 404, { message: 'Unknown action.' });
  } catch (e) {
    sendJson(res, 400, { message: 'Ошибка запроса.' });
  }
}

const LOG_FILE = path.join(ROOT, 'visitors.log');
const LOG_SKIP = /\.(log)$/i;

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return real.trim();
  const addr = req.socket.remoteAddress || '?';
  return addr.replace(/^::ffff:/, '');
}

function writeVisitorLog(ip, method, reqPath, status, ua, referer) {
  if (LOG_SKIP.test(reqPath)) return;
  const entry = JSON.stringify({
    t: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ip, m: method, p: reqPath, s: status,
    ua: ua || '', r: referer || ''
  });
  fs.appendFile(LOG_FILE, entry + '\n', () => {});
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel.startsWith('nova/')) rel = rel.slice(5);
  else if (rel === 'nova') rel = '';
  if (!rel) rel = 'index.html';
  if (rel.includes('..')) {
    writeVisitorLog(getClientIp(req), req.method, pathname, 403, req.headers['user-agent'], req.headers['referer']);
    res.writeHead(403); return res.end('403');
  }

  const full = path.join(ROOT, rel);
  fs.stat(full, (err, stat) => {
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'];
    const ref = req.headers['referer'];
    if (err || !stat.isFile()) {
      writeVisitorLog(ip, req.method, pathname, 404, ua, ref);
      res.writeHead(404); return res.end('404');
    }
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
    writeVisitorLog(ip, req.method, pathname, 200, ua, ref);
    fs.createReadStream(full).pipe(res);
  });
}

function checkAdminKey(req) {
  return req.headers['x-admin-key'] === ADMIN_KEY;
}

function getNgrokUrl() {
  return new Promise(resolve => {
    const req = http.get('http://localhost:4040/api/tunnels', res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const tunnels = JSON.parse(data).tunnels;
          const t = tunnels.find(t => t.proto === 'https') || tunnels[0];
          resolve(t ? t.public_url : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
  });
}

// ── Chat ────────────────────────────────────────────────────────────────────
const CHAT_FILE = path.join(ROOT, 'chat.json');

function readChats() {
  try { const r = fs.readFileSync(CHAT_FILE, 'utf8').trim(); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function writeChats(data) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// SSE subscribers: { sessionId: [res, ...] }
const chatSubs = {};
// Manager SSE subscribers
const managerSubs = [];

function pushToSession(sessionId, event, data) {
  const subs = chatSubs[sessionId] || [];
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  subs.forEach(r => { try { r.write(msg); } catch {} });
}
function pushToManagers(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  managerSubs.forEach(r => { try { r.write(msg); } catch {} });
}

async function handleChat(action, req, res) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, ngrok-skip-browser-warning'
  };

  // SSE stream for visitor
  if (action === 'stream') {
    const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');
    if (!sessionId) { res.writeHead(400); return res.end(); }
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(':\n\n');
    if (!chatSubs[sessionId]) chatSubs[sessionId] = [];
    chatSubs[sessionId].push(res);
    req.on('close', () => {
      chatSubs[sessionId] = (chatSubs[sessionId] || []).filter(r => r !== res);
    });
    return;
  }

  // SSE stream for manager
  if (action === 'manager-stream') {
    if (!checkAdminKey(req)) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(':\n\n');
    managerSubs.push(res);
    req.on('close', () => {
      const i = managerSubs.indexOf(res); if (i >= 0) managerSubs.splice(i, 1);
    });
    return;
  }

  // Get all sessions (manager)
  if (action === 'sessions') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    const chats = readChats();
    const sessions = Object.entries(chats).map(([id, s]) => ({
      id, name: s.name, startedAt: s.startedAt,
      lastMessage: s.messages[s.messages.length - 1] || null,
      unread: s.messages.filter(m => m.from === 'visitor' && !m.read).length
    })).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    return sendJson(res, 200, sessions);
  }

  // Get messages for session (manager or visitor with correct sessionId)
  if (action === 'messages') {
    const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');
    if (!sessionId) return sendJson(res, 400, { message: 'No sessionId' });
    const chats = readChats();
    const session = chats[sessionId];
    if (!session) return sendJson(res, 404, { message: 'Not found' });
    // Mark as read if manager
    if (checkAdminKey(req)) {
      session.messages.forEach(m => { if (m.from === 'visitor') m.read = true; });
      writeChats(chats);
    }
    return sendJson(res, 200, { session, messages: session.messages });
  }

  // Visitor sends message
  if (action === 'send' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}');
    const { sessionId, name, text } = body;
    if (!sessionId || !text) return sendJson(res, 400, { message: 'Missing fields' });
    const chats = readChats();
    if (!chats[sessionId]) {
      chats[sessionId] = { id: sessionId, name: name || 'Гость', startedAt: new Date().toISOString(), messages: [] };
    }
    const msg = { id: Date.now(), from: 'visitor', text, time: new Date().toISOString(), read: false };
    chats[sessionId].messages.push(msg);
    if (name) chats[sessionId].name = name;
    writeChats(chats);
    pushToManagers('message', { sessionId, session: chats[sessionId], msg });
    sendJson(res, 200, { ok: true, msg });

    // AI auto-reply
    setImmediate(async () => {
      try {
        const session = readChats()[sessionId];
        if (!session) return;
        const apiMessages = session.messages.map(m => ({
          role: m.from === 'visitor' ? 'user' : 'assistant',
          content: m.text
        }));
        const aiText = await askClaude(apiMessages);
        if (!aiText) return;
        const chats2 = readChats();
        if (!chats2[sessionId]) return;
        const aiMsg = { id: Date.now(), from: 'manager', text: aiText, time: new Date().toISOString() };
        chats2[sessionId].messages.push(aiMsg);
        writeChats(chats2);
        pushToSession(sessionId, 'message', aiMsg);
        pushToManagers('message', { sessionId, msg: aiMsg });
      } catch {}
    });
    return;
  }

  // Manager replies
  if (action === 'reply' && req.method === 'POST') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    const body = JSON.parse(await readBody(req) || '{}');
    const { sessionId, text } = body;
    if (!sessionId || !text) return sendJson(res, 400, { message: 'Missing fields' });
    const chats = readChats();
    if (!chats[sessionId]) return sendJson(res, 404, { message: 'Session not found' });
    const msg = { id: Date.now(), from: 'manager', text, time: new Date().toISOString() };
    chats[sessionId].messages.push(msg);
    writeChats(chats);
    pushToSession(sessionId, 'message', msg);
    pushToManagers('message', { sessionId, msg });
    return sendJson(res, 200, { ok: true, msg });
  }

  res.writeHead(404); res.end();
}
// ────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, ngrok-skip-browser-warning'
    });
    return res.end();
  }

  // Control API
  if (pathname === '/api/public-status') {
    return sendJson(res, 200, { running: true, startTime: SERVER_START });
  }

  if (pathname === '/api/public-ngrok') {
    const ngrokUrl = await getNgrokUrl();
    return sendJson(res, 200, { url: ngrokUrl });
  }

  if (pathname === '/api/status') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    return sendJson(res, 200, { running: true, pid: process.pid, startTime: SERVER_START });
  }

  if (pathname === '/api/clear-log' && req.method === 'POST') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    try { fs.writeFileSync(LOG_FILE, '', 'utf8'); } catch {}
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/start' && req.method === 'POST') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    return sendJson(res, 200, { message: 'already running' });
  }

  if (pathname === '/api/stop' && req.method === 'POST') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    sendJson(res, 200, { message: 'stopping' });
    setTimeout(() => process.exit(0), 300);
    return;
  }

  if (pathname === '/api/restart' && req.method === 'POST') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    sendJson(res, 200, { message: 'restarting' });
    setTimeout(() => {
      spawn(process.execPath, process.argv.slice(1), {
        detached: true, stdio: 'inherit',
        cwd: ROOT, env: process.env
      }).unref();
      process.exit(0);
    }, 300);
    return;
  }

  const chatMatch = pathname.toLowerCase().match(/^\/nova\/api\/chat\/(stream|manager-stream|sessions|messages|send|reply)$/);
  if (chatMatch) return handleChat(chatMatch[1], req, res);

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
