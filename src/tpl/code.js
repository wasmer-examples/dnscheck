class DnsCheckService {
  constructor({ url, onOpen, onMessage, onError, onClose, onMalformedMessage }) {
    this.url = url;
    this.callbacks = {
      onOpen,
      onMessage,
      onError,
      onClose,
      onMalformedMessage,
    };
    this.ws = null;
    this.readyPromise = null;
    this._openResolvers = null;
    this.explicitClose = false;
    this.connected = false;
    this.runToken = 0;

    this._handleOpen = this._handleOpen.bind(this);
    this._handleMessage = this._handleMessage.bind(this);
    this._handleError = this._handleError.bind(this);
    this._handleClose = this._handleClose.bind(this);
  }

  async ensureOpen() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this.readyPromise) {
      return this.readyPromise;
    }

    if (this.ws && (this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED)) {
      this._removeListeners(this.ws);
      this.ws = null;
      this.readyPromise = null;
      this._openResolvers = null;
    }

    if (!this.ws) {
      this.explicitClose = false;
      this.connected = false;
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', this._handleOpen);
      this.ws.addEventListener('message', this._handleMessage);
      this.ws.addEventListener('error', this._handleError);
      this.ws.addEventListener('close', this._handleClose);
      this.readyPromise = new Promise((resolve, reject) => {
        this._openResolvers = { resolve, reject };
      });
    }

    return this.readyPromise;
  }

  async startCheck(payload) {
    const token = this.runToken + 1;
    this.runToken = token;
    await this.ensureOpen();
    if (token !== this.runToken) {
      return false;
    }
    this.send({ action: 'check', ...payload });
    return true;
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Connection is not open.');
    }
    this.ws.send(JSON.stringify(message));
  }

  close(code = 1000, reason = 'client closing') {
    if (!this.ws) return;
    this.explicitClose = true;
    this.runToken += 1;
    const socket = this.ws;
    this._removeListeners(socket);
    this.ws = null;
    this.readyPromise = null;
    this._openResolvers = null;
    this.connected = false;
    try {
      socket.close(code, reason);
    } catch (err) {
      // ignore
    }
  }

  _resolveReady() {
    if (!this._openResolvers) return;
    this._openResolvers.resolve();
    this._openResolvers = null;
    this.readyPromise = null;
  }

  _rejectReady(error) {
    if (!this._openResolvers) return;
    this._openResolvers.reject(error);
    this._openResolvers = null;
    this.readyPromise = null;
  }

  _handleOpen() {
    this.connected = true;
    this._resolveReady();
    if (this.callbacks.onOpen) {
      this.callbacks.onOpen();
    }
  }

  _handleMessage(event) {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      if (this.callbacks.onMalformedMessage) {
        this.callbacks.onMalformedMessage(err);
      }
      return;
    }
    if (this.callbacks.onMessage) {
      this.callbacks.onMessage(payload);
    }
  }

  _handleError() {
    const wasConnected = this.connected;
    if (!wasConnected) {
      this._rejectReady(new Error('connection error'));
    }
    if (this.callbacks.onError) {
      this.callbacks.onError({ wasConnected, error: new Error('connection error') });
    }
  }

  _handleClose(event) {
    const target = event.target || this.ws;
    this._removeListeners(target);
    if (this.ws === target) {
      this.ws = null;
    }

    const wasExplicit = this.explicitClose;
    const wasConnected = this.connected;
    this.explicitClose = false;
    this.connected = false;

    if (!wasConnected) {
      this._rejectReady(new Error('connection closed'));
    }

    if (!wasExplicit) {
      if (wasConnected && this.callbacks.onClose) {
        this.callbacks.onClose({ wasConnected: true, event });
      } else if (!wasConnected && this.callbacks.onError) {
        this.callbacks.onError({ wasConnected: false, error: new Error('connection closed') });
      }
    }
  }

  _removeListeners(target) {
    if (!target) return;
    target.removeEventListener('open', this._handleOpen);
    target.removeEventListener('message', this._handleMessage);
    target.removeEventListener('error', this._handleError);
    target.removeEventListener('close', this._handleClose);
  }
}

function init() {
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${location.host}/api/ws`;

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

  const urlParams = new URLSearchParams(window.location.search);
  const initialSelections = {
    domain: (urlParams.get('domain') || '').trim(),
    listId: urlParams.get('list_id') || '',
    transport: urlParams.get('transport') || '',
  };

  if (initialSelections.domain) {
    domainInput.value = initialSelections.domain;
  }

  if (initialSelections.transport) {
    const hasTransportOption = Array.from(transportSelect.options).some(
      (option) => option.value === initialSelections.transport,
    );
    if (hasTransportOption) {
      transportSelect.value = initialSelections.transport;
    }
  }

  let providerLists = {};
  let latestConsensus = { A: [], AAAA: [] };
  const providerIndex = new Map();
  let hasRequested = false;
  let runInProgress = false;
  let awaitingRun = false;
  let initialAutoSubmitPending = Boolean(initialSelections.domain);
  let currentRunService = null;

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

  function showAlert(message, tone = 'is-danger', options = {}) {
    const { retry = false, onRetry = null } = options;
    const notification = document.createElement('div');
    notification.className = `notification ${tone}`;

    const dismissButton = document.createElement('button');
    dismissButton.className = 'delete';
    dismissButton.type = 'button';
    dismissButton.setAttribute('aria-label', 'Dismiss');
    dismissButton.addEventListener('click', () => notification.remove());

    const messageContainer = document.createElement('div');
    messageContainer.innerHTML = message;

    notification.appendChild(dismissButton);
    notification.appendChild(messageContainer);

    if (retry) {
      const actions = document.createElement('div');
      actions.className = 'buttons is-right mt-3';
      const retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'button is-primary is-light is-small';
      retryButton.textContent = 'Retry';
      retryButton.addEventListener('click', () => {
        notification.remove();
        if (typeof onRetry === 'function') {
          onRetry();
        } else {
          form.requestSubmit();
        }
      });
      actions.appendChild(retryButton);
      notification.appendChild(actions);
    }

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
    const hasConsensus = latestConsensus.A.length || latestConsensus.AAAA.length;
    summaryBox.classList.toggle('is-hidden', !hasConsensus);
    consensusA.innerHTML = formatRecords(latestConsensus.A);
    consensusAAAA.innerHTML = formatRecords(latestConsensus.AAAA);
  }

  function formatRecords(records) {
    if (!records || records.length === 0) {
      return '<span class="is-dimmed">—</span>';
    }
    return records.map((value) => `<span>${value}</span>`).join('<br />');
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
    let targetListId = providerSelect.options.length ? providerSelect.options[0].value : '';
    if (initialSelections.listId && providerLists[initialSelections.listId]) {
      targetListId = initialSelections.listId;
    }
    providerSelect.value = targetListId;
    updateProviderDescription();

    if (initialAutoSubmitPending) {
      initialAutoSubmitPending = false;
      queueMicrotask(() => form.requestSubmit());
    }
  }

  function updateProviderDescription() {
    const selected = providerSelect.value;
    const list = providerLists[selected];
    providerDescription.textContent = list ? list.description : '';
  }

  function handleServerMessage(message, sourceService) {
    if (message.type === 'provider_lists') {
      providerLists = message.lists || {};
      providerIndex.clear();
      Object.values(providerLists).forEach((list) => {
        (list.providers || []).forEach((provider) => {
          providerIndex.set(provider.id, provider);
        });
      });
      populateProviderLists();
      return;
    }

    const isActiveRunService = currentRunService === sourceService;

    switch (message.type) {
      case 'run_started':
        if (!isActiveRunService) return;
        clearAlert();
        prepareTable(message.providers || []);
        awaitingRun = false;
        runInProgress = true;
        break;
      case 'provider_result':
        if (!isActiveRunService) return;
        if (message.consensus) {
          updateConsensusDisplay(message.consensus);
        }
        if (message.result) {
          renderProviderResult(message.result, message.consensus || latestConsensus);
        }
        break;
      case 'run_complete':
        if (!isActiveRunService) return;
        updateConsensusDisplay(message.consensus || {});
        runInProgress = false;
        if (currentRunService === sourceService) {
          sourceService.close(1000, 'run complete');
          if (currentRunService === sourceService) {
            currentRunService = null;
          }
        }
        break;
      case 'error':
        if (!isActiveRunService) {
          const shouldOfferRetry = Object.keys(providerLists || {}).length === 0;
          if (shouldOfferRetry) {
            showAlert(message.message || 'An error occurred.', 'is-danger', {
              retry: true,
              onRetry: bootstrapProviderLists,
            });
          } else {
            showAlert(message.message || 'An error occurred.', 'is-danger');
          }
          if (sourceService) {
            sourceService.close(1000, 'non-run error message');
          }
          return;
        }
        showAlert(message.message || 'An error occurred.', 'is-danger', { retry: true });
        runInProgress = false;
        awaitingRun = false;
        if (currentRunService === sourceService) {
          sourceService.close(1000, 'run error');
          if (currentRunService === sourceService) {
            currentRunService = null;
          }
        }
        break;
      default:
        console.warn('Unhandled message', message);
    }
  }

  function handleRunConnectionFailure(sourceService) {
    if (currentRunService !== sourceService) return;
    if (!hasRequested || (!runInProgress && !awaitingRun)) {
      sourceService.close(1000, 'run connection failure');
      if (currentRunService === sourceService) {
        currentRunService = null;
      }
      return;
    }
    runInProgress = false;
    awaitingRun = false;
    showAlert('Connection lost before all results were received.', 'is-danger', { retry: true });
    sourceService.close(1000, 'run connection failure');
    if (currentRunService === sourceService) {
      currentRunService = null;
    }
  }

  function createRunService() {
    const runService = new DnsCheckService({
      url: wsUrl,
      onOpen: () => {
        if (hasRequested) {
          clearAlert();
        }
      },
      onMessage: (message) => handleServerMessage(message, runService),
      onError: ({ wasConnected }) => {
        if (currentRunService !== runService) return;
        if (!hasRequested) {
          runService.close(1000, 'run aborted');
          if (currentRunService === runService) {
            currentRunService = null;
          }
          return;
        }
        if (wasConnected) {
          handleRunConnectionFailure(runService);
        } else {
          runInProgress = false;
          awaitingRun = false;
          showAlert('Unable to connect to the DNS checker service.', 'is-danger', { retry: true });
          runService.close(1000, 'run connection error');
          if (currentRunService === runService) {
            currentRunService = null;
          }
        }
      },
      onClose: ({ wasConnected }) => {
        if (currentRunService !== runService) return;
        if (wasConnected) {
          handleRunConnectionFailure(runService);
        }
      },
      onMalformedMessage: () => {
        showAlert('Received malformed message from server.');
      },
    });
    return runService;
  }

  async function bootstrapProviderLists() {
    const listService = new DnsCheckService({
      url: wsUrl,
      onMessage: (message) => {
        handleServerMessage(message, listService);
        if (message.type === 'provider_lists') {
          listService.close(1000, 'provider lists received');
        }
      },
      onError: ({ wasConnected }) => {
        if (wasConnected) {
          showAlert('Connection lost while loading provider lists.', 'is-danger', {
            retry: true,
            onRetry: bootstrapProviderLists,
          });
        } else {
          showAlert('Unable to load provider lists.', 'is-danger', {
            retry: true,
            onRetry: bootstrapProviderLists,
          });
        }
        listService.close(1000, 'provider lists error');
      },
      onClose: ({ wasConnected }) => {
        if (!wasConnected) {
          showAlert('Unable to load provider lists.', 'is-danger', {
            retry: true,
            onRetry: bootstrapProviderLists,
          });
        }
      },
      onMalformedMessage: () => {
        showAlert('Received malformed message from server.');
      },
    });

    try {
      await listService.ensureOpen();
      try {
        listService.send({ action: 'lists' });
      } catch (err) {
        // If sending fails, the error handlers above surface the problem.
      }
    } catch (err) {
      showAlert('Unable to load provider lists.', 'is-danger', {
        retry: true,
        onRetry: bootstrapProviderLists,
      });
    }
  }

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
    const transport = transportSelect.value;

    const params = new URLSearchParams(window.location.search);
    params.set('domain', domain);
    if (listId) {
      params.set('list_id', listId);
    } else {
      params.delete('list_id');
    }
    if (transport) {
      params.set('transport', transport);
    } else {
      params.delete('transport');
    }
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    history.replaceState(null, '', nextUrl);

    runInProgress = false;
    awaitingRun = false;
    if (currentRunService) {
      currentRunService.close(1000, 'starting new run');
      currentRunService = null;
    }

    const runService = createRunService();
    currentRunService = runService;

    try {
      await runService.startCheck({ domain, list_id: listId, transport });
    } catch (err) {
      runInProgress = false;
      awaitingRun = false;
      showAlert('Unable to connect to the DNS checker service.', 'is-danger', { retry: true });
      if (currentRunService === runService) {
        runService.close(1000, 'start failed');
        currentRunService = null;
      }
      return;
    }

    resetTable();
    awaitingRun = true;
    runInProgress = true;
  });

  bootstrapProviderLists();
}

document.addEventListener('DOMContentLoaded', init);
