(() => {
  "use strict";

  /* ===================== State ===================== */
  const state = {
    parties: [],
    allCandidates: [], // flattened, each carries partyId/partyName
    ageBounds: { min: 18, max: 90 },
    filters: {
      view: "grouped", // 'grouped' | 'flat'
      gender: "all", // 'all' | 'F' | 'M'
      ageMin: 18,
      ageMax: 90,
      search: "",
    },
    openParties: new Set(),
    overview: {
      scope: "all", // 'all' | 'top'
      topN: 10,
      ageSort: "default", // 'default' | 'asc' | 'desc'
      genderSort: "default", // 'default' | 'female' | 'male'
    },
  };

  /* ===================== Utilities ===================== */
  const normalize = (s) =>
    (s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const round1 = (n) => Math.round(n * 10) / 10;

  const partyLabel = (party) => `${party.id}. ${party.name}`;

  function average(nums) {
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  /* ===================== Theme ===================== */
  function initTheme() {
    const saved = localStorage.getItem("p12-theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    const toggle = document.getElementById("theme-toggle");

    function applyTheme(t) {
      document.documentElement.setAttribute("data-theme", t);
      toggle.setAttribute("aria-checked", t === "dark" ? "true" : "false");
    }

    applyTheme(theme);
    toggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("p12-theme", next);
    });
  }

  /* ===================== Tabs ===================== */
  function initTabs() {
    const btnCandidates = document.getElementById("tab-btn-candidates");
    const btnOverview = document.getElementById("tab-btn-overview");
    const panelCandidates = document.getElementById("tab-candidates");
    const panelOverview = document.getElementById("tab-overview");

    function activate(btn, panel) {
      [btnCandidates, btnOverview].forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      [panelCandidates, panelOverview].forEach((p) => p.classList.toggle("is-active", p === panel));
    }

    btnCandidates.addEventListener("click", () => activate(btnCandidates, panelCandidates));
    btnOverview.addEventListener("click", () => {
      activate(btnOverview, panelOverview);
      renderOverview();
    });
  }

  /* ===================== Data loading ===================== */
  async function loadData() {
    const res = await fetch("data/candidates.json");
    if (!res.ok) throw new Error("Nepodařilo se načíst data kandidátů.");
    const json = await res.json();
    state.parties = json.parties;
    state.allCandidates = json.parties.flatMap((p) =>
      p.candidates.map((c) => ({ ...c, partyId: p.id, partyName: p.name }))
    );
    const ages = state.allCandidates.map((c) => c.age).filter((a) => a != null);
    state.ageBounds.min = Math.min(...ages);
    state.ageBounds.max = Math.max(...ages);
    state.filters.ageMin = state.ageBounds.min;
    state.filters.ageMax = state.ageBounds.max;
  }

  /* ===================== Hero stats ===================== */
  function renderHeroStats() {
    const total = state.allCandidates.length;
    const female = state.allCandidates.filter((c) => c.gender === "F").length;
    const pctFemale = round1((female / total) * 100);
    const avgAge = round1(average(state.allCandidates.map((c) => c.age)));
    const el = document.getElementById("hero-stats");
    el.innerHTML = `
      <div class="chip"><strong>${total}</strong> kandidátů</div>
      <div class="chip"><strong>${state.parties.length}</strong> kandidátních listin</div>
      <div class="chip"><strong>${pctFemale}&nbsp;%</strong> žen</div>
      <div class="chip"><strong>${avgAge}</strong> let průměrný věk</div>
    `;
  }

  /* ===================== Filtering ===================== */
  function getFilteredCandidates() {
    const { gender, ageMin, ageMax, search } = state.filters;
    const q = normalize(search);
    return state.allCandidates.filter((c) => {
      if (gender !== "all" && c.gender !== gender) return false;
      if (c.age != null && (c.age < ageMin || c.age > ageMax)) return false;
      if (q) {
        const haystack = normalize(`${c.name} ${c.profession || ""}`);
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  /* ===================== Candidates tab rendering ===================== */
  function renderCandidatesTab() {
    const filtered = getFilteredCandidates();
    document.getElementById("result-count").textContent = `Zobrazeno ${filtered.length} z ${state.allCandidates.length} kandidátů`;

    const groupedView = document.getElementById("grouped-view");
    const flatView = document.getElementById("flat-view");
    const emptyState = document.getElementById("empty-state");

    const isGrouped = state.filters.view === "grouped";
    groupedView.hidden = !isGrouped;
    flatView.hidden = isGrouped;

    emptyState.hidden = filtered.length > 0;

    if (isGrouped) {
      renderGroupedView(filtered);
    } else {
      renderFlatView(filtered);
    }
  }

  function genderBadge(gender) {
    if (gender === "F") return '<span class="badge badge--female">Žena</span>';
    if (gender === "M") return '<span class="badge badge--male">Muž</span>';
    return "";
  }

  // Measures the widest "name + gender badge" combination across every
  // candidate (not just the currently filtered ones) so the column stays a
  // stable width regardless of filtering, and sets it as a CSS variable.
  // Uses a plain styled element (not a real table) so it is never affected
  // by responsive table rules (e.g. the mobile card layout).
  async function measureNameColumnWidth() {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (e) {
        /* ignore font loading errors, measure with whatever is available */
      }
    }

    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.left = "-9999px";
    probe.style.top = "0";
    probe.style.whiteSpace = "nowrap";
    probe.style.fontFamily = "var(--font-body)";
    probe.style.fontSize = ".9rem";
    probe.style.paddingLeft = ".9rem";
    probe.style.paddingRight = ".9rem";
    document.body.appendChild(probe);

    let maxWidth = 0;
    state.allCandidates.forEach((c) => {
      probe.innerHTML = `<strong>${c.name}</strong> ${genderBadge(c.gender)}`;
      maxWidth = Math.max(maxWidth, probe.scrollWidth);
    });

    document.body.removeChild(probe);

    document.documentElement.style.setProperty("--name-col-width", `${Math.ceil(maxWidth) + 4}px`);
  }

  function renderGroupedView(filtered) {
    const container = document.getElementById("grouped-view");
    const byParty = new Map();
    filtered.forEach((c) => {
      if (!byParty.has(c.partyId)) byParty.set(c.partyId, []);
      byParty.get(c.partyId).push(c);
    });

    container.innerHTML = "";
    state.parties.forEach((party) => {
      const candidates = (byParty.get(party.id) || []).slice().sort((a, b) => (a.number || 0) - (b.number || 0));
      if (candidates.length === 0) return;

      const women = candidates.filter((c) => c.gender === "F").length;
      const avgAge = round1(average(candidates.map((c) => c.age)));
      const isOpen = state.openParties.has(party.id);

      const card = document.createElement("article");
      card.className = "party-card" + (isOpen ? " is-open" : "");

      const rows = candidates
        .map(
          (c) => `
          <tr>
            <td>${c.number ?? ""}</td>
            <td><strong>${c.name}</strong> ${genderBadge(c.gender)}</td>
            <td>${c.age ?? "–"}</td>
            <td>${c.profession ? c.profession : "–"}</td>
          </tr>`
        )
        .join("");

      card.innerHTML = `
        <button class="party-card__header" data-party-id="${party.id}">
          <div class="party-card__title">
            <strong>${party.id}. ${party.name}</strong>
            <span class="party-card__meta">
              <span>${candidates.length} kandidátů</span>
              <span>${round1((women / candidates.length) * 100)}&nbsp;% žen</span>
              <span>průměrný věk ${avgAge} let</span>
            </span>
          </div>
          <span class="party-card__chevron" aria-hidden="true">⌄</span>
        </button>
        <div class="party-card__body">
          <div class="table-wrap">
            <table class="candidates-table">
              <thead><tr><th>#</th><th>Jméno</th><th>Věk</th><th>Povolání</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;

      card.querySelector(".party-card__header").addEventListener("click", () => {
        if (state.openParties.has(party.id)) {
          state.openParties.delete(party.id);
        } else {
          state.openParties.add(party.id);
        }
        renderCandidatesTab();
      });

      container.appendChild(card);
    });
  }

  function renderFlatView(filtered) {
    const tbody = document.getElementById("flat-table-body");
    const sorted = filtered
      .slice()
      .sort((a, b) => (a.partyId || 0) - (b.partyId || 0) || (a.number || 0) - (b.number || 0));

    tbody.innerHTML = sorted
      .map(
        (c) => `
        <tr>
          <td>${c.number ?? ""}</td>
          <td><strong>${c.name}</strong> ${genderBadge(c.gender)}</td>
          <td>${c.age ?? "–"}</td>
          <td>${c.profession ? c.profession : "–"}</td>
          <td>${c.partyId}. ${c.partyName}</td>
        </tr>`
      )
      .join("");
  }

  /* ===================== Filter controls ===================== */
  function initFilterControls() {
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle("is-active", b === btn));
        state.filters.view = btn.dataset.view;
        renderCandidatesTab();
      });
    });

    document.querySelectorAll('[data-gender]').forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll('[data-gender]').forEach((b) => b.classList.toggle("is-active", b === btn));
        state.filters.gender = btn.dataset.gender;
        renderCandidatesTab();
      });
    });

    document.getElementById("search-input").addEventListener("input", (e) => {
      state.filters.search = e.target.value;
      renderCandidatesTab();
    });

    document.getElementById("reset-filters").addEventListener("click", () => {
      state.filters.gender = "all";
      state.filters.search = "";
      state.filters.ageMin = state.ageBounds.min;
      state.filters.ageMax = state.ageBounds.max;
      document.getElementById("search-input").value = "";
      document.querySelectorAll('[data-gender]').forEach((b) => b.classList.toggle("is-active", b.dataset.gender === "all"));
      syncAgeSlider();
      renderCandidatesTab();
    });

    initAgeSlider();
  }

  function initAgeSlider() {
    const min = document.getElementById("age-min");
    const max = document.getElementById("age-max");
    const minNumber = document.getElementById("age-min-number");
    const maxNumber = document.getElementById("age-max-number");

    min.min = max.min = minNumber.min = maxNumber.min = state.ageBounds.min;
    min.max = max.max = minNumber.max = maxNumber.max = state.ageBounds.max;
    min.value = state.ageBounds.min;
    max.value = state.ageBounds.max;

    function applyRange(lo, hi) {
      lo = clampAge(lo);
      hi = clampAge(hi);
      if (lo > hi) [lo, hi] = [hi, lo];
      state.filters.ageMin = lo;
      state.filters.ageMax = hi;
      syncAgeSlider();
      renderCandidatesTab();
    }

    function clampAge(value) {
      if (!Number.isFinite(value)) return state.ageBounds.min;
      return Math.min(state.ageBounds.max, Math.max(state.ageBounds.min, value));
    }

    min.addEventListener("input", () => applyRange(parseInt(min.value, 10), parseInt(max.value, 10)));
    max.addEventListener("input", () => applyRange(parseInt(min.value, 10), parseInt(max.value, 10)));

    minNumber.addEventListener("change", () => applyRange(parseInt(minNumber.value, 10), state.filters.ageMax));
    maxNumber.addEventListener("change", () => applyRange(state.filters.ageMin, parseInt(maxNumber.value, 10)));

    syncAgeSlider();
  }

  function syncAgeSlider() {
    const min = document.getElementById("age-min");
    const max = document.getElementById("age-max");
    min.value = state.filters.ageMin;
    max.value = state.filters.ageMax;
    document.getElementById("age-min-number").value = state.filters.ageMin;
    document.getElementById("age-max-number").value = state.filters.ageMax;

    const total = state.ageBounds.max - state.ageBounds.min || 1;
    const leftPct = ((state.filters.ageMin - state.ageBounds.min) / total) * 100;
    const rightPct = ((state.filters.ageMax - state.ageBounds.min) / total) * 100;
    const range = document.querySelector(".range-slider__range");
    range.style.left = `${leftPct}%`;
    range.style.width = `${rightPct - leftPct}%`;
  }

  /* ===================== Overview tab ===================== */
  function initOverviewControls() {
    document.querySelectorAll('[data-scope]').forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle("is-active", b === btn));
        state.overview.scope = btn.dataset.scope;
        document.getElementById("topn-wrap").hidden = state.overview.scope !== "top";
        renderOverview();
      });
    });

    const topnInput = document.getElementById("topn-input");
    topnInput.addEventListener("input", () => {
      const n = parseInt(topnInput.value, 10);
      state.overview.topN = Number.isFinite(n) && n > 0 ? n : 10;
      renderOverview();
    });

    document.querySelectorAll('[data-age-sort]').forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll('[data-age-sort]').forEach((b) => b.classList.toggle("is-active", b === btn));
        state.overview.ageSort = btn.dataset.ageSort;
        renderOverview();
      });
    });

    document.querySelectorAll('[data-gender-sort]').forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll('[data-gender-sort]').forEach((b) => b.classList.toggle("is-active", b === btn));
        state.overview.genderSort = btn.dataset.genderSort;
        renderOverview();
      });
    });
  }

  function getOverviewScopeCandidates() {
    if (state.overview.scope === "all") return state.allCandidates;
    const n = state.overview.topN;
    return state.allCandidates.filter((c) => c.number != null && c.number <= n);
  }

  function computeStats(candidates) {
    const total = candidates.length;
    const female = candidates.filter((c) => c.gender === "F").length;
    const male = candidates.filter((c) => c.gender === "M").length;
    const avgAge = average(candidates.map((c) => c.age).filter((a) => a != null));
    return {
      total,
      female,
      male,
      femalePct: total ? round1((female / total) * 100) : 0,
      malePct: total ? round1((male / total) * 100) : 0,
      avgAge: avgAge != null ? round1(avgAge) : null,
    };
  }

  function getPartyStatsList() {
    const n = state.overview.topN;
    const useTop = state.overview.scope === "top";
    return state.parties.map((party) => {
      const candidates = useTop ? party.candidates.filter((c) => c.number != null && c.number <= n) : party.candidates;
      return { party, stats: computeStats(candidates) };
    });
  }

  function renderOverview() {
    const scopeCandidates = getOverviewScopeCandidates();
    const stats = computeStats(scopeCandidates);
    const partyStatsList = getPartyStatsList();

    renderSummaryGrid(stats);
    renderDonut(stats);
    renderAgeBarChart(scopeCandidates);
    renderPartyAgeChart(partyStatsList, stats);
    renderPartyGenderChart(partyStatsList);
    renderOverviewTable(partyStatsList);
  }

  function renderSummaryGrid(stats) {
    const el = document.getElementById("summary-grid");
    el.innerHTML = `
      <div class="summary-card"><span>Kandidátů v rozsahu</span><strong>${stats.total}</strong></div>
      <div class="summary-card female"><span>Ženy</span><strong>${stats.female} (${stats.femalePct}&nbsp;%)</strong></div>
      <div class="summary-card male"><span>Muži</span><strong>${stats.male} (${stats.malePct}&nbsp;%)</strong></div>
      <div class="summary-card"><span>Průměrný věk</span><strong>${stats.avgAge ?? "–"} let</strong></div>
    `;
  }

  function renderDonut(stats) {
    const circle = document.getElementById("donut-female");
    const r = 50;
    const circumference = 2 * Math.PI * r;
    const femaleLen = (stats.femalePct / 100) * circumference;
    circle.setAttribute("stroke-dasharray", `${femaleLen} ${circumference - femaleLen}`);
    document.getElementById("legend-female").textContent = `${stats.female} (${stats.femalePct}\u00a0%)`;
    document.getElementById("legend-male").textContent = `${stats.male} (${stats.malePct}\u00a0%)`;
  }

  function renderAgeBarChart(candidates) {
    const buckets = [
      { label: "18–29", test: (a) => a < 30 },
      { label: "30–39", test: (a) => a >= 30 && a < 40 },
      { label: "40–49", test: (a) => a >= 40 && a < 50 },
      { label: "50–59", test: (a) => a >= 50 && a < 60 },
      { label: "60–69", test: (a) => a >= 60 && a < 70 },
      { label: "70+", test: (a) => a >= 70 },
    ];
    const ages = candidates.map((c) => c.age).filter((a) => a != null);
    const counts = buckets.map((b) => ages.filter(b.test).length);
    const max = Math.max(...counts, 1);

    const el = document.getElementById("age-bar-chart");
    el.innerHTML = buckets
      .map(
        (b, i) => `
        <div class="bar-row">
          <span>${b.label}</span>
          <div class="bar-row__track"><div class="bar-row__fill" style="width:${(counts[i] / max) * 100}%"></div></div>
          <span class="bar-row__count">${counts[i]}</span>
        </div>`
      )
      .join("");
  }

  function renderPartyAgeChart(partyStatsList, overallStats) {
    const el = document.getElementById("party-age-chart");
    const marker = document.getElementById("party-age-avg-marker");
    const withAge = partyStatsList.filter((p) => p.stats.avgAge != null);
    const maxAge = Math.max(...withAge.map((p) => p.stats.avgAge), 1);
    const overallPct = overallStats.avgAge != null ? (overallStats.avgAge / maxAge) * 100 : null;

    if (overallPct != null) {
      marker.hidden = false;
      marker.style.left = `${overallPct}%`;
      marker.querySelector(".avg-marker__label").textContent = `Průměr (${overallStats.avgAge} let)`;
    } else {
      marker.hidden = true;
    }

    const sorted = withAge.slice();
    if (state.overview.ageSort === "asc") {
      sorted.sort((a, b) => a.stats.avgAge - b.stats.avgAge);
    } else if (state.overview.ageSort === "desc") {
      sorted.sort((a, b) => b.stats.avgAge - a.stats.avgAge);
    }

    el.innerHTML = sorted
      .map(({ party, stats }) => {
        const widthPct = (stats.avgAge / maxAge) * 100;
        const avgLine = overallPct != null ? `<div class="party-bar-row__avg-line" style="left:${overallPct}%"></div>` : "";
        const label = partyLabel(party);
        return `
          <div class="party-bar-row">
            <div class="party-bar-row__label"><span title="${label}">${label}</span><span>${stats.avgAge}&nbsp;let</span></div>
            <div class="party-bar-row__track">
              <div class="party-bar-row__fill" style="width:${widthPct}%"></div>
              ${avgLine}
            </div>
          </div>`;
      })
      .join("");
  }

  function renderPartyGenderChart(partyStatsList) {
    const el = document.getElementById("party-gender-chart");
    const sorted = partyStatsList.slice();
    if (state.overview.genderSort === "female") {
      sorted.sort((a, b) => b.stats.femalePct - a.stats.femalePct);
    } else if (state.overview.genderSort === "male") {
      sorted.sort((a, b) => b.stats.malePct - a.stats.malePct);
    }
    el.innerHTML = sorted
      .map(({ party, stats }) => {
        const label = partyLabel(party);
        return `
        <div class="party-bar-row">
          <div class="party-bar-row__label"><span title="${label}">${label}</span><span>${stats.femalePct}&nbsp;% Ž / ${stats.malePct}&nbsp;% M</span></div>
          <div class="party-bar-row__track">
            <div class="party-bar-row__segment party-bar-row__segment--female" style="width:${stats.femalePct}%"></div>
            <div class="party-bar-row__segment party-bar-row__segment--male" style="width:${stats.malePct}%"></div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderOverviewTable(partyStatsList) {
    const tbody = document.getElementById("overview-table-body");

    tbody.innerHTML = partyStatsList
      .map(({ party, stats }) => `
          <tr>
            <td><strong>${partyLabel(party)}</strong></td>
            <td>${stats.total}</td>
            <td>${stats.female} (${stats.femalePct}&nbsp;%)</td>
            <td>${stats.male} (${stats.malePct}&nbsp;%)</td>
            <td>${stats.avgAge ?? "–"} let</td>
          </tr>`)
      .join("");
  }

  /* ===================== Init ===================== */
  async function init() {
    initTheme();
    initTabs();
    try {
      await loadData();
    } catch (err) {
      document.getElementById("grouped-view").innerHTML = `<p class="empty-state">Nepodařilo se načíst data: ${err.message}</p>`;
      return;
    }
    renderHeroStats();
    await measureNameColumnWidth();
    initFilterControls();
    initOverviewControls();
    renderCandidatesTab();
    renderOverview();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
