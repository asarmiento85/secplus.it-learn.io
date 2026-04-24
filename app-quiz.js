import { renderSidebar }                  from './sidebar.js';
import { touchStreak, saveQuizSession }   from './progress.js';
import { isLoggedIn, showLockOverlay }    from './auth.js';
import { scheduleSync }                   from './progress-sync.js';

// ── Domain weights for practice exam ──────────────────────────────────────
const EXAM_WEIGHTS = [
  { id: '1.0', name: 'Networking Concepts',    pct: 23, count: 21 },
  { id: '2.0', name: 'Network Implementation', pct: 20, count: 18 },
  { id: '3.0', name: 'Network Operations',     pct: 19, count: 17 },
  { id: '4.0', name: 'Network Security',       pct: 14, count: 13 },
  { id: '5.0', name: 'Network Troubleshooting',pct: 24, count: 21 },
];
const EXAM_TOTAL     = 90;
const EXAM_MINUTES   = 90;
const PASS_THRESHOLD = 0.72;

// ── State ──────────────────────────────────────────────────────────────────
let allQuestions = [];
let domains      = [];
let queue        = [];   // ordered questions for current session
let qIdx         = 0;
let answers      = {};   // { [question.id]: selectedIndex | null }
let mode         = 'quiz';  // 'quiz' | 'exam'
let lastSettings = {};
let timerInterval   = null;
let secondsLeft     = 0;
let sessionStartTime = 0;   // ms timestamp when session began

// ── Boot ───────────────────────────────────────────────────────────────────
async function init() {
  const [qData, outlineData] = await Promise.all([
    fetch('../data/questions.json').then(r => r.json()),
    fetch('../data/sy0-701-outline.json').then(r => r.json()),
  ]);

  allQuestions = qData.questions;
  domains      = outlineData.domains;

  // Auth gate — limit to first 50 questions for anonymous users
  if (!isLoggedIn()) {
    allQuestions = allQuestions.slice(0, 50);
    const wrap = document.querySelector('.qz-wrap') || document.querySelector('.main-content');
    if (wrap) {
      const banner = document.createElement('div');
      banner.style.cssText = 'background:rgba(0,255,136,.08);border:1px solid rgba(0,255,136,.25);border-radius:10px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.88rem;color:#e8eaf0;text-align:center;';
      banner.innerHTML = '🔒 You\'re previewing 50 of 1,500 questions. <a href="./login.html" style="color:#00ff88;font-weight:700;">Create a free account</a> to unlock all questions.';
      wrap.insertBefore(banner, wrap.firstChild);
    }
  }

  renderSidebar({
    navEl:        document.getElementById('sidebar-nav'),
    domains,
    showHomeLink: true,
    homeHref:     '../index.html',
    socials:      true,
    autoClose:    true,
  });

  buildDomainFilter();
  bindSetupEvents();
}

// ── Filters ────────────────────────────────────────────────────────────────
function buildDomainFilter() {
  const container = document.getElementById('qz-domain-pills');
  container.innerHTML = '';

  // "All Domains" pill — starts selected
  const allPill = document.createElement('label');
  allPill.className = 'qz-domain-pill selected';
  allPill.dataset.domain = 'all';
  allPill.innerHTML = `<input type="checkbox" value="all" checked> All Domains`;
  container.appendChild(allPill);

  domains.forEach(d => {
    const pill = document.createElement('label');
    pill.className = 'qz-domain-pill';
    pill.dataset.domain = d.id;
    pill.innerHTML = `<input type="checkbox" value="${d.id}"> ${d.id} – ${d.name}`;
    container.appendChild(pill);
  });
}

function getSelectedDomains() {
  const selected = [];
  document.querySelectorAll('#qz-domain-pills .qz-domain-pill').forEach(pill => {
    const cb = pill.querySelector('input[type="checkbox"]');
    if (cb.checked) selected.push(cb.value);
  });
  if (selected.includes('all') || selected.length === 0) return ['all'];
  return selected;
}

function restorePillState(domainIds) {
  document.querySelectorAll('#qz-domain-pills .qz-domain-pill').forEach(pill => {
    const cb    = pill.querySelector('input');
    const isAll = domainIds.includes('all');
    cb.checked  = isAll ? cb.value === 'all' : domainIds.includes(cb.value) && cb.value !== 'all';
    pill.classList.toggle('selected', cb.checked);
  });
}

function populateObjFilter(domainId) {
  const sel = document.getElementById('qz-obj-select');
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

// ── Queue building ─────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuizQueue(domainIds, objId, countVal, ordered) {
  let pool = allQuestions;
  if (!domainIds.includes('all')) pool = pool.filter(q => domainIds.includes(q.domain_id));
  if (objId !== 'all')           pool = pool.filter(q => q.objective_id === objId);

  pool = ordered ? [...pool] : shuffle(pool);

  const count = countVal === 'all' ? pool.length : Math.min(parseInt(countVal), pool.length);
  return pool.slice(0, count);
}

function buildExamQueue() {
  let result = [];
  EXAM_WEIGHTS.forEach(w => {
    const pool = shuffle(allQuestions.filter(q => q.domain_id === w.id));
    result = result.concat(pool.slice(0, w.count));
  });
  return shuffle(result);
}

// ── Start session ──────────────────────────────────────────────────────────
function startQuiz() {
  const domainIds = getSelectedDomains();
  const objId     = document.getElementById('qz-obj-select').value;
  const countVal  = document.getElementById('qz-count-select').value;
  const ordered   = document.getElementById('qz-order-select').value === 'sequential';

  lastSettings = { type: 'quiz', domainIds, objId, countVal, ordered };

  queue            = buildQuizQueue(domainIds, objId, countVal, ordered);
  mode             = 'quiz';
  answers          = {};
  qIdx             = 0;
  sessionStartTime = Date.now();

  if (queue.length === 0) {
    alert('No questions match the selected filters. Try different settings.');
    return;
  }

  touchStreak();
  stopTimer();
  showScreen('qz-active-screen');
  document.getElementById('qz-timer').classList.remove('show');
  renderQuestion();
}

function startExam() {
  lastSettings     = { type: 'exam' };
  queue            = buildExamQueue();
  mode             = 'exam';
  answers          = {};
  qIdx             = 0;
  sessionStartTime = Date.now();

  touchStreak();
  stopTimer();
  showScreen('qz-active-screen');
  document.getElementById('qz-timer').classList.add('show');
  startTimer(EXAM_MINUTES * 60);
  renderQuestion();
}

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  secondsLeft = seconds;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    secondsLeft--;
    updateTimerDisplay();
    if (secondsLeft <= 0) {
      stopTimer();
      finishSession(true);
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimerDisplay() {
  const el = document.getElementById('qz-timer');
  const m  = Math.floor(secondsLeft / 60);
  const s  = secondsLeft % 60;
  el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.classList.remove('warning', 'danger');
  if (secondsLeft <= 300) el.classList.add('danger');
  else if (secondsLeft <= 600) el.classList.add('warning');
}

// ── Render question ────────────────────────────────────────────────────────
function renderQuestion() {
  if (qIdx >= queue.length) {
    finishSession(false);
    return;
  }

  const q = queue[qIdx];

  // Top bar
  const total = queue.length;
  document.getElementById('qz-counter').textContent = `${qIdx + 1} / ${total}`;
  document.getElementById('qz-progress-fill').style.width = `${(qIdx / total) * 100}%`;

  // Live score (quiz mode)
  if (mode === 'quiz') {
    const answered = Object.keys(answers).length;
    const correct  = Object.values(answers).filter(a => a.correct).length;
    document.getElementById('qz-score-live').textContent =
      answered > 0 ? `${correct}/${answered} correct` : '';
  } else {
    const answered = Object.keys(answers).length;
    document.getElementById('qz-score-live').textContent =
      answered > 0 ? `${answered} answered` : '';
  }

  // Card content
  document.getElementById('qz-obj-tag').textContent   = q.objective_id;
  document.getElementById('qz-question-text').textContent = q.question;

  // Options
  const optContainer = document.getElementById('qz-options');
  optContainer.innerHTML = '';
  q.options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'qz-option';
    div.dataset.index = i;
    div.innerHTML = `
      <span class="qz-opt-letter">${'ABCD'[i]}</span>
      <span class="qz-opt-text">${opt}</span>`;
    div.addEventListener('click', () => selectOption(i));
    optContainer.appendChild(div);
  });

  // Reset UI
  document.getElementById('qz-explanation').className = 'qz-explanation';
  document.getElementById('qz-explanation').textContent = '';
  document.getElementById('btn-submit').disabled = true;
  document.getElementById('btn-submit').style.display = '';
  document.getElementById('btn-next-q').className = 'btn-next-q';
}

function selectOption(idx) {
  if (document.getElementById('btn-submit').style.display === 'none') return;

  document.querySelectorAll('.qz-option').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.qz-option[data-index="${idx}"]`).classList.add('selected');
  document.getElementById('btn-submit').disabled = false;
}

function submitAnswer() {
  const q        = queue[qIdx];
  const selected = document.querySelector('.qz-option.selected');
  if (!selected) return;

  const chosenIdx  = parseInt(selected.dataset.index);
  const isCorrect  = chosenIdx === q.correct;
  answers[q.id]    = { chosen: chosenIdx, correct: isCorrect };

  // Disable all options
  document.querySelectorAll('.qz-option').forEach(el => {
    el.classList.add('disabled');
    const i = parseInt(el.dataset.index);
    if (i === q.correct)  el.classList.add('correct');
    if (i === chosenIdx && !isCorrect) el.classList.add('wrong');
  });

  // Show explanation in quiz mode
  if (mode === 'quiz') {
    const expEl = document.getElementById('qz-explanation');
    expEl.innerHTML = `<strong>${isCorrect ? '✓ Correct!' : '✗ Incorrect.'}</strong> ${q.explanation}`;
    expEl.classList.add('show');
  }

  // Hide submit, show next
  document.getElementById('btn-submit').style.display = 'none';

  const isLast = qIdx >= queue.length - 1;
  const nextBtn = document.getElementById('btn-next-q');
  nextBtn.textContent = isLast ? 'Finish →' : 'Next →';
  nextBtn.classList.add('show');
}

function nextQuestion() {
  qIdx++;
  if (qIdx >= queue.length) {
    finishSession(false);
  } else {
    renderQuestion();
  }
}

// ── Finish / Results ───────────────────────────────────────────────────────
function finishSession(timedOut) {
  stopTimer();

  const total   = queue.length;
  const correct = Object.values(answers).filter(a => a.correct).length;
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0;
  const passed  = pct >= (PASS_THRESHOLD * 100);

  // ── Persist session to progress store ──
  const domainBreakdown = {};
  queue.forEach(q => {
    if (!domainBreakdown[q.domain_id]) domainBreakdown[q.domain_id] = { correct: 0, total: 0 };
    domainBreakdown[q.domain_id].total++;
    if (answers[q.id]?.correct) domainBreakdown[q.domain_id].correct++;
  });
  const durationSecs = Math.round((Date.now() - sessionStartTime) / 1000);
  saveQuizSession({ mode, score: correct, total, pct, domainBreakdown, durationSecs });
  scheduleSync();

  // Score ring
  const ring = document.getElementById('qz-score-ring');
  ring.className = `qz-score-ring ${passed ? 'pass' : 'fail'}`;
  document.getElementById('qz-score-pct').textContent = `${pct}%`;
  document.getElementById('qz-score-pct').style.color = passed ? '#2ecc71' : '#e74c3c';

  // Badge
  const badge = document.getElementById('qz-pass-badge');
  badge.textContent = passed ? 'PASS' : 'FAIL';
  badge.className = `qz-pass-badge ${passed ? 'pass' : 'fail'}`;

  // Meta
  const meta = timedOut ? `Time expired — ${correct} / ${total} correct` : `${correct} / ${total} correct`;
  document.getElementById('qz-results-meta').textContent = meta;

  // Domain breakdown
  buildDomainBreakdown(correct, total);

  // Missed questions
  buildMissedList();

  showScreen('qz-results-screen');
}

function buildDomainBreakdown(totalCorrect, totalQ) {
  const container = document.getElementById('qz-breakdown-rows');
  container.innerHTML = '';

  const domainStats = {};
  queue.forEach(q => {
    if (!domainStats[q.domain_id]) domainStats[q.domain_id] = { total: 0, correct: 0, name: '' };
    domainStats[q.domain_id].total++;
    if (answers[q.id]?.correct) domainStats[q.domain_id].correct++;
  });

  // Add domain names
  domains.forEach(d => {
    if (domainStats[d.id]) domainStats[d.id].name = `${d.id} – ${d.name}`;
  });

  Object.entries(domainStats).sort((a,b) => a[0].localeCompare(b[0])).forEach(([id, stats]) => {
    const pct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    const color = pct >= 72 ? '#2ecc71' : pct >= 50 ? '#e67e22' : '#e74c3c';
    container.innerHTML += `
      <div class="qz-breakdown-row">
        <span class="qz-breakdown-name">${stats.name}</span>
        <div class="qz-breakdown-bar-wrap">
          <div class="qz-breakdown-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="qz-breakdown-frac">${stats.correct}/${stats.total}</span>
      </div>`;
  });
}

function buildMissedList() {
  const section = document.getElementById('qz-missed-section');
  const list    = document.getElementById('qz-missed-list');
  list.innerHTML = '';

  const missed = queue.filter(q => answers[q.id] && !answers[q.id].correct);

  if (missed.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  missed.forEach(q => {
    const ans = answers[q.id];
    const yourOpt    = ans ? q.options[ans.chosen] : 'Not answered';
    const correctOpt = q.options[q.correct];
    list.innerHTML += `
      <div class="qz-missed-item">
        <div class="qz-missed-q"><strong>${q.objective_id}</strong> — ${q.question}</div>
        <div class="qz-missed-your">✗ Your answer: ${yourOpt}</div>
        <div class="qz-missed-correct">✓ Correct: ${correctOpt}</div>
        <div class="qz-missed-exp">${q.explanation}</div>
      </div>`;
  });
}

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.qz-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Event bindings ─────────────────────────────────────────────────────────
function bindSetupEvents() {
  // Mode tabs
  document.getElementById('tab-quiz').addEventListener('click', () => {
    document.getElementById('tab-quiz').classList.add('active');
    document.getElementById('tab-exam').classList.remove('active');
    document.getElementById('panel-quiz').classList.remove('hidden');
    document.getElementById('panel-exam').classList.add('hidden');
    mode = 'quiz';
  });
  document.getElementById('tab-exam').addEventListener('click', () => {
    document.getElementById('tab-exam').classList.add('active');
    document.getElementById('tab-quiz').classList.remove('active');
    document.getElementById('panel-exam').classList.remove('hidden');
    document.getElementById('panel-quiz').classList.add('hidden');
    mode = 'exam';
  });

  // Domain pill multi-select
  document.getElementById('qz-domain-pills').addEventListener('change', e => {
    const cb = e.target;
    if (!cb || cb.type !== 'checkbox') return;

    const pills  = [...document.querySelectorAll('#qz-domain-pills .qz-domain-pill')];
    const allCb  = document.querySelector('#qz-domain-pills input[value="all"]');
    const allPill = document.querySelector('#qz-domain-pills .qz-domain-pill[data-domain="all"]');

    if (cb.value === 'all') {
      // Selecting "All" → deselect every specific domain
      pills.forEach(p => {
        const c = p.querySelector('input');
        c.checked = c.value === 'all';
        p.classList.toggle('selected', c.value === 'all');
      });
    } else {
      // Selecting specific domain → uncheck "All"
      allCb.checked = false;
      allPill.classList.remove('selected');
      cb.closest('.qz-domain-pill').classList.toggle('selected', cb.checked);

      // If nothing checked, re-select "All"
      const anyChecked = pills.some(p => {
        const c = p.querySelector('input');
        return c.value !== 'all' && c.checked;
      });
      if (!anyChecked) { allCb.checked = true; allPill.classList.add('selected'); }
    }

    // Show/hide objective row: only meaningful when exactly 1 specific domain
    const selected = getSelectedDomains();
    const objRow   = document.getElementById('qz-obj-row');
    if (selected.length === 1 && selected[0] !== 'all') {
      populateObjFilter(selected[0]);
      objRow.style.display = '';
    } else {
      const objSel = document.getElementById('qz-obj-select');
      while (objSel.options.length > 1) objSel.remove(1);
      objSel.value = 'all';
      objRow.style.display = selected[0] === 'all' ? '' : 'none';
    }
  });

  // Start buttons
  document.getElementById('btn-start-quiz').addEventListener('click', startQuiz);
  document.getElementById('btn-start-exam').addEventListener('click', startExam);

  // Active question controls
  document.getElementById('btn-submit').addEventListener('click', submitAnswer);
  document.getElementById('btn-next-q').addEventListener('click', nextQuestion);

  // Results buttons
  document.getElementById('btn-retry').addEventListener('click', () => {
    if (lastSettings.type === 'exam') {
      startExam();
    } else {
      restorePillState(lastSettings.domainIds || ['all']);
      startQuiz();
    }
  });
  document.getElementById('btn-back-setup').addEventListener('click', () => {
    stopTimer();
    showScreen('qz-setup-screen');
  });
  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    window.print();
  });

  // Keyboard shortcuts during active quiz
  document.addEventListener('keydown', e => {
    if (!document.getElementById('qz-active-screen').classList.contains('active')) return;
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

    const keyMap = { '1': 0, 'a': 0, 'A': 0, '2': 1, 'b': 1, 'B': 1, '3': 2, 'c': 2, 'C': 2, '4': 3, 'd': 3, 'D': 3 };
    if (keyMap[e.key] !== undefined) {
      const opts = document.querySelectorAll('.qz-option:not(.disabled)');
      if (opts.length > 0) selectOption(keyMap[e.key]);
    }
    if (e.key === 'Enter') {
      const submitBtn = document.getElementById('btn-submit');
      const nextBtn   = document.getElementById('btn-next-q');
      if (!submitBtn.disabled && submitBtn.style.display !== 'none') submitAnswer();
      else if (nextBtn.classList.contains('show')) nextQuestion();
    }
  });
}

init().catch(console.error);
