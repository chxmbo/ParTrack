const STORAGE_KEY = "partrack:v1";
const LEGACY_STORAGE_KEY = "loop-handicap:v1";
const todayIso = () => new Date().toISOString().slice(0, 10);
const todayLabel = () => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
const round1 = (value) => Math.round((value + Number.EPSILON) * 10) / 10;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const defaultPars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const defaultYards = [385, 412, 168, 536, 397, 421, 177, 548, 404, 390, 426, 181, 552, 405, 432, 172, 541, 410];
const defaultStrokeIndexes = [11, 3, 17, 7, 1, 9, 15, 5, 13, 12, 4, 18, 8, 2, 10, 16, 6, 14];

function createHoleCard(pars = defaultPars, yards = defaultYards, strokeIndexes = defaultStrokeIndexes) {
  return Array.from({ length: 18 }, (_, index) => ({
    hole: index + 1,
    par: pars[index] ?? 4,
    yards: yards[index] ?? null,
    handicap: strokeIndexes[index] ?? index + 1
  }));
}

const sampleCourses = [
  { id: uid(), name: "Wasatch Links", tee: "Blue", rating: 71.8, slope: 129, holes: createHoleCard() },
  { id: uid(), name: "Cedar Ridge", tee: "White", rating: 69.7, slope: 123, holes: createHoleCard([4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], [361, 398, 142, 501, 374, 168, 386, 514, 392, 376, 402, 155, 521, 389, 417, 149, 508, 393]) },
  { id: uid(), name: "Desert Mesa", tee: "Gold", rating: 73.1, slope: 136, holes: createHoleCard([4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], [423, 561, 184, 441, 413, 572, 201, 429, 438, 414, 447, 196, 589, 428, 452, 188, 574, 436]) }
];

function createScoredHoleCard(course, targetScore) {
  const holes = course.holes.map((hole) => ({
    hole: hole.hole,
    par: Number(hole.par) || 4,
    yards: Number(hole.yards) || null,
    handicap: Number(hole.handicap) || hole.hole,
    strokes: Number(hole.par) || 4
  }));
  let delta = targetScore - holes.reduce((sum, hole) => sum + hole.strokes, 0);
  const hardToEasy = [...holes].sort((a, b) => a.handicap - b.handicap);
  const easyToHard = [...holes].sort((a, b) => b.handicap - a.handicap);

  while (delta > 0) {
    for (const hole of hardToEasy) {
      if (delta <= 0) break;
      hole.strokes += 1;
      delta -= 1;
    }
  }

  while (delta < 0) {
    for (const hole of easyToHard) {
      if (delta >= 0) break;
      if (hole.strokes > 1) {
        hole.strokes -= 1;
        delta += 1;
      }
    }
  }

  return holes.sort((a, b) => a.hole - b.hole);
}

const seedRounds = (courses) => [
  { course: courses[0], date: "2026-03-02", score: 88, pcc: 0 },
  { course: courses[1], date: "2026-03-10", score: 84, pcc: 0 },
  { course: courses[2], date: "2026-03-17", score: 91, pcc: 1 },
  { course: courses[0], date: "2026-03-25", score: 83, pcc: 0 },
  { course: courses[1], date: "2026-04-04", score: 86, pcc: 0 },
  { course: courses[2], date: "2026-04-11", score: 82, pcc: -1 }
].map((round) => ({
  id: uid(),
  createdAt: Date.now(),
  courseId: round.course.id,
  date: round.date,
  pcc: round.pcc,
  holes: createScoredHoleCard(round.course, round.score)
}));

const state = loadState();

const views = [...document.querySelectorAll(".view")];
const links = [...document.querySelectorAll("[data-view-link]")];
const title = document.querySelector("#view-title");
const roundDialog = document.querySelector("#roundDialog");
const roundForm = document.querySelector("#roundForm");
const courseForm = document.querySelector("#courseForm");
const courseFormToggle = document.querySelector("[data-toggle-course-form]");
const courseSelect = document.querySelector("#courseSelect");
const holeRows = document.querySelector("#holeRows");
const holeTotals = document.querySelector("#holeTotals");
const strokeButtons = document.querySelector("#strokeButtons");
const roundHoleGrid = document.querySelector("#roundHoleGrid");
const selectedCourseIdsByName = {};
const roundHoleState = {
  activeHole: 1,
  holes: []
};

function loadState() {
  const fallback = { courses: [...sampleCourses], rounds: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
    if (stored && Array.isArray(stored.courses) && Array.isArray(stored.rounds)) {
      stored.courses = stored.courses.map(normalizeCourse);
      stored.rounds = stored.rounds.map((round) => normalizeRound(round, stored.courses));
      return stored;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeCourse(course) {
  const holes = Array.isArray(course.holes) && course.holes.length === 18
    ? course.holes.map((hole, index) => ({
      hole: index + 1,
      par: Number(hole.par) || 4,
      yards: Number(hole.yards) || null,
      handicap: Number(hole.handicap) || index + 1
    }))
    : createLegacyHoleCard(course.par);
  return { ...course, holes, par: totalPar({ holes, par: course.par }) };
}

function createLegacyHoleCard(par) {
  const targetPar = Number(par) || 72;
  const holes = createHoleCard(defaultPars, Array.from({ length: 18 }, () => null), defaultStrokeIndexes);
  let delta = targetPar - totalPar({ holes });
  for (const hole of holes) {
    if (delta === 0) break;
    if (delta > 0 && hole.par < 5) {
      hole.par += 1;
      delta -= 1;
    }
    if (delta < 0 && hole.par > 3) {
      hole.par -= 1;
      delta += 1;
    }
  }
  return holes;
}

function courseById(id) {
  return state.courses.find((course) => course.id === id);
}

function normalizeRound(round, courses = state?.courses || []) {
  const course = courses.find((item) => item.id === round.courseId);
  const holes = Array.isArray(round.holes) && round.holes.length === 18
    ? round.holes.map((hole, index) => ({
      hole: index + 1,
      par: Number(hole.par) || Number(course?.holes?.[index]?.par) || 4,
      yards: Number(hole.yards) || Number(course?.holes?.[index]?.yards) || null,
      handicap: Number(hole.handicap) || Number(course?.holes?.[index]?.handicap) || index + 1,
      strokes: Number(hole.strokes) || null
    }))
    : course
      ? createScoredHoleCard(course, Number(round.score) || totalPar(course))
      : [];

  return {
    ...round,
    pcc: Number(round.pcc) || 0,
    score: holes.length ? roundScore({ holes }) : Number(round.score) || null,
    holes
  };
}

function totalPar(course) {
  if (Array.isArray(course.holes) && course.holes.length) {
    return course.holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  }
  return Number(course.par) || 72;
}

function totalYards(course) {
  if (!Array.isArray(course.holes)) return null;
  const yards = course.holes.map((hole) => Number(hole.yards)).filter(Number.isFinite);
  return yards.length ? yards.reduce((sum, value) => sum + value, 0) : null;
}

function hasHoleScore(hole) {
  return hole?.strokes !== null && hole?.strokes !== "" && hole?.strokes !== undefined && Number.isFinite(Number(hole.strokes));
}

function roundScore(round) {
  if (Array.isArray(round.holes) && round.holes.length) {
    const strokes = round.holes.filter(hasHoleScore).map((hole) => Number(hole.strokes));
    return strokes.length === 18 ? strokes.reduce((sum, value) => sum + value, 0) : null;
  }
  return Number(round.score) || null;
}

function roundToPar(round) {
  if (!Array.isArray(round.holes) || !round.holes.length) return null;
  const score = roundScore(round);
  const par = round.holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  return Number.isFinite(score) ? score - par : null;
}

function differential(round, course = courseById(round.courseId)) {
  if (!course) return null;
  const score = roundScore(round);
  if (!Number.isFinite(score)) return null;
  return round1((113 / Number(course.slope)) * (score - Number(course.rating) - Number(round.pcc || 0)));
}

function roundWithMath(round) {
  const course = courseById(round.courseId);
  return {
    ...round,
    course,
    score: roundScore(round),
    toPar: roundToPar(round),
    differential: differential(round, course)
  };
}

function scoringRecord() {
  return state.rounds
    .map(roundWithMath)
    .filter((round) => round.course && Number.isFinite(round.score) && Number.isFinite(round.differential))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function indexRule(count) {
  if (count < 3) return null;
  if (count === 3) return { used: 1, adjustment: -2 };
  if (count === 4) return { used: 1, adjustment: -1 };
  if (count === 5) return { used: 1, adjustment: 0 };
  if (count === 6) return { used: 2, adjustment: -1 };
  if (count <= 8) return { used: 2, adjustment: 0 };
  if (count <= 11) return { used: 3, adjustment: 0 };
  if (count <= 14) return { used: 4, adjustment: 0 };
  if (count <= 16) return { used: 5, adjustment: 0 };
  if (count <= 18) return { used: 6, adjustment: 0 };
  if (count === 19) return { used: 7, adjustment: 0 };
  return { used: 8, adjustment: 0 };
}

function indexFromRecord(record) {
  const recent = record.slice(0, 20);
  const rule = indexRule(recent.length);
  if (!rule) {
    return { recent, index: null, usedRounds: [], rule: null };
  }

  const usedRounds = [...recent]
    .sort((a, b) => a.differential - b.differential)
    .slice(0, rule.used);
  const average = usedRounds.reduce((sum, round) => sum + round.differential, 0) / usedRounds.length;
  const index = Math.min(54, round1(average + rule.adjustment));
  return { recent, index, usedRounds, rule };
}

function handicapSummary() {
  const record = scoringRecord();
  return { record, ...indexFromRecord(record) };
}

function handicapChangesByRound(record) {
  const chronological = [...record].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const changes = {};
  for (let index = 0; index < chronological.length; index += 1) {
    const before = indexFromRecord(chronological.slice(0, index).reverse()).index;
    const after = indexFromRecord(chronological.slice(0, index + 1).reverse()).index;
    changes[chronological[index].id] = {
      before,
      after,
      delta: Number.isFinite(before) && Number.isFinite(after) ? round1(after - before) : null
    };
  }
  return changes;
}

function route() {
  const id = location.hash.replace("#", "") || "dashboard";
  const activeId = views.some((view) => view.id === id) ? id : "dashboard";
  views.forEach((view) => view.classList.toggle("active", view.id === activeId));
  links.forEach((link) => link.classList.toggle("active", link.dataset.viewLink === activeId));
  title.textContent = activeId[0].toUpperCase() + activeId.slice(1);
  render();
}

function render() {
  renderHoleEditor();
  renderCourseSelect();
  renderDashboard();
  renderRounds();
  renderCourses();
}

function renderDashboard() {
  const summary = handicapSummary();
  const record = summary.record;
  const best = [...record].sort((a, b) => a.differential - b.differential)[0];
  const scores = record.map((round) => Number(round.score));
  const toPar = record.map((round) => Number(round.toPar)).filter(Number.isFinite);

  document.querySelector("#handicapIndex").textContent = summary.index === null ? "--" : summary.index.toFixed(1);
  document.querySelector("#handicapStatus").textContent = indexStatus(summary);
  document.querySelector("#roundCount").textContent = record.length;
  document.querySelector("#recentWindow").textContent = `${summary.recent.length} in current window`;
  document.querySelector("#bestDifferential").textContent = best ? best.differential.toFixed(1) : "--";
  document.querySelector("#heroBestDiff").textContent = best ? best.differential.toFixed(1) : "--";
  document.querySelector("#bestRoundLabel").textContent = best ? `${best.course.name}, ${formatDate(best.date)}` : "No rounds yet";
  document.querySelector("#averageScore").textContent = scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "--";
  document.querySelector("#averagePutts").textContent = toPar.length ? `${formatToPar(round1(toPar.reduce((a, b) => a + b, 0) / toPar.length))} avg to par` : "No completed rounds";
  document.querySelector("#countToTwenty").textContent = summary.recent.length >= 20 ? "Full 20-round index" : `${20 - summary.recent.length} to full index`;
  document.querySelector("#twentyProgressLabel").textContent = `${Math.min(summary.recent.length, 20)}/20`;
  document.querySelector("#twentyProgressText").textContent = summary.recent.length >= 20
    ? "Full handicap window"
    : `${20 - summary.recent.length} rounds until full window`;
  document.querySelector(".progress-ring").style.setProperty("--progress", `${Math.min(summary.recent.length, 20) / 20}`);

  renderCountingScores(summary);
  drawTrend(summary.recent);
}

function indexStatus(summary) {
  if (summary.index === null) {
    const needed = 3 - summary.recent.length;
    return `Add ${needed} more completed ${needed === 1 ? "round" : "rounds"} to establish an index.`;
  }

  const adjustment = summary.rule.adjustment ? `, ${summary.rule.adjustment.toFixed(1)} adjustment` : "";
  return `Using ${summary.rule.used} of ${summary.recent.length} latest handicap values${adjustment}.`;
}

function renderCountingScores(summary) {
  const target = document.querySelector("#countingScores");
  if (!summary.usedRounds.length) {
    target.innerHTML = `<div class="empty">Counting scores appear after 3 rounds.</div>`;
    return;
  }

  target.innerHTML = summary.usedRounds
    .map((round) => `
      <div class="score-chip">
        <div>
          <strong>${round.differential.toFixed(1)}</strong>
          <div>${escapeHtml(round.course.name)} · ${formatDate(round.date)}</div>
        </div>
        <span>${round.score}</span>
      </div>
    `)
    .join("");
}

function drawTrend(rounds) {
  const canvas = document.querySelector("#trendChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(320 * dpr));
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = 320;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);

  if (!rounds.length) {
    ctx.fillStyle = "#637268";
    ctx.font = "700 15px system-ui";
    ctx.fillText("Add rounds to draw a trend.", 24, 45);
    return;
  }

  const chronological = [...rounds].reverse();
  const values = chronological.map((round) => round.differential);
  const min = Math.floor(Math.min(...values) - 2);
  const max = Math.ceil(Math.max(...values) + 2);
  const pad = { top: 24, right: 24, bottom: 38, left: 42 };
  const xStep = values.length === 1 ? 0 : (width - pad.left - pad.right) / (values.length - 1);
  const y = (value) => pad.top + ((max - value) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);

  ctx.strokeStyle = "#dce5dc";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#637268";
  ctx.font = "700 12px system-ui";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = min + ((max - min) * tick) / 4;
    const yy = y(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
    ctx.stroke();
    ctx.fillText(round1(value).toFixed(1), 8, yy + 4);
  }

  const points = values.map((value, index) => ({
    x: pad.left + (values.length === 1 ? (width - pad.left - pad.right) / 2 : xStep * index),
    y: y(value),
    value
  }));

  ctx.strokeStyle = "#2f6788";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  points.forEach((point) => {
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2f6788";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function renderRounds() {
  const target = document.querySelector("#roundList");
  const record = scoringRecord();
  const currentHandicapIndex = handicapSummary().index;
  const handicapChanges = handicapChangesByRound(record);
  if (!record.length) {
    target.innerHTML = `<div class="empty">No rounds yet. Add one from the top button.</div>`;
    return;
  }

  target.innerHTML = record
    .map((round) => {
      const courseHandicap = playingHandicap(round.course, currentHandicapIndex);
      const netScore = Number.isFinite(currentHandicapIndex) ? round.score - courseHandicap : "--";
      return `
      <article class="round-item">
        <div>
          <div class="round-title">
            <strong>${escapeHtml(round.course.name)}</strong>
            <span>${escapeHtml(round.course.tee)} · ${formatDate(round.date)}</span>
          </div>
          <div class="round-meta">
            <span>${round.course.rating}/${round.course.slope}</span>
            <span>Par ${totalPar(round.course)}</span>
            <span>${formatToPar(round.toPar)}</span>
          </div>
          ${renderRoundCard(round, currentHandicapIndex)}
        </div>
        <div class="metric-grid">
          ${metric("Score", round.score)}
          ${metric("To par", formatToPar(round.toPar))}
          ${metric("Net score", netScore)}
          ${metric("Handicap", round.differential.toFixed(1), renderHandicapChange(handicapChanges[round.id]))}
        </div>
        <button class="delete-button" type="button" data-delete-round="${round.id}">Delete</button>
      </article>
    `;
    })
    .join("");
}

function renderRoundCard(round, handicapIndex = null) {
  if (!Array.isArray(round.holes) || round.holes.length !== 18) return "";
  const out = round.holes.slice(0, 9);
  const inNine = round.holes.slice(9);
  const dotsByHole = handicapDotsByHole(round.course, handicapIndex);
  return `
    <div class="scorecard-mini" aria-label="${escapeHtml(round.course.name)} ${formatDate(round.date)} scores">
      ${renderScoreNine("Out", out, dotsByHole)}
      ${renderScoreNine("In", inNine, dotsByHole)}
    </div>
  `;
}

function renderScoreNine(label, holes, dotsByHole = {}) {
  const parTotal = holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  const scoreTotal = holes.reduce((sum, hole) => sum + (Number(hole.strokes) || 0), 0);
  return `
    <div>
      <div class="scorecard-nine-label">${label}</div>
      <div class="scorecard-row scorecard-dot-row" aria-label="Handicap strokes">
        <span></span>
        ${holes.map((hole) => `<span>${renderStrokeDots(dotsByHole[hole.hole] || 0)}</span>`).join("")}
        <span></span>
      </div>
      <div class="scorecard-row scorecard-head">
        <span>Hole</span>
        ${holes.map((hole) => `<span>${hole.hole}</span>`).join("")}
        <span>${label}</span>
      </div>
      <div class="scorecard-row">
        <span>Par</span>
        ${holes.map((hole) => `<span>${present(hole.par)}</span>`).join("")}
        <span>${parTotal}</span>
      </div>
      <div class="scorecard-row">
        <span>Score</span>
        ${holes.map((hole) => `<span>${renderScoreMark(hole)}</span>`).join("")}
        <span>${scoreTotal}</span>
      </div>
    </div>
  `;
}

function playingHandicap(course, handicapIndex) {
  if (!course || !Number.isFinite(Number(handicapIndex))) return 0;
  const raw = Number(handicapIndex) * (Number(course.slope) / 113) + Number(course.rating) - totalPar(course);
  return Math.max(0, Math.round(raw));
}

function handicapDotsByHole(course, handicapIndex) {
  const allowance = playingHandicap(course, handicapIndex);
  if (!allowance || !Array.isArray(course?.holes)) return {};
  const fullDots = Math.floor(allowance / 18);
  const extraDots = allowance % 18;
  return Object.fromEntries(
    course.holes.map((hole) => [
      hole.hole,
      fullDots + (Number(hole.handicap) <= extraDots ? 1 : 0)
    ])
  );
}

function renderStrokeDots(count) {
  return `<span class="stroke-dot-stack">${Array.from({ length: count }, () => `<i></i>`).join("")}</span>`;
}

function scoreMarkClass(hole) {
  if (!hasHoleScore(hole)) return "";
  const relative = Number(hole.strokes) - Number(hole.par);
  if (relative <= -2) return "score-mark eagle";
  if (relative === -1) return "score-mark birdie";
  if (relative === 1) return "score-mark bogey";
  if (relative >= 2) return "score-mark double-bogey";
  return "score-mark";
}

function renderScoreMark(hole) {
  const value = present(hole.strokes);
  const className = scoreMarkClass(hole);
  return className ? `<span class="${className}">${value}</span>` : value;
}

function renderCourses() {
  const target = document.querySelector("#courseList");
  if (!state.courses.length) {
    target.innerHTML = `<div class="empty">Add a course tee set to start tracking rounds.</div>`;
    return;
  }

  target.innerHTML = courseGroups()
    .map((group) => {
      const selectedId = selectedCourseIdsByName[group.name] || group.courses[0].id;
      const course = group.courses.find((item) => item.id === selectedId) || group.courses[0];
      selectedCourseIdsByName[group.name] = course.id;
      const yards = totalYards(course);
      const currentIndex = handicapSummary().index;
      const courseHandicap = Number.isFinite(currentIndex) ? playingHandicap(course, currentIndex) : null;
      return `
      <article class="course-item">
        <div>
          <div class="course-title course-title-with-select">
            <strong>${escapeHtml(group.name)}</strong>
            <label class="tee-select-label">
              Tee
              <select data-course-tee-select="${escapeHtml(group.name)}">
                ${group.courses.map((teeSet) => `<option value="${teeSet.id}" ${teeSet.id === course.id ? "selected" : ""}>${escapeHtml(teeSet.tee)}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="course-meta">
            <span>Rating ${Number(course.rating).toFixed(1)}</span>
            <span>Slope ${course.slope}</span>
            <span>Par ${totalPar(course)}</span>
            ${yards ? `<span>${yards.toLocaleString()} yards</span>` : ""}
            ${Number.isFinite(courseHandicap) ? `<span>Course hcp ${courseHandicap}</span>` : ""}
          </div>
          ${renderCourseStats(course)}
          ${renderCourseCard(course)}
        </div>
        <button class="delete-button" type="button" data-delete-course="${course.id}">Delete tee</button>
      </article>
    `;
    })
    .join("");
}

function courseGroups() {
  const groups = new Map();
  for (const course of state.courses) {
    const key = course.name.trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(course);
  }
  return [...groups.entries()]
    .map(([name, courses]) => ({
      name,
      courses: courses.sort((a, b) => String(a.tee).localeCompare(String(b.tee)))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderCourseStats(course) {
  const stats = courseStats(course);
  if (!stats.rounds) {
    return `<div class="course-performance empty">No rounds scored on this tee yet.</div>`;
  }

  return `
    <div class="course-performance">
      ${metric("Rounds", stats.rounds)}
      ${metric("Avg score", stats.averageScore.toFixed(1))}
      ${metric("Avg to par", formatToPar(stats.averageToPar))}
      ${metric("Par 3 avg", stats.byPar[3] ? stats.byPar[3].toFixed(2) : "--")}
      ${metric("Par 4 avg", stats.byPar[4] ? stats.byPar[4].toFixed(2) : "--")}
      ${metric("Par 5 avg", stats.byPar[5] ? stats.byPar[5].toFixed(2) : "--")}
    </div>
  `;
}

function courseStats(course) {
  const rounds = scoringRecord().filter((round) => round.courseId === course.id && Array.isArray(round.holes));
  const byParBuckets = { 3: [], 4: [], 5: [] };
  const scores = [];
  const toPars = [];

  for (const round of rounds) {
    scores.push(round.score);
    toPars.push(round.toPar);
    for (const hole of round.holes) {
      const par = Number(hole.par);
      const strokes = Number(hole.strokes);
      if (byParBuckets[par] && Number.isFinite(strokes)) byParBuckets[par].push(strokes);
    }
  }

  const average = (values) => values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  return {
    rounds: rounds.length,
    averageScore: average(scores),
    averageToPar: average(toPars),
    byPar: {
      3: average(byParBuckets[3]),
      4: average(byParBuckets[4]),
      5: average(byParBuckets[5])
    }
  };
}

function renderCourseCard(course) {
  if (!Array.isArray(course.holes) || course.holes.length !== 18) return "";
  const out = course.holes.slice(0, 9);
  const inNine = course.holes.slice(9);
  const currentIndex = handicapSummary().index;
  const dotsByHole = Number.isFinite(currentIndex) ? handicapDotsByHole(course, currentIndex) : null;
  return `
    <div class="scorecard-mini" aria-label="${escapeHtml(course.name)} ${escapeHtml(course.tee)} hole details">
      ${renderNine("Out", out, dotsByHole)}
      ${renderNine("In", inNine, dotsByHole)}
    </div>
  `;
}

function renderNine(label, holes, dotsByHole = null) {
  const parTotal = holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  const yardTotal = holes.reduce((sum, hole) => sum + (Number(hole.yards) || 0), 0);
  const strokeTotal = dotsByHole
    ? holes.reduce((sum, hole) => sum + (dotsByHole[hole.hole] || 0), 0)
    : null;
  return `
    <div>
      <div class="scorecard-nine-label">${label}</div>
      <div class="scorecard-row scorecard-head">
        <span>Hole</span>
        ${holes.map((hole) => `<span>${hole.hole}</span>`).join("")}
        <span>${label}</span>
      </div>
      <div class="scorecard-row">
        <span>Par</span>
        ${holes.map((hole) => `<span>${present(hole.par)}</span>`).join("")}
        <span>${parTotal}</span>
      </div>
      <div class="scorecard-row">
        <span>Yds</span>
        ${holes.map((hole) => `<span>${present(hole.yards)}</span>`).join("")}
        <span>${yardTotal || "--"}</span>
      </div>
      <div class="scorecard-row">
        <span>${dotsByHole ? "Stk" : "SI"}</span>
        ${holes.map((hole) => `<span>${dotsByHole ? renderCourseStrokeDots(dotsByHole[hole.hole] || 0) : present(hole.handicap)}</span>`).join("")}
        <span>${Number.isFinite(strokeTotal) ? strokeTotal || "--" : ""}</span>
      </div>
    </div>
  `;
}

function renderCourseStrokeDots(count) {
  return count ? renderStrokeDots(count) : "--";
}

function renderHoleEditor(preserveValues = true) {
  if (!holeRows) return;
  const active = document.activeElement;
  const activeName = active?.name;
  const existing = preserveValues ? new FormData(courseForm) : null;
  holeRows.innerHTML = createHoleCard().map((hole) => {
    const number = hole.hole;
    const par = existing?.get(`holePar${number}`) || hole.par;
    const yards = existing?.get(`holeYards${number}`) || hole.yards || "";
    const handicap = existing?.get(`holeHandicap${number}`) || hole.handicap;
    return `
      <tr>
        <th scope="row">${number}</th>
        <td><input aria-label="Hole ${number} par" name="holePar${number}" type="number" min="3" max="6" step="1" value="${par}" required /></td>
        <td><input aria-label="Hole ${number} yards" name="holeYards${number}" type="number" min="1" max="900" step="1" value="${yards}" /></td>
        <td><input aria-label="Hole ${number} handicap index" name="holeHandicap${number}" type="number" min="1" max="18" step="1" value="${handicap}" required /></td>
      </tr>
    `;
  }).join("");
  if (activeName) courseForm.elements[activeName]?.focus();
  updateHoleTotals();
}

function renderCourseSelect() {
  courseSelect.innerHTML = state.courses
    .map((course) => `<option value="${course.id}">${escapeHtml(course.name)} · ${escapeHtml(course.tee)}</option>`)
    .join("");
  updateSelectedCourseMeta();
}

function updateSelectedCourseMeta() {
  const course = courseById(courseSelect.value) || state.courses[0];
  const target = document.querySelector("#selectedCourseMeta");
  const yards = course ? totalYards(course) : null;
  target.textContent = course
    ? `Rating ${Number(course.rating).toFixed(1)} · Slope ${course.slope} · Par ${totalPar(course)}${yards ? ` · ${yards.toLocaleString()} yards` : ""}`
    : "Add a course before saving a round.";
}

function startRoundCard(course = courseById(courseSelect.value) || state.courses[0]) {
  roundHoleState.activeHole = 1;
  roundHoleState.holes = course
    ? course.holes.map((hole) => ({
      hole: hole.hole,
      par: Number(hole.par) || 4,
      yards: Number(hole.yards) || null,
      handicap: Number(hole.handicap) || hole.hole,
      strokes: null
    }))
    : [];
  renderRoundScoringUI();
}

function renderRoundScoringUI() {
  if (!strokeButtons || !roundHoleGrid) return;
  const active = roundHoleState.holes[roundHoleState.activeHole - 1];
  const completed = roundHoleState.holes.filter(hasHoleScore);
  const total = completed.reduce((sum, hole) => sum + Number(hole.strokes), 0);
  document.querySelector("#roundHoleNumber").textContent = active?.hole || "--";
  document.querySelector("#roundHoleYards").textContent = present(active?.yards);
  document.querySelector("#roundHolePar").textContent = present(active?.par);
  document.querySelector("#roundHoleHandicap").textContent = present(active?.handicap);
  document.querySelector("#roundTotalScore").textContent = completed.length ? `${total} / ${completed.length}` : "--";

  strokeButtons.innerHTML = scoreOptionsForHole(active).map((score) => {
    const relative = active ? score - Number(active.par) : 0;
    const selected = Number(active?.strokes) === score ? " selected" : "";
    const label = relative === 0 ? "Par" : formatToPar(relative);
    return `<button class="stroke-button${selected}" type="button" data-stroke="${score}"><strong>${score}</strong><span>${label}</span></button>`;
  }).join("");

  roundHoleGrid.innerHTML = roundHoleState.holes.map((hole) => {
    const activeClass = hole.hole === roundHoleState.activeHole ? " active" : "";
    const score = present(hole.strokes);
    const toPar = hasHoleScore(hole) ? formatToPar(Number(hole.strokes) - Number(hole.par)) : "";
    return `<button class="round-hole-button${activeClass}" type="button" data-round-hole="${hole.hole}"><span>${hole.hole}</span><strong>${score}</strong><small>${toPar}</small></button>`;
  }).join("");
}

function setActiveRoundHole(holeNumber) {
  roundHoleState.activeHole = Math.min(18, Math.max(1, holeNumber));
  renderRoundScoringUI();
}

function scoreOptionsForHole(hole) {
  const par = Number(hole?.par) || 4;
  const minimum = par >= 5 ? 2 : 1;
  const maximum = Math.max(minimum, par * 2);
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

function isValidHoleScore(hole) {
  if (!hasHoleScore(hole)) return false;
  return scoreOptionsForHole(hole).includes(Number(hole.strokes));
}

function setActiveHoleScore(score) {
  const active = roundHoleState.holes[roundHoleState.activeHole - 1];
  if (!active) return;
  if (!scoreOptionsForHole(active).includes(score)) return;
  active.strokes = score;
  const nextBlank = roundHoleState.holes.find((hole) => !hasHoleScore(hole) && hole.hole > roundHoleState.activeHole);
  if (nextBlank) roundHoleState.activeHole = nextBlank.hole;
  renderRoundScoringUI();
}

function validateRoundCard() {
  if (!roundHoleState.holes.length) return "Choose a course before saving.";
  const missing = roundHoleState.holes.find((hole) => !hasHoleScore(hole));
  if (missing) return `Hole ${missing.hole} needs a score.`;
  const invalid = roundHoleState.holes.find((hole) => !isValidHoleScore(hole));
  return invalid ? `Hole ${invalid.hole} needs a score from ${scoreOptionsForHole(invalid)[0]} to ${scoreOptionsForHole(invalid).at(-1)}.` : "";
}

function metric(label, value, detail = "") {
  return `<div class="metric-chip"><span>${label}</span><strong>${value}</strong>${detail}</div>`;
}

function present(value) {
  return value === "" || value === null || value === undefined || Number.isNaN(Number(value)) ? "--" : value;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${isoDate}T12:00:00`));
}

function formatToPar(value) {
  if (!Number.isFinite(value)) return "--";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

function renderHandicapChange(change) {
  if (!change || !Number.isFinite(change.delta)) {
    return `<small class="handicap-change neutral">First index</small>`;
  }
  if (change.delta === 0) {
    return `<small class="handicap-change neutral">No change</small>`;
  }
  const className = change.delta < 0 ? "positive" : "negative";
  const sign = change.delta > 0 ? "+" : "";
  return `<small class="handicap-change ${className}">${sign}${change.delta.toFixed(1)}</small>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numeric(formData, key) {
  const value = formData.get(key);
  return value === "" || value === null ? null : Number(value);
}

function parseHoleCard(formData) {
  return Array.from({ length: 18 }, (_, index) => {
    const hole = index + 1;
    return {
      hole,
      par: numeric(formData, `holePar${hole}`),
      yards: numeric(formData, `holeYards${hole}`),
      handicap: numeric(formData, `holeHandicap${hole}`)
    };
  });
}

function validateHoleCard(holes) {
  const indexes = holes.map((hole) => hole.handicap);
  const uniqueIndexes = new Set(indexes);
  const validIndexes = indexes.every((value) => Number.isInteger(value) && value >= 1 && value <= 18);
  const validPars = holes.every((hole) => Number.isInteger(hole.par) && hole.par >= 3 && hole.par <= 6);
  if (!validPars) return "Each hole needs a par from 3 to 6.";
  if (!validIndexes || uniqueIndexes.size !== 18) return "Use each handicap index from 1 to 18 exactly once.";
  return "";
}

function updateHoleTotals() {
  if (!holeTotals || !courseForm) return;
  const holes = parseHoleCard(new FormData(courseForm));
  const par = holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  const yards = holes.reduce((sum, hole) => sum + (Number(hole.yards) || 0), 0);
  const filledYards = holes.filter((hole) => Number(hole.yards)).length;
  const indexes = holes.map((hole) => hole.handicap).filter(Number.isFinite);
  const indexStatus = new Set(indexes).size === 18 && indexes.length === 18 ? "Hcp indexes complete" : "Hcp indexes need 1-18";
  holeTotals.textContent = `Par ${par || "--"} · ${filledYards ? `${yards.toLocaleString()} yards` : "yardage optional"} · ${indexStatus}`;
}

function setCourseFormOpen(isOpen) {
  courseForm.classList.toggle("is-collapsed", !isOpen);
  courseFormToggle.innerHTML = isOpen
    ? `<span aria-hidden="true">−</span> Hide form`
    : `<span aria-hidden="true">+</span> Add course`;
  if (isOpen) {
    courseForm.querySelector("input[name='name']")?.focus();
  }
}

document.querySelectorAll("[data-open-round]").forEach((button) => {
  button.addEventListener("click", () => {
    roundForm.reset();
    roundForm.elements.date.value = todayIso();
    renderCourseSelect();
    startRoundCard();
    roundDialog.showModal();
  });
});

document.querySelectorAll("[data-close-round]").forEach((button) => {
  button.addEventListener("click", () => roundDialog.close());
});

courseSelect.addEventListener("change", () => {
  updateSelectedCourseMeta();
  startRoundCard();
});
courseForm.addEventListener("input", (event) => {
  if (event.target.closest(".hole-table")) updateHoleTotals();
});
document.querySelector("[data-reset-holes]").addEventListener("click", () => renderHoleEditor(false));
courseFormToggle.addEventListener("click", () => {
  const shouldOpen = courseForm.classList.contains("is-collapsed");
  setCourseFormOpen(shouldOpen);
});
document.querySelector("[data-cancel-course-form]").addEventListener("click", () => {
  courseForm.reset();
  renderHoleEditor(false);
  setCourseFormOpen(false);
});

roundForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.courses.length) return;
  const formData = new FormData(roundForm);
  const roundError = validateRoundCard();
  if (roundError) {
    document.querySelector("#roundTotalScore").textContent = roundError;
    return;
  }
  const holes = roundHoleState.holes.map((hole) => ({ ...hole, strokes: Number(hole.strokes) }));
  state.rounds.push({
    id: uid(),
    createdAt: Date.now(),
    date: formData.get("date"),
    courseId: formData.get("courseId"),
    pcc: numeric(formData, "pcc") || 0,
    score: holes.reduce((sum, hole) => sum + hole.strokes, 0),
    holes
  });
  saveState();
  roundDialog.close();
  render();
});

courseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(courseForm);
  const holes = parseHoleCard(formData);
  const holeError = validateHoleCard(holes);
  if (holeError) {
    holeTotals.textContent = holeError;
    return;
  }
  state.courses.push({
    id: uid(),
    name: String(formData.get("name")).trim(),
    tee: String(formData.get("tee")).trim(),
    rating: numeric(formData, "rating"),
    slope: numeric(formData, "slope"),
    par: holes.reduce((sum, hole) => sum + hole.par, 0),
    holes
  });
  saveState();
  courseForm.reset();
  renderHoleEditor();
  setCourseFormOpen(false);
  render();
});

document.addEventListener("click", (event) => {
  const roundButton = event.target.closest("[data-delete-round]");
  const courseButton = event.target.closest("[data-delete-course]");
  const strokeButton = event.target.closest("[data-stroke]");
  const roundHoleButton = event.target.closest("[data-round-hole]");
  const prevHoleButton = event.target.closest("[data-prev-hole]");
  const nextHoleButton = event.target.closest("[data-next-hole]");
  if (strokeButton) setActiveHoleScore(Number(strokeButton.dataset.stroke));
  if (roundHoleButton) setActiveRoundHole(Number(roundHoleButton.dataset.roundHole));
  if (prevHoleButton) setActiveRoundHole(roundHoleState.activeHole - 1);
  if (nextHoleButton) setActiveRoundHole(roundHoleState.activeHole + 1);
  if (roundButton) {
    if (!confirm("Delete this round from local storage?")) return;
    state.rounds = state.rounds.filter((round) => round.id !== roundButton.dataset.deleteRound);
    saveState();
    render();
  }
  if (courseButton) {
    const courseId = courseButton.dataset.deleteCourse;
    const affectedRounds = state.rounds.filter((round) => round.courseId === courseId).length;
    const message = affectedRounds
      ? `Delete this course and ${affectedRounds} linked ${affectedRounds === 1 ? "round" : "rounds"} from local storage?`
      : "Delete this course from local storage?";
    if (!confirm(message)) return;
    state.courses = state.courses.filter((course) => course.id !== courseId);
    state.rounds = state.rounds.filter((round) => round.courseId !== courseId);
    saveState();
    render();
  }
});

document.addEventListener("change", (event) => {
  const teeSelect = event.target.closest("[data-course-tee-select]");
  if (!teeSelect) return;
  selectedCourseIdsByName[teeSelect.dataset.courseTeeSelect] = teeSelect.value;
  renderCourses();
});

document.querySelector("[data-seed]").addEventListener("click", () => {
  state.courses = sampleCourses.map(normalizeCourse);
  state.rounds = seedRounds(state.courses);
  saveState();
  render();
});

document.querySelector("[data-clear]").addEventListener("click", () => {
  if (!confirm("Clear all saved rounds from local storage?")) return;
  state.courses = sampleCourses.map(normalizeCourse);
  state.rounds = [];
  saveState();
  render();
});

document.querySelector("[data-export]").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `partrack-${todayIso()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

window.addEventListener("hashchange", route);
window.addEventListener("resize", () => drawTrend(handicapSummary().recent));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(
    () => {
      document.querySelector("#offlineStatus").textContent = "Offline cache is active after the first visit.";
    },
    () => {
      document.querySelector("#offlineStatus").textContent = "Offline cache needs a web server or GitHub Pages.";
    }
  );
} else {
  document.querySelector("#offlineStatus").textContent = "This browser does not support service workers.";
}

renderHoleEditor();
document.querySelector("#todayLabel").textContent = todayLabel();
route();
