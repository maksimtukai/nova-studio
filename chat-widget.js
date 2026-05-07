(function () {
  const BASE = '/nova/api/chat';
  let sessionId = localStorage.getItem('nova_chat_sid');
  if (!sessionId) { sessionId = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2); localStorage.setItem('nova_chat_sid', sessionId); }
  let visitorName = localStorage.getItem('nova_chat_name') || '';
  let eventSource = null;
  let unread = 0;

  // ── Styles ──
  const style = document.createElement('style');
  style.textContent = `
#nova-chat-btn{position:fixed;bottom:28px;right:28px;z-index:9999;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,#00e5ff,#7b2fff);border:none;cursor:pointer;box-shadow:0 4px 20px rgba(0,229,255,.35);display:flex;align-items:center;justify-content:center;transition:transform .2s;}
#nova-chat-btn:hover{transform:scale(1.1);}
#nova-chat-btn svg{width:26px;height:26px;fill:#fff;}
#nova-chat-badge{position:absolute;top:-4px;right:-4px;background:#ff3b5c;color:#fff;font-size:11px;font-weight:700;border-radius:50%;width:20px;height:20px;display:none;align-items:center;justify-content:center;font-family:sans-serif;}
#nova-chat-box{position:fixed;bottom:100px;right:28px;z-index:9999;width:340px;max-width:calc(100vw - 40px);background:#0d1526;border:1px solid rgba(0,229,255,.18);border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;font-family:'Manrope',sans-serif;}
#nova-chat-head{background:linear-gradient(135deg,rgba(0,229,255,.12),rgba(123,47,255,.12));padding:16px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,.06);}
#nova-chat-head .avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#00e5ff,#7b2fff);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
#nova-chat-head .info{flex:1;}
#nova-chat-head .info strong{color:#fff;font-size:14px;display:block;}
#nova-chat-head .info span{color:#00e5ff;font-size:11px;}
#nova-chat-close{background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:20px;padding:0;line-height:1;}
#nova-chat-close:hover{color:#fff;}
#nova-chat-msgs{flex:1;height:280px;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;scrollbar-color:rgba(0,229,255,.2) transparent;}
.nc-msg{max-width:80%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.45;word-break:break-word;}
.nc-msg.visitor{align-self:flex-end;background:linear-gradient(135deg,#00e5ff,#7b2fff);color:#fff;border-bottom-right-radius:4px;}
.nc-msg.manager{align-self:flex-start;background:rgba(255,255,255,.08);color:#e8eaf6;border-bottom-left-radius:4px;}
.nc-msg .nc-time{font-size:10px;opacity:.5;margin-top:4px;}
.nc-welcome{text-align:center;color:rgba(255,255,255,.35);font-size:12px;padding:20px 10px;}
#nova-chat-name-row{padding:10px 14px 0;display:none;}
#nova-chat-name-row input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(0,229,255,.2);border-radius:10px;color:#fff;padding:8px 12px;font-size:13px;outline:none;font-family:inherit;}
#nova-chat-name-row input::placeholder{color:rgba(255,255,255,.3);}
#nova-chat-footer{padding:12px 14px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;}
#nova-chat-input{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(0,229,255,.2);border-radius:12px;color:#fff;padding:9px 13px;font-size:13px;outline:none;font-family:inherit;resize:none;}
#nova-chat-input::placeholder{color:rgba(255,255,255,.3);}
#nova-chat-send{background:linear-gradient(135deg,#00e5ff,#7b2fff);border:none;border-radius:12px;width:40px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;}
#nova-chat-send:hover{opacity:.85;}
#nova-chat-send svg{width:18px;height:18px;fill:#fff;}
  `;
  document.head.appendChild(style);

  // ── HTML ──
  const btn = document.createElement('button');
  btn.id = 'nova-chat-btn';
  btn.title = 'Написать нам';
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/></svg><div id="nova-chat-badge"></div>`;
  document.body.appendChild(btn);

  const box = document.createElement('div');
  box.id = 'nova-chat-box';
  box.innerHTML = `
    <div id="nova-chat-head">
      <div class="avatar">💬</div>
      <div class="info"><strong>Nova Studio</strong><span>Онлайн · отвечаем быстро</span></div>
      <button id="nova-chat-close">×</button>
    </div>
    <div id="nova-chat-msgs"><div class="nc-welcome">Привет! Чем можем помочь? 👋</div></div>
    <div id="nova-chat-name-row"><input id="nova-chat-name-inp" type="text" placeholder="Ваше имя (необязательно)" maxlength="40"></div>
    <div id="nova-chat-footer">
      <textarea id="nova-chat-input" rows="1" placeholder="Написать сообщение..."></textarea>
      <button id="nova-chat-send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
    </div>`;
  document.body.appendChild(box);

  const msgsEl = box.querySelector('#nova-chat-msgs');
  const inputEl = box.querySelector('#nova-chat-input');
  const nameRow = box.querySelector('#nova-chat-name-row');
  const nameInp = box.querySelector('#nova-chat-name-inp');
  const badge = btn.querySelector('#nova-chat-badge');

  function timeStr(iso) {
    const d = new Date(iso);
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  }

  function appendMsg(msg, scroll = true) {
    const welcome = msgsEl.querySelector('.nc-welcome');
    if (welcome) welcome.remove();
    const el = document.createElement('div');
    el.className = 'nc-msg ' + msg.from;
    el.innerHTML = `${msg.text}<div class="nc-time">${timeStr(msg.time)}</div>`;
    msgsEl.appendChild(el);
    if (scroll) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function loadHistory() {
    try {
      const r = await fetch(`${BASE}/messages?sessionId=${sessionId}`, { headers: { 'ngrok-skip-browser-warning': '1' } });
      if (!r.ok) return;
      const data = await r.json();
      data.messages.forEach(m => appendMsg(m, false));
      msgsEl.scrollTop = msgsEl.scrollHeight;
    } catch {}
  }

  function startSSE() {
    if (eventSource) return;
    eventSource = new EventSource(`${BASE}/stream?sessionId=${sessionId}`);
    eventSource.addEventListener('message', e => {
      const msg = JSON.parse(e.data);
      appendMsg(msg);
      if (box.style.display === 'none' || box.style.display === '') {
        unread++; badge.textContent = unread; badge.style.display = 'flex';
      }
    });
  }

  function openChat() {
    box.style.display = 'flex';
    unread = 0; badge.style.display = 'none';
    if (!visitorName) nameRow.style.display = 'block';
    loadHistory();
    startSSE();
    setTimeout(() => inputEl.focus(), 100);
  }

  function closeChat() { box.style.display = 'none'; }

  btn.addEventListener('click', () => box.style.display === 'flex' ? closeChat() : openChat());
  box.querySelector('#nova-chat-close').addEventListener('click', closeChat);

  async function sendMsg() {
    const text = inputEl.value.trim();
    if (!text) return;
    const name = nameInp.value.trim() || visitorName || 'Гость';
    if (nameInp.value.trim()) { visitorName = nameInp.value.trim(); localStorage.setItem('nova_chat_name', visitorName); nameRow.style.display = 'none'; }
    inputEl.value = '';
    try {
      await fetch(`${BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ sessionId, name, text })
      });
      appendMsg({ from: 'visitor', text, time: new Date().toISOString() });
    } catch { inputEl.value = text; }
  }

  box.querySelector('#nova-chat-send').addEventListener('click', sendMsg);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });

  // Auto-resize textarea
  inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px'; });
})();
