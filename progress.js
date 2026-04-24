// progress.js — shared progress tracking utility (localStorage only)

const KEYS = {
  FC:         'fc-progress-v1',       // flashcard known/review state (legacy binary)
  FC_SM2:     'fc-sm2-v1',            // flashcard SM-2 spaced repetition data
  QUIZ:       'quiz-history-v1',      // array of quiz session results
  STREAK:     'study-streak-v1',      // streak + total session count
  OBJECTIVES: 'objectives-visited-v1' // { [objectiveId]: timestamp }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Study streak ───────────────────────────────────────────────────────────
// Call once per study session (first card marked, or quiz started).
export function touchStreak() {
  const today  = todayStr();
  const raw    = localStorage.getItem(KEYS.STREAK);
  const data   = raw ? JSON.parse(raw) : { lastDate: null, streak: 0, totalSessions: 0 };

  data.totalSessions = (data.totalSessions || 0) + 1;

  if (data.lastDate === today) {
    // Already counted today — just bump session count, leave streak alone
  } else if (data.lastDate === yesterdayStr()) {
    data.streak++;
    data.lastDate = today;
  } else {
    // Streak broken (or first session ever)
    data.streak   = 1;
    data.lastDate = today;
  }

  localStorage.setItem(KEYS.STREAK, JSON.stringify(data));
  return data;
}

export function getStreak() {
  const raw = localStorage.getItem(KEYS.STREAK);
  if (!raw) return { streak: 0, totalSessions: 0, lastDate: null };
  const data = JSON.parse(raw);
  // Streak resets if last session wasn't today or yesterday
  if (data.lastDate !== todayStr() && data.lastDate !== yesterdayStr()) {
    data.streak = 0;
  }
  return data;
}

// ── Quiz sessions ──────────────────────────────────────────────────────────
/**
 * session shape:
 * { mode: 'quiz'|'exam', score: N, total: N, pct: N,
 *   domainBreakdown: { [domainId]: { correct: N, total: N } },
 *   durationSecs: N }
 */
export function saveQuizSession(session) {
  const history = getQuizHistory();
  history.push({
    id:              Date.now(),
    date:            new Date().toISOString(),
    mode:            session.mode,
    score:           session.score,
    total:           session.total,
    pct:             session.pct,
    domainBreakdown: session.domainBreakdown || {},
    durationSecs:    session.durationSecs    || 0,
  });
  // Keep last 100 sessions
  if (history.length > 100) history.splice(0, history.length - 100);
  localStorage.setItem(KEYS.QUIZ, JSON.stringify(history));
}

export function getQuizHistory() {
  const raw = localStorage.getItem(KEYS.QUIZ);
  return raw ? JSON.parse(raw) : [];
}

// ── Flashcard stats ────────────────────────────────────────────────────────
export function getFlashcardStats(allCards) {
  const prog   = JSON.parse(localStorage.getItem(KEYS.FC) || '{}');
  const total  = allCards.length;
  const known  = allCards.filter(c => prog[c.id] === 'known').length;
  const review = allCards.filter(c => prog[c.id] === 'review').length;
  const unseen = total - known - review;

  // Per-domain breakdown
  const byDomain = {};
  allCards.forEach(c => {
    if (!byDomain[c.domain_id]) byDomain[c.domain_id] = { total: 0, known: 0, review: 0, unseen: 0 };
    byDomain[c.domain_id].total++;
    const state = prog[c.id];
    if (state === 'known')  byDomain[c.domain_id].known++;
    else if (state === 'review') byDomain[c.domain_id].review++;
    else                         byDomain[c.domain_id].unseen++;
  });

  return { total, known, review, unseen, byDomain };
}

// ── Objectives visited ─────────────────────────────────────────────────────
export function markObjectiveVisited(id) {
  const visited = getVisitedObjectives();
  if (!visited[id]) {
    visited[id] = Date.now();
    localStorage.setItem(KEYS.OBJECTIVES, JSON.stringify(visited));
  }
}

export function getVisitedObjectives() {
  const raw = localStorage.getItem(KEYS.OBJECTIVES);
  return raw ? JSON.parse(raw) : {};
}

// ── Bookmarks ───────────────────────────────────────────────────────────────
export function getBookmarks() {
  const raw = localStorage.getItem('bookmarks-v1');
  return raw ? JSON.parse(raw) : [];
}

export function toggleBookmark(id) {
  const bms = getBookmarks();
  const idx = bms.indexOf(id);
  if (idx === -1) bms.push(id);
  else bms.splice(idx, 1);
  localStorage.setItem('bookmarks-v1', JSON.stringify(bms));
  return bms.includes(id); // true = now bookmarked
}

export function isBookmarked(id) {
  return getBookmarks().includes(id);
}

// ── SM-2 Spaced Repetition ──────────────────────────────────────────────────
// quality ratings: 1=Again, 3=Hard, 4=Good, 5=Easy

function defaultSM2() {
  return { ef: 2.5, interval: 0, reps: 0, due: todayStr() };
}

/** Return SM-2 state for a card (defaults if unseen). */
export function getSM2Card(id) {
  const store = JSON.parse(localStorage.getItem(KEYS.FC_SM2) || '{}');
  return store[id] ? { ...store[id] } : defaultSM2();
}

/**
 * Apply SM-2 algorithm, persist, and return updated card state.
 * quality: 1=Again, 3=Hard, 4=Good, 5=Easy
 */
export function updateSM2(id, quality) {
  const store = JSON.parse(localStorage.getItem(KEYS.FC_SM2) || '{}');
  const card  = store[id] ? { ...store[id] } : defaultSM2();

  if (quality < 3) {
    card.reps     = 0;
    card.interval = 1;
  } else {
    if      (card.reps === 0) card.interval = 1;
    else if (card.reps === 1) card.interval = 6;
    else                      card.interval = Math.round(card.interval * card.ef);
    card.reps++;
  }

  // Update easiness factor — floor at 1.3
  card.ef = Math.max(1.3, card.ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

  // Next due date
  const due = new Date();
  due.setDate(due.getDate() + card.interval);
  card.due = due.toISOString().slice(0, 10);

  store[id] = card;
  localStorage.setItem(KEYS.FC_SM2, JSON.stringify(store));
  return { ...card };
}

/** Count cards (from supplied id array) due today or overdue. */
export function getDueCount(cardIds) {
  const store = JSON.parse(localStorage.getItem(KEYS.FC_SM2) || '{}');
  const today = todayStr();
  return cardIds.filter(id => !store[id] || store[id].due <= today).length;
}

/** Return subset of cardIds that are due today or overdue. */
export function getDueCardIds(cardIds) {
  const store = JSON.parse(localStorage.getItem(KEYS.FC_SM2) || '{}');
  const today = todayStr();
  return cardIds.filter(id => !store[id] || store[id].due <= today);
}
