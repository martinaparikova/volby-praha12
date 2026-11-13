(() => {
  const DATA = window.PROGRAM_ANALYSIS;
  const state = {
    query: "",
    topic: "all",
    view: "compare",
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

  function splitPoints(text) {
    return String(text || "")
      .split(/\s*;\s*/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.charAt(0).toLocaleUpperCase("cs") + item.slice(1));
  }

  function renderPoints(text) {
    const points = splitPoints(text);
    if (!points.length) return "";
    return `<ul class="point-list">${points.map((point) => `<li>${highlight(point)}</li>`).join("")}</ul>`;
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
          const visible = matchesQuery([topic.title, party.name, party.short, party.leader, text]);
          return {
            visible,
            html: `
            <article class="compare-card party-${party.id}${visible ? "" : " is-dimmed"}">
              <div class="compare-card__party">${escapeHtml(party.short)}</div>
              ${renderPoints(text)}
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
          <tr class="status-${escapeHtml(row.status)}">
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
  }

  function sheetFromAoA(rows, colWidths) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = colWidths.map((width) => ({ wch: width }));
    return sheet;
  }

  function exportWorkbook() {
    if (typeof XLSX === "undefined") return;

    const partyHeaders = DATA.parties.map((party) => party.name);
    const compareRows = [
      ["Téma", ...partyHeaders],
      ...DATA.topics.map((topic) => [
        topic.title,
        ...DATA.parties.map((party) => splitPoints(topic.positions[party.id]).join("\n")),
      ]),
    ];
    const matrixRows = [
      ["Opatření", ...DATA.parties.map((party) => party.short), "Stav shody"],
      ...DATA.matrix.map((row) => [
        row.measure,
        ...DATA.parties.map((party) => row.stances[party.id]?.label || ""),
        row.agreementLabel,
      ]),
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      sheetFromAoA(compareRows, [28, 48, 48, 48, 48, 48]),
      "Srovnání po tématech"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      sheetFromAoA(matrixRows, [42, 22, 28, 28, 28, 22, 32]),
      "Analytická matice"
    );
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
  }

  init();
})();
