'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let mode     = 'fixed';      // 'fixed' | 'continuous'
let protocol = 'udp';
let sending  = false;
let pollTimer = null;

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  srcMac:          $('srcMac'),
  dstMac:          $('dstMac'),
  vlanEnable:      $('vlanEnable'),
  vlanFields:      $('vlanFields'),
  vlanId:          $('vlanId'),
  vlanPcp:         $('vlanPcp'),
  srcIp:           $('srcIp'),
  dstIp:           $('dstIp'),
  dscpValue:       $('dscpValue'),
  dscpSelect:      $('dscpSelect'),
  portFields:      $('portFields'),
  srcPort:         $('srcPort'),
  dstPort:         $('dstPort'),
  iface:           $('iface'),
  pktCount:        $('pktCount'),
  pktRate:         $('pktRate'),
  fixedFields:     $('fixedFields'),
  continuousFields:$('continuousFields'),
  payload:         $('payload'),
  btnSend:         $('btnSend'),
  btnStart:        $('btnStart'),
  btnStop:         $('btnStop'),
  btnClear:        $('btnClear'),
  logOutput:       $('logOutput'),
  statusBadge:     $('statusBadge'),
  statusText:      $('statusText'),
  liveCounter:     $('liveCounter'),
  liveCount:       $('liveCount'),
  ifaceConfigIface:$('ifaceConfigIface'),
  ifaceIp:         $('ifaceIp'),
  ifacePill:       $('ifacePill'),
  btnIfaceUp:      $('btnIfaceUp'),
  btnIfaceDown:    $('btnIfaceDown'),
  routeDst:        $('routeDst'),
  routeNh:         $('routeNh'),
  routeIface:      $('routeIface'),
  btnRouteAdd:     $('btnRouteAdd'),
  routeList:       $('routeList'),
  btnRouteClear:   $('btnRouteClear'),
};

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg, type = '') {
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ` log-${type}` : '');
  line.textContent = msg;
  els.logOutput.appendChild(line);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function logTs(msg, type) {
  const t = new Date().toLocaleTimeString('en-US', { hour12: false });
  log(`[${t}] ${msg}`, type);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function setStatus(state, text) {
  els.statusBadge.className = `status-badge ${state}`;
  els.statusText.textContent = text;
}

// ─── Segmented controls ───────────────────────────────────────────────────────
function wireSegGroup(groupId, onChange) {
  const group = $(groupId);
  group.querySelectorAll('.seg').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.seg').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.value);
    });
  });
}

// ─── Protocol toggle ─────────────────────────────────────────────────────────
wireSegGroup('protoGroup', val => {
  protocol = val;
  const showPorts = val !== 'icmp';
  els.portFields.style.display = showPorts ? '' : 'none';
});

// ─── Mode toggle ─────────────────────────────────────────────────────────────
wireSegGroup('modeGroup', val => {
  mode = val;
  const fixed = val === 'fixed';
  els.fixedFields.style.display     = fixed ? '' : 'none';
  els.continuousFields.classList.toggle('collapsed', fixed);
  els.btnSend.classList.toggle('hidden',  !fixed);
  els.btnStart.classList.toggle('hidden', fixed);
  els.btnStop.classList.add('hidden');
});

// ─── VLAN toggle ─────────────────────────────────────────────────────────────
els.vlanEnable.addEventListener('change', () => {
  els.vlanFields.classList.toggle('collapsed', !els.vlanEnable.checked);
});

// ─── DSCP quick-select ───────────────────────────────────────────────────────
els.dscpSelect.addEventListener('change', () => {
  if (els.dscpSelect.value !== '') {
    els.dscpValue.value = els.dscpSelect.value;
    els.dscpSelect.value = '';
  }
});

// ─── Interface Config ─────────────────────────────────────────────────────────
els.btnIfaceUp.addEventListener('click', async () => {
  const body = { interface: els.ifaceConfigIface.value, ip: els.ifaceIp.value.trim() };
  els.btnIfaceUp.disabled = true;
  try {
    const res  = await fetch('/api/interface/up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Configure failed');
    els.ifacePill.textContent = body.ip;
    els.ifacePill.classList.remove('hidden');
    logTs(`Interface ${data.interface} configured — ${data.ip}`, 'success');
  } catch (err) {
    logTs(`Interface configure error: ${err.message}`, 'error');
  } finally {
    els.btnIfaceUp.disabled = false;
  }
});

els.btnIfaceDown.addEventListener('click', async () => {
  const iface = els.ifaceConfigIface.value;
  els.btnIfaceDown.disabled = true;
  try {
    const res  = await fetch('/api/interface/down', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interface: iface }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Reset failed');
    els.ifacePill.classList.add('hidden');
    els.routeList.innerHTML = '';
    els.btnRouteClear.classList.add('hidden');
    logTs(`Interface ${data.interface} reset — address and routes flushed`, 'warn');
  } catch (err) {
    logTs(`Interface reset error: ${err.message}`, 'error');
  } finally {
    els.btnIfaceDown.disabled = false;
  }
});

// ─── Routes ──────────────────────────────────────────────────────────────────
function addRouteItem(prefix, nexthop, iface) {
  const item = document.createElement('div');
  item.className = 'route-item';
  item.dataset.prefix  = prefix;
  item.dataset.nexthop = nexthop;
  item.dataset.iface   = iface;
  item.innerHTML =
    `<span class="route-item-text">${prefix}</span>` +
    `<span class="route-item-via">via</span>` +
    `<span class="route-item-text">${nexthop}</span>` +
    `<span class="route-item-via">dev</span>` +
    `<span class="route-item-dev">${iface}</span>` +
    `<button class="btn-icon" title="Remove">✕</button>`;
  item.querySelector('.btn-icon').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/routes/del', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, nexthop, interface: iface }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Delete failed');
      item.remove();
      if (!els.routeList.children.length) els.btnRouteClear.classList.add('hidden');
      logTs(`Route removed: ${prefix} via ${nexthop} dev ${iface}`, 'warn');
    } catch (err) {
      logTs(`Route remove error: ${err.message}`, 'error');
    }
  });
  els.routeList.appendChild(item);
  els.btnRouteClear.classList.remove('hidden');
}

els.btnRouteAdd.addEventListener('click', async () => {
  const prefix  = els.routeDst.value.trim();
  const nexthop = els.routeNh.value.trim();
  const iface   = els.routeIface.value;
  if (!prefix || !nexthop) {
    logTs('Destination and Next Hop are required.', 'warn');
    return;
  }
  els.btnRouteAdd.disabled = true;
  try {
    const res = await fetch('/api/routes/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, nexthop, interface: iface }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Add failed');
    addRouteItem(prefix, nexthop, iface);
    els.routeDst.value = '';
    els.routeNh.value  = '';
    logTs(`Route added: ${prefix} via ${nexthop} dev ${iface}`, 'success');
  } catch (err) {
    logTs(`Route add error: ${err.message}`, 'error');
  } finally {
    els.btnRouteAdd.disabled = false;
  }
});

els.btnRouteClear.addEventListener('click', async () => {
  const iface = els.routeIface.value;
  try {
    const res = await fetch('/api/routes/flush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interface: iface }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Flush failed');
    els.routeList.innerHTML = '';
    els.btnRouteClear.classList.add('hidden');
    logTs(`All routes flushed on ${data.interface}`, 'warn');
  } catch (err) {
    logTs(`Route flush error: ${err.message}`, 'error');
  }
});

// ─── Load interfaces ─────────────────────────────────────────────────────────
async function loadInterfaces() {
  try {
    const res = await fetch('/api/interfaces');
    if (!res.ok) return;
    const { interfaces } = await res.json();
    [els.iface, els.ifaceConfigIface, els.routeIface].forEach(sel => {
      sel.innerHTML = '';
      interfaces.forEach(iface => {
        const opt = document.createElement('option');
        opt.value = iface;
        opt.textContent = iface;
        if (iface === 'eth1') opt.selected = true;
        sel.appendChild(opt);
      });
      if ([...sel.options].some(o => o.value === 'eth1')) sel.value = 'eth1';
    });
  } catch {
    logTs('Could not fetch interface list — defaulting to eth1.', 'warn');
  }
}

// ─── Build packet config ──────────────────────────────────────────────────────
function buildConfig() {
  const cfg = {
    src_mac:   els.srcMac.value.trim(),
    dst_mac:   els.dstMac.value.trim(),
    src_ip:    els.srcIp.value.trim(),
    dst_ip:    els.dstIp.value.trim(),
    dscp:      parseInt(els.dscpValue.value) || 0,
    protocol,
    payload:   els.payload.value || 'ClabPktGen',
    interface: els.iface.value,
  };

  if (protocol !== 'icmp') {
    cfg.src_port = parseInt(els.srcPort.value) || 12345;
    cfg.dst_port = parseInt(els.dstPort.value) || 80;
  }

  if (els.vlanEnable.checked) {
    cfg.vlan_id  = parseInt(els.vlanId.value)  || 100;
    cfg.vlan_pcp = parseInt(els.vlanPcp.value) || 0;
  }

  return cfg;
}

// ─── Send Fixed ───────────────────────────────────────────────────────────────
els.btnSend.addEventListener('click', async () => {
  const cfg = buildConfig();
  cfg.count = parseInt(els.pktCount.value) || 1;

  els.btnSend.disabled = true;
  setStatus('sending', 'SENDING');

  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Send failed');
    logTs(`Sent ${data.sent} packet(s) on ${data.interface}`, 'success');
    setStatus('idle', 'IDLE');
  } catch (err) {
    logTs(`Error: ${err.message}`, 'error');
    setStatus('error', 'ERROR');
    setTimeout(() => setStatus('idle', 'IDLE'), 3000);
  } finally {
    els.btnSend.disabled = false;
  }
});

// ─── Start Stream ─────────────────────────────────────────────────────────────
els.btnStart.addEventListener('click', async () => {
  const cfg = buildConfig();
  cfg.rate = parseFloat(els.pktRate.value) || 10;

  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Start failed');

    sending = true;
    els.btnStart.classList.add('hidden');
    els.btnStop.classList.remove('hidden');
    els.liveCounter.classList.remove('hidden');
    setStatus('sending', 'STREAMING');
    logTs(`Stream started on ${data.interface} @ ${data.rate} pps`, 'success');
    startPoll();
  } catch (err) {
    logTs(`Error: ${err.message}`, 'error');
  }
});

// ─── Stop Stream ─────────────────────────────────────────────────────────────
els.btnStop.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/stop', { method: 'POST' });
    const data = await res.json();
    logTs(`Stream stopped. Total sent: ${data.sent}`, 'warn');
  } catch {
    logTs('Stop request failed.', 'error');
  }
  stopPoll();
  sending = false;
  els.btnStop.classList.add('hidden');
  els.btnStart.classList.remove('hidden');
  els.liveCounter.classList.add('hidden');
  setStatus('idle', 'IDLE');
});

// ─── Live Poll ────────────────────────────────────────────────────────────────
function startPoll() {
  pollTimer = setInterval(async () => {
    try {
      const res  = await fetch('/api/status');
      const data = await res.json();
      els.liveCount.textContent = data.sent.toLocaleString();
      if (!data.sending && sending) {
        // Stream ended server-side
        els.btnStop.click();
      }
    } catch { /* ignore */ }
  }, 500);
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ─── Clear Log ────────────────────────────────────────────────────────────────
els.btnClear.addEventListener('click', () => {
  els.logOutput.innerHTML = '';
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadInterfaces();
logTs('ClabPktGen ready.', 'info');
