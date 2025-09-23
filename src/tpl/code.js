function init() {
  const statusEl = document.getElementById('status');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const reconnectBtn = document.getElementById('reconnect');
  const messagesEl = document.getElementById('messages');
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${location.host}/api/ws`;
  let ws = null;

  function formatTime(d) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

// type: 'sent' | 'received'
  function clearPlaceholder() {
    const ph = document.getElementById('placeholder');
    if (ph) ph.remove();
  }

  function addMessage(text, type, extraMeta = '') {
    clearPlaceholder();
    const article = document.createElement('article');
    article.className = `message ${type === 'sent' ? 'is-primary' : 'is-info'}`;
    const body = document.createElement('div');
    body.className = 'message-body';

    const now = new Date();
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `(${formatTime(now)}${extraMeta ? ` • ${extraMeta}` : ''})`;

    const content = document.createElement('span');
    content.className = 'is-mono';
    content.textContent = text;

    body.appendChild(content);
    body.appendChild(meta);
    article.appendChild(body);
    // Prepend newest messages at the top
    messagesEl.insertBefore(article, messagesEl.firstChild);
  }

  function setStatus(state) {
    statusEl.classList.remove('is-warning', 'is-success', 'is-danger');
    if (state === 'connected') {
      statusEl.textContent = 'Connected';
      statusEl.classList.add('is-success');
      reconnectBtn.disabled = true;
    } else if (state === 'connecting') {
      statusEl.textContent = 'Connecting…';
      statusEl.classList.add('is-warning');
      reconnectBtn.disabled = true;
    } else {
      statusEl.textContent = 'Disconnected';
      statusEl.classList.add('is-danger');
      reconnectBtn.disabled = false;
    }
  }

  const inflight = new Map(); // id -> send timestamp
  let nextId = 1;

  function connect() {
    setStatus('connecting');
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => setStatus('connected'));
    ws.addEventListener('close', () => setStatus('disconnected'));
    ws.addEventListener('message', (event) => {
      let data = event.data;
      // Expect echo format: "<id>|<payload>" to measure RTT if applicable
      const sep = data.indexOf('|');
      if (sep > 0) {
        const idStr = data.slice(0, sep);
        const payload = data.slice(sep + 1);
        const t0 = inflight.get(idStr);
        let meta = '';
        if (t0) {
          const rttMs = Math.round(performance.now() - t0);
          inflight.delete(idStr);
          meta = `RTT ${rttMs} ms`;
        }
        addMessage(`Received: ${payload}`, 'received', meta);
      } else {
        addMessage(`Received: ${data}`, 'received');
      }
    });
  }

  connect();

  const MAX_LEN = 500;

  function sendCurrent() {
    const msg = inputEl.value;
    if (!msg) return;
    if (msg.length > MAX_LEN) {
      addMessage(`Cannot send: message exceeds ${MAX_LEN} chars`, 'received');
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      const id = String(nextId++);
      inflight.set(id, performance.now());
      ws.send(`${id}|${msg}`);
      addMessage(`Sent: ${msg}`, 'sent');
    } else {
      addMessage('Cannot send: WebSocket not connected', 'received');
    }
    inputEl.value = '';
    inputEl.focus();
  }

  sendBtn.addEventListener('click', sendCurrent);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendCurrent();
    }
  });
  reconnectBtn.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
  });
}

init();
