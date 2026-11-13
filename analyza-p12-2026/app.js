(() => {
  const DATA = window.PROGRAM_ANALYSIS;
  const state = {
    query: "",
    topic: "all",
    view: "compare",
    relatedTags: [],
    sourceId: "",
  };

  const els = {
    topicFilter: document.getElementById("topic-filter"),
    search: document.getElementById("analysis-search"),
    parties: document.getElementById("party-overview"),
    compare: document.getElementById("view-compare"),
    matrix: document.getElementById("view-matrix"),
    matrixBody: document.getElementById("matrix-body"),
    empty: document.getElementById("analysis-empty"),
    exportBtn: document.getElementById("export-xlsx"),
    themeToggle: document.getElementById("theme-toggle"),
    relatedHint: document.getElementById("related-hint"),
  };

  function initTheme() {
    const saved = localStorage.getItem("p12-theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved || (prefersDark ? "dark" : "light");

    function applyTheme(t) {
      document.documentElement.setAttribute("data-theme", t);
      els.themeToggle.setAttribute("aria-checked", t === "dark" ? "true" : "false");
    }

    applyTheme(theme);
    els.themeToggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("p12-theme", next);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("cs")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function highlight(text) {
    const raw = String(text || "");
    const query = state.query.trim();
    if (!query) return escapeHtml(raw);
    const needle = normalize(query);
    if (!needle) return escapeHtml(raw);

    const indexMap = [];
    let normalized = "";
    for (let i = 0; i < raw.length; i += 1) {
      const piece = normalize(raw[i]);
      for (let j = 0; j < piece.length; j += 1) indexMap.push(i);
      normalized += piece;
    }

    let cursorNorm = 0;
    let cursorOrig = 0;
    let html = "";
    let from = 0;
    while ((from = normalized.indexOf(needle, cursorNorm)) !== -1) {
      const origFrom = indexMap[from];
      const origTo = indexMap[from + needle.length - 1] + 1;
      html += escapeHtml(raw.slice(cursorOrig, origFrom));
      html += `<mark class="hit">${escapeHtml(raw.slice(origFrom, origTo))}</mark>`;
      cursorNorm = from + needle.length;
      cursorOrig = origTo;
    }
    html += escapeHtml(raw.slice(cursorOrig));
    return html;
  }

  function matchesQuery(parts) {
    const needle = normalize(state.query.trim());
    if (!needle) return true;
    return parts.some((part) => normalize(part).includes(needle));
  }

  function topicMatches(topicId, topicIds) {
    if (state.topic === "all") return true;
    if (topicId) return topicId === state.topic;
    return (topicIds || []).includes(state.topic);
  }

  function splitPoints(value) {
    const items = Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : String(value || "")
          .split(/\s*;\s*/)
          .map((item) => item.trim())
          .filter(Boolean);
    return items.map((item) => item.charAt(0).toLocaleUpperCase("cs") + item.slice(1));
  }

  function tagsFor(text) {
    const n = normalize(text);
    const tags = [];
    if (/metro d/.test(n)) tags.push("metro-d");
    if (/tramvaj/.test(n) && /komoran/.test(n)) tags.push("tramvaj-komorany");
    if (/parkovac/.test(n)) tags.push("parkovaci-domy");
    if (/\bd0\b/.test(n) || /prazsk(?:y|eho) okruh/.test(n) || /obchvat komoran/.test(n)) tags.push("d0-obchvat");
    if (/vlak|\bs8\b/.test(n)) tags.push("vlak-s8");
    if (/cyklopruh/.test(n) || /paterni tahy vyhradne/.test(n)) tags.push("cyklopruhy-paterni");
    if (/cyklo|sdilenych kol|sdilena kola|vjezdu kol/.test(n)) tags.push("cyklodoprava");
    if (/p\+r/.test(n)) tags.push("p-plus-r");
    if (/zon placeneho|placeneho stani/.test(n)) tags.push("modre-zony");
    if (/skolni ulice|zony bez aut|cesty do skol|pre chod.*skol|prechod.*skol|bezpecn.*skol|okoli skol/.test(n)) {
      tags.push("bezpecnost-skoly");
    }
    if (/lavka/.test(n)) tags.push("lavky");
    if (/zs komoran|zakladni skola v komoran|zakladni skoly v komoranech/.test(n)) {
      tags.push("zs-komorany");
    }
    if (/t\. g\. masaryka/.test(n)) tags.push("zs-tgm-pavilon");
    if (/stredni skol|gymnaz/.test(n)) tags.push("stredni-skola");
    if (/obecni byt|bytoveho fondu|najemni bydleni|mestske najemni|socialniho bydleni/.test(n)) {
      tags.push("obecni-byty");
    }
    if (/prodej majetku|prodej mestskych byt|ukonceni prodeje|nebudeme prodavat|privatizac/.test(n)) {
      tags.push("prodej-majetku");
    }
    if (/zahustov|vysokopodlaz|predimenzovan|nadsazen|charakter vilov|raz cholupic/.test(n)) {
      tags.push("regulace-vystavby");
    }
    if (/developer|obcanska vybavenost|obcanskou vybavenost|prispevky developer/.test(n)) {
      tags.push("vybavenost-developeri");
    }
    if (/sofijsk|prior|galerie modrany/.test(n)) tags.push("sofijak-prior");
    if (/zbrojni|oc labe/.test(n)) tags.push("cholupice-labe");
    if (/fotovolta|solarni/.test(n)) tags.push("fve");
    if (/prevzeti uklidu|mestsky zahradnik/.test(n)) tags.push("uklid-zelen");
    if (/destov|sucho|vedr|zadrzovani vody|adaptac/.test(n)) tags.push("destova-voda");
    if (/belari/.test(n)) tags.push("belarie");
    if (/bazen/.test(n)) tags.push("bazen");
    if (/domov senior|dum pro seniory|zarubov|vapcarov/.test(n)) tags.push("domov-senioru");
    if (/kamer/.test(n)) tags.push("kamery");
    if (/straznik|hlidek mestske policie|okrskov/.test(n)) tags.push("straznici-mp");
    if (/asistent/.test(n) && /prevence/.test(n)) tags.push("asistenti-prevence");
    if (/poliklinik(?:y|a) modran|provozovatele poliklinik/.test(n)) tags.push("poliklinika");
    if (/portal|digitaliz|online sluz|online zapis|elektronick/.test(n)) tags.push("digitalizace");
    if (
      /rozklikavac|otevrenych mestech|open source|jmenovite hlasovani|zverejnovani zadani|zverejneni maxima informaci|dohled nad hospodarenim/.test(
        n
      )
    ) {
      tags.push("transparentnost");
    }
    if (/participativn/.test(n)) tags.push("participativni-rozpocet");
    if (/kulturni(ho)? domu v cholupic|komunitni centrum (na tocne|v odkoupen)|namesti v tocne|namesti v cholupic/.test(n)) {
      tags.push("komunity-okraje");
    }
    if (/knihovn|kulturni sal|viceuceloveho kulturniho salu/.test(n)) tags.push("knihovna-sal");
    if (/sportovn|spolk|lodenic|pump-track|mikrogrant|atletick/.test(n)) tags.push("sport-spolky");
    if (/alkohol|nizkoprah|bezdomov|nelegalniho prodeje drog|drogam ve verejnem/.test(n)) {
      tags.push("alkohol-bezdomovectvi");
    }
    if (/senior taxi/.test(n)) tags.push("senior-taxi");
    return [...new Set(tags)];
  }

  function renderPoints(text, partyId, topicId) {
    const points = splitPoints(text);
    if (!points.length) return "";
    return `<ul class="point-list">${points
      .map((point, index) => {
        const tags = tagsFor(point);
        const extras = tags.length
          ? ` data-tags="${escapeHtml(tags.join(" "))}" data-source="${escapeHtml(`${topicId}-${partyId}-${index}`)}" tabindex="0" role="button"`
          : "";
        return `<li${extras}>${highlight(point)}</li>`;
      })
      .join("")}</ul>`;
  }

  function relatedLabels() {
    return DATA.matrix.filter((row) => state.relatedTags.includes(row.id)).map((row) => row.measure);
  }

  function collectEvidence(tagId) {
    return DATA.parties.map((party) => {
      const items = [];
      DATA.topics.forEach((topic) => {
        splitPoints(topic.positions[party.id]).forEach((point) => {
          if (tagsFor(point).includes(tagId)) items.push({ topic: topic.title, point });
        });
      });
      return { party, items };
    });
  }

  function renderMatrixEvidence(options) {
    document.querySelectorAll("tr.matrix-evidence").forEach((el) => el.remove());
    const fromMatrix = String(state.sourceId || "").startsWith("matrix-");
    const tagId = fromMatrix ? state.relatedTags[0] : "";
    if (!tagId) return;
    const sourceRow = document.querySelector(`tr[data-matrix-id="${CSS.escape(tagId)}"]`);
    if (!sourceRow) return;
    const measure = DATA.matrix.find((row) => row.id === tagId)?.measure || "";
    const colCount = DATA.parties.length + 2;
    const cards = collectEvidence(tagId)
      .map(({ party, items }) => {
        const list = items.length
          ? `<ul class="point-list">${items
              .map(
                (item) =>
                  `<li><span class="evidence-topic">${escapeHtml(item.topic)}</span>${highlight(item.point)}</li>`
              )
              .join("")}</ul>`
          : `<p class="evidence-empty">V programu výslovně neuvedeno</p>`;
        return `
          <article class="evidence-card party-${party.id}">
            <div class="compare-card__party">${escapeHtml(party.short)}</div>
            ${list}
          </article>`;
      })
      .join("");
    const detail = document.createElement("tr");
    detail.className = "matrix-evidence";
    detail.innerHTML = `
      <td colspan="${colCount}">
        <div class="evidence-panel">
          <p class="evidence-heading">Podklady v programech${measure ? `: ${escapeHtml(measure)}` : ""}</p>
          <div class="evidence-grid">${cards}</div>
        </div>
      </td>`;
    sourceRow.after(detail);
    if (options && options.scroll) {
      detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function applyRelated(options) {
    const active = state.relatedTags.length > 0;
    document.body.classList.toggle("is-linking", active);
    document.querySelectorAll("[data-tags]").forEach((el) => {
      const tags = (el.dataset.tags || "").split(" ").filter(Boolean);
      const match = tags.some((tag) => state.relatedTags.includes(tag));
      el.classList.toggle("is-related", match);
      el.classList.toggle("is-source", Boolean(state.sourceId) && el.dataset.source === state.sourceId);
    });
    document.querySelectorAll("[data-matrix-id]").forEach((el) => {
      el.classList.toggle("is-related", state.relatedTags.includes(el.dataset.matrixId));
    });
    renderMatrixEvidence(options);
    if (!els.relatedHint) return;
    if (!active) {
      els.relatedHint.hidden = true;
      els.relatedHint.textContent = "";
      return;
    }
    const fromMatrix = String(state.sourceId || "").startsWith("matrix-");
    const labels = relatedLabels();
    els.relatedHint.hidden = false;
    els.relatedHint.textContent = fromMatrix
      ? "Pod řádkem jsou citace z programů. Klikněte znovu nebo stiskněte Esc pro zrušení."
      : labels.length
        ? `Související: ${labels.join(" · ")}. Klikněte znovu nebo stiskněte Esc pro zrušení.`
        : "Související body jsou zvýrazněné. Klikněte znovu nebo stiskněte Esc pro zrušení.";
  }

  function setRelated(tags, sourceId, options) {
    const unique = [...new Set(tags)].filter(Boolean);
    if (sourceId && sourceId === state.sourceId) {
      state.relatedTags = [];
      state.sourceId = "";
      applyRelated();
      return;
    }
    state.relatedTags = unique;
    state.sourceId = sourceId || unique.join("|");
    applyRelated(options);
  }

  function renderParties() {
    els.parties.innerHTML = DATA.parties
      .map(
        (party) => `
        <article class="party-overview__card party-${party.id}">
          <strong>${escapeHtml(party.name)}</strong>
          <a href="${escapeHtml(party.url)}" target="_blank" rel="noopener noreferrer">Volební program</a>
        </article>`
      )
      .join("");
  }

  function fillTopicFilter() {
    const options = [`<option value="all">Všechna témata</option>`]
      .concat(
        DATA.topics.map(
          (topic) =>
            `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.filterLabel || topic.title)}</option>`
        )
      )
      .join("");
    els.topicFilter.innerHTML = options;
  }

  function renderCompare() {
    const blocks = DATA.topics
      .filter((topic) => topicMatches(topic.id))
      .map((topic) => {
        const cards = DATA.parties.map((party) => {
          const text = topic.positions[party.id] || "";
          const visible = matchesQuery([
            topic.title,
            party.name,
            party.short,
            party.leader,
            ...splitPoints(text),
          ]);
          return {
            visible,
            html: `
            <article class="compare-card party-${party.id}${visible ? "" : " is-dimmed"}">
              <div class="compare-card__party">${escapeHtml(party.short)}</div>
              ${renderPoints(text, party.id, topic.id)}
            </article>`,
          };
        });
        const anyMatch = cards.some((card) => card.visible) || matchesQuery([topic.title]);
        if (state.query.trim() && !anyMatch) return "";
        return `
          <section class="topic-block" data-topic="${escapeHtml(topic.id)}">
            <h2>${highlight(topic.title)}</h2>
            <div class="compare-grid">${cards.map((card) => card.html).join("")}</div>
          </section>`;
      })
      .filter(Boolean)
      .join("");

    els.compare.innerHTML = blocks;
  }

  function renderMatrix() {
    const rows = DATA.matrix
      .filter((row) => topicMatches(null, row.topicIds))
      .filter((row) => {
        const stanceText = DATA.parties.map((party) => row.stances[party.id]?.label || "");
        return matchesQuery([row.measure, row.agreementLabel, ...stanceText]);
      });

    els.matrixBody.innerHTML = rows
      .map((row) => {
        const cells = DATA.parties
          .map((party) => {
            const stance = row.stances[party.id];
            return `<td><span class="stance stance--${escapeHtml(stance.kind)}">${highlight(stance.label)}</span></td>`;
          })
          .join("");
        return `
          <tr class="status-${escapeHtml(row.status)}" data-matrix-id="${escapeHtml(row.id)}" tabindex="0">
            <th scope="row">${highlight(row.measure)}</th>
            ${cells}
            <td><span class="agreement-pill agreement-pill--${escapeHtml(row.status)}">${highlight(row.agreementLabel)}</span></td>
          </tr>`;
      })
      .join("");
  }

  function updateEmptyState() {
    const hasCompare = els.compare.querySelector(".topic-block");
    const hasMatrix = els.matrixBody.querySelector("tr");
    const currentHasContent = state.view === "compare" ? hasCompare : hasMatrix;
    els.empty.hidden = Boolean(currentHasContent);
  }

  function render() {
    renderCompare();
    renderMatrix();
    els.compare.hidden = state.view !== "compare";
    els.matrix.hidden = state.view !== "matrix";
    updateEmptyState();
    applyRelated();
  }

  function estimateRowHeight(values, colWidth) {
    const maxLen = Math.max(12, ...values.map((value) => String(value || "").length));
    const lines = Math.min(10, Math.ceil(maxLen / Math.max(18, colWidth - 2)));
    return { hpt: Math.max(18, lines * 16) };
  }

  function sheetFromAoA(rows, colWidths, extra) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = colWidths.map((width) => ({ wch: width }));
    sheet["!rows"] = rows.map((row) => estimateRowHeight(row, Math.min(...colWidths.slice(1, colWidths.length) || colWidths)));
    if (extra && extra.merges) sheet["!merges"] = extra.merges;
    if (extra && extra.freezeRows) {
      sheet["!views"] = [{ state: "frozen", ySplit: extra.freezeRows, topLeftCell: `A${extra.freezeRows + 1}` }];
    }
    return sheet;
  }

  function compareExportSheet() {
    const headers = ["Téma", ...DATA.parties.map((party) => party.short)];
    const rows = [headers];
    const merges = [];

    DATA.topics.forEach((topic) => {
      const lists = DATA.parties.map((party) => splitPoints(topic.positions[party.id]));
      const maxPoints = Math.max(1, ...lists.map((list) => list.length));
      const start = rows.length;
      for (let i = 0; i < maxPoints; i += 1) {
        rows.push([i === 0 ? topic.title : "", ...lists.map((list) => list[i] || "")]);
      }
      if (maxPoints > 1) {
        merges.push({ s: { r: start, c: 0 }, e: { r: start + maxPoints - 1, c: 0 } });
      }
      rows.push([]);
    });

    if (rows.length > 1 && !rows[rows.length - 1].some(Boolean)) rows.pop();

    return sheetFromAoA(rows, [28, 38, 38, 38, 38, 38], { merges, freezeRows: 1 });
  }

  function matrixExportSheet() {
    const rows = [
      ["Opatření", ...DATA.parties.map((party) => party.short), "Stav shody"],
      ...DATA.matrix.map((row) => [
        row.measure,
        ...DATA.parties.map((party) => row.stances[party.id]?.label || ""),
        row.agreementLabel,
      ]),
    ];
    return sheetFromAoA(rows, [42, 22, 28, 28, 28, 22, 32], { freezeRows: 1 });
  }

  function pointsListSheet() {
    const rows = [["Téma", "Strana", "Bod programu"]];
    DATA.topics.forEach((topic) => {
      DATA.parties.forEach((party) => {
        splitPoints(topic.positions[party.id]).forEach((point) => {
          rows.push([topic.title, party.short, point]);
        });
      });
    });
    return sheetFromAoA(rows, [28, 22, 80], { freezeRows: 1 });
  }

  function exportWorkbook() {
    if (typeof XLSX === "undefined") return;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, compareExportSheet(), "Srovnání po tématech");
    XLSX.utils.book_append_sheet(workbook, matrixExportSheet(), "Analytická matice");
    XLSX.utils.book_append_sheet(workbook, pointsListSheet(), "Seznam bodů");
    XLSX.writeFile(workbook, "srovnani-programu-praha12-2026.xlsx");
  }

  function initViewToggle() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view;
        document.querySelectorAll("[data-view]").forEach((item) => {
          item.classList.toggle("is-active", item === button);
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        render();
      });
    });
  }

  function init() {
    initTheme();
    fillTopicFilter();
    renderParties();
    render();
    initViewToggle();

    els.search.addEventListener("input", () => {
      state.query = els.search.value;
      render();
    });
    els.topicFilter.addEventListener("change", () => {
      state.topic = els.topicFilter.value;
      render();
    });
    els.exportBtn.addEventListener("click", exportWorkbook);
    if (typeof XLSX === "undefined") {
      els.exportBtn.disabled = true;
      els.exportBtn.title = "Knihovna SheetJS se nenačetla";
    }

    function eventEl(event) {
      const node = event.target;
      return node instanceof Element ? node : node && node.parentElement;
    }

    els.compare.addEventListener("click", (event) => {
      const el = eventEl(event);
      const point = el && el.closest("li[data-tags]");
      if (!point) return;
      event.stopPropagation();
      setRelated((point.dataset.tags || "").split(" "), point.dataset.source);
    });
    els.matrix.addEventListener("click", (event) => {
      const el = eventEl(event);
      const row = el && el.closest("tr[data-matrix-id]");
      if (!row) return;
      event.stopPropagation();
      setRelated([row.dataset.matrixId], `matrix-${row.dataset.matrixId}`, { scroll: true });
    });
    document.addEventListener("click", (event) => {
      if (!state.relatedTags.length) return;
      const el = eventEl(event);
      if (el && el.closest(".analysis-toolbar, .party-overview a, li[data-tags], tr[data-matrix-id], tr.matrix-evidence")) {
        return;
      }
      setRelated([], "");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setRelated([], "");
      if (event.key !== "Enter") return;
      const el = eventEl(event);
      const point = el && el.closest("li[data-tags]");
      if (point) setRelated((point.dataset.tags || "").split(" "), point.dataset.source);
      const row = el && el.closest("tr[data-matrix-id]");
      if (row) setRelated([row.dataset.matrixId], `matrix-${row.dataset.matrixId}`, { scroll: true });
    });
  }

  init();
})();
