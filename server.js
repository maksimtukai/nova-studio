const http = require('http');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
// Prevent multiple concurrent instances: simple PID lock
const PID_FILE = path.join(__dirname, 'server.pid');
try {
  if (fs.existsSync(PID_FILE)) {
    const otherPid = Number(fs.readFileSync(PID_FILE, 'utf8') || '0') || 0;
    if (otherPid) {
      try {
        process.kill(otherPid, 0);
        console.error('Another server.js is already running (PID ' + otherPid + '). Exiting.');
        process.exit(1);
      } catch (err) {
        // process not running, continue and overwrite pid file
      }
    }
  }
  fs.writeFileSync(PID_FILE, String(process.pid), { encoding: 'utf8' });
  const removePid = () => { try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch(e){} };
  process.on('exit', removePid);
  process.on('SIGINT', () => { removePid(); process.exit(0); });
  process.on('uncaughtException', (err) => { console.error('uncaughtException', err); removePid(); process.exit(1); });
} catch (e) {
  console.error('PID lock setup failed:', e && e.message);
}

const crypto = require('crypto');
const { spawn } = require('child_process');

// Load .env
try { require('fs').readFileSync(require('path').join(__dirname,'.env'),'utf8').split('\n').forEach(l=>{const[k,...v]=l.split('=');if(k&&v.length)process.env[k.trim()]=v.join('=').trim();}); } catch {}

const PORT = process.env.PORT || 43219;
const ROOT = __dirname;
const USERS_FILE = path.join(ROOT, 'users.json');
const ADMIN_KEY = process.env.ADMIN_KEY || (() => { try { return fs.readFileSync(path.join(ROOT, 'admin.key'), 'utf8').trim(); } catch { return '1234567890'; } })();
const SERVER_START = new Date().toISOString();
const ERRORS_FILE = path.join(ROOT, 'errors.log');
const IS_VERCEL = Boolean(process.env.VERCEL);

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_DISABLED = String(process.env.SUPABASE_DISABLED || '').toLowerCase() === 'true';
const SUPABASE_ALLOW_ANON = String(process.env.SUPABASE_ALLOW_ANON || '').toLowerCase() === 'true';
let supabase = null;

let SUPABASE_KEY = '';
if (SUPABASE_SERVICE_ROLE_KEY) SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY;
else if (SUPABASE_ALLOW_ANON && SUPABASE_ANON_KEY) SUPABASE_KEY = SUPABASE_ANON_KEY;

if (!SUPABASE_DISABLED && SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('Supabase client initialized');
  } catch (e) {
    console.error('Failed to initialize Supabase:', e.message);
    supabase = null;
  }
} else {
  if (SUPABASE_DISABLED) console.log('Supabase disabled, using local JSON files');
  else if (!SUPABASE_URL) console.log('Supabase URL not found, using local JSON files');
  else console.log('Supabase key not found, using local JSON files');
}

function logError(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(ERRORS_FILE, line); } catch {}
}

// Analytics system
const ANALYTICS_FILE = path.join(ROOT, 'analytics.json');
const MAX_ANALYTICS_ENTRIES = 5000;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function clampText(value, max = 200) {
  if (value == null) return '';
  return String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, max);
}

function toEventTimestamp(value) {
  if (value == null || value === '') return Date.now();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function toIsoTimestamp(value) {
  return new Date(toEventTimestamp(value)).toISOString();
}

function getPathFromUrlCandidate(value) {
  const text = clampText(value, 500);
  if (!text) return '/';
  try {
    const parsed = new URL(text, 'http://localhost');
    return parsed.pathname || '/';
  } catch {
    return text.startsWith('/') ? text : `/${text.replace(/^\/+/, '')}`;
  }
}

function getRefHost(value) {
  const text = clampText(value, 500);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return parsed.hostname || '';
  } catch {
    return text;
  }
}

function getLanguageFromHeader(value) {
  const text = clampText(value, 100);
  if (!text) return '';
  return text.split(',')[0].trim();
}

function getTimezoneOffset() {
  return -new Date().getTimezoneOffset() / 60;
}

function sanitizeScreen(value) {
  if (!value) return '';
  if (typeof value === 'string') return clampText(value, 32);
  if (typeof value === 'object') {
    const width = Number(value.width || value.w || value.innerWidth || 0);
    const height = Number(value.height || value.h || value.innerHeight || 0);
    if (width > 0 && height > 0) return `${Math.round(width)}x${Math.round(height)}`;
  }
  return '';
}

function sanitizeMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean = {};
  Object.keys(value).slice(0, 20).forEach((key) => {
    const safeKey = clampText(key, 40);
    const item = value[key];
    if (!safeKey) return;
    if (item == null) {
      clean[safeKey] = '';
    } else if (typeof item === 'number' || typeof item === 'boolean') {
      clean[safeKey] = item;
    } else if (typeof item === 'string') {
      clean[safeKey] = clampText(item, 200);
    }
  });
  return clean;
}

function detectDeviceType(ua) {
  const value = String(ua || '').toLowerCase();
  if (!value) return 'Unknown';
  if (/ipad|tablet/.test(value)) return 'Tablet';
  if (/mobile|iphone|android.+mobile|windows phone/.test(value)) return 'Mobile';
  if (/bot|spider|crawler|headless/.test(value)) return 'Bot';
  return 'Desktop';
}

function detectBrowser(ua) {
  const value = String(ua || '');
  const checks = [
    { name: 'Edge', regex: /(Edg|Edge)\/([\d.]+)/ },
    { name: 'Opera', regex: /(OPR|Opera)\/([\d.]+)/ },
    { name: 'Chrome', regex: /Chrome\/([\d.]+)/ },
    { name: 'Firefox', regex: /Firefox\/([\d.]+)/ },
    { name: 'Safari', regex: /Version\/([\d.]+).*Safari/ },
    { name: 'Internet Explorer', regex: /(MSIE |rv:)([\d.]+)/ }
  ];
  for (const item of checks) {
    const match = value.match(item.regex);
    if (match) {
      const version = match[2] || match[1] || '';
      return { browser: item.name, browserVersion: clampText(version, 20) };
    }
  }
  return { browser: value ? 'Other' : 'Unknown', browserVersion: '' };
}

function detectOs(ua) {
  const value = String(ua || '');
  if (/Windows NT 10\.0/.test(value)) return 'Windows 10/11';
  if (/Windows NT 6\.3/.test(value)) return 'Windows 8.1';
  if (/Windows NT 6\.2/.test(value)) return 'Windows 8';
  if (/Windows NT 6\.1/.test(value)) return 'Windows 7';
  if (/Android/.test(value)) return 'Android';
  if (/iPhone|iPad|iPod/.test(value)) return 'iOS';
  if (/Mac OS X/.test(value)) return 'macOS';
  if (/Linux/.test(value)) return 'Linux';
  return value ? 'Other' : 'Unknown';
}

function getStableVisitorId(ip, ua) {
  return crypto
    .createHash('sha1')
    .update(`${ip || ''}|${ua || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function normalizeAnalyticsEvent(event, req, fallbackPath = '/') {
  const ua = clampText((event && event.ua) || (req && req.headers['user-agent']) || '', 500);
  const browserInfo = detectBrowser(ua);
  const ip = clampText((event && event.ip) || (req ? getClientIp(req) : ''), 80);
  const pathValue = getPathFromUrlCandidate((event && (event.path || event.url)) || fallbackPath || '/');
  const visitorId = clampText((event && event.visitorId) || '', 64) || getStableVisitorId(ip, ua);
  const sessionId = clampText((event && event.sessionId) || '', 64) || `fallback-${visitorId}`;
  const duration = Number(event && event.duration);
  const countryHeader = req && req.headers['cf-ipcountry'] ? String(req.headers['cf-ipcountry']).trim() : '';
  return {
    ts: toIsoTimestamp(event && event.ts),
    event: clampText((event && event.event) || 'pageview', 40) || 'pageview',
    session_id: sessionId,
    visitor_id: visitorId,
    ip,
    path: pathValue,
    url: clampText((event && event.url) || pathValue, 500),
    title: clampText(event && event.title, 160),
    ua,
    ref: clampText((event && event.ref) || (req && req.headers['referer']) || '', 500),
    ref_host: getRefHost((event && event.ref) || (req && req.headers['referer']) || ''),
    browser: clampText((event && event.browser) || browserInfo.browser, 80),
    browser_version: clampText((event && event.browserVersion) || browserInfo.browserVersion, 20),
    os: clampText((event && event.os) || detectOs(ua), 80),
    device_type: clampText((event && event.deviceType) || detectDeviceType(ua), 40),
    language: clampText((event && event.language) || getLanguageFromHeader(req && req.headers['accept-language']), 40),
    timezone: clampText((event && event.timezone) || `UTC${getTimezoneOffset() >= 0 ? '+' : ''}${getTimezoneOffset()}`, 40),
    screen: sanitizeScreen(event && event.screen),
    country: clampText((event && event.country) || countryHeader || 'Unknown', 80),
    duration: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    meta: sanitizeMeta(event && event.meta)
  };
}

async function loadLegacyAnalyticsFromSupabase() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('analytics')
      .select('*')
      .order('ts', { ascending: false })
      .limit(MAX_ANALYTICS_ENTRIES);
    if (error) throw error;
    return (data || []).map((item) => normalizeAnalyticsEvent({
      ts: item.ts,
      event: 'pageview',
      ip: item.ip,
      path: item.path,
      ua: item.ua,
      ref: item.ref
    }, null, item.path || '/'));
  } catch (e) {
    logError('Failed to load analytics from Supabase: ' + e.message);
    return [];
  }
}

async function loadAnalytics() {
  try {
    const data = fs.readFileSync(ANALYTICS_FILE, 'utf8');
    const parsed = parseJsonSafe(data, []);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
  }
  return loadLegacyAnalyticsFromSupabase();
}

async function saveAnalytics(data) {
  try {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logError('Failed to save analytics: ' + e.message);
  }
}

async function trackEvent(event) {
  const normalized = normalizeAnalyticsEvent(event.reqBody || event, event.req || null, (event && event.path) || '/');
  const analytics = await loadAnalytics();
  analytics.push(normalized);
  if (analytics.length > MAX_ANALYTICS_ENTRIES) {
    analytics.splice(0, analytics.length - MAX_ANALYTICS_ENTRIES);
  }
  await saveAnalytics(analytics);

  if (supabase) {
    try {
      const legacyInsert = {
        ts: normalized.ts,
        ip: normalized.ip,
        path: normalized.path,
        ua: normalized.ua,
        ref: normalized.ref
      };
      const fullInsert = {
        ...legacyInsert,
        event: normalized.event,
        session_id: normalized.session_id,
        visitor_id: normalized.visitor_id,
        url: normalized.url,
        title: normalized.title,
        ref_host: normalized.ref_host,
        browser: normalized.browser,
        browser_version: normalized.browser_version,
        os: normalized.os,
        device_type: normalized.device_type,
        language: normalized.language,
        timezone: normalized.timezone,
        screen: normalized.screen,
        country: normalized.country,
        duration: normalized.duration,
        meta: normalized.meta
      };

      let { error } = await supabase
        .from('analytics')
        .insert(fullInsert);
      if (error && /column|schema cache/i.test(String(error.message || ''))) {
        ({ error } = await supabase
          .from('analytics')
          .insert(legacyInsert));
      }
      if (error) throw error;
    } catch (e) {
      logError('Failed to track event in Supabase: ' + e.message);
    }
  }
  return normalized;
}

function getEventTime(event) {
  return toEventTimestamp(event && event.ts);
}

function sortByCountDesc(a, b) {
  return b.count - a.count;
}

function incrementCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function toCountList(map, limit = 10) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort(sortByCountDesc)
    .slice(0, limit);
}

function getRangeStart(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (range === 'week') return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (range === 'month') return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

function filterAnalyticsByRange(analytics, range) {
  const start = getRangeStart(range);
  if (!start) return analytics.slice();
  return analytics.filter((item) => getEventTime(item) >= start);
}

function buildSessions(analytics) {
  const sorted = analytics.slice().sort((a, b) => getEventTime(a) - getEventTime(b));
  const sessions = [];
  const active = new Map();
  sorted.forEach((event) => {
    const time = getEventTime(event);
    const baseKey = event.session_id || event.visitor_id || event.ip || 'anonymous';
    let session = active.get(baseKey);
    if (!session || time - session.lastTs > SESSION_TIMEOUT_MS) {
      session = {
        id: `${baseKey}-${time}`,
        baseKey,
        visitorId: event.visitor_id || baseKey,
        ip: event.ip || '',
        country: event.country || 'Unknown',
        browser: event.browser || 'Unknown',
        os: event.os || 'Unknown',
        deviceType: event.device_type || 'Unknown',
        language: event.language || '',
        screen: event.screen || '',
        timezone: event.timezone || '',
        firstTs: time,
        lastTs: time,
        pageviews: 0,
        eventCount: 0,
        pages: new Set(),
        reportedDuration: 0
      };
      sessions.push(session);
      active.set(baseKey, session);
    }

    session.lastTs = time;
    session.eventCount += 1;
    if (event.path) session.pages.add(event.path);
    if ((event.event || 'pageview') === 'pageview') session.pageviews += 1;
    if (Number.isFinite(event.duration) && event.duration > session.reportedDuration) {
      session.reportedDuration = event.duration;
    }
    if (!session.country || session.country === 'Unknown') session.country = event.country || session.country;
    if (!session.screen) session.screen = event.screen || '';
    if (!session.language) session.language = event.language || '';
    if (!session.timezone) session.timezone = event.timezone || '';
  });

  return sessions.map((session) => ({
    ...session,
    pages: Array.from(session.pages),
    durationSec: session.reportedDuration || Math.max(0, Math.round((session.lastTs - session.firstTs) / 1000)),
    bounced: session.pageviews <= 1
  }));
}

function buildTimeline(analytics, range) {
  const pageviews = analytics.filter((item) => (item.event || 'pageview') === 'pageview');
  const now = new Date();
  const buckets = [];
  const counts = new Map();

  if (range === 'today') {
    const base = new Date(now);
    base.setMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i -= 1) {
      const start = new Date(base.getTime() - i * 60 * 60 * 1000);
      const key = start.toISOString();
      buckets.push({ key, label: `${String(start.getHours()).padStart(2, '0')}:00`, start: start.getTime() });
      counts.set(key, 0);
    }
    pageviews.forEach((event) => {
      const d = new Date(getEventTime(event));
      d.setMinutes(0, 0, 0);
      const key = d.toISOString();
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    });
  } else {
    const length = range === 'week' ? 7 : 30;
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    for (let i = length - 1; i >= 0; i -= 1) {
      const start = new Date(base.getTime() - i * 24 * 60 * 60 * 1000);
      const key = start.toISOString().slice(0, 10);
      buckets.push({
        key,
        label: start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
        start: start.getTime()
      });
      counts.set(key, 0);
    }
    pageviews.forEach((event) => {
      const d = new Date(getEventTime(event));
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    });
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    value: counts.get(bucket.key) || 0
  }));
}

function buildWeekdayBreakdown(analytics) {
  const pageviews = analytics.filter((item) => (item.event || 'pageview') === 'pageview');
  const labels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const counts = labels.map((label) => ({ label, value: 0 }));
  pageviews.forEach((event) => {
    const d = new Date(getEventTime(event));
    counts[d.getDay()].value += 1;
  });
  return counts;
}

function getLastEvent(analytics) {
  return analytics
    .slice()
    .sort((a, b) => getEventTime(b) - getEventTime(a))[0] || null;
}

async function getAnalyticsStats(range = 'today') {
  const analytics = await loadAnalytics();
  const filtered = filterAnalyticsByRange(analytics, range);
  const sessions = buildSessions(filtered);
  const allSessions = buildSessions(analytics);
  const pageviews = filtered.filter((item) => (item.event || 'pageview') === 'pageview');
  const uniqueVisitors = new Set();
  const countries = new Map();
  const browsers = new Map();
  const devices = new Map();
  const osFamilies = new Map();
  const languages = new Map();
  const screens = new Map();
  const referrers = new Map();
  const pages = new Map();

  filtered.forEach((event) => {
    incrementCounter(pages, event.path || '/');
    incrementCounter(browsers, event.browser || 'Unknown');
    incrementCounter(devices, event.device_type || 'Unknown');
    incrementCounter(osFamilies, event.os || 'Unknown');
    incrementCounter(languages, event.language || 'Unknown');
    incrementCounter(screens, event.screen || 'Unknown');
    incrementCounter(countries, event.country || 'Unknown');
    incrementCounter(referrers, event.ref_host || (event.ref ? event.ref : 'Direct'));
    uniqueVisitors.add(event.visitor_id || event.ip || 'anonymous');
  });

  const onlineCutoff = Date.now() - ONLINE_WINDOW_MS;
  const onlineUsers = new Set(
    analytics
      .filter((event) => getEventTime(event) >= onlineCutoff)
      .map((event) => event.session_id || event.visitor_id || event.ip || 'anonymous')
  ).size;

  const totalDuration = sessions.reduce((sum, session) => sum + session.durationSec, 0);
  const bouncedSessions = sessions.filter((session) => session.bounced).length;
  const recentVisitors = pageviews
    .slice()
    .sort((a, b) => getEventTime(b) - getEventTime(a))
    .slice(0, 10)
    .map((event) => ({
      ts: event.ts,
      ip: event.ip,
      country: event.country || 'Unknown',
      path: event.path || '/',
      browser: event.browser || 'Unknown',
      os: event.os || 'Unknown',
      language: event.language || 'Unknown'
    }));

  const liveEvents = analytics
    .slice()
    .sort((a, b) => getEventTime(b) - getEventTime(a))
    .slice(0, 12)
    .map((event) => ({
      ts: event.ts,
      event: event.event || 'pageview',
      path: event.path || '/',
      browser: event.browser || 'Unknown',
      os: event.os || 'Unknown',
      country: event.country || 'Unknown'
    }));

  const topScreens = toCountList(screens, 5);
  const topLanguages = toCountList(languages, 5);
  const topBrowsers = toCountList(browsers, 5);
  const topOs = toCountList(osFamilies, 5);

  return {
    range,
    generatedAt: new Date().toISOString(),
    summary: {
      totalViews: pageviews.length,
      uniqueVisitors: uniqueVisitors.size,
      onlineUsers,
      avgSessionSec: sessions.length ? Math.round(totalDuration / sessions.length) : 0,
      bounceRate: sessions.length ? Number(((bouncedSessions / sessions.length) * 100).toFixed(1)) : 0,
      countries: toCountList(countries, 100).filter((item) => item.label && item.label !== 'Unknown').length,
      totalEvents: filtered.length,
      sessions: sessions.length
    },
    timeline: buildTimeline(filtered, range),
    weekday: buildWeekdayBreakdown(filtered),
    topPages: toCountList(pages, 8).map((item) => ({ path: item.label, count: item.count })),
    topReferrers: toCountList(referrers, 6).map((item) => ({ referrer: item.label || 'Direct', count: item.count })),
    browsers: topBrowsers,
    devices: toCountList(devices, 5),
    os: topOs,
    languages: topLanguages,
    screens: topScreens,
    countriesList: toCountList(countries, 8).map((item) => ({ country: item.label || 'Unknown', count: item.count })),
    recentVisitors,
    liveEvents,
    systemInfo: {
      topOs: topOs[0] ? topOs[0].label : 'Нет данных',
      topResolution: topScreens[0] ? topScreens[0].label : 'Нет данных',
      topLanguage: topLanguages[0] ? topLanguages[0].label : 'Нет данных',
      topBrowser: topBrowsers[0] ? topBrowsers[0].label : 'Нет данных',
      timezones: toCountList(filtered.reduce((map, event) => {
        incrementCounter(map, event.timezone || 'Unknown');
        return map;
      }, new Map()), 5)
    },
    last: getLastEvent(filtered),
    health: {
      storedEvents: analytics.length,
      activeSessions: allSessions.filter((session) => session.lastTs >= onlineCutoff).length
    }
  };
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

// Static file cache
const staticCache = new Map();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL = 3600000; // 1 hour

function getCachedFile(filePath) {
  const cached = staticCache.get(filePath);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedFile(filePath, data) {
  if (staticCache.size >= CACHE_MAX_SIZE) {
    const firstKey = staticCache.keys().next().value;
    staticCache.delete(firstKey);
  }
  staticCache.set(filePath, { data, timestamp: Date.now() });
}

async function readUsers() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*');
      if (error) throw error;
      return data || [];
    } catch (e) {
      logError('Failed to load users from Supabase: ' + e.message);
      return [];
    }
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8').trim();
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writeUsers(users) {
  if (supabase) {
    // Users are managed individually in the auth functions
    return;
  }
  fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8', (err) => {
    if (err) logError('writeUsers error: ' + err.message);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex');
  // Формат совместим с Django: pbkdf2_sha256$iterations$salt$hash
  return ['pbkdf2_sha256', '210000', salt, hash].join('$');
}

function verifyPassword(password, stored) {
  const value = String(stored || '');
  const parts = value.split('$');
  // Если это не наш формат хеша — поддержим старый plaintext режим.
  if (parts[0] !== 'pbkdf2_sha256') {
    return value === password;
  }

  // Поддерживаем:
  // 1) Нормальный формат: pbkdf2_sha256$210000$salt$hash
  // 2) Ранее встречавшийся баг с двойным "$": pbkdf2_sha256$210000$$salt$hash
  let iterationsRaw = parts[1];
  let salt = '';
  let expectedHex = '';
  if (parts.length === 4) {
    salt = parts[2];
    expectedHex = parts[3];
  } else if (parts.length === 5 && parts[2] === '') {
    salt = parts[3];
    expectedHex = parts[4];
  } else {
    return false;
  }
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function isBuggyDoubleDollarHash(stored) {
  return typeof stored === 'string' && stored.startsWith('pbkdf2_sha256$') && stored.includes('$210000$$');
}

function hasPlaintextPassword(user) {
  return user && typeof user.password === 'string' && !user.password.startsWith('pbkdf2_sha256$');
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning'
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, ngrok-skip-browser-warning',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  res.end(text);
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
    const users = await readUsers();

    // На Vercel локальные JSON-файлы не являются надёжным хранилищем.
    // Если Supabase не инициализировался, возвращаем понятную ошибку, а не "Неверный email или пароль".
    if (IS_VERCEL && !supabase) {
      return sendJson(res, 500, { message: 'Сервер авторизации не настроен. Проверьте переменные окружения Supabase в Vercel.' });
    }

    if (action === 'register') {
      const name = String(body.name || '').replace(/[\x00-\x1f]/g, '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const pass = String(body.password || '');
      if (!name || !email || !pass) return sendJson(res, 400, { message: 'Заполните все поля.' });
      if (pass.length < 6) return sendJson(res, 400, { message: 'Пароль должен быть от 6 символов.' });
      
      if (supabase) {
        const { data: existingUser } = await supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .maybeSingle();
        if (existingUser) return sendJson(res, 409, { message: 'Email уже зарегистрирован.' });
        
        const { error } = await supabase
          .from('users')
          .insert({ name, email, password: hashPassword(pass) });
        if (error) return sendJson(res, 500, { message: 'Ошибка регистрации.' });
      } else {
        if (users.find(u => u.email === email)) return sendJson(res, 409, { message: 'Email уже зарегистрирован.' });
        users.push({ name, email, password: hashPassword(pass) });
        writeUsers(users);
      }
      return sendJson(res, 200, { message: 'Регистрация успешна.' });
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const pass = String(body.password || '');
      
      if (supabase) {
        const { data: user, error } = await supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .maybeSingle();
        if (error) return sendJson(res, 500, { message: 'Ошибка базы данных. Попробуйте позже.' });
        if (!user) return sendJson(res, 401, { message: 'Неверный email или пароль.' });
        if (!verifyPassword(pass, user.password)) return sendJson(res, 401, { message: 'Неверный email или пароль.' });
        // Миграция старого "buggy" формата хеша в корректный (без влияния на пользователя).
        if (isBuggyDoubleDollarHash(user.password)) {
          try {
            await supabase
              .from('users')
              .update({ password: hashPassword(pass) })
              .eq('email', email);
          } catch {}
        }
        return sendJson(res, 200, { message: 'Успешный вход.', name: user.name, email: user.email });
      } else {
        const found = users.find(u => u.email === email && verifyPassword(pass, u.password));
        if (!found) return sendJson(res, 401, { message: 'Неверный email или пароль.' });
        if (hasPlaintextPassword(found)) {
          found.password = hashPassword(pass);
          writeUsers(users);
        }
        // Мигрируем старый buggy-хеш в корректный.
        if (isBuggyDoubleDollarHash(found.password)) {
          found.password = hashPassword(pass);
          writeUsers(users);
        }
        return sendJson(res, 200, { message: 'Успешный вход.', name: found.name, email: found.email });
      }
    }

    if (action === 'reset') {
      const email = String(body.email || '').trim().toLowerCase();
      const newPass = String(body.newPassword || '');
      if (newPass.length < 6) return sendJson(res, 400, { message: 'Пароль должен быть от 6 символов.' });

      const fallbackName = (() => {
        const left = String(email.split('@')[0] || '').trim();
        const clean = left.replace(/[^\wА-Яа-яёЁ-]+/g, '').slice(0, 32);
        return clean || 'Пользователь';
      })();
      
      if (supabase) {
        const { data: updated, error } = await supabase
          .from('users')
          .update({ password: hashPassword(newPass) })
          .eq('email', email)
          .select('email');
        if (error) return sendJson(res, 500, { message: 'Ошибка обновления пароля. Попробуйте позже.' });
        if (!updated || (Array.isArray(updated) && updated.length === 0)) {
          // Для демо-режима: если пользователь не найден, создаём аккаунт и ставим новый пароль.
          const { error: insertError } = await supabase
            .from('users')
            .insert({ name: fallbackName, email, password: hashPassword(newPass) });
          if (insertError) {
            return sendJson(res, 500, { message: 'Не удалось создать аккаунт. Попробуйте позже.' });
          }
          return sendJson(res, 200, { message: 'Аккаунт создан. Теперь можно войти.' });
        }
      } else {
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) {
          users.push({ name: fallbackName, email, password: hashPassword(newPass) });
          writeUsers(users);
          return sendJson(res, 200, { message: 'Аккаунт создан. Теперь можно войти.' });
        }
        users[idx].password = hashPassword(newPass);
        writeUsers(users);
      }
      return sendJson(res, 200, { message: 'Пароль обновлён.' });
    }

    sendJson(res, 404, { message: 'Unknown action.' });
  } catch (e) {
    sendJson(res, 400, { message: 'Ошибка запроса.' });
  }
}

const LOG_FILE = path.join(ROOT, 'visitors.log');
const LOG_SKIP = /\.(log)$/i;

// Log batching to reduce I/O operations
const logBatch = [];
const LOG_BATCH_SIZE = 50;
const LOG_BATCH_INTERVAL = 5000; // 5 seconds

function flushLogBatch() {
  if (logBatch.length === 0) return;
  const batch = logBatch.splice(0, logBatch.length);
  fs.appendFile(LOG_FILE, batch.join('') + '\n', 'utf8', (err) => {
    if (err) logError('flushLogBatch error: ' + err.message);
  });
}

setInterval(flushLogBatch, LOG_BATCH_INTERVAL);
const STATIC_DENY = new Set([
  '.env',
  'admin.key',
  'admin.key.example',
  'errors.log',
  'users.json',
  'visitors.log'
]);

function getClientIp(req) {
  // Cloudflare Tunnel / proxy headers (prefer real client IP)
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).split(',')[0].trim();

  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();

  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();

  const addr = req.socket.remoteAddress || '?';
  return String(addr).replace(/^::ffff:/, '');
}

function writeVisitorLog(ip, method, reqPath, status, ua, referer) {
  if (LOG_SKIP.test(reqPath)) return;
  const entry = JSON.stringify({
    t: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ip, m: method, p: reqPath, s: status,
    ua: ua || '', r: referer || ''
  });
  logBatch.push(entry);
  if (logBatch.length >= LOG_BATCH_SIZE) {
    flushLogBatch();
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel.startsWith('nova/')) rel = rel.slice(5);
  else if (rel === 'nova') rel = '';
  rel = rel.replace(/[\s,]+$/, '');
  if (!rel) rel = 'index.html';
  if (rel.includes('..')) {
    writeVisitorLog(getClientIp(req), req.method, pathname, 403, req.headers['user-agent'], req.headers['referer']);
    res.writeHead(403); return res.end('403');
  }
  if (rel.startsWith('.') || STATIC_DENY.has(rel.toLowerCase())) {
    writeVisitorLog(getClientIp(req), req.method, pathname, 403, req.headers['user-agent'], req.headers['referer']);
    res.writeHead(403); return res.end('403');
  }

  const full = path.join(ROOT, rel);
  const ext = path.extname(full).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  
  // Check cache for static files (except HTML)
  if (!['.html'].includes(ext)) {
    const cached = getCachedFile(full);
    if (cached) {
      const ip = getClientIp(req);
      writeVisitorLog(ip, req.method, pathname, 200, req.headers['user-agent'], req.headers['referer']);
      res.writeHead(200, {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });
      return res.end(cached);
    }
  }

  fs.stat(full, (err, stat) => {
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'];
    const ref = req.headers['referer'];
    if (err || !stat.isFile()) {
      writeVisitorLog(ip, req.method, pathname, 404, ua, ref);
      res.writeHead(404); return res.end('404');
    }
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
    
    // Cache small static files
    if (!['.html'].includes(ext) && stat.size < 102400) { // < 100KB
      fs.readFile(full, (err, data) => {
        if (err) {
          fs.createReadStream(full).pipe(res);
        } else {
          setCachedFile(full, data);
          res.end(data);
        }
      });
    } else {
      fs.createReadStream(full).pipe(res);
    }
  });
}

function checkAdminKey(req) {
  return req.headers['x-admin-key'] === ADMIN_KEY;
}

const TUNNEL_URL_FILE = path.join(ROOT, 'server.url');

function readTunnelUrlFile() {
  try {
    const url = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
    if (url.startsWith('http')) return url;
  } catch {}
  return null;
}

function readConfiguredTunnelUrl() {
  try {
    const text = fs.readFileSync(path.join(ROOT, 'cloudflared.yml'), 'utf8');
    const m = text.match(/^\s*-\s*hostname:\s*(\S+)/m);
    if (m) return `https://${m[1].trim()}`;
  } catch {}
  return null;
}

function fetchUrlFromMetrics(port, pattern) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/metrics`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const m = data.match(pattern);
        resolve(m ? m[1] : null);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
  });
}

function getNgrokUrl() {
  const configured = readConfiguredTunnelUrl();
  if (configured) return Promise.resolve(configured);
  const persisted = readTunnelUrlFile();
  if (persisted) return Promise.resolve(persisted);
  return fetchUrlFromMetrics(20241, /userHostname="(https?:\/\/[^"]+)"/)
    .then(url => {
      if (url) return url;
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
    })
    .then(url => url || null);
}

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

  if (pathname === '/api/logs' && req.method === 'GET') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    let text = '';
    try { text = fs.readFileSync(LOG_FILE, 'utf8'); } catch {}
    return sendText(res, 200, text);
  }

  if (pathname === '/api/clear-log' && req.method === 'POST') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    try { fs.writeFileSync(LOG_FILE, '', 'utf8'); } catch {}
    return sendJson(res, 200, { ok: true });
  }

  // Analytics API
  if ((pathname === '/api/analytics' || pathname === '/api/v2/analytics') && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = parseJsonSafe(body || '{}', {});
      const event = await trackEvent({
        ...data,
        ip: getClientIp(req),
        ua: req.headers['user-agent'] || '',
        ref: data.ref || req.headers['referer'] || '',
        req
      });
      return sendJson(res, 200, { ok: true, event });
    } catch (e) {
      return sendJson(res, 400, { message: 'bad request' });
    }
  }

  if (pathname === '/api/analytics/stats' && req.method === 'GET') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    try {
      const url = new URL(req.url, 'http://localhost');
      const range = clampText(url.searchParams.get('range') || 'today', 20).toLowerCase();
      const safeRange = ['today', 'week', 'month', 'all'].includes(range) ? range : 'today';
      const stats = await getAnalyticsStats(safeRange);
      return sendJson(res, 200, stats);
    } catch (e) {
      return sendJson(res, 500, { message: 'error' });
    }
  }

  if (pathname === '/api/analytics/clear' && req.method === 'POST') {
    if (!checkAdminKey(req)) return sendJson(res, 401, { message: 'Unauthorized' });
    try {
      if (supabase) {
        const { error } = await supabase
          .from('analytics')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
      } else {
        await saveAnalytics([]);
      }
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 500, { message: 'error' });
    }
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

  const authMatch = pathname.toLowerCase().match(/^\/nova\/api\/auth\/(login|register|reset)$/);
  if (req.method === 'POST' && authMatch) {
    return handleAuth(authMatch[1], req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405); res.end('405');
});

// For Vercel: export the server
module.exports = server;

// For local development: listen on port
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Nova server running on port ${PORT}`);
  });
}
