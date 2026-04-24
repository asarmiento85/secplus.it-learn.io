// app-objective.js (ROOT)
// Objective page: sidebar + prev/next + loads markdown (with per-objective images)

import { renderSidebar } from "./sidebar.js";
import { toggleBookmark, isBookmarked } from "./progress.js";
import { isLoggedIn, showLockOverlay } from "./auth.js";

async function loadObjectivePage() {
  const nav = document.getElementById("nav");
  const titleEl = document.getElementById("objectiveTitle");
  const conceptsEl = document.getElementById("objectiveConcepts");
  const mdEl = document.getElementById("objectiveMarkdown");
  const pagerEl = document.getElementById("objectivePager");
  const videoEl = document.getElementById("objectiveVideo");

  // Support both ?id=1.1 (query param) and #1.1 (hash) so that servers
  // which strip query strings from HTML requests still work correctly.
  const id =
    new URLSearchParams(location.search).get("id") ||
    decodeURIComponent(location.hash.replace(/^#/, "")).trim() ||
    null;

  if (!id) {
    // No objective id found — redirect home rather than showing a raw error
    window.location.replace("../index.html");
    return;
  }

  const res = await fetch("../data/sy0-701-outline.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load JSON");
  const data = await res.json();

  // Flatten objective list for prev/next
  const flat = [];
  data.domains.forEach(d => (d.objectives || []).forEach(o => flat.push({ domain: d, objective: o })));

  const idx = flat.findIndex(x => x.objective.id === id);
  if (idx < 0) throw new Error(`Objective not found: ${id}`);

  // Auth gate — objectives 1.1 and 1.2 are free, all others require a free account
  const FREE_OBJECTIVES = ['1.1', '1.2'];
  if (!isLoggedIn() && !FREE_OBJECTIVES.includes(id)) {
    const main = document.querySelector('.main-content') || document.querySelector('main');
    if (main) showLockOverlay(main, 'this objective');
    return;
  }

  const current = flat[idx];
  const currentDomainId = current.domain.id;

  renderSidebar({
    navEl: nav,
    domains: data.domains,
    currentDomainId,
    showHomeLink: true,
    homeHref: "../index.html",
    socials: true,
    autoClose: true
  });

  // Title
  titleEl.textContent = `${current.objective.id} — ${current.objective.title}`;

  // Bookmark button (injected right after the title)
  const bmBtn = document.createElement("button");
  bmBtn.className = `bm-btn${isBookmarked(id) ? " bookmarked" : ""}`;
  bmBtn.id = "bm-btn";
  bmBtn.textContent = isBookmarked(id) ? "★ Bookmarked" : "☆ Bookmark";
  titleEl.insertAdjacentElement("afterend", bmBtn);
  bmBtn.addEventListener("click", () => {
    const nowBookmarked = toggleBookmark(id);
    bmBtn.textContent = nowBookmarked ? "★ Bookmarked" : "☆ Bookmark";
    bmBtn.classList.toggle("bookmarked", nowBookmarked);
  });

  // Concepts first
  conceptsEl.innerHTML = renderConcepts(current.objective.concepts);

  // Video section (optional)
  const yt = current.objective.youtube_id;
  videoEl.innerHTML = yt
    ? `<div class="yt">
         <iframe
           src="https://www.youtube.com/embed/${encodeURIComponent(yt)}"
           title="YouTube video"
           allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
           allowfullscreen></iframe>
       </div>`
    : `<p class="muted">No video added yet. Add <code>"youtube_id"</code> for this objective in the JSON.</p>`;

  // Markdown section (optional)
  const mdPath = current.objective.content_md;
  if (mdPath) {
    const mdRes = await fetch(`../data/${mdPath}`, { cache: "no-cache" });
    if (mdRes.ok) {
      const md = await mdRes.text();
      // ✅ render markdown with per-objective image support
      mdEl.innerHTML = `<div class="md">${renderMarkdown(md, id)}</div>`;
      initImageZoom(mdEl);  // wire up click-to-zoom on any images
    } else {
      mdEl.innerHTML = `<p class="muted">Markdown not found: <code>${escapeHtml(mdPath)}</code></p>`;
    }
  } else {
    mdEl.innerHTML = `<p class="muted">No markdown mapped for this objective.</p>`;
  }

  // Pager (Prev/Next)
  const prev = flat[idx - 1]?.objective;
  const next = flat[idx + 1]?.objective;

  pagerEl.innerHTML = `
    <div class="pager">
      ${prev ? `<a class="pager-btn" href="./objective.html#${encodeURIComponent(prev.id)}">← ${escapeHtml(prev.id)}</a>` : `<span></span>`}
      <a class="pager-btn" href="../index.html">Home</a>
      ${next ? `<a class="pager-btn" href="./objective.html#${encodeURIComponent(next.id)}">${escapeHtml(next.id)} →</a>` : `<span></span>`}
    </div>
  `;

  // Scroll to top after content renders (hash in URL can cause browser to jump to bottom)
  window.scrollTo(0, 0);
}

/* ----- Markdown renderer (basic + images + links) ----- */
function renderMarkdown(md, objectiveId) {
  // For per-objective images:
  // data/objectives-md/1.1.md
  // data/objectives-md/1.1/<image files>
  // Page is /pages/objective.html => images must resolve to:
  // ../data/objectives-md/1.1/<image>
  const imgBase = `../data/objectives-md/${objectiveId}/`;

  // Escape first (keeps your safe approach)
  let html = escapeHtml(md);

  // Code fences first
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);

  // Images: ![alt](url) → <figure> + optional <figcaption>
  // Supports: (image.png), (./image.png), (sub/diag.png), (http...), (/absolute...)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, rawUrl) => {
    const url     = rewriteMdAssetUrl(rawUrl, imgBase);
    const safeAlt = escapeHtml(alt);
    const safeUrl = escapeHtml(url);
    const caption = safeAlt
      ? `<figcaption class="md-caption">${safeAlt}</figcaption>`
      : "";
    return `<figure class="md-figure"><img class="md-img" src="${safeUrl}" alt="${safeAlt}" loading="lazy">${caption}</figure>`;
  });

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, rawUrl) => {
    const url = rawUrl.trim();
    const safeText = escapeHtml(text);
    const safeUrl = escapeHtml(url);
    const isExternal = /^https?:\/\//i.test(url);
    return isExternal
      ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`
      : `<a href="${safeUrl}">${safeText}</a>`;
  });

  // Headings
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");

  // Tables: detect pipe-table blocks (header | sep | rows)
  html = html.replace(/((?:[ \t]*\|.+\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').map(row =>
      row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    );
    if (rows.length < 2) return block;
    const isSep = rows[1].every(c => /^[-: ]+$/.test(c));
    if (!isSep) return block;
    const header = rows[0];
    const body = rows.slice(2);
    const thead = `<thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
    const tbody = body.length
      ? `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '';
    return `<div class="md-table-wrap"><table>${thead}${tbody}</table></div>\n`;
  });

  // Inline: bold, italic, inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Lists
  html = html.replace(/^\- (.*)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  // Paragraphs (don't wrap existing block-level HTML)
  html = html.replace(/^(?!<h|<ul|<li|<pre|<p|<div|<table|<figure|<\/|<img)(.+)$/gm, "<p>$1</p>");

  return html;
}

function rewriteMdAssetUrl(rawUrl, imgBase) {
  let url = String(rawUrl || "").trim();

  // Strip surrounding quotes if user wrote ("file.png")
  url = url.replace(/^["']|["']$/g, "");

  // Leave external or absolute paths untouched
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return url;
  if (url.startsWith("data:")) return url;

  // Normalize "./"
  if (url.startsWith("./")) url = url.slice(2);

  // If it's a relative file, rewrite into per-objective folder
  return imgBase + url;
}

/* ----- Concepts renderer ----- */
function renderConcepts(concepts) {
  if (!concepts) return "<p class='muted'>No concepts yet.</p>";

  if (Array.isArray(concepts) && concepts.every(x => typeof x === "string")) {
    return `<ul>${concepts.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
  }

  if (Array.isArray(concepts)) {
    return `<ul>${concepts.map(item => `<li>${renderItem(item)}</li>`).join("")}</ul>`;
  }

  return `<pre>${escapeHtml(JSON.stringify(concepts, null, 2))}</pre>`;
}

function renderItem(item) {
  if (typeof item === "string") return escapeHtml(item);

  if (item && typeof item === "object") {
    const label = item.name || item.category || "Item";
    if (Array.isArray(item.items)) {
      return `<strong>${escapeHtml(label)}:</strong><ul>${item.items.map(x => `<li>${renderItem(x)}</li>`).join("")}</ul>`;
    }
    if (item.protocol && item.ports) {
      return `<code>${escapeHtml(item.protocol)}</code> — ports ${escapeHtml(item.ports.join(", "))}`;
    }
    return `<code>${escapeHtml(JSON.stringify(item))}</code>`;
  }

  return escapeHtml(String(item));
}

/* ----- Image zoom lightbox ----- */
function initImageZoom(container) {
  // Build the overlay once per page load
  if (!document.getElementById("img-zoom-overlay")) {
    const overlay = document.createElement("div");
    overlay.id        = "img-zoom-overlay";
    overlay.className = "img-zoom-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image zoom");
    overlay.innerHTML = `
      <button class="img-zoom-close" aria-label="Close zoom">✕</button>
      <img  class="img-zoom-img" id="img-zoom-img" src="" alt="">
      <p   class="img-zoom-caption" id="img-zoom-caption"></p>
    `;
    document.body.appendChild(overlay);

    // Click the dark backdrop (not the image) to close
    overlay.addEventListener("click", e => {
      if (!e.target.closest(".img-zoom-img")) closeZoom();
    });

    // ESC also closes
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeZoom();
    });
  }

  // Bind every .md-img inside this container
  container.querySelectorAll(".md-img").forEach(img => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => openZoom(img.src, img.alt));
  });
}

function openZoom(src, alt) {
  document.getElementById("img-zoom-img").src        = src;
  document.getElementById("img-zoom-img").alt        = alt;
  document.getElementById("img-zoom-caption").textContent = alt;
  document.getElementById("img-zoom-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeZoom() {
  const overlay = document.getElementById("img-zoom-overlay");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadObjectivePage().catch(err => {
  console.error(err);
  const el = document.getElementById("objectiveMarkdown");
  if (el) el.innerHTML = `<p class="muted">Error: ${escapeHtml(err.message)}</p>`;
});

// When the hash changes (clicking prev/next on the same page), reload to pick up new id
window.addEventListener("hashchange", () => location.reload());