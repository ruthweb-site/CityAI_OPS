/* =============================================
   AI City Operations — App Logic v3
   Features: Multi-Agent Reasoning Trace,
             Foundry IQ Citations, WebSockets,
             Live Map, Real-Time Dashboard
   ============================================= */

const API_URL = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
    ? 'http://127.0.0.1:8000/api'
    : '/api';
const WS_URL = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
    ? 'ws://127.0.0.1:8000/ws'
    : `wss://${window.location.host}/ws`;
let allReports = [];
let currentFilter = 'all';
let cityMap = null;
let mapMarkers = [];
let ws = null;
let wsReconnectTimer = null;

// ── CITY COORDINATES for demo (random offsets around a city center) ──
const CITY_CENTER = [19.4184, 72.8182]; // Nalasopara
const LOCATION_OFFSETS = {
    '5th Avenue & Main Street':      [19.4190, 72.8150],
    'Nya Re, Nalasopara':            [19.4184, 72.8182],
    'Central Park, East Gate':       [19.4200, 72.8200],
    'Baker Street, Block 7':         [19.4050, 72.8100],
    'Outer Ring Road, Junction 12':  [19.4250, 72.7950],
    'Sector 4, Park Area':           [19.4100, 72.8250],
};

// ============================================================
// WEBSOCKET CLIENT — Real-Time Live Updates
// ============================================================
function initWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('🔌 WebSocket connected — live updates active.');
            clearTimeout(wsReconnectTimer);
            // Keep-alive ping every 25 seconds
            setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25000);
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleWsEvent(msg);
        };

        ws.onerror = () => console.warn('WebSocket error — falling back to polling.');

        ws.onclose = () => {
            console.warn('WebSocket closed. Reconnecting in 5s...');
            wsReconnectTimer = setTimeout(initWebSocket, 5000);
        };
    } catch (e) {
        console.warn('WebSocket unavailable — polling active.');
    }
}

function handleWsEvent(msg) {
    const { type, payload } = msg;

    if (type === 'init') {
        // Server sends current state on first connect
        allReports = payload.reports || [];
        if (document.getElementById('view-manager').classList.contains('active')) {
            renderDashboard();
        }
        if (document.getElementById('view-map').classList.contains('active')) {
            renderMapMarkers();
        }
    }

    if (type === 'new_report') {
        // A new report was submitted — push it into state and refresh UI
        const exists = allReports.some(r => r.id === payload.id);
        if (!exists) {
            allReports.unshift(payload); // prepend so newest appears first
        }

        // Live-update Operations Hub if visible
        if (document.getElementById('view-manager').classList.contains('active')) {
            renderDashboard();
        }
        // Live-update Map if visible
        if (document.getElementById('view-map').classList.contains('active')) {
            renderMapMarkers();
        }

        // Show toast notification regardless of which tab is active
        const toastType = payload.priority === 'CRITICAL' ? 'critical' : payload.priority === 'High' ? 'warning' : 'info';
        showToast(
            `📡 Live: New Report ${payload.id}`,
            `${payload.classification} → ${payload.department} | ${payload.priority}`,
            toastType
        );
    }

    if (type === 'status_update') {
        // Status changed — update in-memory state
        const report = allReports.find(r => r.id === payload.id);
        if (report) report.status = payload.status;
        if (document.getElementById('view-manager').classList.contains('active')) {
            renderDashboard();
        }
    }
}

// ============================================================
// NAVIGATION
// ============================================================
function switchView(view) {
    ['citizen','manager','map','insights'].forEach(v => {
        document.getElementById(`view-${v}`)?.classList.add('hidden');
        document.getElementById(`view-${v}`)?.classList.remove('active');
        document.getElementById(`tab-${v}`)?.classList.remove('active');
    });
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById(`view-${view}`).classList.add('active');
    document.getElementById(`tab-${view}`)?.classList.add('active');

    if (view === 'manager') fetchReports();
    if (view === 'map') initMap();
    if (view === 'insights') fetchInsights();
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(title, msg, type = 'info', duration = 5000) {
    const icons = { info:'ℹ️', success:'✅', warning:'⚠️', critical:'🚨' };
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            <div class="toast-msg">${msg}</div>
        </div>
        <div class="toast-close" onclick="dismissToast(this.parentElement)">✕</div>
    `;
    container.appendChild(toast);
    setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(el) {
    if (!el || !el.parentElement) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
}

// ============================================================
// QUICK FILL
// ============================================================
const SCENARIOS = {
    water: {
        name: 'Priya Sharma', location: '5th Avenue & Main Street',
        description: 'There is a massive water leak gushing out onto the road near the intersection. With freezing temperatures tonight, the entire road will turn into dangerous black ice by morning. Needs IMMEDIATE attention!'
    },
    pothole: {
        name: 'Rahul Mehta', location: 'Nya Re, Nalasopara',
        description: 'A huge pothole appeared after last night\'s rain — at least 30cm deep and 1 metre wide. I saw two cars swerve dangerously to avoid it. The asphalt has completely caved in and it is getting bigger.'
    },
    garbage: {
        name: 'Ananya Iyer', location: 'Central Park, East Gate',
        description: 'All trash cans near the park benches have been overflowing for 3 days. Garbage is spilling onto the walkways and attracting rodents. Families with children cannot use the area.'
    },
    light: {
        name: 'Suresh Naidu', location: 'Baker Street, Block 7',
        description: 'Three consecutive streetlights on Baker Street are out since last week. The area is completely dark at night. Two people have reported tripping on the pavement due to poor visibility.'
    }
};

function quickFill(type) {
    const s = SCENARIOS[type];
    document.getElementById('citizen-name').value = s.name;
    document.getElementById('location').value = s.location;
    document.getElementById('description').value = s.description;
}

// ============================================================
// FORM SUBMISSION
// ============================================================
document.getElementById('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitReport();
});

async function submitReport() {
    const name        = document.getElementById('citizen-name').value.trim();
    const location    = document.getElementById('location').value.trim();
    const description = document.getElementById('description').value.trim();
    if (!name || !location || !description) return;

    // UI: loading
    const form      = document.getElementById('report-form');
    const btnText   = document.getElementById('btn-text');
    const btnLoad   = document.getElementById('btn-loading');
    form.style.opacity = '0.5';
    form.style.pointerEvents = 'none';
    btnText.classList.add('hidden');
    btnLoad.classList.remove('hidden');

    // Show trace panel with live steps immediately
    const tracePanel = document.getElementById('trace-panel');
    tracePanel.classList.remove('hidden');
    document.getElementById('trace-steps').innerHTML = '';
    document.getElementById('resolution-plan').classList.add('hidden');

    // Animate through generic steps while waiting
    animateTraceLoading();

    // Fetch real coordinates dynamically
    try {
        if (location.includes('CR7F+8HR') || location.toLowerCase().includes('viva twp')) {
            // Hardcode exact coordinate for the demo location in Nalasopara East
            LOCATION_OFFSETS[location] = [19.414343, 72.827670]; 
        } else {
            // Strip plus codes which confuse Nominatim API
            const cleanLoc = location.replace(/^[A-Z0-9\+]+\,\s*/, ''); 
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanLoc + ', Maharashtra, India')}`);
            const geoData = await geoRes.json();
            if (geoData && geoData.length > 0) {
                LOCATION_OFFSETS[location] = [parseFloat(geoData[0].lat), parseFloat(geoData[0].lon)];
            } else {
                LOCATION_OFFSETS[location] = [19.4184, 72.8182]; // Fallback
            }
        }
    } catch(e) {
        LOCATION_OFFSETS[location] = [19.4184, 72.8182]; // Fallback
    }

    let data;
    try {
        const res = await fetch(`${API_URL}/reports`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location, description, name })
        });
        if (!res.ok) throw new Error();
        data = await res.json();
    } catch {
        data = mockAnalyze(name, location, description);
    }

    if (data.is_duplicate) {
        showDuplicate(data);
        return;
    }

    if (data.needs_info) {
        showFollowUp(data.follow_up_question);
        return;
    }

    allReports = [data]; // ONLY show this new report

    // Render actual trace steps from AI response
    await sleep(200);
    renderTrace(data);

    // Show success card
    showSuccess(data);

    // Toast notification
    const toastType = data.priority === 'CRITICAL' ? 'critical' : data.priority === 'High' ? 'warning' : 'success';
    showToast(
        `New Report: ${data.id}`,
        `${data.classification} → ${data.department} | Priority: ${data.priority}`,
        toastType
    );
}

function animateTraceLoading() {
    const steps = [
        'Report Ingested — Preprocessing text...',
        'Extracting key signals...',
        'Classifying issue type...',
        'Routing to department...',
        'Assessing severity...',
        'Generating resolution plan...'
    ];
    const container = document.getElementById('trace-steps');
    container.innerHTML = '';
    steps.forEach((txt, i) => {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'trace-step';
            el.innerHTML = `<div class="trace-step-icon">${i+1}</div>
                <div class="trace-step-body">
                    <div class="trace-step-title">${txt}</div>
                    <div class="trace-step-detail">Processing<span class="dots">...</span></div>
                </div>`;
            container.appendChild(el);
            setTimeout(() => el.classList.add('revealed'), 20);
        }, i * 220);
    });
}

function renderTrace(data) {
    const container = document.getElementById('trace-steps');
    container.innerHTML = '';
    const steps = data.reasoning_steps || [];
    steps.forEach((s, i) => {
        const el = document.createElement('div');
        el.className = 'trace-step';
        el.style.animationDelay = `${i * 100}ms`;
        el.innerHTML = `
            <div class="trace-step-icon done">✓</div>
            <div class="trace-step-body">
                <div class="trace-step-title">${s.title}</div>
                <div class="trace-step-detail">${s.detail}</div>
                <div class="trace-step-time">+${s.duration_ms}ms</div>
            </div>`;
        container.appendChild(el);
        setTimeout(() => el.classList.add('revealed'), i * 80);
    });

    // Show Foundry IQ policy citation
    if (data.policy_citation) {
        const citationEl = document.createElement('div');
        citationEl.style.cssText = 'margin-top:1rem;padding:.75rem 1rem;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:8px;font-size:.78rem;color:#a78bfa;line-height:1.5;animation:fadeup .4s ease both;';
        citationEl.innerHTML = `<span style="font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:.65rem;display:block;margin-bottom:4px;opacity:.7">📚 Foundry IQ — Policy Citation</span>${data.policy_citation}`;
        document.getElementById('trace-panel').appendChild(citationEl);
    }

    // Show resolution plan
    if (data.resolution_plan?.length) {
        const planDiv = document.getElementById('resolution-plan');
        const planList = document.getElementById('plan-list');
        planList.innerHTML = '';
        data.resolution_plan.forEach((step, i) => {
            const li = document.createElement('li');
            li.style.animationDelay = `${i * 100}ms`;
            li.innerHTML = `<span class="plan-num">${i+1}</span>${step}`;
            planList.appendChild(li);
        });
        setTimeout(() => planDiv.classList.remove('hidden'), steps.length * 80 + 200);
    }

    if (data.resource_allocation) {
        const resDiv = document.getElementById('resource-allocation');
        const resGrid = document.getElementById('resource-grid');
        resGrid.innerHTML = `
            <div class="resource-item"><span class="resource-label">Recommended Crew</span><span class="resource-value"><ul>${data.resource_allocation.crew.map(c=>`<li>${c}</li>`).join('')}</ul></span></div>
            <div class="resource-item"><span class="resource-label">Est. Cost</span><span class="resource-value" style="color:var(--green)">${data.resource_allocation.cost}</span></div>
            <div class="resource-item"><span class="resource-label">Expected Time</span><span class="resource-value" style="color:var(--orange)">${data.resource_allocation.time}</span></div>
        `;
        setTimeout(() => resDiv.classList.remove('hidden'), steps.length * 80 + 400);
    }
}

function showSuccess(data) {
    document.getElementById('report-form').classList.add('hidden');
    const panel = document.getElementById('success-panel');
    panel.classList.remove('hidden');
    document.getElementById('res-id').textContent = data.id;
    document.getElementById('res-class').textContent = data.classification;
    document.getElementById('res-dept').textContent = data.department;
    const pri = document.getElementById('res-priority');
    pri.textContent = data.priority;
    const colors = { CRITICAL: 'var(--red)', High: 'var(--orange)', Medium: 'var(--yellow)', Low: 'var(--green)' };
    pri.style.color = colors[data.priority] || 'var(--text-1)';
    const conf = document.getElementById('res-conf');
    conf.textContent = `${data.confidence || 88}%`;
    conf.style.color = (data.confidence || 88) >= 90 ? 'var(--green)' : 'var(--yellow)';
}

function showDuplicate(data) {
    document.getElementById('trace-panel').classList.add('hidden');
    document.getElementById('report-form').classList.add('hidden');
    const panel = document.getElementById('duplicate-panel');
    panel.classList.remove('hidden');
    document.getElementById('dup-parent-id').textContent = data.parent_id;
}

function showFollowUp(question) {
    document.getElementById('trace-panel').classList.add('hidden');
    const form = document.getElementById('report-form');
    form.style.opacity = '1';
    form.style.pointerEvents = 'auto';
    document.getElementById('btn-loading').classList.add('hidden');
    document.getElementById('btn-text').classList.remove('hidden');
    
    // Hide standard form elements visually to focus on question
    document.getElementById('submit-btn').classList.add('hidden');
    document.querySelector('.quick-fill-section').classList.add('hidden');
    
    const panel = document.getElementById('followup-panel');
    panel.classList.remove('hidden');
    document.getElementById('followup-text').textContent = question;
}

async function submitFollowUp() {
    const answer = document.getElementById('followup-answer').value.trim();
    if (!answer) return;
    
    const descEl = document.getElementById('description');
    descEl.value = descEl.value + "\n\nUser Answer: " + answer;
    
    document.getElementById('followup-panel').classList.add('hidden');
    document.getElementById('submit-btn').classList.remove('hidden');
    document.querySelector('.quick-fill-section').classList.remove('hidden');
    
    await submitReport();
}

function resetForm() {
    document.getElementById('report-form').reset();
    document.getElementById('report-form').classList.remove('hidden');
    document.getElementById('report-form').style.opacity = '1';
    document.getElementById('report-form').style.pointerEvents = 'auto';
    document.getElementById('btn-text').classList.remove('hidden');
    document.getElementById('btn-loading').classList.add('hidden');
    document.getElementById('success-panel').classList.add('hidden');
    document.getElementById('followup-panel').classList.add('hidden');
    document.getElementById('success-panel').classList.add('hidden');
    document.getElementById('trace-panel').classList.add('hidden');
    document.getElementById('resolution-plan').classList.add('hidden');
    document.getElementById('resource-allocation').classList.add('hidden');
    document.getElementById('followup-answer').value = '';
    document.getElementById('submit-btn').classList.remove('hidden');
    document.querySelector('.quick-fill-section').classList.remove('hidden');
}

// ============================================================
// DASHBOARD
// ============================================================
async function fetchReports() {
    try {
        const res = await fetch(`${API_URL}/reports`);
        const data = await res.json();
        allReports = data.reports || [];
        if (allReports.length === 0) allReports = getDemoData();
    } catch {
        if (allReports.length === 0) allReports = getDemoData();
    }
    renderDashboard();
}

function renderDashboard() {
    updateStats();
    renderReports(currentFilter);
}

function updateStats() {
    document.getElementById('stat-total').textContent    = allReports.length;
    document.getElementById('stat-critical').textContent = allReports.filter(r => r.priority === 'CRITICAL').length;
    document.getElementById('stat-high').textContent     = allReports.filter(r => r.priority === 'High').length;
    document.getElementById('stat-resolved').textContent = allReports.filter(r => r.status === 'Resolved').length;
}

function filterReports(f, btn) {
    currentFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderReports(f);
}

async function fetchInsights() {
    const content = document.getElementById('insights-content');
    const loading = document.getElementById('insights-loading');
    content.classList.add('hidden');
    loading.classList.remove('hidden');

    let data;
    try {
        const res = await fetch(`${API_URL}/insights`);
        if (!res.ok) throw new Error();
        data = await res.json();
    } catch {
        // Fallback mock insights
        data = {
            summary: "Analyzed recent reports. Significant clustering of infrastructure complaints in the Nalasopara region.",
            trends: [
                "40% increase in water leakage reports compared to last week.",
                "Road damage accounts for the highest proportion of high-priority tickets."
            ],
            recommendation: "Deploy an additional Water Management emergency crew to Sector 4 to mitigate cascading infrastructure damage."
        };
    }

    loading.classList.add('hidden');
    content.classList.remove('hidden');
    
    document.getElementById('insight-summary').textContent = data.summary;
    document.getElementById('insight-recommendation').textContent = data.recommendation;
    
    const trendsList = document.getElementById('insight-trends');
    trendsList.innerHTML = '';
    (data.trends || []).forEach(t => {
        const li = document.createElement('li');
        li.textContent = t;
        li.style.marginBottom = '8px';
        trendsList.appendChild(li);
    });
}

function renderReports(filter) {
    const grid  = document.getElementById('reports-grid');
    const empty = document.getElementById('empty-state');
    grid.innerHTML = '';

    let filtered = allReports;
    if (filter === 'New' || filter === 'Resolved' || filter === 'Assigned') {
        filtered = allReports.filter(r => r.status === filter);
    } else if (filter !== 'all') {
        filtered = allReports.filter(r => r.priority === filter);
    }

    if (filtered.length === 0) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    filtered.forEach((report, idx) => {
        const badgeClass = { CRITICAL:'badge-critical', High:'badge-high', Medium:'badge-medium', Low:'badge-low' }[report.priority] || 'badge-status';
        const emoji = { CRITICAL:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' }[report.priority] || '⚪';
        const statusBadge = report.status === 'Resolved' ? 'badge-resolved' : report.status === 'Assigned' ? 'badge-assigned' : 'badge-status';

        const card = document.createElement('div');
        card.className = `report-card priority-${report.priority}`;
        card.style.animationDelay = `${idx * 40}ms`;
        card.onclick = () => openModal(report);
        card.innerHTML = `
            <div class="card-top">
                <div>
                    <div class="card-id">${report.id}</div>
                    <div class="card-category">${report.classification}</div>
                    <div class="card-confidence">${report.confidence || 88}% confidence</div>
                </div>
                <span class="badge ${badgeClass}">${emoji} ${report.priority}</span>
            </div>
            <p class="card-desc">"${report.description}"</p>
            <div class="card-location">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                ${report.location || '—'}
            </div>
            <div class="card-footer">
                <div style="display:flex;gap:5px;flex-wrap:wrap">
                    <span class="badge badge-dept">🏛️ ${report.department}</span>
                    <span class="badge ${statusBadge}">${report.status}</span>
                </div>
                <div class="card-actions" onclick="event.stopPropagation()">
                    ${report.status !== 'Resolved' ? `<button class="action-btn assign" onclick="updateStatus('${report.id}','Assigned')">Assign</button>` : ''}
                    ${report.status !== 'Resolved' ? `<button class="action-btn resolve" onclick="updateStatus('${report.id}','Resolved')">Resolve</button>` : '✅ Done'}
                </div>
            </div>`;
        grid.appendChild(card);
    });
}

async function updateStatus(id, status) {
    // Update locally first (optimistic)
    const report = allReports.find(r => r.id === id);
    if (report) report.status = status;
    renderDashboard();

    const icon = status === 'Resolved' ? '✅' : '📋';
    showToast(`${icon} Status Updated`, `${id} marked as ${status}`, status === 'Resolved' ? 'success' : 'info');

    // Try to sync with backend
    try {
        await fetch(`${API_URL}/reports/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
    } catch { /* offline mode — local update is enough for demo */ }
}

// ============================================================
// MODAL
// ============================================================
function openModal(report) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const priorityColors = { CRITICAL: 'var(--red)', High: 'var(--orange)', Medium: 'var(--yellow)', Low: 'var(--green)' };

    const planHTML = (report.resolution_plan || []).map((step, i) =>
        `<div class="modal-plan-item"><div class="modal-plan-num">${i+1}</div>${step}</div>`
    ).join('');

    const traceHTML = (report.reasoning_steps || []).map(s =>
        `<div class="modal-trace-step"><strong>${s.title}</strong> — ${s.detail} <span style="color:var(--text-3);font-family:'JetBrains Mono',monospace;font-size:.7rem">(+${s.duration_ms}ms)</span></div>`
    ).join('');

    const allocHTML = report.resource_allocation ? `
        <div class="modal-section" style="margin-top:1.25rem;">
            <div class="modal-section-title">AI Resource Allocation</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;background:rgba(37,99,235,.05);border:1px solid rgba(37,99,235,.2);padding:1rem;border-radius:8px;">
                <div><div style="font-size:.65rem;color:var(--text-3);text-transform:uppercase;margin-bottom:3px">Crew</div><div style="font-size:.8rem;color:var(--text-1);font-weight:600">${report.resource_allocation.crew.join(', ')}</div></div>
                <div><div style="font-size:.65rem;color:var(--text-3);text-transform:uppercase;margin-bottom:3px">Cost</div><div style="font-size:.8rem;color:var(--green);font-weight:600">${report.resource_allocation.cost}</div></div>
                <div><div style="font-size:.65rem;color:var(--text-3);text-transform:uppercase;margin-bottom:3px">Time</div><div style="font-size:.8rem;color:var(--orange);font-weight:600">${report.resource_allocation.time}</div></div>
            </div>
        </div>
    ` : '';

    content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.25rem;flex-wrap:wrap;gap:.75rem">
            <div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-3);margin-bottom:5px">${report.id}</div>
                <h2 style="font-size:1.3rem;font-weight:700;letter-spacing:-.02em">${report.classification}</h2>
            </div>
            <span style="font-size:1.1rem;font-weight:700;color:${priorityColors[report.priority]}">${report.priority}</span>
        </div>
        <div class="modal-section">
            <div class="modal-section-title">Citizen Report</div>
            <p style="font-size:.875rem;color:var(--text-2);line-height:1.65">"${report.description}"</p>
            <div style="margin-top:.6rem;font-size:.8rem;color:var(--text-3)">📍 ${report.location} &nbsp;|&nbsp; 👤 ${report.name || 'Anonymous'}</div>
        </div>
        <div class="modal-section">
            <div class="modal-section-title">AI Decision</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);border-radius:8px;overflow:hidden;margin-bottom:.75rem">
                <div style="padding:10px 12px;background:var(--surface-2)"><div style="font-size:.7rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Department</div><div style="font-size:.875rem;font-weight:600">${report.department}</div></div>
                <div style="padding:10px 12px;background:var(--surface-2)"><div style="font-size:.7rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Confidence</div><div style="font-size:.875rem;font-weight:600;color:var(--green)">${report.confidence || 88}%</div></div>
            </div>
            ${report.reasoning ? `<p style="font-size:.82rem;color:var(--blue);font-style:italic">💡 "${report.reasoning}"</p>` : ''}
        </div>
        ${report.policy_citation ? `
        <div class="modal-section">
            <div class="modal-section-title">📚 Foundry IQ — Policy Citation</div>
            <div style="padding:.75rem 1rem;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:8px;font-size:.82rem;color:#a78bfa;line-height:1.6">${report.policy_citation}</div>
        </div>` : ''}
        ${planHTML ? `<div class="modal-section"><div class="modal-section-title">🎯 AI-Generated Resolution Plan</div>${planHTML}</div>` : ''}
        ${allocHTML}
        ${traceHTML ? `<div class="modal-section" style="margin-top:1.25rem;"><div class="modal-section-title">🔍 Multi-Agent Reasoning Trace</div>${traceHTML}</div>` : ''}
    `;

    overlay.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

// ============================================================
// MAP VIEW
// ============================================================
function initMap() {
    if (!cityMap) {
        cityMap = L.map('city-map').setView(CITY_CENTER, 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap contributors © CARTO',
            maxZoom: 19
        }).addTo(cityMap);
    }
    renderMapMarkers();
}

function renderMapMarkers() {
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];

    const priorityColors = { CRITICAL: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e' };
    const reports = allReports; // Do not use demo data if allReports is populated

    const listEl = document.getElementById('map-report-list');
    listEl.innerHTML = '';

    if (reports.length === 0) return;

    reports.forEach(r => {
        const coords = LOCATION_OFFSETS[r.location] || [
            CITY_CENTER[0] + (Math.random() - 0.5) * 0.04,
            CITY_CENTER[1] + (Math.random() - 0.5) * 0.04
        ];
        const color = priorityColors[r.priority] || '#94a3b8';
        const icon = L.divIcon({
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 10px ${color}"></div>`,
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });
        const marker = L.marker(coords, { icon }).addTo(cityMap);
        marker.bindPopup(`
            <div style="font-family:Inter,sans-serif;min-width:200px">
                <div style="font-weight:700;margin-bottom:4px">${r.classification}</div>
                <div style="font-size:.8rem;color:#666;margin-bottom:4px">📍 ${r.location}</div>
                <div style="font-size:.8rem">🏛️ ${r.department}</div>
                <div style="font-size:.8rem;font-weight:600;color:${color};margin-top:4px">⚡ ${r.priority}</div>
            </div>
        `);
        mapMarkers.push(marker);

        const item = document.createElement('div');
        item.className = 'map-list-item';
        item.innerHTML = `
            <strong style="color:${color}">${r.classification}</strong>
            <span>${r.location}</span>`;
        item.onclick = () => { cityMap.setView(coords, 16); marker.openPopup(); };
        listEl.appendChild(item);

        // Center map to this real coordinate immediately
        cityMap.setView(coords, 16);
    });
}

// ============================================================
// DEMO SEED DATA
// ============================================================
function getDemoData() {
    return [
        { id:'REP-0001', name:'Priya Sharma', location:'5th Avenue & Main Street', description:'Massive water leak gushing onto the road — with freezing temperatures tonight it will turn into dangerous black ice.', classification:'Water Leak / Pipe Damage', department:'Water Management', priority:'CRITICAL', confidence:96, status:'In Progress', reasoning:'Water leak combined with freezing hazard creates immediate life-safety risk.', resolution_plan:['Dispatch Water Management emergency crew','Isolate the affected pipe section','Set up road barriers and diversion signs','Restore water supply to nearby residents','File infrastructure damage report'], resource_allocation:{crew:['2 Plumbers', '1 Supervisor', '1 Traffic Officer'], cost:'₹12,000', time:'4 hours'}, reasoning_steps:[{title:'Report Ingested',detail:'Received 112 chars. Tokenizing text.',duration_ms:12},{title:'Keyword Extraction',detail:'Detected: "water", "leak", "gush", "freeze".',duration_ms:28},{title:'Issue Classification',detail:'Matched pattern: Water Leak / Pipe Damage. 96% confidence.',duration_ms:44},{title:'Department Routing',detail:'Routed to Water Management.',duration_ms:18},{title:'Severity Assessment',detail:'Water leak + freezing hazard = CRITICAL. Immediate life-safety risk.',duration_ms:55},{title:'Resolution Plan Generated',detail:'5-step action plan created for Water Management team.',duration_ms:35}] },
        { id:'REP-0002', name:'Rahul Mehta', location:'Nya Re, Nalasopara', description:'Huge pothole — 30cm deep, 1m wide. Two cars swerved dangerously to avoid it.', classification:'Pothole / Road Damage', department:'Dept of Transportation', priority:'High', confidence:92, status:'New', reasoning:'Pothole of this size with observed near-accidents constitutes a high-priority road hazard.', resolution_plan:['Deploy road maintenance crew to assess','Place warning signs and cones','Apply temporary cold-mix patch','Schedule permanent resurfacing within 48h','Inspect surrounding road for damage'], resource_allocation:{crew:['3 Road Workers', '1 Heavy Machinery Operator'], cost:'₹25,000', time:'8 hours'}, reasoning_steps:[{title:'Report Ingested',detail:'Received 95 chars. Tokenizing text.',duration_ms:11},{title:'Keyword Extraction',detail:'Detected: "pothole", "deep", "swerved", "dangerously".',duration_ms:25},{title:'Issue Classification',detail:'Matched pattern: Pothole / Road Damage. 92% confidence.',duration_ms:41},{title:'Department Routing',detail:'Routed to Dept of Transportation.',duration_ms:17},{title:'Severity Assessment',detail:'Observed near-accidents elevate from Medium to High priority.',duration_ms:49},{title:'Resolution Plan Generated',detail:'5-step action plan created for road crew.',duration_ms:32}] },
        { id:'REP-0003', name:'Ananya Iyer', location:'Central Park, East Gate', description:'Overflowing trash cans for 3 days, garbage on walkways attracting rodents. Families cannot use the area.', classification:'Waste / Sanitation Issue', department:'Sanitation', priority:'Medium', confidence:89, status:'New', reasoning:'Rodent attraction and health risk elevate this beyond a Low priority complaint.', resolution_plan:['Dispatch sanitation truck to location','Clear overflowing waste and sanitize area','Inspect and replace damaged bins','Add extra pickup schedule this week','Review waste collection frequency'], resource_allocation:{crew:['2 Sanitation Workers', '1 Waste Truck'], cost:'₹4,500', time:'2 hours'}, reasoning_steps:[{title:'Report Ingested',detail:'Received 104 chars.',duration_ms:10},{title:'Keyword Extraction',detail:'Detected: "trash", "overflow", "rodents", "health".',duration_ms:22},{title:'Issue Classification',detail:'Matched: Waste / Sanitation Issue. 89% confidence.',duration_ms:38},{title:'Department Routing',detail:'Routed to Sanitation Dept.',duration_ms:15},{title:'Severity Assessment',detail:'Rodent presence and health risk = Medium priority.',duration_ms:44},{title:'Resolution Plan Generated',detail:'5-step plan created.',duration_ms:30}] },
        { id:'REP-0004', name:'Suresh Naidu', location:'Baker Street, Block 7', description:'Three consecutive streetlights are out since last week. Area is completely dark — people are tripping.', classification:'Broken Streetlight', department:'Electrical / Public Works', priority:'Medium', confidence:91, status:'Assigned', reasoning:'Multiple streetlights out in sequence suggests a circuit fault — Medium priority public safety issue.', resolution_plan:['Alert electrical maintenance team','Inspect fuse box and wiring','Replace faulty components','Test adjacent lights for cascade failure','Log for preventive maintenance'], resource_allocation:{crew:['2 Electricians', '1 Boom Lift Operator'], cost:'₹8,000', time:'3 hours'}, reasoning_steps:[{title:'Report Ingested',detail:'Received 96 chars.',duration_ms:10},{title:'Keyword Extraction',detail:'Detected: "streetlights", "dark", "tripping".',duration_ms:21},{title:'Issue Classification',detail:'Matched: Broken Streetlight. 91% confidence.',duration_ms:37},{title:'Department Routing',detail:'Routed to Electrical / Public Works.',duration_ms:14},{title:'Severity Assessment',detail:'Multiple lights + tripping reports = Medium priority.',duration_ms:43},{title:'Resolution Plan Generated',detail:'5-step electrical plan created.',duration_ms:29}] },
        { id:'REP-0005', name:'Kavya Reddy', location:'Outer Ring Road, Junction 12', description:'Road sign has completely fallen over, blocking part of the lane after yesterday\'s storm.', classification:'Road Sign / Signage Damage', department:'Dept of Transportation', priority:'High', confidence:87, status:'New', reasoning:'Fallen sign blocking an active lane is an immediate road safety hazard.', resolution_plan:['Dispatch road crew to remove/secure sign','Place temporary warning markers','Assess sign post damage','Install replacement sign within 24h','Inspect other signs in storm area'], resource_allocation:{crew:['2 Road Workers', '1 Light Truck'], cost:'₹5,500', time:'2 hours'}, reasoning_steps:[{title:'Report Ingested',detail:'Received 88 chars.',duration_ms:9},{title:'Keyword Extraction',detail:'Detected: "sign", "fallen", "blocking", "lane".',duration_ms:20},{title:'Issue Classification',detail:'Matched: Road Sign / Signage Damage. 87% confidence.',duration_ms:36},{title:'Department Routing',detail:'Routed to Dept of Transportation.',duration_ms:13},{title:'Severity Assessment',detail:'Lane obstruction = High priority road hazard.',duration_ms:41},{title:'Resolution Plan Generated',detail:'5-step plan created.',duration_ms:27}] },
        { id:'REP-0006', name:'Mohan Das', location:'Sector 4, Park Area', description:'Park benches are broken with shattered glass on the ground near the children\'s play area.', classification:'Public Property Damage', department:'City Services', priority:'Low', confidence:82, status:'Resolved', reasoning:'No immediate safety emergency but broken glass near children\'s area should be addressed.', resolution_plan:['Inspect and cordon off damaged area','Clear shattered glass safely','Remove or repair broken benches','Report for replacement order','Follow up within 7 days'], resource_allocation:{crew:['1 Field Inspector', '1 Cleanup Crew'], cost:'₹3,000', time:'1.5 hours'}, reasoning_steps:[{title:'Report Ingested',detail:'Received 92 chars.',duration_ms:9},{title:'Keyword Extraction',detail:'Detected: "broken", "glass", "children".',duration_ms:19},{title:'Issue Classification',detail:'Matched: Public Property Damage. 82% confidence.',duration_ms:34},{title:'Department Routing',detail:'Routed to City Services.',duration_ms:12},{title:'Severity Assessment',detail:'Non-urgent but glass near children requires attention.',duration_ms:39},{title:'Resolution Plan Generated',detail:'5-step plan created.',duration_ms:26}] }
    ];
}

// ============================================================
// UTILITY
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function mockAnalyze(name, location, description) {
    const d = description.toLowerCase();

    // Duplicate detection simulation
    if (d.includes('water') && location.includes('5th Avenue') && !d.includes('user answer:')) {
        return { is_duplicate: true, parent_id: 'REP-0001' };
    }

    // Follow-up simulation
    if (d.split(' ').length < 10 && !d.includes('user answer:')) {
        if (d.includes('water') || d.includes('leak')) {
            return { needs_info: true, follow_up_question: "Is the water actively flooding onto the road, or is it a minor puddle?" };
        }
        if (d.includes('pothole') || d.includes('road')) {
            return { needs_info: true, follow_up_question: "Can you estimate the size of the pothole? Is it affecting traffic flow?" };
        }
        return { needs_info: true, follow_up_question: "Could you please provide a few more details about the issue and its exact location?" };
    }

    let classification, department, priority, confidence, reasoning;
    if (d.includes('water')||d.includes('leak')||d.includes('pipe')) {
        classification='Water Leak / Pipe Damage'; department='Water Management';
        priority=(d.includes('freez')||d.includes('ice')||d.includes('gush')||d.includes('massive'))?'CRITICAL':'High';
        confidence=94; reasoning=`Water-related emergency. Priority ${priority} due to hazard level in description.`;
    } else if (d.includes('pothole')||d.includes('road')||d.includes('asphalt')) {
        classification='Pothole / Road Damage'; department='Dept of Transportation';
        priority=(d.includes('danger')||d.includes('accident')||d.includes('swerv'))?'High':'Medium';
        confidence=91; reasoning=`Road damage detected. ${priority} priority based on safety risk described.`;
    } else if (d.includes('garbage')||d.includes('trash')||d.includes('waste')) {
        classification='Waste / Sanitation Issue'; department='Sanitation';
        priority=(d.includes('rodent')||d.includes('health'))?'Medium':'Low';
        confidence=88; reasoning=`Sanitation issue. ${priority} priority based on health impact signals.`;
    } else if (d.includes('light')||d.includes('dark')||d.includes('lamp')) {
        classification='Broken Streetlight'; department='Electrical / Public Works';
        priority='Medium'; confidence=90; reasoning='Streetlight outage. Medium priority public safety concern.';
    } else {
        classification='General City Issue'; department='City Services';
        priority='Medium'; confidence=72; reasoning='No specific pattern matched. Routed for human assessment.';
    }

    const steps = [
        {title:'Report Ingested',detail:`Received ${description.length} chars.`,duration_ms:12},
        {title:'Keyword Extraction',detail:'Scanning for hazard and urgency signals.',duration_ms:28},
        {title:'Issue Classification',detail:`Matched: ${classification}. ${confidence}% confidence.`,duration_ms:44},
        {title:'Department Routing',detail:`Routed to ${department}.`,duration_ms:18},
        {title:'Severity Assessment',detail:reasoning,duration_ms:52},
        {title:'Resolution Plan Generated',detail:'Action plan created for assigned department.',duration_ms:35}
    ];

    const planMap = {
        'Water Management':['Dispatch Water Management emergency crew','Isolate the affected pipe section','Set up road barriers','Restore water supply','File infrastructure damage report'],
        'Dept of Transportation':['Deploy road maintenance crew','Place warning signs and cones','Apply temporary patch','Schedule permanent fix within 48h','Inspect surrounding road'],
        'Sanitation':['Dispatch sanitation truck','Clear waste and sanitize area','Replace damaged bins','Add extra pickup schedule','Review collection frequency'],
        'Electrical / Public Works':['Alert electrical maintenance team','Inspect fuse box and wiring','Replace faulty components','Test adjacent lights','Log for preventive maintenance'],
        'City Services':['Log complaint in system','Assign to field inspector','Issue work order','Update citizen on timeline','Follow up within 7 days']
    };

    const resourceMap = {
        'Water Management': { crew: ['2 Plumbers', '1 Supervisor', '1 Traffic Officer'], cost: '₹12,000', time: '4 hours' },
        'Dept of Transportation': { crew: ['3 Road Workers', '1 Heavy Machinery Operator'], cost: '₹25,000', time: '8 hours' },
        'Sanitation': { crew: ['2 Sanitation Workers', '1 Waste Truck'], cost: '₹4,500', time: '2 hours' },
        'Electrical / Public Works': { crew: ['2 Electricians', '1 Boom Lift Operator'], cost: '₹8,000', time: '3 hours' },
        'City Services': { crew: ['1 Field Inspector', '1 General Helper'], cost: '₹2,000', time: '1 hour' }
    };

    const id = `REP-${String(allReports.length + 1).padStart(4, '0')}`;
    return { id, name, description, location, classification, department, priority, confidence, status:'New', reasoning, reasoning_steps:steps, resolution_plan:planMap[department]||planMap['City Services'], resource_allocation:resourceMap[department]||resourceMap['City Services'] };
}

// ── Initialize WebSocket for real-time updates ──
// Falls back to polling if WebSocket is unavailable
initWebSocket();

// Polling fallback: only fires if WebSocket is NOT connected
setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) return; // WS active — skip poll
    if (document.getElementById('view-manager').classList.contains('active')) {
        fetchReports();
    }
}, 30000);
