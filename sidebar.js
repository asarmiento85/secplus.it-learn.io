// sidebar.js (ROOT)
// Sidebar renderer + reliable accordion + MOBILE HAMBURGER DRAWER (no HTML changes needed)

import { initSearch, openSearch } from './app-search.js';
import { getBookmarks } from './progress.js';
import { isLoggedIn, getUser, logout } from './auth.js';

const ADMIN_EMAIL = 'asarmiento85@live.com';

// ── PWA: Register service worker ──────────────────────────────────────────────
(function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // Resolve SW path relative to site root regardless of current page depth
  const swPath = location.pathname.includes('/pages/')
    ? '../sw.js'
    : './sw.js';
  // scope must cover the whole site (always root)
  const swScope = location.pathname.includes('/pages/')
    ? '../'
    : './';
  navigator.serviceWorker.register(swPath, { scope: swScope })
    .then(reg => console.log('[SW] Registered, scope:', reg.scope))
    .catch(err => console.warn('[SW] Registration failed:', err));
})();

// ── Theme helpers ─────────────────────────────────────────────────────────────
function applyTheme() {
  const stored = localStorage.getItem('theme-v1') || 'dark';
  if (stored === 'light') {
    document.documentElement.classList.add('light-mode');
  } else {
    document.documentElement.classList.remove('light-mode');
  }
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = stored === 'light' ? '☀️' : '🌙';
}

function toggleTheme() {
  const isLight = document.documentElement.classList.contains('light-mode');
  const next = isLight ? 'dark' : 'light';
  localStorage.setItem('theme-v1', next);
  applyTheme();
}

export function renderSidebar({
  navEl,
  domains,
  currentDomainId = null,
  showHomeLink = false,
  homeHref = null,
  socials = true,
  autoClose = true
}) {
  if (!navEl) throw new Error("renderSidebar: navEl is required");
  if (!Array.isArray(domains)) throw new Error("renderSidebar: domains must be an array");

  // Detect where we are so links work everywhere
  const inPages = location.pathname.includes("/pages/");
  const base = inPages ? ".." : ".";
  const pagesBase = `${base}/pages`;
  const homeLink = homeHref ?? `${base}/index.html`;

  const bookmarks = getBookmarks();

  navEl.innerHTML = `
    ${showHomeLink ? `<a class="home-btn" href="${homeLink}">← Back to Home</a>` : ""}

    <button class="search-trigger" type="button" id="sidebar-search-btn">
      🔍 Search…
      <kbd>${navigator.platform?.startsWith('Mac') ? '⌘K' : 'Ctrl+K'}</kbd>
    </button>

    <div class="sidebar-controls">
      <button class="sidebtn" type="button" data-action="expand">Expand all</button>
      <button class="sidebtn" type="button" data-action="collapse">Collapse</button>
      <button class="sidebtn" type="button" data-action="theme" id="theme-btn">🌙</button>
    </div>

    <div class="study-links">
      <a class="flashcards-link"  href="${pagesBase}/flashcards.html">⬡ Flashcards</a>
      <a class="quiz-link"        href="${pagesBase}/quiz.html">✎ Practice Quiz</a>
      <a class="dashboard-link"   href="${pagesBase}/dashboard.html">📊 My Progress</a>
      <a class="tools-link"       href="${pagesBase}/tools.html">⚙ Toolbox</a>
    </div>

    <div class="navTree">
      ${domains.map(d => navGroupHtml(d, currentDomainId, pagesBase, bookmarks)).join("")}
    </div>

    ${authHtml(inPages)}

    ${socials ? socialsHtml() : ""}
  `;

  // ---- Apply stored theme + init search (global, once per page) ----
  applyTheme();
  initSearch();

  // Wire up search trigger button
  const searchBtn = document.getElementById('sidebar-search-btn');
  if (searchBtn) searchBtn.addEventListener('click', () => openSearch());

  // Wire up logout button
  const logoutBtn = document.getElementById('sidebar-logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    logout();
    window.location.href = inPages ? '../index.html' : './index.html';
  });

  // ---- Mobile hamburger drawer (global, safe) ----
  ensureMobileDrawer(navEl);

  // ---- Cleanly (re)bind click handler every render ----
  if (navEl.__sidebarHandler) navEl.removeEventListener("click", navEl.__sidebarHandler);
  const handler = (e) => onSidebarClick(e, { navEl, autoClose });
  navEl.addEventListener("click", handler);
  navEl.__sidebarHandler = handler;

  // Ensure current domain starts open
  if (currentDomainId) {
    if (autoClose) closeAllExcept(navEl, currentDomainId);
    else openOne(navEl, currentDomainId);
  }
}

function onSidebarClick(e, { navEl, autoClose }) {
  // Expand/Collapse/Theme buttons
  const actionBtn = e.target.closest("button[data-action]");
  if (actionBtn && navEl.contains(actionBtn)) {
    const action = actionBtn.dataset.action;
    if (action === "expand")  setAll(navEl, true);
    if (action === "collapse") setAll(navEl, false);
    if (action === "theme")   toggleTheme();
    return;
  }

  // Domain toggle
  const toggle = e.target.closest("button.nav-toggle");
  if (!toggle || !navEl.contains(toggle)) return;

  const domainId = toggle.getAttribute("data-domain");
  if (!domainId) return;

  const group = toggle.closest(".nav-group");
  const subnav = group?.querySelector(".subnav");
  const isOpen = toggle.getAttribute("aria-expanded") === "true";

  if (isOpen) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove("active");
    if (subnav) subnav.hidden = true;
    return;
  }

  if (autoClose) closeAllExcept(navEl, domainId);
  else openOne(navEl, domainId);

  toggle.setAttribute("aria-expanded", "true");
  toggle.classList.add("active");
  if (subnav) subnav.hidden = false;
}

function closeAllExcept(navEl, domainIdToKeep) {
  navEl.querySelectorAll(".nav-group").forEach(group => {
    const t = group.querySelector(".nav-toggle");
    const s = group.querySelector(".subnav");
    const id = t?.getAttribute("data-domain");
    const open = id === domainIdToKeep;

    if (t) {
      t.setAttribute("aria-expanded", String(open));
      t.classList.toggle("active", open);
    }
    if (s) s.hidden = !open;
  });
}

function openOne(navEl, domainId) {
  navEl.querySelectorAll(".nav-group").forEach(group => {
    const t = group.querySelector(".nav-toggle");
    const s = group.querySelector(".subnav");
    if (t?.getAttribute("data-domain") === domainId) {
      t.setAttribute("aria-expanded", "true");
      t.classList.add("active");
      if (s) s.hidden = false;
    }
  });
}

function setAll(navEl, open) {
  navEl.querySelectorAll(".nav-group").forEach(group => {
    const t = group.querySelector(".nav-toggle");
    const s = group.querySelector(".subnav");
    if (t) {
      t.setAttribute("aria-expanded", String(open));
      t.classList.toggle("active", open);
    }
    if (s) s.hidden = !open;
  });
}

/* -------------------- MOBILE DRAWER (Hamburger) -------------------- */

function ensureMobileDrawer(navEl) {
  const sidebar = navEl.closest(".sidebar");
  if (!sidebar) return;

  // Create floating hamburger button once
  if (!document.getElementById("sidebarFab")) {
    const btn = document.createElement("button");
    btn.id = "sidebarFab";
    btn.className = "hamburger-fab";
    btn.type = "button";
    btn.setAttribute("aria-label", "Open menu");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = "☰";
    document.body.appendChild(btn);

    btn.addEventListener("click", () => toggleDrawer(true));
  }

  // Create backdrop once
  if (!document.getElementById("sidebarBackdrop")) {
    const backdrop = document.createElement("div");
    backdrop.id = "sidebarBackdrop";
    backdrop.className = "sidebar-backdrop";
    backdrop.addEventListener("click", () => toggleDrawer(false));
    document.body.appendChild(backdrop);
  }

  // Close drawer on navigation link click (mobile only)
  if (!navEl.__closeOnLinkBound) {
    navEl.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (!a) return;
      if (isMobile()) toggleDrawer(false);
    });
    navEl.__closeOnLinkBound = true;
  }

  // ESC closes drawer
  if (!window.__drawerEscBound) {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") toggleDrawer(false);
    });
    window.__drawerEscBound = true;
  }

  // Keep aria in sync on resize (if you go back to desktop, ensure closed)
  if (!window.__drawerResizeBound) {
    window.addEventListener("resize", () => {
      if (!isMobile()) toggleDrawer(false);
    });
    window.__drawerResizeBound = true;
  }
}

function toggleDrawer(open) {
  const body = document.body;
  const btn = document.getElementById("sidebarFab");
  if (!btn) return;

  if (open) body.classList.add("sidebar-open");
  else body.classList.remove("sidebar-open");

  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
}

/* -------------------- HTML BUILDERS -------------------- */

function navGroupHtml(domain, currentDomainId, pagesBase, bookmarks = []) {
  const open = domain.id === currentDomainId;
  const fileId = String(domain.id).replace(".", "");
  const domainHref = `${pagesBase}/${fileId}-${slug(domain.name)}.html`;

  return `
    <div class="nav-group">
      <button class="nav-toggle ${open ? "active" : ""}" type="button"
        data-domain="${escapeAttr(domain.id)}"
        aria-expanded="${open ? "true" : "false"}">
        <span class="left">
          <span class="title">${escapeHtml(domain.id)} ${escapeHtml(domain.name)}</span>
          <span class="meta">${(domain.objectives || []).length} objectives</span>
        </span>
        <span class="chev">⌄</span>
      </button>

      <div class="subnav" ${open ? "" : "hidden"}>
        <a href="${domainHref}">
          <span class="subid">Open</span> Domain overview
        </a>

        ${(domain.objectives || []).map(o => {
          const starred = bookmarks.includes(o.id);
          return `
            <a href="${pagesBase}/objective.html#${encodeURIComponent(o.id)}">
              <span class="subid">${escapeHtml(o.id)}</span>${escapeHtml(o.title)}${starred ? '<span class="bm-star" aria-label="bookmarked">★</span>' : ""}
            </a>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function authHtml(inPages) {
  const loginPath = inPages ? './login.html' : './pages/login.html';
  const adminPath = inPages ? './admin.html'  : './pages/admin.html';

  if (!isLoggedIn()) {
    return `
      <div class="sidebar-auth">
        <a class="sidebar-signin-btn" href="${loginPath}">🔒 Sign In / Register</a>
      </div>`;
  }

  const user    = getUser();
  const email   = user?.email || '';
  const isAdmin = email === ADMIN_EMAIL;

  return `
    <div class="sidebar-auth sidebar-auth--in">
      <div class="sidebar-user-email" title="${escapeAttr(email)}">${escapeHtml(email)}</div>
      ${isAdmin ? `<a class="sidebar-admin-btn" href="${adminPath}">⚙ Admin Dashboard</a>` : ''}
      <button class="sidebar-logout-btn" type="button" id="sidebar-logout-btn">Log Out</button>
    </div>`;
}

function socialsHtml() {
  return `
    <h4 class="social-title">Social</h4>
    <div class="social-icons">
      <a href="https://x.com/it_learn_io" target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.654l-5.214-6.817-5.963 6.817H1.688l7.73-8.835L1.25 2.25h6.823l4.713 6.231 5.458-6.231z"/>
        </svg>
      </a>
      <a href="https://www.instagram.com/it_learn.io/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 5.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5zm0 7.4A2.9 2.9 0 1 1 14.9 12 2.9 2.9 0 0 1 12 14.9zM17.8 6.2a1.1 1.1 0 1 1-1.1-1.1 1.1 1.1 0 0 1 1.1 1.1z"/>
        </svg>
      </a>
      <a href="https://www.youtube.com/@it-learn-io" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.5 2.8 12 2.8 12 2.8s-4.5 0-6.8.2c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.8 9.2.8 11.5v2.1c0 2.3.2 4.5.2 4.5s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.6 22.2 12 22.2 12 22.2s4.5 0 6.8-.3c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.2-2.2.2-4.5v-2.1C23.2 9.2 23 7 23 7zm-13.5 8.5V8.5l8 3.5-8 3.5z"/>
        </svg>
      </a>
      <a href="https://www.linkedin.com/company/it-learn-io/?viewAsMember=true" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0-.02-5zM3 9h4v12H3zM9 9h3.8v1.7h.1a4.2 4.2 0 0 1 3.8-2.1c4.1 0 4.9 2.7 4.9 6.2V21h-4v-5.4c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21H9z"/>
        </svg>
      </a>
      <a href="https://www.facebook.com/people/It-learnio/61587331703888/?sk=about" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 12a10 10 0 1 0-11.5 9.9v-7H8v-3h2.5V9.7c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.7-1.6 1.5V12H16l-.5 3h-1.9v7A10 10 0 0 0 22 12z"/>
        </svg>
      </a>
    </div>
  `;
}

/* -------------------- UTILS -------------------- */

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', "&quot;");
}