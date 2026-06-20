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

// ─── Load interfaces ─────────────────────────────────────────────────────────
async function loadInterfaces() {
  try {
    const res = await fetch('/api/interfaces');
    if (!res.ok) return;
    const { interfaces } = await res.json();
    els.iface.innerHTML = '';
    interfaces.forEach(iface => {
      const opt = document.createElement('option');
      opt.value = iface;
      opt.textContent = iface;
      if (iface === 'eth1') opt.selected = true;
      els.iface.appendChild(opt);
    });
    // Default to eth1 if present
    if ([...els.iface.options].some(o => o.value === 'eth1')) {
      els.iface.value = 'eth1';
    }
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
