// app-dashboard.js
import { renderSidebar }                                          from './sidebar.js';
import { getStreak, getQuizHistory, getFlashcardStats, getBookmarks } from './progress.js';
import { isLoggedIn, showLockOverlay }                            from './auth.js';

// ── Boot ───────────────────────────────────────────────────────────────────
async function init() {
  // Auth gate — progress dashboard requires a free account
  if (!isLoggedIn()) {
    const main = document.querySelector('.main-content') || document.querySelector('main');
    if (main) showLockOverlay(main, 'My Progress');
    return;
  }

  // Date stamp
  document.getElementById('db-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const [fcData, outlineData] = await Promise.all([
    fetch('../data/flashcards.json').then(r => r.json()),
    fetch('../data/sy0-701-outline.json').then(r => r.json()),
  ]);

  renderSidebar({
    navEl:        document.getElementById('sidebar-nav'),
    domains:      outlineData.domains,
    showHomeLink: true,
    homeHref:     '../index.html',
    socials:      true,
    autoClose:    true,
  });

  const allCards = fcData.flashcards;
  const domains  = outlineData.domains;
  const fcStats  = getFlashcardStats(allCards);
  const streak   = getStreak();
  const history  = getQuizHistory();

  renderHeroStats(fcStats, streak, history);
  renderBookmarks(domains);
  renderFlashcardMastery(fcStats, domains);
  renderQuizHistory(history);
  renderDomainAccuracy(history, domains);
  bindDataActions();
}

// ── Bookmarks ───────────────────────────────────────────────────────────────
function renderBookmarks(domains) {
  const section   = document.getElementById('db-bookmarks-section');
  const container = document.getElementById('db-bookmarks-content');
  const bms       = getBookmarks();

  if (bms.length === 0) {
    container.innerHTML = `
      <div class="db-empty">
        <div class="db-empty-icon">☆</div>
        <div class="db-empty-msg">No bookmarks yet.<br>Open any objective and click <strong>☆ Bookmark</strong> to save it here.</div>
      </div>`;
    return;
  }

  // Build a flat lookup: objectiveId → { id, title, domainName }
  const lookup = {};
  (domains || []).forEach(d => {
    (d.objectives || []).forEach(o => {
      lookup[o.id] = { id: o.id, title: o.title, domainName: d.name };
    });
  });

  const cards = bms.map(bmId => {
    const obj = lookup[bmId];
    if (!obj) return '';
    return `
      <a class="db-bookmark-card" href="./objective.html#${encodeURIComponent(obj.id)}">
        <span class="bmc-id">★ ${obj.id}</span>
        <span class="bmc-title">${escapeHtml(obj.title)}</span>
      </a>`;
  }).join('');

  container.innerHTML = `<div class="db-bookmark-grid">${cards}</div>`;
}

// ── Hero stats ─────────────────────────────────────────────────────────────
function renderHeroStats(fcStats, streak, history) {
  document.getElementById('stat-streak').textContent   = streak.streak;
  document.getElementById('stat-sessions').textContent = streak.totalSessions || 0;

  const mastPct = fcStats.total > 0
    ? Math.round((fcStats.known / fcStats.total) * 100)
    : 0;
  document.getElementById('stat-mastery').textContent = mastPct + '%';

  if (history.length > 0) {
    const best = Math.max(...history.map(s => s.pct));
    document.getElementById('stat-best').textContent = best + '%';
  } else {
    document.getElementById('stat-best').textContent = '—';
  }
}

// ── Flashcard mastery ──────────────────────────────────────────────────────
function renderFlashcardMastery(fcStats, domains) {
  const mastPct = fcStats.total > 0
    ? Math.round((fcStats.known / fcStats.total) * 100)
    : 0;
  document.getElementById('fc-mastery-pct').textContent = mastPct + '%';

  const container = document.getElementById('fc-domain-bars');
  container.innerHTML = '';

  domains.forEach(d => {
    const ds = fcStats.byDomain[d.id];
    if (!ds || ds.total === 0) return;

    const knownPct  = Math.round((ds.known  / ds.total) * 100);
    const reviewPct = Math.round((ds.review / ds.total) * 100);
    // Clamp to avoid rounding overflow
    const unseenPct = Math.max(0, 100 - knownPct - reviewPct);

    container.innerHTML += `
      <div class="db-domain-row">
        <div class="db-domain-label">
          <span class="db-domain-name">${d.id} – ${d.name}</span>
          <span>${ds.known}/${ds.total} known</span>
        </div>
        <div class="db-seg-bar">
          <div class="db-seg-known"  style="width:${knownPct}%"></div>
          <div class="db-seg-review" style="width:${reviewPct}%"></div>
          <div class="db-seg-unseen" style="width:${unseenPct}%"></div>
        </div>
      </div>`;
  });
}

// ── Quiz score history ─────────────────────────────────────────────────────
function renderQuizHistory(history) {
  const container = document.getElementById('quiz-history-content');

  if (history.length === 0) {
    container.innerHTML = `
      <div class="db-empty">
        <div class="db-empty-icon">📋</div>
        <div class="db-empty-msg">No quiz sessions yet.<br>Take a quiz to see your score history here.</div>
        <a class="db-empty-cta" href="./quiz.html">Start a Quiz →</a>
      </div>`;
    return;
  }

  // Last 10 sessions
  const recent = history.slice(-10);

  const barsHtml = recent.map(s => {
    const pass = s.pct >= 72;
    // Height in px; chart area is 100px so 1% ≈ 1px
    const barH  = Math.max(4, Math.round(s.pct));
    const date  = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const modeTag = s.mode === 'exam' ? 'E' : 'Q';
    return `
      <div class="db-bar-col" title="${s.pct}% · ${pass ? 'Pass' : 'Fail'} · ${date}">
        <div class="db-bar ${pass ? 'pass' : 'fail'}" style="height:${barH}px"></div>
        <div class="db-bar-lbl">${s.pct}%</div>
        <div class="db-bar-lbl">${date}</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="db-chart-wrap">${barsHtml}</div>
    <div class="db-pass-line">72% pass threshold</div>`;
}

// ── Domain accuracy ────────────────────────────────────────────────────────
function renderDomainAccuracy(history, domains) {
  const container = document.getElementById('domain-accuracy-content');

  if (history.length === 0) {
    container.innerHTML = `
      <div class="db-empty">
        <div class="db-empty-icon">🎯</div>
        <div class="db-empty-msg">Take a quiz to see your accuracy by domain.</div>
        <a class="db-empty-cta" href="./quiz.html">Start a Quiz →</a>
      </div>`;
    return;
  }

  // Aggregate all sessions' domainBreakdown data
  const totals = {};
  history.forEach(s => {
    if (!s.domainBreakdown) return;
    Object.entries(s.domainBreakdown).forEach(([dId, v]) => {
      if (!totals[dId]) totals[dId] = { correct: 0, total: 0 };
      totals[dId].correct += (v.correct || 0);
      totals[dId].total   += (v.total   || 0);
    });
  });

  let html = '';
  domains.forEach(d => {
    const t = totals[d.id];
    if (!t || t.total === 0) return;

    const pct   = Math.round((t.correct / t.total) * 100);
    const color = pct >= 72 ? '#2ecc71' : pct >= 50 ? '#e67e22' : '#e74c3c';

    html += `
      <div class="db-acc-row">
        <div class="db-acc-name">${d.id} – ${d.name}</div>
        <div class="db-acc-bar-wrap">
          <div class="db-acc-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="db-acc-pct">${pct}%</div>
      </div>`;
  });

  container.innerHTML = html ||
    `<div class="db-empty"><div class="db-empty-msg">No domain breakdown data available yet.</div></div>`;
}

// ── All localStorage keys that represent study progress ─────────────────────
const PROGRESS_KEYS = [
  'bookmarks-v1',
  'fc-progress-v1',
  'fc-sm2-v1',
  'quiz-history-v1',
  'study-streak-v1',
  'objectives-visited-v1',
];

// ── Export progress ─────────────────────────────────────────────────────────
function exportProgress() {
  const bundle = { exportedAt: new Date().toISOString() };
  PROGRESS_KEYS.forEach(k => {
    const val = localStorage.getItem(k);
    if (val !== null) bundle[k] = JSON.parse(val);
  });
  const blob     = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `netplus-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import progress ─────────────────────────────────────────────────────────
function importProgress(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let bundle;
    try {
      bundle = JSON.parse(e.target.result);
    } catch {
      showImportStatus('Invalid file — could not parse JSON.', 'error');
      return;
    }

    const exportDate = bundle.exportedAt
      ? new Date(bundle.exportedAt).toLocaleString()
      : 'unknown date';

    if (!confirm(`Import progress exported on ${exportDate}?\n\nThis will overwrite your current progress and reload the page.`)) return;

    PROGRESS_KEYS.forEach(k => {
      if (bundle[k] !== undefined) {
        localStorage.setItem(k, JSON.stringify(bundle[k]));
      }
    });

    showImportStatus('Progress imported! Reloading…', 'success');
    setTimeout(() => location.reload(), 800);
  };
  reader.readAsText(file);
}

function showImportStatus(msg, type) {
  const el = document.getElementById('db-import-status');
  el.textContent = msg;
  el.className   = `db-import-status ${type}`;
}

// ── Data actions (Export / Import / Reset) ──────────────────────────────────
function bindDataActions() {
  document.getElementById('db-export-btn').addEventListener('click', exportProgress);

  document.getElementById('db-import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importProgress(file);
    e.target.value = '';  // reset so same file can be re-imported
  });

  document.getElementById('db-reset-btn').addEventListener('click', () => {
    if (!confirm(
      'Reset ALL progress?\n\nThis will clear:\n• Flashcard known/review status\n• SM-2 scheduling data\n• Quiz score history\n• Study streak\n• Bookmarks\n\nThis cannot be undone.'
    )) return;

    PROGRESS_KEYS.forEach(k => localStorage.removeItem(k));
    location.reload();
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

init().catch(console.error);
