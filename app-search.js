// app-search.js (ROOT)
// Global command-palette search overlay.
// Trigger: sidebar 🔍 button OR Ctrl/Cmd+K from any page.
// Lazy-loads all 3 JSON data files on first open.

// ── Path helper ──────────────────────────────────────────────────────────────
function dataPath(file) {
  // Works from root (index.html) and from /pages/*.html
  const inPages = location.pathname.includes('/pages/');
  return inPages ? `../data/${file}` : `./data/${file}`;
}

function pagesPath(file) {
  const inPages = location.pathname.includes('/pages/');
  return inPages ? `./${file}` : `./pages/${file}`;
}

// ── State ────────────────────────────────────────────────────────────────────
let searchIndex = null;     // built once; null = not loaded yet
let isLoading   = false;
let activeIdx   = -1;

// ── Public API ───────────────────────────────────────────────────────────────
export function initSearch() {
  if (document.getElementById('search-overlay')) return; // already inited

  // Build overlay DOM
  const overlay = document.createElement('div');
  overlay.id        = 'search-overlay';
  overlay.className = 'search-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Search');
  overlay.innerHTML = `
    <div class="search-box" role="search">
      <div class="search-input-row">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <input
          class="search-input"
          id="search-input"
          type="search"
          placeholder="Search objectives, flashcards, questions…"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
        />
        <span class="search-esc-hint">ESC</span>
      </div>
      <div class="search-results" id="search-results" role="listbox">
        <div class="search-empty">Start typing to search…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Wire events
  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  // Close on backdrop click (not on .search-box click)
  overlay.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) closeSearch();
  });

  // Input → live search
  input.addEventListener('input', () => renderResults(input.value.trim()));

  // Keyboard: arrow nav + enter + esc
  input.addEventListener('keydown', e => {
    const items = results.querySelectorAll('.search-result');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      highlightActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      highlightActive(items);
    } else if (e.key === 'Enter') {
      const active = results.querySelector('.search-result.active');
      if (active) active.click();
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  // Global Ctrl+K / Cmd+K shortcut
  if (!window.__searchKbBound) {
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
      }
    });
    window.__searchKbBound = true;
  }
}

export function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  const input = document.getElementById('search-input');
  input.value = '';
  activeIdx = -1;
  document.getElementById('search-results').innerHTML =
    '<div class="search-empty">Start typing to search…</div>';

  // Delay focus so drawer animation doesn't steal it
  setTimeout(() => input.focus(), 60);

  // Lazy-load index
  if (!searchIndex && !isLoading) buildIndex();
}

export function closeSearch() {
  const overlay = document.getElementById('search-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Index builder ─────────────────────────────────────────────────────────────
async function buildIndex() {
  isLoading = true;
  const resultsEl = document.getElementById('search-results');
  if (resultsEl) resultsEl.innerHTML = '<div class="search-empty">Loading…</div>';

  try {
    const [outlineRes, fcRes, qRes] = await Promise.all([
      fetch(dataPath('sy0-701-outline.json'), { cache: 'force-cache' }),
      fetch(dataPath('flashcards.json'),      { cache: 'force-cache' }),
      fetch(dataPath('questions.json'),       { cache: 'force-cache' }),
    ]);

    const outline = await outlineRes.json();
    const fcData  = await fcRes.json();
    const qData   = await qRes.json();

    const index = [];

    // Objectives
    (outline.domains || []).forEach(d => {
      (d.objectives || []).forEach(o => {
        const conceptsText = (o.concepts || [])
          .map(c => (typeof c === 'string' ? c : JSON.stringify(c)))
          .join(' ');
        index.push({
          type:    'obj',
          text:    `${o.id} — ${o.title}`,
          subtext: o.title + (conceptsText ? ' · ' + conceptsText.slice(0, 120) : ''),
          search:  `${o.id} ${o.title} ${conceptsText}`.toLowerCase(),
          href:    pagesPath('objective.html') + '#' + encodeURIComponent(o.id),
        });
      });
    });

    // Flashcards
    (fcData.flashcards || []).forEach(c => {
      index.push({
        type:    'card',
        text:    c.front,
        subtext: c.back ? c.back.slice(0, 130) : '',
        search:  `${c.front} ${c.back || ''} ${c.objective_id || ''}`.toLowerCase(),
        href:    pagesPath('flashcards.html'),
      });
    });

    // Questions
    (qData.questions || []).forEach(q => {
      index.push({
        type:    'q',
        text:    q.question,
        subtext: `Objective ${q.objective_id} · ${(q.options || []).join(' | ').slice(0, 100)}`,
        search:  `${q.question} ${(q.options || []).join(' ')} ${q.objective_id || ''}`.toLowerCase(),
        href:    pagesPath('quiz.html'),
      });
    });

    searchIndex = index;

    // If user already typed something, run search now
    const input = document.getElementById('search-input');
    if (input && input.value.trim()) renderResults(input.value.trim());
    else if (resultsEl) resultsEl.innerHTML = '<div class="search-empty">Start typing to search…</div>';

  } catch (err) {
    console.error('[search] Failed to build index:', err);
    if (resultsEl) resultsEl.innerHTML = '<div class="search-empty">Could not load search data.</div>';
  } finally {
    isLoading = false;
  }
}

// ── Renderer ──────────────────────────────────────────────────────────────────
function renderResults(query) {
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  activeIdx = -1;

  if (!query) {
    resultsEl.innerHTML = '<div class="search-empty">Start typing to search…</div>';
    return;
  }

  if (!searchIndex) {
    resultsEl.innerHTML = '<div class="search-empty">Loading…</div>';
    return;
  }

  const q = query.toLowerCase();
  const matched = searchIndex.filter(item => item.search.includes(q));

  if (!matched.length) {
    resultsEl.innerHTML = `<div class="search-empty">No results for "<strong>${escapeHtml(query)}</strong>"</div>`;
    return;
  }

  // Group and cap at 8 per type
  const groups = { obj: [], card: [], q: [] };
  matched.forEach(item => {
    if (groups[item.type].length < 8) groups[item.type].push(item);
  });

  const labels = { obj: 'Objectives', card: 'Flashcards', q: 'Questions' };
  const badgeClass = { obj: 'badge-obj', card: 'badge-card', q: 'badge-q' };
  const badgeLabel = { obj: 'Obj', card: 'Card', q: 'Q' };

  let html = '';
  ['obj', 'card', 'q'].forEach(type => {
    const items = groups[type];
    if (!items.length) return;
    html += `<div class="search-group-label">${labels[type]}</div>`;
    items.forEach(item => {
      html += `
        <div class="search-result" role="option" data-href="${escapeHtml(item.href)}" tabindex="-1">
          <span class="search-result-badge ${badgeClass[type]}">${badgeLabel[type]}</span>
          <div class="search-result-text">
            <div class="search-result-main">${escapeHtml(item.text)}</div>
            ${item.subtext ? `<div class="search-result-sub">${escapeHtml(item.subtext)}</div>` : ''}
          </div>
        </div>
      `;
    });
  });

  resultsEl.innerHTML = html;

  // Bind clicks
  resultsEl.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      location.href = el.dataset.href;
      closeSearch();
    });
  });
}

function highlightActive(items) {
  items.forEach((el, i) => {
    el.classList.toggle('active', i === activeIdx);
    if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
