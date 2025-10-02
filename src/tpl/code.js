function init() {
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${location.host}/api/ws`;

  const connectionStatus = document.getElementById('connectionStatus');
  const statusTag = document.getElementById('statusTag');
  const reconnectBtn = document.getElementById('reconnect');
  const domainInput = document.getElementById('domainInput');
  const providerSelect = document.getElementById('providerList');
  const providerDescription = document.getElementById('providerDescription');
  const form = document.getElementById('checkerForm');
  const transportSelect = document.getElementById('transportSelect');
  const clearButton = document.getElementById('clearButton');
  const resultsBody = document.getElementById('resultsBody');
  const emptyRow = document.getElementById('resultsEmpty');
  const alertArea = document.getElementById('alertArea');
  const summaryBox = document.getElementById('summaryBox');
  const consensusA = document.getElementById('consensusA');
  const consensusAAAA = document.getElementById('consensusAAAA');

  let ws = null;
  let wsReadyPromise = null;
  let wsHandlers = null;
  let providerLists = {};
  let latestConsensus = { A: [], AAAA: [] };
  const providerIndex = new Map();
  let hasRequested = false;
  let runInProgress = false;
  let awaitingRun = false;

  function arraysEqual(a = [], b = []) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function classListForStatus({ errors = {}, records }) {
    const entries = Object.values(errors);
    const hasHardError = entries.some((info) => info && info.type === 'resolver_error');
    const hasSoftError = entries.some((info) => info && info.type !== 'resolver_error');
    const hasRecords = Object.values(records).some((items) => items && items.length);
    return { hasHardError, hasSoftError, hasRecords };
  }

  function showConnectionStatus(stateClass, label, { allowReconnect = false } = {}) {
    if (!hasRequested) return;
    connectionStatus.classList.remove('is-hidden');
    statusTag.className = 'tag status-tag';
    if (stateClass) {
      statusTag.classList.add(stateClass);
    }
    statusTag.textContent = label;
    reconnectBtn.disabled = !allowReconnect;
  }

  function hideConnectionStatus() {
    connectionStatus.classList.add('is-hidden');
    statusTag.className = 'tag status-tag';
    statusTag.textContent = '—';
    reconnectBtn.disabled = true;
  }

  function formatRecords(records) {
    if (!records || records.length === 0) {
      return '<span class="is-dimmed">—</span>';
    }
    return records.map((value) => `<span>${value}</span>`).join('<br />');
  }

  function showAlert(message, tone = 'is-danger') {
    const notification = document.createElement('div');
    notification.className = `notification ${tone}`;
    notification.innerHTML = `
      <button class="delete" aria-label="Dismiss"></button>
      ${message}
    `;
    notification.querySelector('button').addEventListener('click', () => notification.remove());
    alertArea.replaceChildren(notification);
  }

  function clearAlert() {
    alertArea.replaceChildren();
  }

  function ensureRow(provider) {
    let row = document.getElementById(`row-${provider.id}`);
    if (row) return row;

    row = document.createElement('tr');
    row.id = `row-${provider.id}`;
    row.className = 'dns-result-row';
    row.dataset.providerId = provider.id;
    row.innerHTML = `
      <td>
        <strong>${provider.name}</strong>
        <div class="nameservers">${provider.nameservers.join(', ')}</div>
      </td>
      <td class="records" data-type="A"></td>
      <td class="records" data-type="AAAA"></td>
      <td class="latency is-dimmed">—</td>
      <td class="status"><span class="tag status-tag dns-result-status">Waiting</span></td>
    `;
    resultsBody.appendChild(row);
    return row;
  }

  function updateConsensusDisplay(consensus) {
    latestConsensus = { A: consensus.A || [], AAAA: consensus.AAAA || [] };
    summaryBox.classList.toggle('is-hidden', !latestConsensus.A.length && !latestConsensus.AAAA.length);
    consensusA.innerHTML = formatRecords(latestConsensus.A);
    consensusAAAA.innerHTML = formatRecords(latestConsensus.AAAA);
  }

  function renderProviderResult(result, consensus) {
    const { provider, records, errors, latency_ms: latencyMs } = result;
    const row = ensureRow(provider);

    const recordCells = row.querySelectorAll('.records');
    recordCells.forEach((cell) => {
      const type = cell.dataset.type;
      const recordList = records[type] || [];
      const errorInfo = errors[type];
      cell.classList.remove('has-text-danger', 'has-text-warning-dark');

      if (errorInfo) {
        const isHardError = errorInfo.type === 'resolver_error';
        const errorClass = isHardError ? 'has-text-danger' : 'has-text-warning-dark';
        cell.innerHTML = `<span class="${errorClass}">${errorInfo.message}</span>`;
        return;
      }

      cell.innerHTML = formatRecords(recordList);
      const consensusList = consensus[type] || [];
      if (consensusList.length && recordList.length && !arraysEqual(recordList, consensusList)) {
        cell.classList.add('has-text-warning-dark');
      }
    });

    const latencyCell = row.querySelector('.latency');
    latencyCell.textContent = `${latencyMs} ms`;
    latencyCell.classList.remove('is-dimmed');

    const statusCell = row.querySelector('.status span');
    const { hasHardError, hasSoftError, hasRecords } = classListForStatus({ errors, records });
    statusCell.className = 'tag status-tag dns-result-status';
    if (hasHardError && !hasRecords) {
      statusCell.classList.add('is-danger');
      statusCell.textContent = 'Error';
    } else if (hasHardError && hasRecords) {
      statusCell.classList.add('is-warning');
      statusCell.textContent = 'Partial';
    } else if (hasSoftError && !hasRecords) {
      statusCell.classList.add('is-warning');
      statusCell.textContent = 'Notice';
    } else if (!hasRecords) {
      statusCell.classList.add('is-light');
      statusCell.textContent = 'No data';
    } else {
      statusCell.classList.add('is-success');
      statusCell.textContent = 'OK';
    }
  }

  function resetTable() {
    resultsBody.innerHTML = '';
    resultsBody.appendChild(emptyRow);
    summaryBox.classList.add('is-hidden');
    consensusA.innerHTML = formatRecords([]);
    consensusAAAA.innerHTML = formatRecords([]);
  }

  function prepareTable(providers) {
    if (emptyRow.parentElement) emptyRow.remove();
    resultsBody.innerHTML = '';
    providers.forEach((providerId) => {
      const provider = providerIndex.get(providerId);
      if (provider) {
        ensureRow(provider);
      }
    });
    if (!resultsBody.children.length) {
      resultsBody.appendChild(emptyRow);
    }
  }

  function populateProviderLists() {
    if (!providerLists || Object.keys(providerLists).length === 0) return;
    providerSelect.innerHTML = '';
    Object.values(providerLists).forEach((list) => {
      const option = document.createElement('option');
      option.value = list.id;
      option.textContent = list.label;
      providerSelect.appendChild(option);
    });
    updateProviderDescription();
  }

  function updateProviderDescription() {
    const selected = providerSelect.value;
    const list = providerLists[selected];
    providerDescription.textContent = list ? list.description : '';
  }

  function handleServerMessage(message) {
    switch (message.type) {
      case 'provider_lists':
        providerLists = message.lists || {};
        providerIndex.clear();
        Object.values(providerLists).forEach((list) => {
          (list.providers || []).forEach((provider) => {
            providerIndex.set(provider.id, provider);
          });
        });
        populateProviderLists();
        break;
      case 'run_started':
        clearAlert();
        prepareTable(message.providers || []);
        awaitingRun = false;
        runInProgress = true;
        hideConnectionStatus();
        break;
      case 'provider_result':
        if (message.consensus) {
          updateConsensusDisplay(message.consensus);
        }
        if (message.result) {
          renderProviderResult(message.result, message.consensus || latestConsensus);
        }
        break;
      case 'run_complete':
        updateConsensusDisplay(message.consensus || {});
        runInProgress = false;
        hideConnectionStatus();
        break;
      case 'error':
        showAlert(message.message || 'An error occurred.');
        runInProgress = false;
        awaitingRun = false;
        break;
      default:
        console.warn('Unhandled message', message);
    }
  }

  function handleRunConnectionFailure() {
    if (!hasRequested || (!runInProgress && !awaitingRun)) return;
    runInProgress = false;
    awaitingRun = false;
    showConnectionStatus('is-danger', 'Connection lost', { allowReconnect: true });
    showAlert('Connection lost before all results were received.');
  }

  function detachWebSocketHandlers() {
    if (!ws || !wsHandlers) return;
    ws.removeEventListener('message', wsHandlers.message);
    ws.removeEventListener('close', wsHandlers.close);
    ws.removeEventListener('error', wsHandlers.error);
    wsHandlers = null;
  }

  async function ensureConnection(options = {}) {
    const { silent = false } = options;

    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING && wsReadyPromise) {
      return wsReadyPromise;
    }

    if (ws) {
      detachWebSocketHandlers();
      try {
        ws.close();
      } catch (err) {
        // ignore
      }
    }

    ws = new WebSocket(wsUrl);

    wsReadyPromise = new Promise((resolve, reject) => {
      let resolved = false;
      let settled = false;

      const finish = (success, value) => {
        if (settled) return;
        settled = true;
        wsReadyPromise = null;
        if (success) {
          resolve(value);
        } else {
          reject(value);
        }
      };

      const handleOpen = () => {
        resolved = true;
        if (hasRequested) {
          hideConnectionStatus();
        }
        clearAlert();
        finish(true);
      };

      const handleMessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleServerMessage(payload);
        } catch (err) {
          showAlert('Received malformed message from server.');
        }
      };

      const handleError = () => {
        if (!resolved) {
          detachWebSocketHandlers();
          ws = null;
          if (hasRequested) {
            showConnectionStatus('is-danger', 'Connection failed', { allowReconnect: true });
            showAlert('Unable to connect to the DNS checker service.');
          }
          finish(false, new Error('connection error'));
          return;
        }
        handleRunConnectionFailure();
      };

      const handleClose = () => {
        detachWebSocketHandlers();
        ws = null;
        if (!resolved) {
          if (hasRequested) {
            showConnectionStatus('is-danger', 'Connection failed', { allowReconnect: true });
            showAlert('Connection closed before it was ready.');
          }
          finish(false, new Error('connection closed'));
          return;
        }
        finish(true);
        if (runInProgress || awaitingRun) {
          handleRunConnectionFailure();
        } else if (hasRequested) {
          hideConnectionStatus();
        }
      };

      wsHandlers = {
        message: handleMessage,
        close: handleClose,
        error: handleError,
      };

      ws.addEventListener('open', handleOpen, { once: true });
      ws.addEventListener('message', handleMessage);
      ws.addEventListener('close', handleClose);
      ws.addEventListener('error', handleError);
    });

    return wsReadyPromise;
  }

  function sendMessage(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Connection is not open.');
    }
    ws.send(JSON.stringify(message));
  }

  reconnectBtn.addEventListener('click', async () => {
    hasRequested = true;
    try {
      await ensureConnection();
    } catch (err) {
      // ensureConnection already surfaced the error
    }
  });

  providerSelect.addEventListener('change', updateProviderDescription);

  clearButton.addEventListener('click', () => {
    resetTable();
    clearAlert();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();
    const domain = domainInput.value.trim();
    if (!domain) {
      showAlert('Please enter a domain to check.', 'is-warning');
      domainInput.focus();
      return;
    }
    hasRequested = true;
    const listId = providerSelect.value;
    try {
      await ensureConnection();
    } catch (err) {
      return;
    }
    resetTable();
    awaitingRun = true;
    runInProgress = true;
    const transport = transportSelect.value;
    try {
      sendMessage({ action: 'check', domain, list_id: listId, transport });
    } catch (err) {
      runInProgress = false;
      awaitingRun = false;
      showAlert('Unable to send request: connection is not ready.');
    }
  });

  ensureConnection({ silent: true }).catch(() => {
    // Initial connection failure is surfaced when the user tries to run a check.
  });
}

document.addEventListener('DOMContentLoaded', init);
