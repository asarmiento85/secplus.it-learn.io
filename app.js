// app.js (ROOT) — Security+ SY0-701
import { renderSidebar } from "./sidebar.js";

async function loadIndex() {
  const nav      = document.getElementById("nav");
  const cards    = document.getElementById("cards");
  const buildInfo = document.getElementById("buildInfo");

  if (!nav)   throw new Error("Missing element: #nav");
  if (!cards) throw new Error("Missing element: #cards");

  const res = await fetch("./data/sy0-701-outline.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load JSON");
  const data = await res.json();

  renderSidebar({
    navEl: nav,
    domains: data.domains,
    currentDomainId: null,
    showHomeLink: false,
    socials: true,
    autoClose: true
  });

  cards.innerHTML = (data.domains || []).map(d => {
    const fileId = String(d.id).replace(".", "");
    const href   = `./pages/${fileId}-${slug(d.name)}.html`;
    const count  = d.objectives?.length ?? 0;
    const pct    = d.weight ?? d.percentage ?? "";
    return `
      <a class="card" href="${href}">
        <h3>${escapeHtml(d.id)} ${escapeHtml(d.name)}</h3>
        <p class="muted">${pct ? escapeHtml(pct + "% of exam · ") : ""}${count} objectives</p>
      </a>
    `;
  }).join("");

  if (buildInfo) {
    const ver  = data.exam?.exam_code ?? "SY0-701";
    const objv = data.exam?.objectives_version ? `Objectives v${data.exam.objectives_version}` : "";
    buildInfo.textContent = `${ver} ${objv}`.trim();
  }
}

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

loadIndex().catch(err => {
  console.error(err);
  const nav   = document.getElementById("nav");
  const cards = document.getElementById("cards");
  if (nav)   nav.innerHTML   = `<p class="muted">Error: ${err.message}</p>`;
  if (cards) cards.innerHTML = `<p class="muted">Check DevTools Console for details.</p>`;
});
