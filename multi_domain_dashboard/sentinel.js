/* ============================================================
   SENTINEL – ESP32 Dashboard JS  |  Demo + Live modes
   ============================================================ */

// ── GLOBALS ──────────────────────────────────────────────────
const S = {
  baseUrl:   localStorage.getItem('esp32Url') || '',
  demo:      true,
  connected: false,
  scanOn:    true,
  buzzEn:    true,
  gateManual:false,
  pollTimer: null,
  data:      null,
  prev:      null,
  trail:     [],   // {angle,ts}
  blips:     [],   // {angle,dist,water,ts}
  // demo sweep state
  dAngle: 0, dDir: 1, dDistMin:10, dDistMax:100,
  dTouchTh: 40, dScanSpeed: 40, dStepSize: 2, dSwMin: 0, dSwMax: 180,
  visualAngle: 0,
};

// ── CANVAS ───────────────────────────────────────────────────
const canvas = document.getElementById('radarCanvas');
const ctx    = canvas.getContext('2d');

function resize() {
  const wrap = canvas.parentElement;
  const W = wrap.clientWidth  || 500;
  const H = wrap.clientHeight || 280;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width  = W;
    canvas.height = H;
  }
}
const ro = new ResizeObserver(resize);
ro.observe(canvas.parentElement);
resize();

// ── RADAR DRAW ───────────────────────────────────────────────
function drawRadar(rawAngle, rawDist, land, water, rawMin, rawMax) {
  const W = canvas.width, H = canvas.height;
  const CX = W / 2, CY = H;
  const R  = Math.max(10, Math.min(H, W / 2) - 18);
  ctx.clearRect(0, 0, W, H);

  const angle = Number(rawAngle) || 0;
  const dist = Number(rawDist) || 0;
  const dMin = Number(rawMin) || 10;
  const dMax = Math.max(Number(rawMax) || 100, 1); // Prevent div by 0

  // Scanline texture overlay
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.fillRect(0, y, W, 2);
  }

  // Rings
  const rings = 4;
  for (let i = 1; i <= rings; i++) {
    const r = (R / rings) * i;
    if (r <= 0) continue;
    ctx.beginPath();
    ctx.arc(CX, CY, r, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = `rgba(0,207,255,${.05 + i * .03})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    const lab = Math.round((dMax / rings) * i);
    ctx.fillStyle = 'rgba(0,207,255,.28)';
    ctx.font = '9px Share Tech Mono';
    ctx.fillText(lab + 'cm', CX + r * Math.cos(-0.15) + 3, CY + r * Math.sin(-0.15) - 3);
  }

  // Spokes
  for (let a = 0; a <= 180; a += 30) {
    const rad = (180 + a) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX + R * Math.cos(rad), CY + R * Math.sin(rad));
    ctx.strokeStyle = 'rgba(0,207,255,.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,207,255,.35)';
    ctx.font = '9px Share Tech Mono';
    const lx = CX + (R + 14) * Math.cos(rad);
    const ly = CY + (R + 14) * Math.sin(rad);
    ctx.fillText(a + '°', lx - 8, ly + 3);
  }

  // Threshold band
  const rMin = R * Math.min(dMin, dMax) / dMax;
  const rMax = R;
  if (rMin >= 0) {
    ctx.beginPath(); ctx.arc(CX, CY, rMin, Math.PI, 2 * Math.PI);
    ctx.setLineDash([3,5]); ctx.strokeStyle='rgba(255,214,0,.22)'; ctx.lineWidth=1; ctx.stroke();
  }
  if (rMax >= 0) {
    ctx.beginPath(); ctx.arc(CX, CY, rMax, Math.PI, 2 * Math.PI);
    ctx.strokeStyle='rgba(255,107,53,.18)'; ctx.stroke();
  }
  ctx.setLineDash([]);

  // Trail
  const now = Date.now();
  S.trail = S.trail.filter(t => now - t.ts < 1400);
  S.trail.forEach(t => {
    const age = (now - t.ts) / 1400;
    const tAngle = Number(t.angle) || 0;
    const rad = (180 + tAngle) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(CX, CY);
    ctx.lineTo(CX + R * Math.cos(rad), CY + R * Math.sin(rad));
    ctx.strokeStyle = `rgba(0,207,255,${(1 - age) * .28})`;
    ctx.lineWidth = 2; ctx.stroke();
  });

  // Glow sweep line
  const rad = (180 + angle) * Math.PI / 180;
  const ex  = CX + R * Math.cos(rad), ey = CY + R * Math.sin(rad);
  const g = ctx.createLinearGradient(CX, CY, ex, ey);
  g.addColorStop(0, 'rgba(0,207,255,0)');
  g.addColorStop(1, 'rgba(0,207,255,.95)');
  ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(ex, ey);
  ctx.strokeStyle = g; ctx.lineWidth = 2.5;
  ctx.shadowColor = '#00cfff'; ctx.shadowBlur = 10; ctx.stroke();

  // Tip dot
  ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, 2 * Math.PI);
  ctx.fillStyle = '#00cfff'; ctx.shadowBlur = 14; ctx.fill();
  ctx.shadowBlur = 0;

  // Blips
  S.blips = S.blips.filter(b => now - b.ts < 5000);
  S.blips.forEach(b => {
    const age = (now - b.ts) / 5000;
    const bDist = Number(b.dist) || 0;
    const bAngle = Number(b.angle) || 0;
    const br  = R * Math.min(bDist, dMax) / dMax;
    const bRad = (180 + bAngle) * Math.PI / 180;
    const bx = CX + br * Math.cos(bRad), by = CY + br * Math.sin(bRad);
    const col = b.water ? `rgba(0,207,255,${1-age})` : `rgba(255,107,53,${1-age})`;
    if (br >= 0) {
      ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.shadowColor = b.water ? '#00cfff' : '#ff6b35';
      ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
      // ring pulse
      ctx.beginPath(); ctx.arc(bx, by, Math.max(0, 4.5 + (1 - age) * 12), 0, 2 * Math.PI);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
    }
  });

  // Center
  ctx.beginPath(); ctx.arc(CX, CY, 4, 0, 2 * Math.PI);
  ctx.fillStyle = '#00cfff'; ctx.shadowColor='#00cfff'; ctx.shadowBlur=10; ctx.fill();
  ctx.shadowBlur=0;
}

// ── DEMO DATA GENERATOR ──────────────────────────────────────
let demoTick = 0;
function genDemo() {
  if (S.scanOn) {
    S.dAngle += S.dDir * S.dStepSize;
    if (S.dAngle >= S.dSwMax) { S.dAngle = S.dSwMax; S.dDir = -1; }
    if (S.dAngle <= S.dSwMin) { S.dAngle = S.dSwMin; S.dDir =  1; }
  }

  const dist     = 20 + Math.sin(demoTick * .07) * 15 + Math.random() * 8;
  const land     = dist < S.dDistMin && demoTick % 40 < 8;
  const water    = dist >= S.dDistMin && dist < S.dDistMax && demoTick % 70 < 5;
  const touch    = demoTick % 120 < 6 && S.dTouchTh < 60;
  const gate     = demoTick % 200 < 30;
  const buzzer   = (land || water) && S.buzzEn;
  demoTick++;

  return {
    angle: Math.round(S.dAngle), distance: Math.round(dist),
    land, water, touch, gate, buzzer,
    distMin: S.dDistMin, distMax: S.dDistMax,
    touchTh: S.dTouchTh, scanSpeed: S.dScanSpeed, stepSize: S.dStepSize,
    swMin: S.dSwMin, swMax: S.dSwMax,
    scanOn: S.scanOn, buzzEn: S.buzzEn, gateManual: S.gateManual,
  };
}

// ── PROCESS DATA ─────────────────────────────────────────────
function processData(d) {
  const p = S.prev;
  if (p) {
    const newLand  = d.land  && !p.land;
    const newWater = d.water && !p.water;
    const newTouch = d.touch && !p.touch;
    if (newLand)   logE('⚠ LAND DETECTED  ' + d.angle + '° · ' + d.distance + 'cm', 'alert');
    if (!d.land && p.land)   logE('Land cleared', 'info');
    if (newWater)  logE('≋ WATER DETECTED  ' + d.angle + '° · ' + d.distance + 'cm', 'warn');
    if (!d.water && p.water) logE('Water cleared', 'info');
    if (newTouch)  logE('⚡ TOUCH TRIGGERED', 'alert');
    if (!d.touch && p.touch) logE('Touch released', 'info');
    if (d.gate !== p.gate)   logE('▣ Gate ' + (d.gate ? 'OPENED' : 'CLOSED'), 'info');
    if (d.buzzer && !p.buzzer) logE('♪ BUZZER ACTIVE', 'warn');
    if (!d.buzzer && p.buzzer) logE('Buzzer silenced', 'info');
    // ── Intrusion popup ──
    if (newLand || newWater || newTouch) triggerAlert(d);
  }
  S.prev = d; S.data = d;
  if ((d.land || d.water) && (!p || !(p.land || p.water)))
    S.blips.push({ angle: d.angle, dist: d.distance, water: d.water, ts: Date.now() });

  updateUI(d);
}

// ── UI UPDATE ────────────────────────────────────────────────
function updateUI(d) {
  // statusbar
  document.getElementById('sbAngle').textContent = pad3(d.angle) + '°';
  document.getElementById('sbDist').textContent  = d.distance + ' cm';
  document.getElementById('sbScan').textContent  = d.scanOn ? 'ACTIVE' : 'PAUSED';
  document.getElementById('sbScan').className    = 'sb-val ' + (d.scanOn ? 'green' : 'orange');

  // radar angle
  const ah = pad3(d.angle) + '°';
  document.getElementById('radarAngle').textContent = ah;

  // stats
  setStat('stDist',  'vDist',  d.distance, colorDist(d));
  setStat('stAngle', 'vAngle', d.angle,    '');
  setStatBool('stGate',  'vGate',  d.gate,    'OPEN','CLOSED','alert','good');
  setStatBool('stTouch', 'vTouch', d.touch,   'ACTIVE','CLEAR','alert','good');
  setStatBool('stBuzz',  'vBuzz',  d.buzzer,  'ON','OFF','warn','');
  setStatBool('stLand',  'vLand',  d.land,    'YES','NO','alert','good');
  setStatBool('stWater', 'vWater', d.water,   'YES','NO','warn','good');

  // gate badge
  const gb = document.getElementById('gateStatBadge');
  gb.textContent = d.gate ? 'OPEN' : 'CLOSED';
  gb.className   = 'badge ' + (d.gate ? 'badge-orange' : 'badge-green');

  // gate mode buttons
  document.getElementById('mManual').classList.toggle('active', d.gateManual);
  document.getElementById('mPhys').classList.toggle('active', !d.gateManual);
  document.getElementById('btnOpen').disabled  = !d.gateManual;
  document.getElementById('btnClose').disabled = !d.gateManual;

  // scan toggle
  const st = document.getElementById('btnScanTgl');
  st.textContent = d.scanOn ? '⏸ PAUSE' : '▶ RESUME';
  st.className   = d.scanOn ? 'btn btn-ghost btn-sm' : 'btn btn-cyan btn-sm';

  // buzzer toggle
  const bz = document.getElementById('btnBuzz');
  bz.textContent = d.buzzEn ? '🔇 MUTE' : '🔊 ENABLE';
  bz.className   = d.buzzEn ? 'btn btn-orange btn-half' : 'btn btn-cyan btn-half';

  // sync sliders (don't override if user dragging)
  syncSliderIfIdle('slDistMin','lDistMin', d.distMin);
  syncSliderIfIdle('slDistMax','lDistMax', d.distMax);
  syncSliderIfIdle('slTouchTh','lTouchTh', d.touchTh);
  syncSliderIfIdle('slSpeed','lSpeed', d.scanSpeed);
  syncSliderIfIdle('slStep','lStep', d.stepSize);
  syncSliderIfIdle('slSwMin','lSwMin', d.swMin);
  syncSliderIfIdle('slSwMax','lSwMax', d.swMax);
}

function colorDist(d) {
  if (d.distance < d.distMin || d.distance > d.distMax) return 'warn';
  return 'good';
}

function setStat(cardId, valId, val, cls) {
  document.getElementById(valId).textContent = val;
  const c = document.getElementById(cardId);
  c.className = 'stat ' + cls;
}

function setStatBool(cardId, valId, bool, t, f, tc, fc) {
  setStat(cardId, valId, bool ? t : f, bool ? tc : fc);
}

function syncSliderIfIdle(slId, lbId, val) {
  const sl = document.getElementById(slId);
  if (sl && !sl.matches(':active') && sl.getAttribute('data-dirty') !== '1') {
    sl.value = val;
    document.getElementById(lbId).textContent = val;
  }
}

function pad3(n) { return String(n).padStart(3,'0'); }

// ── LOG ───────────────────────────────────────────────────────
function logE(msg, type='info') {
  const log = document.getElementById('log');
  const ts  = new Date().toTimeString().slice(0,8);
  const d   = document.createElement('div');
  d.className = `log-entry ${type}`;
  d.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg">${msg}</span>`;
  log.prepend(d);
  if (log.children.length > 100) log.lastChild.remove();
}

// ── CLOCK ─────────────────────────────────────────────────────
function tick() { document.getElementById('clock').textContent = new Date().toTimeString().slice(0,8); }
setInterval(tick,1000); tick();

// ── CONNECTION ────────────────────────────────────────────────
function setConnState(state) {
  const badge = document.getElementById('connBadge');
  const label = document.getElementById('connLabel');
  badge.className = 'conn-badge ' + state;
  label.textContent = state.toUpperCase();
}

// ── POLLING ───────────────────────────────────────────────────
let _pollErrCount = 0;
async function poll() {
  if (S.demo) { processData(genDemo()); return; }
  if (!S.baseUrl) return;
  try {
    const r = await fetch(S.baseUrl + '/data', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!S.connected) {
      S.connected = true;
      _pollErrCount = 0;
      setConnState('online');
      logE('✓ Connected to ' + S.baseUrl, 'info');
    }
    processData(d);
  } catch(e) {
    _pollErrCount++;
    if (S.connected) {
      S.connected = false;
      setConnState('offline');
    }
    // Show detailed error every 10 attempts so log isn't spammed
    if (_pollErrCount === 1 || _pollErrCount % 10 === 0) {
      const hint = e.message.includes('Failed to fetch') || e.message.includes('NetworkError')
        ? ' — Check: (1) ESP32 is powered & on same network, (2) ESP32 sends CORS header: Access-Control-Allow-Origin: *'
        : e.message.includes('timeout') ? ' — Request timed out. ESP32 may be busy or unreachable.'
        : '';
      logE('✗ ' + S.baseUrl + '/data → ' + e.message + hint, 'alert');
    }
  }
}

function startPolling() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = setInterval(poll, 300);
  poll();
}

// ── RAF RENDER LOOP ───────────────────────────────────────────
let lastTime = 0;
function raf(time) {
  if (!lastTime) lastTime = time;
  const dt = Math.min(time - lastTime, 100); // cap dt at 100ms
  lastTime = time;

  if (S.data) {
    const targetAngle = S.data.angle;
    const diff = targetAngle - S.visualAngle;
    
    // Smoothly interpolate sweep based on configured speed
    const degPerMs = (S.data.stepSize || 2) / Math.max(10, S.data.scanSpeed || 40);
    const maxMove = degPerMs * dt;
    
    if (Math.abs(diff) > maxMove) {
      S.visualAngle += Math.sign(diff) * maxMove;
    } else {
      S.visualAngle = targetAngle;
    }
    
    S.trail.push({ angle: S.visualAngle, ts: Date.now() });
    
    drawRadar(S.visualAngle, S.data.distance, S.data.land, S.data.water, S.data.distMin, S.data.distMax);
  }
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// ── HELPERS ──────────────────────────────────────────────────
async function espFetch(path) {
  if (S.demo) return;
  if (!S.baseUrl) { openConfig(); return; }
  try { await fetch(S.baseUrl + path, { signal: AbortSignal.timeout(3000) }); }
  catch(e) { console.warn('ESP:', e.message); }
}

function flash(fbId, card) {
  const el = document.getElementById(fbId);
  el.textContent = '✓ SENT'; el.classList.add('show');
  if (card) { card.classList.add('sent'); setTimeout(()=>card.classList.remove('sent'),500); }
  setTimeout(()=>el.classList.remove('show'),1500);
}

window.sv = (sid,lid) => {
  const sl = document.getElementById(sid);
  sl.setAttribute('data-dirty', '1');
  document.getElementById(lid).textContent = sl.value;
};

// ── DEMO TOGGLE ──────────────────────────────────────────────
window.toggleDemo = function() {
  S.demo = !S.demo;
  const btn = document.getElementById('demoToggle');
  const sm  = document.getElementById('sbMode');
  if (S.demo) {
    btn.classList.add('active');
    btn.textContent = '◉ DEMO';
    setConnState('demo');
    sm.textContent='DEMO'; sm.className='sb-val cyan';
    logE('Demo mode activated','info');
  } else {
    btn.classList.remove('active');
    btn.textContent = '○ LIVE';
    setConnState('offline');
    sm.textContent='LIVE'; sm.className='sb-val green';
    logE('Live mode — polling ESP32','info');
  }
};

// ── SETTINGS ─────────────────────────────────────────────────
window.openConfig = function() {
  document.getElementById('espUrl').value = S.baseUrl;
  document.getElementById('settingsModal').classList.remove('hidden');
};
document.getElementById('cancelSettings').onclick = () => document.getElementById('settingsModal').classList.add('hidden');
document.getElementById('settingsModal').onclick = e => { if (e.target.id==='settingsModal') e.target.classList.add('hidden'); };
document.getElementById('openSettings').onclick = openConfig;
document.getElementById('saveSettings').onclick = () => {
  let v = document.getElementById('espUrl').value.trim().replace(/\/$/, '');
  // Auto-prefix http:// if user typed a bare IP
  if (v && !v.startsWith('http://') && !v.startsWith('https://')) v = 'http://' + v;
  S.baseUrl = v;
  localStorage.setItem('esp32Url', v);
  _pollErrCount = 0;
  document.getElementById('settingsModal').classList.add('hidden');
  logE('Target set → ' + v, 'info');
  if (S.demo) {
    window.toggleDemo(); // This flips demo to false and updates UI
  }
  startPolling();
};

// Test connection button
window.testConnection = async function() {
  const raw = document.getElementById('espUrl').value.trim().replace(/\/$/, '');
  let url = raw;
  if (url && !url.startsWith('http')) url = 'http://' + url;
  const btn = document.getElementById('testBtn');
  btn.textContent = '⏳ TESTING…'; btn.disabled = true;
  try {
    const r = await fetch(url + '/data', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    btn.textContent = '✓ CONNECTED';
    btn.style.background = 'var(--green)'; btn.style.color = '#000';
    document.getElementById('testResult').textContent = 'OK — got data: angle=' + d.angle + ' dist=' + d.distance;
    document.getElementById('testResult').style.color = 'var(--green)';
  } catch(e) {
    btn.textContent = '✗ FAILED';
    btn.style.background = 'var(--red)'; btn.style.color = '#fff';
    let msg = e.message;
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      msg = 'CORS blocked or unreachable. Add to ESP32 code:\nserver.sendHeader("Access-Control-Allow-Origin", "*");';
    }
    document.getElementById('testResult').textContent = msg;
    document.getElementById('testResult').style.color = 'var(--orange)';
  }
  setTimeout(() => { btn.textContent = '⚡ TEST'; btn.disabled = false; btn.style.background=''; btn.style.color=''; }, 3000);
};

// ── GATE CONTROLS ─────────────────────────────────────────────
window.setGateMode = async (mode) => {
  S.gateManual = mode==='manual';
  await espFetch('/gate?mode='+mode);
  logE('Gate mode → '+mode.toUpperCase(),'info');
};
window.setGate = async (st) => {
  await espFetch('/gate?state='+st);
  logE('Gate command → '+st.toUpperCase(),'info');
};

// ── THRESHOLD ─────────────────────────────────────────────────
window.applyThreshold = async () => {
  const min=document.getElementById('slDistMin').value, max=document.getElementById('slDistMax').value;
  S.dDistMin=+min; S.dDistMax=+max;
  document.getElementById('slDistMin').removeAttribute('data-dirty');
  document.getElementById('slDistMax').removeAttribute('data-dirty');
  await espFetch(`/threshold?min=${min}&max=${max}`);
  const c=document.querySelector('.ctrl-section');
  flash('fbThresh', c);
  logE(`Threshold → ${min}–${max} cm`,'info');
};

// ── TOUCH ─────────────────────────────────────────────────────
window.applyTouch = async () => {
  const th=document.getElementById('slTouchTh').value;
  S.dTouchTh = +th;
  document.getElementById('slTouchTh').removeAttribute('data-dirty');
  await espFetch(`/touch?th=${th}`);
  flash('fbTouch');
  logE('Touch threshold → '+th,'info');
};

// ── SCAN ──────────────────────────────────────────────────────
window.applyScan = async () => {
  const sp=document.getElementById('slSpeed').value,
        st=document.getElementById('slStep').value,
        mn=document.getElementById('slSwMin').value,
        mx=document.getElementById('slSwMax').value;
  S.dScanSpeed = +sp;
  S.dStepSize = +st;
  S.dSwMin = +mn;
  S.dSwMax = +mx;
  document.getElementById('slSpeed').removeAttribute('data-dirty');
  document.getElementById('slStep').removeAttribute('data-dirty');
  document.getElementById('slSwMin').removeAttribute('data-dirty');
  document.getElementById('slSwMax').removeAttribute('data-dirty');
  await espFetch(`/scan?speed=${sp}&step=${st}&min=${mn}&max=${mx}`);
  flash('fbScan');
  logE(`Scan → ${sp}ms / ${st}° / ${mn}°–${mx}°`,'info');
};
window.toggleScan = async () => {
  S.scanOn = !S.scanOn;
  await espFetch('/scan?enable='+(S.scanOn?1:0));
  logE('Scan '+(S.scanOn?'RESUMED':'PAUSED'),'info');
};

// ── BUZZER ────────────────────────────────────────────────────
window.toggleBuzzer = async () => {
  S.buzzEn = !S.buzzEn;
  await espFetch('/buzzer?enable='+(S.buzzEn?1:0));
  flash('fbBuzz');
  logE('Buzzer '+(S.buzzEn?'ENABLED':'MUTED'),'info');
};

// ── INTRUSION ALERT ──────────────────────────────────────────
const ia = {
  active: false,
  snoozedUntil: 0,
  lastType: '',
};

function triggerAlert(d) {
  if (ia.active) return;                          // already showing
  if (Date.now() < ia.snoozedUntil) return;       // snoozed

  ia.active = true;
  const al = document.getElementById('intrusionAlert');
  const chips = document.getElementById('iaChips');

  // type chips
  chips.innerHTML = '';
  if (d.land)  chips.innerHTML += '<span class="ia-chip land">▲ LAND</span>';
  if (d.water) chips.innerHTML += '<span class="ia-chip water">≋ WATER</span>';
  if (d.touch) chips.innerHTML += '<span class="ia-chip touch">⚡ TOUCH</span>';

  // icon
  document.getElementById('iaIcon').textContent  = d.touch ? '⚡' : d.water ? '≋' : '⚠';
  document.getElementById('iaAngle').textContent = pad3(d.angle) + '°';
  document.getElementById('iaDist').textContent  = d.distance + ' cm';
  document.getElementById('iaTime').textContent  = new Date().toTimeString().slice(0,8);

  const types = [d.land?'LAND':null, d.water?'WATER':null, d.touch?'TOUCH':null].filter(Boolean);
  document.getElementById('iaSubtitle').textContent = types.join(' + ') + ' — THREAT DETECTED';

  al.classList.remove('hidden');
}

window.dismissAlert = function() {
  document.getElementById('intrusionAlert').classList.add('hidden');
  ia.active = false;
};

window.snoozeAlert = function() {
  ia.snoozedUntil = Date.now() + 30000;
  dismissAlert();
  logE('Alert snoozed for 30s','warn');
};

// ── INIT ──────────────────────────────────────────────────────
setConnState('demo');
document.getElementById('sbMode').textContent='DEMO';
logE('SENTINEL online — demo mode active','info');
logE('Press ◉ DEMO to switch to live ESP32 data','info');
startPolling();
