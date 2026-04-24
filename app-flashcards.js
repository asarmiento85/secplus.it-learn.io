import { renderSidebar }                                       from './sidebar.js';
import { touchStreak, getSM2Card, updateSM2,
         getDueCount, getDueCardIds }                          from './progress.js';
import { isLoggedIn, showLockOverlay }                         from './auth.js';
import { scheduleSync }                                          from './progress-sync.js';

const STORAGE_KEY = 'fc-progress-v1';  // legacy binary known/review
const SM2_KEY     = 'fc-sm2-v1';       // SM-2 spaced-repetition store

// ── State ──────────────────────────────────────────────────────────────────
let allCards      = [];
let filtered      = [];
let domains       = [];
let idx           = 0;
let flipped       = false;
let shuffled      = false;
let progress      = {};   // { [card.id]: 'known' | 'review' }  (legacy binary)
let streakTouched = false;

// ── Boot ───────────────────────────────────────────────────────────────────
async function init() {
  // Auth gate — full flashcard deck requires a free account
  if (!isLoggedIn()) {
    const main = document.querySelector('.main-content') || document.querySelector('main');
    if (main) showLockOverlay(main, 'Flashcards');
    return;
  }

  const [fcData, outlineData] = await Promise.all([
    fetch('../data/flashcards.json').then(r => r.json()),
    fetch('../data/sy0-701-outline.json').then(r => r.json()),
  ]);

  allCards = fcData.flashcards;
  domains  = outlineData.domains;
  progress = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

  renderSidebar({
    navEl:        document.getElementById('sidebar-nav'),
    domains,
    showHomeLink: true,
    homeHref:     '../index.html',
    socials:      true,
    autoClose:    true,
  });

  buildDomainFilter();
  applyFilters();
  bindEvents();
}

// ── Filters ────────────────────────────────────────────────────────────────
function buildDomainFilter() {
  const sel = document.getElementById('fc-domain-select');
  domains.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.id} – ${d.name}`;
    sel.appendChild(opt);
  });
}

function applyFilters() {
  const domainVal = document.getElementById('fc-domain-select').value;
  const objVal    = document.getElementById('fc-obj-select').value;
  const modeVal   = document.getElementById('fc-mode-select').value;

  // Base pool: domain + objective filter
  let pool = allCards.filter(c => {
    if (domainVal !== 'all' && c.domain_id    !== domainVal) return false;
    if (objVal    !== 'all' && c.objective_id !== objVal)    return false;
    return true;
  });

  // Study-mode filter
  if (modeVal === 'review') {
    pool = pool.filter(c => progress[c.id] === 'review');
  } else if (modeVal === 'unseen') {
    pool = pool.filter(c => progress[c.id] === undefined);
  } else if (modeVal === 'due') {
    const dueSet = new Set(getDueCardIds(pool.map(c => c.id)));
    pool = pool.filter(c => dueSet.has(c.id));
  }

  filtered = pool;
  if (shuffled) shuffleArray(filtered);
  idx = 0;
  renderCard();
}

// ── Objective select (populated from domain) ────────────────────────────────
function populateObjFilter(domainId) {
  const sel = document.getElementById('fc-obj-select');
  while (sel.options.length > 1) sel.remove(1);
  if (domainId === 'all') return;
  const domain = domains.find(d => d.id === domainId);
  if (!domain) return;
  domain.objectives.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = `${o.id} – ${o.title}`;
    sel.appendChild(opt);
  });
}

// ── SM-2 Helpers ─────────────────────────────────────────────────────────
/** Pure simulation — mirrors updateSM2 math without persisting. */
function simulateSM2(card, quality) {
  const sm2 = getSM2Card(card.id);
  if (quality < 3) return { interval: 1 };
  let interval;
  if      (sm2.reps === 0) interval = 1;
  else if (sm2.reps === 1) interval = 6;
  else                     interval = Math.round(sm2.interval * sm2.ef);
  return { interval };
}

/** Friendly label: 1d, 6d, 2w, 3mo */
function formatInterval(days) {
  if (days <= 1)  return '1d';
  if (days < 14)  return `${days}d`;
  if (days < 60)  return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderCard() {
  const scene = document.getElementById('fc-scene');

  // Always reset flip + hide rating row on card change
  flipped = false;
  const ratingRow = document.getElementById('fc-rating-row');
  if (ratingRow) ratingRow.style.display = 'none';

  if (filtered.length === 0) {
    scene.innerHTML = `<div class="fc-empty">No cards match your current filters.<br>Try selecting a different domain or study mode.</div>`;
    updateStats();
    return;
  }

  // Rebuild card HTML if it was replaced by the empty-state message
  if (!document.getElementById('fc-card')) {
    scene.innerHTML = `
      <div class="fc-card" id="fc-card">
        <div class="fc-face fc-front">
          <div class="fc-label">Question</div>
          <div class="fc-text" id="fc-front-text"></div>
          <div class="fc-hint">Click card · or press <kbd>Space</kbd> to reveal answer</div>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-label">Answer</div>
          <div class="fc-text" id="fc-back-text"></div>
          <div class="fc-hint">Rate yourself after flipping · <kbd>1</kbd> Again · <kbd>4</kbd> Good · <kbd>5</kbd> Easy</div>
        </div>
        <span class="fc-obj-tag" id="fc-obj-tag"></span>
      </div>`;
    // fc-scene listener (bound once in bindEvents) still works — no rebind needed
  } else {
    document.getElementById('fc-card').classList.remove('flipped');
  }

  const current = filtered[idx];
  document.getElementById('fc-front-text').textContent = current.front;
  document.getElementById('fc-back-text').textContent  = current.back;
  document.getElementById('fc-obj-tag').textContent    = current.objective_id;

  // Legacy color-outline based on binary known/review state
  const cardEl = document.getElementById('fc-card');
  cardEl.style.outline = 'none';
  if (progress[current.id] === 'known')  cardEl.style.outline = '2px solid #2ecc71';
  if (progress[current.id] === 'review') cardEl.style.outline = '2px solid #e67e22';

  updateStats();
}

function updateStats() {
  const total   = filtered.length;
  const knownCt = filtered.filter(c => progress[c.id] === 'known').length;
  const revCt   = filtered.filter(c => progress[c.id] === 'review').length;
  const dueCt   = getDueCount(allCards.map(c => c.id));

  document.getElementById('fc-counter').textContent       = total ? `${idx + 1} / ${total}` : '0 / 0';
  document.getElementById('fc-progress-fill').style.width = total ? `${((idx + 1) / total) * 100}%` : '0%';
  document.getElementById('fc-known-badge').textContent   = `✓ ${knownCt}`;
  document.getElementById('fc-review-badge').textContent  = `↻ ${revCt}`;
  document.getElementById('fc-due-badge').textContent     = `⏰ ${dueCt} due`;
}

// ── Navigation ─────────────────────────────────────────────────────────────
function next() { if (idx < filtered.length - 1) { idx++; renderCard(); } }
function prev() { if (idx > 0)                   { idx--; renderCard(); } }

function flip() {
  if (!document.getElementById('fc-card')) return;
  flipped = !flipped;
  document.getElementById('fc-card').classList.toggle('flipped', flipped);

  const ratingRow = document.getElementById('fc-rating-row');
  if (!ratingRow) return;
  ratingRow.style.display = flipped ? 'flex' : 'none';

  // Pre-fill projected intervals when revealing the answer
  if (flipped && filtered.length) {
    const current = filtered[idx];
    [
      { quality: 1, suffix: 'again' },
      { quality: 3, suffix: 'hard'  },
      { quality: 4, suffix: 'good'  },
      { quality: 5, suffix: 'easy'  },
    ].forEach(({ quality, suffix }) => {
      const span = document.getElementById(`ri-${suffix}`);
      if (span) {
        const { interval } = simulateSM2(current, quality);
        span.textContent = ` · ${formatInterval(interval)}`;
      }
    });
  }
}

// ── SM-2 Rating ─────────────────────────────────────────────────────────────
function rateSM2(quality) {
  if (!filtered.length) return;

  // Touch streak on first rating action this session
  if (!streakTouched) { touchStreak(); streakTouched = true; }

  const current = filtered[idx];

  // Legacy binary write (keeps dashboard getFlashcardStats() accurate)
  progress[current.id] = quality >= 4 ? 'known' : 'review';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));

  // SM-2 scheduling
  updateSM2(current.id, quality);
  scheduleSync();

  // Brief visual feedback
  const colours = { 1: '#e74c3c', 3: '#e67e22', 4: '#2ecc71', 5: '#06b6d4' };
  const cardEl  = document.getElementById('fc-card');
  if (cardEl) cardEl.style.outline = `2px solid ${colours[quality]}`;

  // Advance after short pause
  setTimeout(() => {
    if (idx < filtered.length - 1) { idx++; renderCard(); }
    else                            { renderCard(); }
  }, 350);
}

// ── Shuffle ────────────────────────────────────────────────────────────────
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Event Bindings ──────────────────────────────────────────────────────────
function bindEvents() {
  // Card click → flip (event on scene, survives innerHTML replacements)
  document.getElementById('fc-scene').addEventListener('click', e => {
    if (e.target.closest('.fc-scene')) flip();
  });

  document.getElementById('fc-next-btn').addEventListener('click', next);
  document.getElementById('fc-prev-btn').addEventListener('click', prev);
  document.getElementById('fc-flip-btn').addEventListener('click', flip);

  // SM-2 rating buttons
  document.getElementById('fc-btn-again').addEventListener('click', () => rateSM2(1));
  document.getElementById('fc-btn-hard') .addEventListener('click', () => rateSM2(3));
  document.getElementById('fc-btn-good') .addEventListener('click', () => rateSM2(4));
  document.getElementById('fc-btn-easy') .addEventListener('click', () => rateSM2(5));

  document.getElementById('fc-shuffle-btn').addEventListener('click', () => {
    shuffled = !shuffled;
    document.getElementById('fc-shuffle-btn').classList.toggle('active', shuffled);
    applyFilters();
  });

  document.getElementById('fc-reset-btn').addEventListener('click', () => {
    if (confirm('Reset all flashcard progress?')) {
      progress = {};
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SM2_KEY);
      renderCard();
      updateStats();
    }
  });

  document.getElementById('fc-domain-select').addEventListener('change', e => {
    populateObjFilter(e.target.value);
    document.getElementById('fc-obj-select').value = 'all';
    applyFilters();
  });

  document.getElementById('fc-obj-select') .addEventListener('change', applyFilters);
  document.getElementById('fc-mode-select').addEventListener('change', applyFilters);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case ' ':
      case 'f':
      case 'F':
        e.preventDefault(); flip(); break;
      case 'ArrowRight':
      case 'l':
      case 'L':
        e.preventDefault(); next(); break;
      case 'ArrowLeft':
      case 'h':
      case 'H':
        e.preventDefault(); prev(); break;
      case '1': rateSM2(1); break;
      case '3': rateSM2(3); break;
      case '4': rateSM2(4); break;
      case '5': rateSM2(5); break;
      case 's':
      case 'S':
        document.getElementById('fc-shuffle-btn').click(); break;
    }
  });
}

init().catch(console.error);
