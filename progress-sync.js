// progress-sync.js — Sync localStorage progress to cloud when authenticated
import { isLoggedIn, getToken } from './auth.js';

// TODO: Replace with secplus API Gateway URL after Lambda is created
const API_URL = 'https://PLACEHOLDER.execute-api.us-east-1.amazonaws.com/prod';

const SYNC_KEYS = [
  'fc-progress-v1',
  'fc-sm2-v1',
  'quiz-history-v1',
  'study-streak-v1',
  'objectives-visited-v1',
  'bookmarks-v1',
];

export function collectProgress() {
  const data = {};
  for (const key of SYNC_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      try { data[key] = JSON.parse(raw); }
      catch { data[key] = raw; }
    }
  }
  return data;
}

export async function pushProgress() {
  if (!isLoggedIn()) return;
  const token = await getToken();
  if (!token) return;
  const payload = collectProgress();
  if (Object.keys(payload).length === 0) return;
  try {
    const res = await fetch(`${API_URL}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ data: payload, updatedAt: Date.now() }),
    });
    if (!res.ok) console.warn('[Sync] Push failed:', res.status);
  } catch (err) {
    console.warn('[Sync] Push error:', err.message);
  }
}

export async function pullProgress() {
  if (!isLoggedIn()) return;
  const token = await getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_URL}/progress`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) { if (res.status === 404) return; return; }
    const result = await res.json();
    const serverData = result.data || {};
    for (const key of SYNC_KEYS) {
      if (key in serverData) {
        const v = serverData[key];
        if (v !== null && v !== undefined) {
          localStorage.setItem(key, typeof v === 'string' ? v : JSON.stringify(v));
        }
      }
    }
  } catch (err) {
    console.warn('[Sync] Pull error:', err.message);
  }
}

export async function syncOnLogin() {
  await pullProgress();
  await pushProgress();
}

let syncTimer = null;
const DEBOUNCE_MS = 5000;

export function scheduleSync() {
  if (!isLoggedIn()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; pushProgress(); }, DEBOUNCE_MS);
}
