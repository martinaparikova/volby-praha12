(() => {
  "use strict";

  // City-wide council (Zastupitelstvo hlavního města Prahy) plus all 22
  // numbered Prague city districts (Praha 1-22).
  const MUNICIPALITIES = {
    magistrat: {
      label: "Magistrát hl. m. Prahy",
      badge: "MHMP",
      file: "data/candidates-magistrat.json",
      resultsFile: "data/results-magistrat.json",
    },
    ...Object.fromEntries(
      Array.from({ length: 22 }, (_, i) => i + 1).map((n) => [
        `praha${n}`,
        {
          label: `Praha ${n}`,
          badge: `P${n}`,
          file: `data/candidates-praha${n}.json`,
          resultsFile: `data/results-praha${n}.json`,
        },
      ])
    ),
  };
  const DEFAULT_MUNICIPALITY = "praha12";
  const RESULTS_AUTOREFRESH_MS = 60000;

  /* ===================== State ===================== */
  const state = {
    municipality: DEFAULT_MUNICIPALITY,
    source: null,
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
    results: null,
    precinctResults: null,
    resultsStation: null,
    resultsPrecinct: null,
    resultsAutoRefresh: true,
  };

  let resultsTimer = null;
  let resultsRequestSequence = 0;

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
    const tabs = [
      { btn: document.getElementById("tab-btn-overview"), panel: document.getElementById("tab-overview"), onActivate: renderOverview },
      { btn: document.getElementById("tab-btn-candidates"), panel: document.getElementById("tab-candidates") },
      { btn: document.getElementById("tab-btn-results"), panel: document.getElementById("tab-results"), onActivate: () => { renderResultsTab(); startResultsAutoRefresh(); } },
    ];

    function activate(target) {
      tabs.forEach(({ btn, panel }) => {
        btn.classList.toggle("is-active", btn === target.btn);
        btn.setAttribute("aria-selected", btn === target.btn ? "true" : "false");
        panel.classList.toggle("is-active", panel === target.panel);
      });
      if (target.btn !== document.getElementById("tab-btn-results")) stopResultsAutoRefresh();
      if (target.onActivate) target.onActivate();
    }

    tabs.forEach((t) => t.btn.addEventListener("click", () => activate(t)));
  }

  /* ===================== Data loading ===================== */
  async function loadData(file) {
    const res = await fetch(file);
    if (!res.ok) throw new Error("Nepodařilo se načíst data kandidátů.");
    const json = await res.json();
    state.source = {
      url: json.source,
      label: json.sourceNote || "Zdroj kandidátů",
      municipality: json.municipality,
    };
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

  /* ===================== Municipality switching ===================== */
  function initMunicipalitySwitch() {
    const select = document.getElementById("municipality-select");
    if (!select) return;
    select.innerHTML = Object.entries(MUNICIPALITIES)
      .map(([slug, cfg]) => `<option value="${slug}">${cfg.label}</option>`)
      .join("");
    select.addEventListener("change", () => {
      if (select.value === state.municipality) return;
      switchMunicipality(select.value);
    });
  }

  async function switchMunicipality(slug) {
    const config = MUNICIPALITIES[slug];
    if (!config) return;

    const select = document.getElementById("municipality-select");
    if (select) select.value = slug;

    // Reset candidate-browsing state - old filters/open accordions rarely
    // make sense for a different municipality's data.
    state.filters.gender = "all";
    state.filters.search = "";
    state.openParties = new Set();
    document.getElementById("search-input").value = "";
    document.querySelectorAll('[data-gender]').forEach((b) => b.classList.toggle("is-active", b.dataset.gender === "all"));

    try {
      await loadData(config.file);
    } catch (err) {
      document.getElementById("grouped-view").innerHTML = `<p class="empty-state">Nepodařilo se načíst data: ${err.message}</p>`;
      return;
    }

    state.municipality = slug;
    localStorage.setItem("p12-municipality", slug);

    document.getElementById("brand-badge").textContent = config.badge;
    document.getElementById("brand-title").textContent = `Volby ${config.label}`;
    document.getElementById("hero-title").innerHTML = `Kdo kandiduje v ${toLocative(config.label)}?`;
    document.title = `Volby ${config.label} — komunální volby 2026`;
    const sourceLink = document.getElementById("source-link");
    if (sourceLink && state.source) {
      sourceLink.href = state.source.url;
      sourceLink.textContent = state.source.label;
    }

    updateAgeSliderBounds();
    await measureNameColumnWidth();
    renderHeroStats();
    renderCandidatesTab();
    renderOverview();

    state.results = null;
    state.precinctResults = null;
    state.resultsStation = null;
    state.resultsPrecinct = null;
    document.getElementById("results-location-filter").hidden = true;
    document.querySelectorAll("#tab-results > .card").forEach((card) => { card.hidden = true; });
    document.getElementById("results-error").hidden = true;
    try {
      await loadResults(config.resultsFile, slug);
    } catch (err) {
      state.results = null;
      showResultsError(err);
    }
    if (document.getElementById("tab-btn-results").classList.contains("is-active")) {
      renderResultsTab();
    }
  }

  // Quick Czech locative-case helper for the Prague districts plus the
  // city-wide council, used in the "Kdo kandiduje v ...?" heading (e.g.
  // "Praze 12", "Praze 11", "Praze" for the city-wide magistrát).
  function toLocative(label) {
    if (label === "Magistrát hl. m. Prahy") return "Praze";
    return label.replace(/^Praha(\s+\d+)/, "Praze$1").replace(" ", "&nbsp;");
  }

  /* ===================== Results tab ===================== */
  async function loadResults(file, slug) {
    const requestSequence = ++resultsRequestSequence;
    const fetchJson = async (url, message) => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(message);
      return res.json();
    };
    const [json, precincts] = await Promise.all([
      fetchJson(file, "Nepodařilo se načíst výsledky."),
      slug === "praha12"
        ? fetchJson("data/precincts-praha12.json", "Nepodařilo se načíst výsledky okrsků Prahy 12.")
        : Promise.resolve(null),
    ]);
    if (slug === "praha12") validatePrecinctResults(precincts, json.parties);
    if (slug !== state.municipality || requestSequence !== resultsRequestSequence) return;
    const currentResults = state.results;
    const currentPrecincts = state.precinctResults;
    const countedPrecincts = (data) => data?.precincts.filter((item) => item.counted).length ?? 0;
    const hasOlderTimestamp = (next, current) => {
      const nextTime = Date.parse(next?.generatedAt);
      const currentTime = Date.parse(current?.generatedAt);
      return Number.isFinite(nextTime) && Number.isFinite(currentTime) && nextTime < currentTime;
    };
    const resultsRegressed = currentResults?.municipality === json.municipality &&
      (json.precinctsCounted < currentResults.precinctsCounted ||
        hasOlderTimestamp(json, currentResults));
    const precinctsRegressed = slug === "praha12" && currentPrecincts &&
      (countedPrecincts(precincts) < countedPrecincts(currentPrecincts) ||
        hasOlderTimestamp(precincts, currentPrecincts));
    if (resultsRegressed || precinctsRegressed) {
      showResultsError(new Error(
        "Automatická aktualizace vrátila starší nebo méně sečtené výsledky; ponechávám předchozí data."
      ));
      return;
    }
    json.fetchedAt = new Date();
    state.results = json;
    state.precinctResults = precincts;
    document.getElementById("results-error").hidden = true;
  }

  function showResultsError(err) {
    const message = document.getElementById("results-error");
    message.textContent = `${err.message} Zobrazené výsledky mohou být neaktuální.`;
    message.hidden = false;
    console.error("Načítání výsledků selhalo:", err);
  }

  function initResultsControls() {
    document.getElementById("results-refresh-btn").addEventListener("click", () => refreshResults());

    const toggle = document.getElementById("results-autorefresh-toggle");
    toggle.addEventListener("change", () => {
      state.resultsAutoRefresh = toggle.checked;
      if (state.resultsAutoRefresh) startResultsAutoRefresh();
      else stopResultsAutoRefresh();
    });
    const pickers = ["results-station-picker", "results-precinct-picker"]
      .map((id) => document.getElementById(id));
    document.addEventListener("click", (event) => {
      pickers.forEach((picker) => {
        if (!picker.contains(event.target)) picker.open = false;
      });
    });
    pickers.forEach((picker) => picker.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        picker.open = false;
        picker.querySelector("summary").focus();
      }
    }));
  }

  async function refreshResults() {
    const slug = state.municipality;
    const config = MUNICIPALITIES[slug];
    const btn = document.getElementById("results-refresh-btn");
    btn.disabled = true;
    try {
      await loadResults(config.resultsFile, slug);
      renderResultsTab();
    } catch (err) {
      if (slug === state.municipality) showResultsError(err);
    } finally {
      btn.disabled = false;
    }
  }

  function startResultsAutoRefresh() {
    stopResultsAutoRefresh();
    if (!state.resultsAutoRefresh) return;
    resultsTimer = setInterval(refreshResults, RESULTS_AUTOREFRESH_MS);
  }

  function stopResultsAutoRefresh() {
    if (resultsTimer) {
      clearInterval(resultsTimer);
      resultsTimer = null;
    }
  }

  function validatePrecinctResults(data, parties) {
    const nonnegative = (value) => Number.isInteger(value) && value >= 0;
    const partyIds = new Set(parties.map((party) => String(party.id)));
    if (!data || data.municipality !== "Praha 12" || data.electionDate !== "20261009" ||
        !Array.isArray(data.precincts) || data.precincts.length !== 50 ||
        !Array.isArray(data.stations) || !data.stations.length ||
        !Number.isFinite(new Date(data.generatedAt).getTime())) {
      throw new Error("Data okrsků Prahy 12 mají neplatný formát.");
    }
    const numbers = new Set();
    for (const item of data.precincts) {
      if (!nonnegative(item.number) || item.number < 12001 || item.number > 12050 ||
          numbers.has(item.number) || typeof item.counted !== "boolean" ||
          (item.counted && (!nonnegative(item.totalVotes) || !nonnegative(item.registeredVoters) ||
            !nonnegative(item.issuedEnvelopes) || item.issuedEnvelopes > item.registeredVoters ||
            !item.votes || Array.isArray(item.votes) || typeof item.votes !== "object" ||
            Object.entries(item.votes).some(([id, votes]) => !partyIds.has(id) || !nonnegative(votes)) ||
            Object.values(item.votes).reduce((sum, votes) => sum + votes, 0) !== item.totalVotes))) {
        throw new Error("Data obsahují neplatný nebo duplicitní okrsek Prahy 12.");
      }
      numbers.add(item.number);
    }
    const assigned = new Set();
    const stationIds = new Set();
    for (const station of data.stations) {
      if (typeof station.id !== "string" || !station.id || stationIds.has(station.id) ||
          typeof station.name !== "string" || !station.name || typeof station.address !== "string" ||
          !Array.isArray(station.precincts) || !station.precincts.length ||
          station.precincts.some((number) => !numbers.has(number) || assigned.has(number))) {
        throw new Error("Sídla volebních místností mají neplatné přiřazení okrsků.");
      }
      stationIds.add(station.id);
      for (const number of station.precincts) {
        if (assigned.has(number)) throw new Error("Okrsek je přiřazen vícekrát.");
        assigned.add(number);
      }
    }
    if (assigned.size !== numbers.size) throw new Error("U některých okrsků chybí sídlo volební místnosti.");
  }

  function renderLocationFilters() {
    const data = state.precinctResults;
    document.getElementById("results-location-filter").hidden = !data;
    if (!data) return;
    const byNumber = new Map(data.precincts.map((item) => [item.number, item]));
    const station = data.stations.find((item) => item.id === state.resultsStation);
    const stationCounted = station?.precincts.filter((number) => byNumber.get(number).counted).length;
    const stationLabel = (item) => `${item.name} (${item.address})`;
    const renderOptions = (id, options, selected, onSelect) => {
      const container = document.getElementById(id);
      const focusedValue = container.contains(document.activeElement) ? document.activeElement.dataset.value : null;
      container.replaceChildren(...options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `results-picker__option${option.pending ? " results-picker__option--pending" : ""}`;
        button.dataset.value = option.value ?? "";
        button.setAttribute("aria-pressed", String(option.value === selected));
        const title = document.createElement("span");
        title.textContent = option.label;
        const detail = document.createElement("small");
        detail.textContent = option.detail;
        button.append(title, detail);
        button.addEventListener("click", () => onSelect(option.value));
        return button;
      }));
      if (focusedValue !== null) {
        Array.from(container.children).find((button) => button.dataset.value === focusedValue)?.focus();
      }
    };
    document.getElementById("results-station-value").textContent = station ? stationLabel(station) : "Všechny okrsky";
    document.getElementById("results-station-picker").classList.toggle("results-picker--pending", !!station && !stationCounted);
    renderOptions("results-station-options", [
      { value: null, label: "Všechny okrsky", detail: "Souhrnné výsledky celé Prahy 12", pending: false },
      ...data.stations.map((item) => {
        const counted = item.precincts.filter((number) => byNumber.get(number).counted).length;
        return {
          value: item.id, label: stationLabel(item),
          detail: `${counted} z ${item.precincts.length} ${item.precincts.length === 1 ? "okrsku" : "okrsků"} sečteno${counted ? "" : " · zatím nesečteno"}`,
          pending: counted === 0,
        };
      }),
    ], state.resultsStation, (value) => {
      state.resultsStation = value;
      state.resultsPrecinct = null;
      document.getElementById("results-station-picker").open = false;
      document.getElementById("results-precinct-picker").open = false;
      renderResultsTab();
      document.querySelector("#results-station-picker summary").focus();
    });
    document.getElementById("results-precinct-field").hidden = !station || station.precincts.length < 2;
    if (!station) return;
    document.getElementById("results-precinct-value").textContent = state.resultsPrecinct
      ? `Okrsek ${state.resultsPrecinct}` : "Všechny okrsky v sídle";
    document.getElementById("results-precinct-picker").classList.toggle("results-picker--pending",
      state.resultsPrecinct ? !byNumber.get(state.resultsPrecinct).counted : !stationCounted);
    renderOptions("results-precinct-options", [
      { value: null, label: "Všechny okrsky v sídle", detail: `${stationCounted} z ${station.precincts.length} okrsků sečteno`, pending: !stationCounted },
      ...station.precincts.map((number) => ({
        value: number, label: `Okrsek ${number}`,
        detail: byNumber.get(number).counted ? "Sečteno" : "Zatím nesečteno",
        pending: !byNumber.get(number).counted,
      })),
    ], state.resultsPrecinct, (value) => {
      state.resultsPrecinct = value;
      document.getElementById("results-precinct-picker").open = false;
      renderResultsTab();
      document.querySelector("#results-precinct-picker summary").focus();
    });
  }

  function scopedResults(results) {
    const data = state.precinctResults;
    const station = data?.stations.find((item) => item.id === state.resultsStation);
    if (!station) return { results, label: `Celé zastupitelstvo: ${results.municipality}`, filtered: false };
    const numbers = state.resultsPrecinct ? [state.resultsPrecinct] : station.precincts;
    const counted = data.precincts.filter((item) => numbers.includes(item.number) && item.counted);
    const totalVotes = counted.reduce((sum, item) => sum + item.totalVotes, 0);
    const registered = counted.reduce((sum, item) => sum + item.registeredVoters, 0);
    const issued = counted.reduce((sum, item) => sum + item.issuedEnvelopes, 0);
    return {
      filtered: true,
      label: `${station.name} (${station.address}) · ${state.resultsPrecinct ? `okrsek ${state.resultsPrecinct}` : numbers.length === 1 ? `okrsek ${numbers[0]}` : "všechny okrsky v sídle"}`,
      results: {
        ...results, precinctsTotal: numbers.length, precinctsCounted: counted.length,
        turnoutPercent: registered ? round1(issued / registered * 100) : null,
        generatedAt: data.generatedAt,
        parties: results.parties.map((party) => {
          const votes = counted.reduce((sum, item) => sum + (item.votes[party.id] || 0), 0);
          return { ...party, votes, votesPercent: totalVotes ? round1(votes / totalVotes * 100) : 0, seats: null };
        }).sort((a, b) => b.votes - a.votes || a.id - b.id),
      },
    };
  }

  function estimatePartialMandates(r) {
    if (r.isSample || r.isComplete !== false || !r.precinctsCounted || !r.totalSeats) return null;

    const parties = r.parties.map((party) => {
      const candidateParty = state.parties.find((item) => item.id === party.id);
      return {
        id: party.id,
        votes: party.votes,
        candidateCount: candidateParty && candidateParty.candidateCount,
      };
    });
    const totalVotes = parties.reduce((sum, party) => sum + party.votes, 0);
    if (
      !totalVotes ||
      parties.some((party) =>
        !Number.isFinite(party.votes) ||
        party.votes < 0 ||
        !Number.isInteger(party.candidateCount) ||
        party.candidateCount < 1
      )
    ) {
      return null;
    }

    const eligible = parties.filter((party) =>
      party.votes >= 0.05 * (totalVotes / r.totalSeats) * Math.min(party.candidateCount, r.totalSeats)
    );
    if (!eligible.some((party) => party.votes > 0)) return null;

    const seats = new Map(parties.map((party) => [party.id, 0]));
    const assigned = eligible.map((party, index) => ({ ...party, index, seats: 0 }));
    for (let seat = 0; seat < r.totalSeats; seat += 1) {
      const winner = assigned
        .filter((party) => party.votes > 0)
        .reduce((best, party) => {
          const quotient = party.votes / (party.seats + 1);
          const bestQuotient = best.votes / (best.seats + 1);
          return quotient > bestQuotient ||
            (quotient === bestQuotient && (party.votes > best.votes ||
              (party.votes === best.votes && party.index < best.index)))
            ? party
            : best;
        });
      winner.seats += 1;
    }
    assigned.forEach((party) => seats.set(party.id, party.seats));
    return { eligible: new Set(eligible.map((party) => party.id)), seats };
  }

  function renderResultsTab() {
    const overall = state.results;
    const banner = document.getElementById("results-sample-banner");
    document.querySelectorAll("#tab-results > .card").forEach((card) => { card.hidden = !overall; });
    if (!overall) {
      banner.hidden = true;
      return;
    }

    renderLocationFilters();
    const { results: r, label, filtered } = scopedResults(overall);
    document.getElementById("results-scope").textContent = label;
    document.getElementById("results-party-hint").textContent = filtered
      ? "Hlasy a účast pouze za vybrané sečtené okrsky. Mandáty se rozdělují za celé zastupitelstvo, nikoliv podle sídla nebo okrsku."
      : "Průběžné mandáty jsou odhad podle aktuálních hlasů; oficiální výsledky budou až po úplném sečtení.";
    document.getElementById("results-council-hint").textContent = filtered
      ? "Zastupitelstvo celé Prahy 12 — výběr sídla ani okrsku tento seznam nemění. Křesla se obsadí podle seznamu zvolených zastupitelů zveřejněného ČSÚ."
      : "Křesla se obsadí podle seznamu zvolených zastupitelů zveřejněného ČSÚ.";
    const estimate = filtered ? null : estimatePartialMandates(r);
    banner.hidden = filtered || (!r.isSample && r.isComplete !== false);
    document.getElementById("results-sample-text").textContent = overall.isSample
      ? overall.sampleNote
      : estimate
        ? "Průběžný odhad mandátů vychází z dosavadních hlasů, zákonné uzavírací klauzule (zohledňuje počet kandidátů listiny) a d'Hondtovy metody; může se změnit. Jména zvolených zastupitelů a oficiální mandáty budou známy po úplném sečtení."
        : "Průběžná data ČSÚ. Odhad mandátů se zobrazí po započtení prvního okrsku; oficiální mandáty a zvolení zastupitelé budou uvedeni až po úplném sečtení.";

    const precinctsPct = r.precinctsTotal ? round1((r.precinctsCounted / r.precinctsTotal) * 100) : 0;
    document.getElementById("results-precincts").textContent = `${r.precinctsCounted} z ${r.precinctsTotal} (${precinctsPct}\u00a0%)`;
    document.getElementById("results-precincts-fill").style.width = `${precinctsPct}%`;
    document.getElementById("results-turnout").textContent = r.turnoutPercent == null ? "–" : `${r.turnoutPercent}\u00a0%`;
    const updated = r.generatedAt ? new Date(r.generatedAt) : null;
    document.getElementById("results-updated").textContent = updated
      ? updated.toLocaleString("cs-CZ")
      : "–";
    document.getElementById("results-fetched").textContent = r.fetchedAt
      ? r.fetchedAt.toLocaleString("cs-CZ")
      : "–";

    const maxPct = Math.max(...r.parties.map((p) => p.votesPercent), 1);
    const renderPartyResult = (p) => {
      let mandateLabel;
      if (filtered) {
        mandateLabel = `${p.votes.toLocaleString("cs-CZ")}\u00a0hlasů`;
      } else if (p.seats != null) {
        mandateLabel = `${p.seats}\u00a0mandátů`;
      } else if (estimate && !estimate.eligible.has(p.id)) {
        mandateLabel = "pod uzavírací klauzulí";
      } else if (estimate) {
        mandateLabel = `odhad: ${estimate.seats.get(p.id)}\u00a0mandátů`;
      } else {
        mandateLabel = "mandáty zatím neurčeny";
      }
      return `
        <div class="party-bar-row">
          <div class="party-bar-row__label"><span title="${p.name}">${p.id}. ${p.name}</span><span>${p.votesPercent}&nbsp;% · ${mandateLabel}</span></div>
          <div class="party-bar-row__track">
            <div class="party-bar-row__fill" style="width:${(p.votesPercent / maxPct) * 100}%"></div>
          </div>
        </div>`;
    };
    const aboveThreshold = r.parties.filter((p) => p.votesPercent >= 5);
    const belowThreshold = r.parties.filter((p) => p.votesPercent < 5);
    document.getElementById("results-party-chart").innerHTML =
      filtered && !r.precinctsCounted
        ? '<p class="empty-state" role="status">Vybrané okrsky zatím nejsou sečtené. Výsledky se zobrazí po zveřejnění dat ČSÚ.</p>'
        : aboveThreshold.map(renderPartyResult).join("") +
      (belowThreshold.length
        ? `<section class="results-below-threshold" aria-labelledby="results-below-threshold-title">
            <h3 id="results-below-threshold-title">Kandidátky pod 5 % hlasů</h3>
            <div class="party-bar-chart">${belowThreshold.map(renderPartyResult).join("")}</div>
          </section>`
        : "");

    const confirmed = overall.seats.filter((s) => s.name).length;
    document.getElementById("results-seats-confirmed").textContent = confirmed;
    document.getElementById("results-seats-total").textContent = overall.totalSeats;
    document.getElementById("results-seats-grid").innerHTML = groupSeatsByParty(overall)
      .flatMap((group, groupIndex) =>
        group.items.map((s) => {
          const stripe = groupIndex % 2 === 0 ? "seat-card--stripe-a" : "seat-card--stripe-b";
          return s.name
            ? `<div class="seat-card seat-card--filled ${stripe}">
                <div class="seat-card__top">
                  <span class="seat-card__number">#${s.seatNumber}</span>
                  <span class="seat-card__name" title="${s.name}">${s.name}</span>
                  <span class="seat-card__votes" title="${s.preferenceVotes}\u00a0hlasů pro kandidáta">${s.preferenceVotes}&nbsp;hl.</span>
                </div>
                <span class="seat-card__party" title="${s.partyName}">${s.partyName}</span>
              </div>`
            : `<div class="seat-card seat-card--pending ${stripe}">
                <div class="seat-card__top">
                  <span class="seat-card__number">#${s.seatNumber}</span>
                  <span class="seat-card__name">čeká na výsledek</span>
                </div>
              </div>`;
        })
      )
      .join("");
  }

  // Groups council seats by party (in the same order as the party results
  // table, i.e. most votes first) and sorts each group by preferential
  // votes, so the grid visually matches "who's ahead" at a glance.
  // Not-yet-confirmed seats (no party assigned) are collected into a last
  // group. The caller alternates a background stripe per returned group.
  function groupSeatsByParty(r) {
    const seatsByParty = new Map();
    const pending = [];
    r.seats.forEach((s) => {
      if (s.partyId == null) {
        pending.push(s);
        return;
      }
      if (!seatsByParty.has(s.partyId)) seatsByParty.set(s.partyId, []);
      seatsByParty.get(s.partyId).push(s);
    });

    const groups = r.parties
      .filter((p) => seatsByParty.has(p.id))
      .map((p) => ({
        partyId: p.id,
        items: seatsByParty.get(p.id).sort((a, b) => (b.preferenceVotes || 0) - (a.preferenceVotes || 0)),
      }));

    if (pending.length) {
      groups.push({ partyId: null, items: pending.sort((a, b) => a.seatNumber - b.seatNumber) });
    }
    return groups;
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

    initAgeSliderListeners();
  }

  function initAgeSliderListeners() {
    const min = document.getElementById("age-min");
    const max = document.getElementById("age-max");
    const minNumber = document.getElementById("age-min-number");
    const maxNumber = document.getElementById("age-max-number");

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
  }

  // Called once on load and again every time the municipality (and
  // therefore the available age range) changes.
  function updateAgeSliderBounds() {
    const min = document.getElementById("age-min");
    const max = document.getElementById("age-max");
    const minNumber = document.getElementById("age-min-number");
    const maxNumber = document.getElementById("age-max-number");

    min.min = max.min = minNumber.min = maxNumber.min = state.ageBounds.min;
    min.max = max.max = minNumber.max = maxNumber.max = state.ageBounds.max;

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
    initFilterControls();
    initOverviewControls();
    initMunicipalitySwitch();
    initResultsControls();

    const saved = localStorage.getItem("p12-municipality");
    const initialSlug = saved && MUNICIPALITIES[saved] ? saved : DEFAULT_MUNICIPALITY;
    await switchMunicipality(initialSlug);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
