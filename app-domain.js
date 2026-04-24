// app-domain.js (ROOT)
// Domain page: render domain overview + sidebar accordion (auto-close)

import { renderSidebar } from "./sidebar.js";

export async function loadDomainPage(domainId) {
  const nav = document.getElementById("nav");
  const titleEl = document.getElementById("domainTitle");
  const wrap = document.getElementById("domainContent");

  if (!nav || !titleEl || !wrap) {
    throw new Error("Missing required elements on domain page");
  }

  const res = await fetch("../data/sy0-701-outline.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load JSON");
  const data = await res.json();

  renderSidebar({
    navEl: nav,
    domains: data.domains,
    currentDomainId: domainId,
    showHomeLink: true,
    homeHref: "../index.html",
    socials: true,
    autoClose: true
  });

  const domain = data.domains.find(d => d.id === domainId);
  if (!domain) throw new Error(`Domain not found: ${domainId}`);

  titleEl.textContent = `${domain.id} ${domain.name}`;

  wrap.innerHTML = (domain.objectives || []).map(o => `
    <section class="objective">
      <h3>${escapeHtml(o.id)} — ${escapeHtml(o.title)}</h3>
      <p class="sub">Concepts:</p>
      ${renderConcepts(o.concepts)}
      <div style="margin-top:10px;">
        <a class="nav-item" href="../pages/objective.html#${encodeURIComponent(o.id)}">
          Open objective
          <span class="pill">→</span>
        </a>
      </div>
    </section>
  `).join("");
}

// Optional backward compat
window.loadDomainPage = loadDomainPage;

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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}