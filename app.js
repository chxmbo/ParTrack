const SUPABASE_CONFIG = window.PARTRACK_ENV || {};
const supabaseUrl = SUPABASE_CONFIG.VITE_SUPABASE_URL || "";
const supabaseAnonKey = SUPABASE_CONFIG.VITE_SUPABASE_ANON_KEY || "";
const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
const localPreviewMode = window.location.protocol === "file:";
const themeStorageKey = "partrack-theme";
const handicapBasisStorageKey = "partrack-handicap-basis";
const preferredCourseStorageKey = "partrack-preferred-course";
const preferredTeeStorageKey = "partrack-preferred-tee";
let supabase = null;

function authRedirectUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/[^/]*$/, "/");
  }
  return url.toString();
}

async function createSupabaseClient() {
  if (!supabaseConfigured || supabase) return supabase;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.43.4");
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  return supabase;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const todayLabel = () => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
const round1 = (value) => Math.round((value + Number.EPSILON) * 10) / 10;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const defaultPars = [4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 3, 4, 4, 5, 4, 4, 3, 4];
const defaultYards = [401, 382, 344, 152, 343, 384, 515, 183, 420, 372, 198, 327, 386, 529, 454, 396, 170, 430];
const defaultStrokeIndexes = [5, 9, 11, 13, 15, 1, 17, 3, 7, 6, 12, 18, 10, 14, 2, 8, 16, 4];

function createHoleCard(pars = defaultPars, yards = defaultYards, strokeIndexes = defaultStrokeIndexes) {
  return Array.from({ length: 18 }, (_, index) => ({
    hole: index + 1,
    par: pars[index] ?? 4,
    yards: yards[index] ?? null,
    handicap: strokeIndexes[index] ?? index + 1
  }));
}

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

const state = blankState();

const views = [...document.querySelectorAll(".view")];
const links = [...document.querySelectorAll("[data-view-link]")];
const title = document.querySelector("#view-title");
const roundDialog = document.querySelector("#roundDialog");
const roundForm = document.querySelector("#roundForm");
const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector(".app-shell");
const authForm = document.querySelector("#authForm");
const authStatus = document.querySelector("#authStatus");
const syncStatus = document.querySelector("#syncStatus");
const themeSelect = document.querySelector("#themeSelect");
const handicapBasisSelect = document.querySelector("#handicapBasisSelect");
const setupDialog = document.querySelector("#setupDialog");
const setupForm = document.querySelector("#setupForm");
const courseForm = document.querySelector("#courseForm");
const courseFormToggle = document.querySelector("[data-toggle-course-form]");
const courseFormMode = document.querySelector("#courseFormMode");
const existingCourseSelect = document.querySelector("#existingCourseSelect");
const courseSelect = document.querySelector("#courseSelect");
const teeSelect = document.querySelector("#teeSelect");
const analyticsCourseSelect = document.querySelector("#analyticsCourseSelect");
const analyticsTeeSelect = document.querySelector("#analyticsTeeSelect");
const analyticsSummary = document.querySelector("#analyticsSummary");
const holeAnalyticsRows = document.querySelector("#holeAnalyticsRows");
const analyticsLocked = document.querySelector("#analyticsLocked");
const analyticsContent = document.querySelector("#analyticsContent");
const analyticsNav = document.querySelector("#analyticsNav");
const analyticsDrillList = document.querySelector("#analyticsDrillList");
const analyticsParBreakdown = document.querySelector("#analyticsParBreakdown");
const analyticsInsights = document.querySelector("#analyticsInsights");
const analyticsHoleWrap = document.querySelector("#analyticsHoleWrap");
const cloudCourseSearch = document.querySelector("#cloudCourseSearch");
const courseList = document.querySelector("#courseList");
const adminReviewPanel = document.querySelector("#adminReviewPanel");
const adminReviewList = document.querySelector("#adminReviewList");
const actionStatus = document.querySelector("#actionStatus");
const preferredCourseSelect = document.querySelector("#preferredCourseSelect");
const preferredTeeSelect = document.querySelector("#preferredTeeSelect");
const holeRows = document.querySelector("#holeRows");
const holeTotals = document.querySelector("#holeTotals");
const strokeButtons = document.querySelector("#strokeButtons");
const roundHoleGrid = document.querySelector("#roundHoleGrid");
const roundAutoSaveStatus = document.querySelector("#roundAutoSaveStatus");
const selectedCourseIdsByName = {};
let editingRoundId = null;
let authMode = "login";
let remoteSession = null;
let remoteCourseSearchTerm = "";
let courseMode = "mine";
let statsView = "overview";
let selectedStatsCourseName = "";
let selectedStatsTeeId = "";
let preferredRoundCourseId = null;
let roundAutoSaveTimer = null;
const openCourseGroups = new Set();
const roundHoleState = {
  activeHole: 1,
  holes: []
};

function lockViewportGestures() {
  const preventZoom = (event) => event.preventDefault();
  document.addEventListener("gesturestart", preventZoom, { passive: false });
  document.addEventListener("gesturechange", preventZoom, { passive: false });
  document.addEventListener("gestureend", preventZoom, { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

lockViewportGestures();

function blankState() {
  return {
    profile: { name: "", setupComplete: false },
    courses: [],
    rounds: []
  };
}

function storedTheme() {
  const value = localStorage.getItem(themeStorageKey);
  return ["device", "light", "dark"].includes(value) ? value : "device";
}

function applyTheme(theme = storedTheme()) {
  document.documentElement.dataset.theme = theme;
  if (themeSelect) themeSelect.value = theme;
}

function storedHandicapBasis() {
  const value = localStorage.getItem(handicapBasisStorageKey);
  return ["estimate", "gross", "net"].includes(value) ? value : "estimate";
}

function applyHandicapBasis(value = storedHandicapBasis()) {
  if (handicapBasisSelect) handicapBasisSelect.value = value;
}

function setSyncStatus(message) {
  if (syncStatus) syncStatus.textContent = message;
  const settingsSyncLabel = document.querySelector("#settingsSyncLabel");
  if (settingsSyncLabel) {
    if (/saving|syncing|deleting|publishing|verifying/i.test(message)) settingsSyncLabel.textContent = "Saving...";
    else settingsSyncLabel.textContent = /failed|offline|sign in|required/i.test(message) ? "Needs attention" : "Saved";
  }
}

function showActionStatus(message, tone = "info") {
  if (!actionStatus) return;
  actionStatus.textContent = message;
  actionStatus.dataset.tone = tone;
  actionStatus.hidden = false;
  clearTimeout(showActionStatus.timer);
  showActionStatus.timer = setTimeout(() => {
    actionStatus.hidden = true;
  }, tone === "error" ? 5200 : 3200);
}

function storedPreferredCourseName() {
  return localStorage.getItem(preferredCourseStorageKey) || "";
}

function storedPreferredTeeId() {
  return localStorage.getItem(preferredTeeStorageKey) || "";
}

function hasRemoteSession() {
  return Boolean(supabase && remoteSession?.user);
}

function remoteUserId() {
  return remoteSession?.user?.id || null;
}

function isCurrentUserAdmin() {
  return remoteSession?.user?.app_metadata?.role === "admin";
}

function normalizeRemoteCourse(course, tee) {
  const holes = Array.isArray(tee.holes) && tee.holes.length === 18
    ? tee.holes.map((hole, index) => ({
      hole: Number(hole.hole) || index + 1,
      par: Number(hole.par) || 4,
      yards: Number(hole.yards) || null,
      handicap: Number(hole.handicap) || index + 1
    }))
    : createLegacyHoleCard(tee.par);
  return normalizeCourse({
    id: tee.id,
    backendCourseId: course.id,
    backendTeeId: tee.id,
    status: course.status || "pending",
    isPublicUnverified: Boolean(course.is_public_unverified),
    createdBy: course.created_by || null,
    city: course.city || "",
    state: course.state || "",
    country: course.country || "US",
    name: course.name,
    tee: tee.name,
    rating: Number(tee.rating),
    slope: Number(tee.slope),
    par: Number(tee.par) || totalPar({ holes }),
    holes
  });
}

function remoteCourseStatus(course) {
  if (course.status === "approved") return "Approved";
  if (course.isPublicUnverified) return "Unverified";
  return "Private Draft";
}

function remoteCourseBadge(course) {
  if (!course.backendCourseId) return "";
  const status = remoteCourseStatus(course);
  const tone = status === "Approved" ? "approved" : status === "Unverified" ? "unverified" : "private";
  return `<span class="status-badge ${tone}">${status}</span>`;
}

function canPublishCourse(course) {
  return Boolean(course?.backendCourseId && course.status === "pending" && course.createdBy === remoteUserId() && !course.isPublicUnverified);
}

function canVerifyCourse(course) {
  return Boolean(course?.backendCourseId && course.status === "pending" && isCurrentUserAdmin());
}

function markCourseApprovedLocal(backendCourseId) {
  state.courses = state.courses.map((course) => (
    course.backendCourseId === backendCourseId
      ? { ...course, status: "approved", isPublicUnverified: false }
      : course
  ));
}

function adminPendingCourseGroups() {
  if (!isCurrentUserAdmin()) return [];
  return courseGroups()
    .map((group) => ({
      ...group,
      courses: group.courses.filter((course) => course.backendCourseId && course.status === "pending")
    }))
    .filter((group) => group.courses.length);
}

function renderAdminReviewQueue() {
  if (!adminReviewPanel || !adminReviewList) return;
  const groups = adminPendingCourseGroups();
  adminReviewPanel.hidden = !isCurrentUserAdmin();
  if (!isCurrentUserAdmin()) {
    adminReviewList.innerHTML = "";
    return;
  }
  if (!groups.length) {
    adminReviewList.innerHTML = `<div class="empty compact-empty">No courses waiting for review.</div>`;
    return;
  }
  const totalTees = groups.reduce((sum, group) => sum + group.courses.length, 0);
  adminReviewList.innerHTML = groups.map((group) => {
    const first = group.courses[0];
    const location = [first.city, first.state].filter(Boolean).join(", ");
    return `
      <div class="admin-review-row">
        <div>
          <strong>${escapeHtml(group.name)}</strong>
          <small>${escapeHtml([location, `${group.courses.length} ${group.courses.length === 1 ? "tee" : "tees"}`].filter(Boolean).join(" · "))}</small>
        </div>
        <div class="admin-review-actions">
          ${group.courses.map((course) => `
            <button class="secondary-action" type="button" data-verify-course="${course.id}">
              Verify ${escapeHtml(course.tee)}
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
  adminReviewList.insertAdjacentHTML("afterbegin", `<div class="admin-review-summary">${totalTees} ${totalTees === 1 ? "tee" : "tees"} waiting across ${groups.length} ${groups.length === 1 ? "course" : "courses"}.</div>`);
}

function setSignedInUi(isSignedIn) {
  if (localPreviewMode && !supabaseConfigured) {
    authScreen.hidden = true;
    appShell.hidden = false;
    setSyncStatus("Local preview");
    return;
  }
  if (!supabase) {
    authScreen.hidden = false;
    appShell.hidden = true;
    setAuthStatus("Account sync is not configured for this build.");
    setSyncStatus("Sync unavailable");
    return;
  }
  authScreen.hidden = isSignedIn;
  appShell.hidden = !isSignedIn;
  setSyncStatus(isSignedIn ? "Synced" : "Sign in to sync");
}

async function ensureRemoteProfile(displayName = "") {
  if (!hasRemoteSession()) return null;
  const user = remoteSession.user;
  const fallbackName = displayName || user.user_metadata?.display_name || user.email?.split("@")[0] || "";
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: fallbackName }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  state.profile = {
    name: data.display_name || fallbackName,
    setupComplete: true
  };
  return data;
}

async function loadRemoteData() {
  if (!hasRemoteSession()) return;
  setSyncStatus("Syncing...");
  const userId = remoteUserId();
  const [{ data: profile, error: profileError }, { data: courses, error: coursesError }, { data: rounds, error: roundsError }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("courses").select("*, tees(*)").order("name"),
    supabase.from("rounds").select("*").eq("user_id", userId).order("played_at", { ascending: false })
  ]);
  if (profileError) throw profileError;
  if (coursesError) throw coursesError;
  if (roundsError) throw roundsError;

  state.profile = {
    name: profile?.display_name || remoteSession.user.email?.split("@")[0] || "",
    setupComplete: true
  };
  state.courses = (courses || [])
    .flatMap((course) => (course.tees || []).map((tee) => normalizeRemoteCourse(course, tee)));
  state.rounds = (rounds || [])
    .map((round) => ({
      id: round.id,
      createdAt: new Date(round.created_at || Date.now()).getTime(),
      date: round.played_at,
      courseId: round.tee_id,
      backendCourseId: round.course_id,
      backendTeeId: round.tee_id,
      pcc: Number(round.pcc) || 0,
      score: Number(round.gross_score) || null,
      notes: round.notes || "",
      holes: Array.isArray(round.holes) ? round.holes : []
    }))
    .map((round) => normalizeRound(round, state.courses));
  setSyncStatus("Synced");
}

function mapCourseToRemote(course, formData, holes) {
  return {
    name: String(formData.get("name")).trim(),
    city: String(formData.get("city") || "").trim() || null,
    state: String(formData.get("state") || "").trim() || null,
    country: String(formData.get("country") || "US").trim() || "US",
    status: "pending",
    is_public_unverified: formData.get("shareUnverified") === "on",
    created_by: remoteUserId()
  };
}

function mapTeeToRemote(formData, holes, override = {}) {
  return {
    name: override.name ?? String(formData.get("tee")).trim(),
    gender: override.gender ?? (String(formData.get("gender") || "").trim() || null),
    par: override.par ?? holes.reduce((sum, hole) => sum + hole.par, 0),
    rating: override.rating ?? numeric(formData, "rating"),
    slope: override.slope ?? numeric(formData, "slope"),
    yardage: override.yardage ?? holes.map((hole) => Number(hole.yards)).filter(Number.isFinite).reduce((sum, yards) => sum + yards, 0),
    holes: override.holes ?? holes
  };
}

function scaleHoleYardages(holes, targetYardage) {
  const total = holes.reduce((sum, hole) => sum + (Number(hole.yards) || 0), 0);
  if (!Number.isFinite(targetYardage) || targetYardage <= 0 || total <= 0) return holes;
  let running = 0;
  return holes.map((hole, index) => {
    if (index === holes.length - 1) return { ...hole, yards: Math.max(1, targetYardage - running) };
    const yards = Math.max(1, Math.round((Number(hole.yards) || 0) * targetYardage / total));
    running += yards;
    return { ...hole, yards };
  });
}

function parseAdditionalTees(formData, baseHoles) {
  const text = String(formData.get("additionalTees") || "").trim();
  if (!text) return [];
  return text.split(/\n+/).map((line, index) => {
    const [name, rating, slope, yardage] = line.split(",").map((part) => part.trim());
    if (!name || !rating || !slope) throw new Error(`Additional tee line ${index + 1} needs tee, rating, and slope.`);
    const parsedRating = Number(rating);
    const parsedSlope = Number(slope);
    const parsedYardage = yardage ? Number(yardage.replace(/,/g, "")) : null;
    if (!Number.isFinite(parsedRating) || !Number.isFinite(parsedSlope)) {
      throw new Error(`Additional tee line ${index + 1} has an invalid rating or slope.`);
    }
    const holes = parsedYardage ? scaleHoleYardages(baseHoles, parsedYardage) : baseHoles;
    return { name, rating: parsedRating, slope: parsedSlope, yardage: parsedYardage, holes };
  });
}

async function saveRemoteCourse(formData, holes) {
  const existingCourseId = String(formData.get("existingCourseId") || "");
  const selectedExisting = existingCourseId ? courseById(existingCourseId) : null;
  let course = null;
  if (formData.get("courseFormMode") === "existing") {
    if (!selectedExisting?.backendCourseId) throw new Error("Choose an existing course.");
    course = {
      id: selectedExisting.backendCourseId,
      name: selectedExisting.name,
      city: selectedExisting.city || "",
      state: selectedExisting.state || "",
      country: selectedExisting.country || "US",
      status: selectedExisting.status || "pending",
      is_public_unverified: Boolean(selectedExisting.isPublicUnverified),
      created_by: selectedExisting.createdBy || null
    };
  } else {
    const { data, error: courseError } = await supabase
      .from("courses")
      .insert(mapCourseToRemote(null, formData, holes))
      .select()
      .single();
    if (courseError) throw courseError;
    course = data;
  }
  const additionalTees = formData.get("courseFormMode") === "existing" ? [] : parseAdditionalTees(formData, holes);
  const teePayloads = [
    { ...mapTeeToRemote(formData, holes), course_id: course.id },
    ...additionalTees.map((tee) => ({
      ...mapTeeToRemote(formData, tee.holes, {
        name: tee.name,
        rating: tee.rating,
        slope: tee.slope,
        yardage: tee.yardage,
        holes: tee.holes
      }),
      course_id: course.id
    }))
  ];
  const { data: tees, error: teeError } = await supabase
    .from("tees")
    .insert(teePayloads)
    .select();
  if (teeError) {
    if (formData.get("courseFormMode") !== "existing") await supabase.from("courses").delete().eq("id", course.id);
    throw teeError;
  }
  const tee = Array.isArray(tees) ? tees[0] : null;
  if (!tee?.id) throw new Error("Course saved, but no tee set came back.");
  return normalizeRemoteCourse(course, tee);
}

async function saveRemoteRound(round, existingRound = null) {
  const course = courseById(round.courseId);
  if (!course?.backendCourseId || !course?.backendTeeId) {
    throw new Error("Choose a course before saving a round.");
  }
  const postingScore = handicapPostingScore(round, course);
  const payload = {
    user_id: remoteUserId(),
    course_id: course.backendCourseId,
    tee_id: course.backendTeeId,
    played_at: round.date,
    gross_score: partialRoundScore(round),
    adjusted_gross_score: postingScore,
    differential: differential(round, course),
    pcc: Number(round.pcc) || 0,
    holes: round.holes,
    notes: round.notes || null
  };
  const query = existingRound
    ? supabase.from("rounds").update(payload).eq("id", existingRound.id).select().single()
    : supabase.from("rounds").insert(payload).select().single();
  const { data, error } = await query;
  if (error) throw error;
  return data;
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

function partialRoundScore(round) {
  if (!Array.isArray(round.holes) || !round.holes.length) return Number(round.score) || null;
  const strokes = round.holes.filter(hasHoleScore).map((hole) => Number(hole.strokes));
  return strokes.length ? strokes.reduce((sum, value) => sum + value, 0) : null;
}

function partialRoundToPar(round) {
  if (!Array.isArray(round.holes) || !round.holes.length) return null;
  const scored = round.holes.filter(hasHoleScore);
  if (!scored.length) return null;
  const score = partialRoundScore(round);
  const par = scored.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  return Number.isFinite(score) ? score - par : null;
}

function scoredHoleCount(round) {
  if (Array.isArray(round.holes) && round.holes.length) {
    return round.holes.filter(hasHoleScore).length;
  }
  return Number.isFinite(Number(round.score)) ? 18 : 0;
}

function unplayedPar(round, course = courseById(round.courseId)) {
  if (!Array.isArray(round.holes) || !round.holes.length) return 0;
  return round.holes
    .filter((hole) => !hasHoleScore(hole))
    .reduce((sum, hole, index) => {
      const fallback = course?.holes?.[index]?.par;
      return sum + (Number(hole.par) || Number(fallback) || 0);
    }, 0);
}

function handicapPostingScore(round, course = courseById(round.courseId)) {
  const score = roundScore(round);
  if (Number.isFinite(score)) return score;
  if (scoredHoleCount(round) !== 9) return null;
  const partial = partialRoundScore(round);
  if (!Number.isFinite(partial)) return null;
  return partial + unplayedPar(round, course);
}

function isValidRatingSlope(course) {
  return Boolean(course) && Number.isFinite(Number(course.rating)) && Number.isFinite(Number(course.slope)) && Number(course.slope) > 0;
}

function handicapEligibility(round, course = courseById(round.courseId)) {
  const holesPlayed = scoredHoleCount(round);
  const coursePar = course ? totalPar(course) : 0;
  const base = { eligible: false, status: "not-eligible", label: "Not eligible", reason: "Missing course" };

  if (round.handicapExcluded) {
    return { ...base, status: "excluded", label: "Excluded", reason: "Excluded from handicap" };
  }

  if (!course) return base;
  if (holesPlayed < 9) return { ...base, reason: "Fewer than 9 holes" };
  if (!isValidRatingSlope(course)) return { ...base, reason: "Missing rating/slope" };
  if (coursePar < 60) return { ...base, reason: "Par below 60" };
  if (holesPlayed === 9) return { eligible: true, status: "eligible", label: "9-hole", reason: "9 holes counted for index" };
  if (holesPlayed < 18) return { ...base, status: "not-eligible", label: "In progress", reason: `${holesPlayed}/18 holes saved` };

  return { eligible: true, status: "eligible", label: "Eligible", reason: "Counts toward index" };
}

function roundToPar(round) {
  if (!Array.isArray(round.holes) || !round.holes.length) return null;
  const score = roundScore(round);
  const par = round.holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  return Number.isFinite(score) ? score - par : null;
}

function handicapPostingToPar(round, course = courseById(round.courseId)) {
  const score = handicapPostingScore(round, course);
  if (!Number.isFinite(score) || !course) return null;
  return score - totalPar(course);
}

function differential(round, course = courseById(round.courseId)) {
  if (!course) return null;
  const score = handicapPostingScore(round, course);
  if (!Number.isFinite(score)) return null;
  return round1((113 / Number(course.slope)) * (score - Number(course.rating) - Number(round.pcc || 0)));
}

function roundWithMath(round) {
  const course = courseById(round.courseId);
  const holesPlayed = scoredHoleCount(round);
  return {
    ...round,
    course,
    score: roundScore(round),
    partialScore: partialRoundScore(round),
    postingScore: handicapPostingScore(round, course),
    holesPlayed,
    isComplete: holesPlayed === 18,
    toPar: roundToPar(round),
    partialToPar: partialRoundToPar(round),
    postingToPar: handicapPostingToPar(round, course),
    differential: differential(round, course)
  };
}

function roundHistoryRecord() {
  return state.rounds
    .map(roundWithMath)
    .filter((round) => round.course)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function inProgressRoundRecord() {
  return roundHistoryRecord().filter((round) => round.holesPlayed > 0 && round.holesPlayed < 18);
}

function completedRoundRecord() {
  return state.rounds
    .map(roundWithMath)
    .filter((round) => round.course && Number.isFinite(round.score))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function scoringRecord() {
  return roundHistoryRecord()
    .filter((round) => handicapEligibility(round, round.course).eligible && Number.isFinite(round.differential));
}

function handicapStatusByRound(rounds) {
  const includedIds = new Set(scoringRecord().slice(0, 20).map((round) => round.id));
  return Object.fromEntries(rounds.map((round) => {
    const status = handicapEligibility(round, round.course);
    if (status.eligible && includedIds.has(round.id)) {
      return [round.id, { ...status, status: "included", label: "Qualified", reason: "In current handicap window" }];
    }
    if (status.eligible) {
      return [round.id, { ...status, status: "replaced", label: "Replaced", reason: "Older than latest 20" }];
    }
    return [round.id, status];
  }));
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
  const record = completedRoundRecord();
  const handicapRecord = scoringRecord();
  return { record, handicapRecord, ...indexFromRecord(handicapRecord) };
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
  const titleMap = { dashboard: "Home", analytics: "Stats" };
  title.textContent = titleMap[activeId] || activeId[0].toUpperCase() + activeId.slice(1);
  render();
}

function navigateToView(id) {
  if (!views.some((view) => view.id === id)) return;
  if (location.hash === `#${id}`) {
    route();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  location.hash = id;
}

function render() {
  renderHoleEditor();
  renderCourseSelect();
  renderAnalytics();
  renderDashboard();
  renderRounds();
  renderCourses();
  renderAdminReviewQueue();
  renderSettingsControls();
  renderQuickStartPanel();
  renderProfile();
}

function renderDashboard() {
  const summary = handicapSummary();
  const record = summary.record;
  const handicapChanges = handicapChangesByRound(record);
  const latestRound = record[0];
  const scores = record.map((round) => Number(round.score));
  const toPar = record.map((round) => Number(round.toPar)).filter(Number.isFinite);
  const latestChange = latestRound ? handicapChanges[latestRound.id] : null;

  document.querySelector("#handicapIndex").textContent = summary.index === null ? "--" : summary.index.toFixed(1);
  document.querySelector("#handicapStatus").textContent = indexStatus(summary);
  document.querySelector("#roundCount").textContent = record.length;
  document.querySelector("#recentWindow").textContent = `${summary.recent.length} in current window`;
  renderHandicapGraphCard(summary);
  document.querySelector("#averageScore").textContent = scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "--";
  document.querySelector("#averagePutts").textContent = toPar.length ? `${formatToPar(round1(toPar.reduce((a, b) => a + b, 0) / toPar.length))} avg to par` : "No completed rounds";

  document.querySelector("#countToTwenty").textContent = !state.courses.length
    ? "Fresh start"
    : summary.recent.length >= 20 ? "Full 20-score index" : `${20 - summary.recent.length} to full index`;
  document.querySelector("#twentyProgressLabel").textContent = `${Math.min(summary.recent.length, 20)}/20`;
  document.querySelector("#twentyProgressText").textContent = !state.courses.length
    ? "Find a course to begin"
    : summary.recent.length >= 20
    ? "Full handicap window"
    : `${20 - summary.recent.length} scores until full window`;
  document.querySelector(".progress-ring").style.setProperty("--progress", `${Math.min(summary.recent.length, 20) / 20}`);

  renderHomeRecentRound(latestRound);
  renderCountingScores(summary);
  drawTrend(summary.recent);
}

function renderHomeRecentRound(round) {
  const target = document.querySelector("#homeRecentRound");
  if (!target) return;
  const inProgress = inProgressRoundRecord()[0];
  const progressMarkup = inProgress ? `
    <div class="field-resume-card">
      <div>
        <span>Round in progress</span>
        <strong>${escapeHtml(inProgress.course.name)}</strong>
        <small>${escapeHtml([inProgress.course.tee, formatDate(inProgress.date), `${inProgress.holesPlayed}/18 holes`].filter(Boolean).join(" · "))}</small>
      </div>
      <button class="secondary-action" type="button" data-resume-round="${inProgress.id}">Resume</button>
    </div>
  ` : "";
  if (!round) {
    target.innerHTML = `
      ${progressMarkup}
      <div class="field-recent-empty">
        <span>Most recent round</span>
        <strong>No rounds yet</strong>
        <small>Start with Round when you are ready.</small>
      </div>
    `;
    return;
  }
  const status = handicapStatusByRound([round])[round.id] || handicapEligibility(round, round.course);
  target.innerHTML = `
    ${progressMarkup}
    <div class="field-recent-copy">
      <span>Most recent round</span>
      <strong>${escapeHtml(round.course.name)}</strong>
      <small>${escapeHtml([round.course.tee, formatDate(round.date), status.label].filter(Boolean).join(" · "))}</small>
    </div>
    <div class="round-score-tile field-recent-score" aria-label="Most recent score">
      <span>To par</span>
      <strong>${formatToPar(round.toPar)}</strong>
      <small>Gross ${round.score}</small>
    </div>
  `;
}

function renderRoundSummaryScoreTile(round) {
  if (round.isComplete) {
    return `
      <div class="round-score-tile" aria-label="Round score">
        <span>To par</span>
        <strong>${formatToPar(round.toPar)}</strong>
        <small>Gross ${round.score}</small>
      </div>
    `;
  }
  if (round.holesPlayed === 9) {
    return `
      <div class="round-score-tile is-estimated" aria-label="Round estimated for handicap">
        <span>9-hole index</span>
        <strong>${formatToPar(round.postingToPar)}</strong>
        <small>${round.partialScore} strokes</small>
      </div>
    `;
  }
  return `
    <div class="round-score-tile is-draft" aria-label="Round in progress">
      <span>In progress</span>
      <strong>${round.holesPlayed}/18</strong>
      <small>${Number.isFinite(round.partialScore) ? `${round.partialScore} strokes` : "Saved draft"}</small>
    </div>
  `;
}

function renderInProgressRoundCard(round) {
  const status = handicapEligibility(round, round.course);
  const scoreLabel = round.holesPlayed === 9
    ? `${round.partialScore} strokes · counts as 9`
    : Number.isFinite(round.partialScore)
      ? `${round.partialScore} strokes saved`
      : "Progress saved";
  const note = round.holesPlayed === 9
    ? "This 9-hole score is included in your handicap estimate. Resume if you play the other nine."
    : round.holesPlayed > 9
      ? "Saved in progress. It will count when all 18 holes are finished."
      : "Saved draft. Score 9 holes to count it toward your handicap estimate.";
  return `
    <article class="progress-round-card">
      <div>
        <p class="eyebrow">Round in progress</p>
        <h2>${escapeHtml(round.course.name)}</h2>
        <p>${escapeHtml([round.course.tee, formatDate(round.date), status.label].filter(Boolean).join(" · "))}</p>
        <strong>${round.holesPlayed}/18 holes</strong>
        <small>${escapeHtml(scoreLabel)}</small>
        <span>${escapeHtml(note)}</span>
      </div>
      <div class="progress-round-actions">
        <button class="primary-action" type="button" data-resume-round="${round.id}">Resume</button>
        <button class="delete-button" type="button" data-delete-round="${round.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderQuickStartPanel() {
  const target = document.querySelector("#quickStartPanel");
  if (!target) return;
  const completed = completedRoundRecord();
  const eligible = scoringRecord();
  const pendingReviews = adminPendingCourseGroups().reduce((sum, group) => sum + group.courses.length, 0);
  const steps = [
    {
      label: "Course library",
      done: state.courses.length > 0,
      text: state.courses.length ? `${courseGroups().length} courses ready` : "Add or verify a course"
    },
    {
      label: "Scoring record",
      done: completed.length > 0,
      text: completed.length ? `${completed.length} rounds saved` : "Save your first round"
    },
    {
      label: "Index window",
      done: eligible.length >= 20,
      text: eligible.length >= 20 ? "Full 20-score window" : `${Math.max(0, 20 - eligible.length)} scores to full window`
    }
  ];
  target.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Next up</p>
        <h2>Keep building your record</h2>
      </div>
      ${pendingReviews ? `<span class="pill">${pendingReviews} to review</span>` : ""}
    </div>
    <div class="quick-start-list">
      ${steps.map((step) => `
        <div class="quick-start-step${step.done ? " is-done" : ""}">
          <span>${step.done ? "Done" : "Next"}</span>
          <div>
            <strong>${step.label}</strong>
            <small>${step.text}</small>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function favoriteCourseName(record) {
  const counts = new Map();
  for (const round of record) counts.set(round.course.name, (counts.get(round.course.name) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
}

function latestHandicapChangeLabel(change) {
  if (!change || !Number.isFinite(change.delta)) return "--";
  if (change.delta === 0) return "E";
  return `${change.delta > 0 ? "+" : ""}${change.delta.toFixed(1)}`;
}

function renderHandicapGraphCard(summary) {
  const target = document.querySelector("#bestScoreGraph");
  if (!target) return;
  const chronological = [...summary.recent].reverse();
  const handicapChanges = handicapChangesByRound(summary.handicapRecord || summary.recent || []);
  const graphPoints = chronological.map((round) => ({
    round,
    change: handicapChanges[round.id],
    value: handicapChanges[round.id]?.after
  }));
  if (!chronological.length) {
    target.innerHTML = `
      <div class="stat-graph-empty">
        <svg viewBox="0 0 140 84" aria-hidden="true">
          <rect x="8" y="12" width="116" height="54" rx="16" class="graph-panel"/>
          <path d="M22 58h88" class="graph-base"/>
          <path d="M22 58l20-12 18 8 26-24" class="graph-line"/>
          <circle cx="22" cy="58" r="4" class="graph-node"/>
          <circle cx="42" cy="46" r="4" class="graph-node"/>
          <circle cx="60" cy="54" r="4" class="graph-node"/>
          <circle cx="86" cy="30" r="5" class="graph-accent"/>
        </svg>
        <small>Add rounds to draw your index shape.</small>
      </div>
    `;
    return;
  }

  const includedIds = new Set(summary.usedRounds.map((round) => round.id));
  const values = graphPoints.map((point) => point.value).filter(Number.isFinite);
  if (!values.length) {
    target.innerHTML = `
      <div class="stat-graph-empty">
        <svg viewBox="0 0 140 84" aria-hidden="true">
          <rect x="8" y="12" width="116" height="54" rx="16" class="graph-panel"/>
          <path d="M22 58h88" class="graph-base"/>
          <path d="M22 58l20-8 20-8 24-6" class="graph-line"/>
          <circle cx="22" cy="58" r="4" class="graph-node"/>
          <circle cx="42" cy="50" r="4" class="graph-node"/>
          <circle cx="62" cy="42" r="4" class="graph-node"/>
          <circle cx="86" cy="36" r="5" class="graph-accent"/>
        </svg>
        <small>Add 3 rounds to start plotting your handicap.</small>
      </div>
    `;
    return;
  }
  const firstValue = values[0];
  const latestValue = values[values.length - 1];
  const trendDelta = Number.isFinite(firstValue) && Number.isFinite(latestValue) ? round1(latestValue - firstValue) : null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 248;
  const height = 140;
  const padX = 18;
  const padY = 20;
  const usableWidth = width - padX * 2;
  const usableHeight = height - padY * 2;
  const range = Math.max(1, max - min);
  const graphMin = Math.max(0, min - 0.8);
  const graphMax = max + 0.8;
  const graphRange = Math.max(1, graphMax - graphMin);
  const gridLines = [0, 0.5, 1].map((ratio) => padY + usableHeight * ratio);
  const points = graphPoints.map((entry, index) => {
    const x = padX + (graphPoints.length === 1 ? usableWidth / 2 : (usableWidth * index) / (graphPoints.length - 1));
    const y = Number.isFinite(entry.value)
      ? height - padY - ((entry.value - graphMin) / graphRange) * usableHeight
      : height - padY;
    return { x, y, ...entry };
  });
  const drawablePoints = points.filter((point) => Number.isFinite(point.value));
  const path = drawablePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const trendLabel = trendDelta === null ? "--" : trendDelta === 0 ? "Even" : `${trendDelta > 0 ? "+" : ""}${trendDelta.toFixed(1)}`;
  target.innerHTML = `
    <div class="stat-graph-plot">
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <rect x="8" y="8" width="${width - 16}" height="${height - 20}" rx="18" class="graph-panel"/>
        ${gridLines.map((y) => `<path d="M20 ${y.toFixed(1)}h${width - 40}" class="graph-grid"/>`).join("")}
        ${points
          .filter((point) => Number.isFinite(point.value))
          .map((point) => `<path d="M${point.x.toFixed(1)} ${height - padY}V${point.y.toFixed(1)}" class="graph-bar"/>`)
          .join("")}
        <path d="M20 ${height - padY}h${width - 40}" class="graph-base"/>
        <path d="${path}" class="graph-line"/>
        ${points.map((point, index) => {
          const isIncluded = includedIds.has(point.round.id);
          const isLast = index === points.length - 1;
          const hasValue = Number.isFinite(point.value);
          const nodeClass = !hasValue ? "graph-node-pending" : isLast ? "graph-accent" : isIncluded ? "graph-node-strong" : "graph-node";
          const radius = !hasValue ? 3.2 : isLast ? 5 : isIncluded ? 4.4 : 3.8;
          const handicapValue = hasValue ? point.value.toFixed(1) : "";
          const label = hasValue
            ? `${formatDate(point.round.date)} handicap ${point.value.toFixed(1)}`
            : `${formatDate(point.round.date)} estimate pending`;
          return `
            <g
              class="graph-point${isLast ? " is-default" : ""}"
              data-graph-date="${escapeHtml(formatDate(point.round.date))}"
              data-graph-handicap="${escapeHtml(handicapValue)}"
              data-graph-left="${((point.x / width) * 100).toFixed(2)}"
              data-graph-top="${((point.y / height) * 100).toFixed(2)}"
              tabindex="0"
              role="button"
              aria-label="${escapeHtml(label)}"
            >
              <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${radius}" class="${nodeClass}"/>
            </g>
          `;
        }).join("")}
        <text x="20" y="${padY - 4}" class="graph-axis-label">${graphMax.toFixed(1)}</text>
        <text x="20" y="${height - 4}" class="graph-axis-label">${graphMin.toFixed(1)}</text>
      </svg>
    </div>
    <div class="stat-graph-meta">
      <small class="stat-graph-caption">${summary.usedRounds.length ? `${summary.usedRounds.length} counting scores in the current window` : "Tap a point to inspect that round's handicap"}</small>
      <small class="stat-graph-tooltip">Latest point selected</small>
    </div>
  `;

  const tooltip = target.querySelector(".stat-graph-tooltip");
  const pointNodes = [...target.querySelectorAll(".graph-point")];
  const activatePoint = (node) => {
    if (!node || !tooltip) return;
    pointNodes.forEach((point) => point.classList.toggle("is-active", point === node));
    const date = node.dataset.graphDate || "";
    const handicapValue = node.dataset.graphHandicap;
    const message = handicapValue ? `${date} · Handicap ${handicapValue} · Change ${trendLabel}` : `${date} · Estimate pending`;
    tooltip.textContent = message;
  };
  pointNodes.forEach((node) => {
    node.addEventListener("mouseenter", () => activatePoint(node));
    node.addEventListener("focus", () => activatePoint(node));
    node.addEventListener("click", () => activatePoint(node));
  });
  activatePoint(target.querySelector(".graph-point.is-default") || pointNodes[pointNodes.length - 1]);
}

function bestScoreDetail(round, netToPar, handicapIndex, playingHandicapValue) {
  const parts = [
    `${round.course.name} · ${round.course.tee} · ${formatDate(round.date)}`,
    `Par ${totalPar(round.course)} · ${formatToPar(round.toPar)} gross`
  ];
  if (Number.isFinite(netToPar)) parts.push(`${formatToPar(netToPar)} net`);
  if (Number.isFinite(handicapIndex)) parts.push(`Index ${handicapIndex.toFixed(1)}`);
  if (Number.isFinite(playingHandicapValue)) parts.push(`Course hcp ${formatCourseHandicap(playingHandicapValue)}`);
  return parts.join(" · ");
}

function indexStatus(summary) {
  if (!state.courses.length) {
    return "Search the course database or add a course to start tracking.";
  }
  if (summary.index === null) {
    const needed = 3 - summary.recent.length;
    return `Add ${needed} more eligible ${needed === 1 ? "score" : "scores"} to establish an index.`;
  }

  const adjustment = summary.rule.adjustment ? `, ${summary.rule.adjustment.toFixed(1)} adjustment` : "";
  return `Using ${summary.rule.used} of ${summary.recent.length} latest handicap values${adjustment}.`;
}

function renderCountingScores(summary) {
  const target = document.querySelector("#countingScores");
  if (!summary.usedRounds.length) {
    target.innerHTML = `<div class="empty">Your counting scores will appear after you record 3 eligible scores.</div>`;
    return;
  }

  target.innerHTML = summary.usedRounds
    .map((round) => `
      <div class="score-chip">
        <div>
          <strong>${round.differential.toFixed(1)}</strong>
          <div>${escapeHtml(round.course.name)} · ${formatDate(round.date)}</div>
        </div>
        <span>${Number.isFinite(round.score) ? round.score : `${round.partialScore} thru 9`}</span>
      </div>
    `)
    .join("");
}

function drawTrend(rounds) {
  const canvas = document.querySelector("#trendChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const chartColors = isDark
    ? { background: "#0d1815", grid: "rgba(224, 235, 226, 0.12)", text: "#9baca4", line: "#75b9d6", point: "#101b18" }
    : { background: "#fbfcf8", grid: "#dce5dc", text: "#637268", line: "#2f6788", point: "#ffffff" };
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(320 * dpr));
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = 320;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = chartColors.background;
  ctx.fillRect(0, 0, width, height);

  if (!rounds.length) {
    ctx.fillStyle = chartColors.text;
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

  ctx.strokeStyle = chartColors.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = chartColors.text;
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

  ctx.strokeStyle = chartColors.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  points.forEach((point) => {
    ctx.beginPath();
    ctx.fillStyle = chartColors.point;
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = chartColors.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function renderRounds() {
  const target = document.querySelector("#roundList");
  const record = roundHistoryRecord();
  const inProgress = record.filter((round) => round.holesPlayed > 0 && round.holesPlayed < 18);
  const history = record.filter((round) => round.holesPlayed === 18);
  const handicapRecord = scoringRecord();
  const currentHandicapIndex = handicapSummary().index;
  const handicapChanges = handicapChangesByRound(handicapRecord);
  const statusByRound = handicapStatusByRound(record);
  if (!record.length) {
    target.innerHTML = '<div class="empty">No rounds yet. Choose a course or add a missing course, then use Add round to start your scoring record.</div>';
    return;
  }

  const inProgressMarkup = inProgress.length ? `
    <section class="progress-round-section" aria-label="Rounds in progress">
      <div class="progress-round-heading">
        <span>Resume</span>
        <strong>${inProgress.length} ${inProgress.length === 1 ? "round" : "rounds"} in progress</strong>
      </div>
      ${inProgress.map(renderInProgressRoundCard).join("")}
    </section>
  ` : "";

  const historyMarkup = history.length ? history
    .map((round) => {
      const roundHandicapIndex = handicapChanges[round.id]?.after ?? currentHandicapIndex;
      const hasHandicapIndex = Number.isFinite(roundHandicapIndex);
      const courseHandicap = hasHandicapIndex ? playingHandicap(round.course, roundHandicapIndex) : null;
      const netScore = round.isComplete && hasHandicapIndex ? round.score - courseHandicap : "--";
      const differentialValue = Number.isFinite(round.differential) ? round.differential.toFixed(1) : "--";
      const handicapStatus = statusByRound[round.id] || handicapEligibility(round, round.course);
      const stats = roundScoringStats(round);
      const detailToPar = round.isComplete ? formatToPar(round.toPar) : round.holesPlayed === 9 ? formatToPar(round.postingToPar) : formatToPar(round.partialToPar);
      const detailGross = round.isComplete
        ? `${round.score}/${netScore}`
        : round.holesPlayed === 9
          ? `${round.partialScore} actual · ${round.postingScore} est.`
          : `${Number.isFinite(round.partialScore) ? round.partialScore : "--"} / draft`;
      const location = [round.course.city, round.course.state].filter(Boolean).join(", ");
      const courseMeta = [
        round.course.tee ? escapeHtml(round.course.tee) : "",
        round.isComplete ? "18 holes" : `${round.holesPlayed}/18 holes`,
        location ? escapeHtml(location) : ""
      ].filter(Boolean).join(" · ");
      return `
      <article class="round-item round-history-card">
        <details class="round-details">
          <summary class="round-summary">
            <div class="round-summary-main">
              <div class="round-title">
                <strong>${escapeHtml(round.course.name)}</strong>
                ${renderHandicapStatusBadge(handicapStatus)}
              </div>
              <div class="round-meta">
                ${courseMeta ? `<span>${courseMeta}</span>` : ""}
                <span>${formatDate(round.date)}</span>
                <span>${escapeHtml(handicapStatus.reason)}</span>
              </div>
            </div>
            ${renderRoundSummaryScoreTile(round)}
            <div class="round-quick-stats" aria-label="Round scoring mix">
              ${roundMiniStat("Birdies+", stats.birdiesBetter)}
              ${roundMiniStat("Pars", stats.pars)}
              ${roundMiniStat("Bogeys+", stats.bogeysPlus)}
            </div>
            <span class="round-expand-cue" aria-hidden="true"></span>
          </summary>

          <div class="round-detail-body">
            <div class="round-detail-card">
              <div class="round-detail-topline">
                <div>
                  <span>To par</span>
                  <strong>${detailToPar}</strong>
                </div>
                <div>
                  <span>${round.isComplete ? "Gross/Net" : round.holesPlayed === 9 ? "Actual/Est." : "Progress"}</span>
                  <strong>${detailGross}</strong>
                </div>
              </div>
              ${renderRoundCard(round, currentHandicapIndex)}
            </div>

            <section class="round-stat-panel" aria-label="Basic stats">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Basic stats</p>
                  <h2>${escapeHtml(round.course.name)}</h2>
                </div>
              </div>
              <div class="round-stat-grid">
                ${metric("Par 3 avg", formatAverageStat(stats.byPar[3]))}
                ${metric("Par 4 avg", formatAverageStat(stats.byPar[4]))}
                ${metric("Par 5 avg", formatAverageStat(stats.byPar[5]))}
                ${metric("Birdies+", stats.birdiesBetter)}
                ${metric("Pars", stats.pars)}
                ${metric("Bogeys+", stats.bogeysPlus)}
              </div>
            </section>

            <div class="round-detail-metrics">
              ${metric("Course hcp", Number.isFinite(courseHandicap) ? formatCourseHandicap(courseHandicap) : "--", hasHandicapIndex ? `<small>Index ${roundHandicapIndex.toFixed(1)}</small>` : "")}
              ${metric("Differential", differentialValue, renderHandicapChange(handicapChanges[round.id]))}
              ${metric("Rating/Slope", `${round.course.rating}/${round.course.slope}`)}
              ${metric(round.isComplete ? "Course par" : round.holesPlayed === 9 ? "9-hole posting" : "Saved", round.isComplete ? totalPar(round.course) : round.holesPlayed === 9 ? "Uses par for unplayed holes" : `${round.holesPlayed}/18`)}
            </div>

            <div class="card-actions">
              <button class="secondary-action" type="button" data-edit-round="${round.id}">Edit</button>
              <button class="delete-button" type="button" data-delete-round="${round.id}">Delete</button>
            </div>
          </div>
        </details>
      </article>
    `;
    })
    .join("") : "";

  target.innerHTML = `
    ${inProgressMarkup}
    ${historyMarkup ? `<section class="round-history-section" aria-label="Completed rounds">${historyMarkup}</section>` : ""}
  `;
}

function roundScoringStats(round) {
  const holes = Array.isArray(round.holes) ? round.holes.filter(hasHoleScore) : [];
  const byParBuckets = { 3: [], 4: [], 5: [] };
  const stats = { birdiesBetter: 0, pars: 0, bogeysPlus: 0, byPar: { 3: null, 4: null, 5: null } };

  for (const hole of holes) {
    const par = Number(hole.par);
    const strokes = Number(hole.strokes);
    if (!Number.isFinite(par) || !Number.isFinite(strokes)) continue;
    if (byParBuckets[par]) byParBuckets[par].push(strokes);
    const relative = strokes - par;
    if (relative <= -1) stats.birdiesBetter += 1;
    else if (relative === 0) stats.pars += 1;
    else stats.bogeysPlus += 1;
  }

  for (const par of [3, 4, 5]) {
    const scores = byParBuckets[par];
    stats.byPar[par] = scores.length ? round1(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
  }
  return stats;
}

function formatAverageStat(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "--";
}

function roundMiniStat(label, value) {
  return `<span><small>${label}</small><strong>${value}</strong></span>`;
}

function renderHandicapStatusBadge(status) {
  const tone = status.status === "included" ? "approved"
    : status.status === "replaced" ? "private"
    : status.status === "excluded" ? "unverified"
    : "not-eligible";
  return `<span class="status-badge ${tone}">${escapeHtml(status.label)}</span>`;
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
  return Math.round(raw);
}

function formatCourseHandicap(value) {
  return Number.isFinite(value) ? String(value) : "--";
}

function handicapDotsByHole(course, handicapIndex) {
  const allowance = Math.max(0, playingHandicap(course, handicapIndex));
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
  const countTitle = document.querySelector("#courseCountTitle");
  const catalogPanel = document.querySelector("#courseCatalogPanel");
  const modeTabs = document.querySelectorAll("[data-course-mode]");
  const myCourseIds = new Set(completedRoundRecord().map((round) => round.courseId));
  const isMyCourse = (course) => myCourseIds.has(course.id);
  const groups = courseGroups()
    .map((group) => ({
      ...group,
      courses: group.courses.filter((course) => courseMode === "catalog" ? true : isMyCourse(course))
    }))
    .filter((group) => group.courses.length)
    .filter((group) => {
      if (courseMode !== "catalog" || !remoteCourseSearchTerm) return true;
      const text = [
        group.name,
        ...group.courses.flatMap((course) => [course.tee, course.city, course.state, course.country, course.status])
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(remoteCourseSearchTerm);
    });

  if (catalogPanel) catalogPanel.hidden = courseMode !== "catalog";
  modeTabs.forEach((button) => {
    const isActive = button.dataset.courseMode === courseMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (countTitle) {
    const count = groups.length;
    countTitle.textContent = courseMode === "catalog"
      ? `${count} catalog ${count === 1 ? "course" : "courses"}`
      : `${count} ${count === 1 ? "course" : "courses"}`;
  }

  if (!groups.length) {
    target.innerHTML = courseMode === "catalog"
      ? `<div class="empty">${remoteCourseSearchTerm ? "No catalog courses match that search." : "No catalog courses are available yet. Add a missing course to make it available for rounds."}</div>`
      : `<div class="empty">Courses you create or play will appear here. Open the course catalog to find a course and start a round.</div>`;
    return;
  }

  if (courseMode === "catalog") {
    target.innerHTML = renderCatalogCourseList(groups);
    return;
  }

  target.innerHTML = renderCatalogCourseList(groups);
}

function renderCatalogCourseList(groups) {
  return groups
    .map((group) => {
      const firstCourse = group.courses[0];
      const location = [firstCourse.city, firstCourse.state].filter(Boolean).join(", ");
      const teeCount = group.courses.length;
      return `
        <article class="catalog-course-row">
          <details class="catalog-course-details" data-course-group="${escapeHtml(group.name)}" ${openCourseGroups.has(group.name) ? "open" : ""}>
            <summary class="catalog-course-summary">
              <div>
                <div class="catalog-course-title">
                  <strong>${escapeHtml(group.name)}</strong>
                  <span>${teeCount} ${teeCount === 1 ? "tee" : "tees"}</span>
                </div>
                <div class="course-meta">
                  ${location ? `<span>${escapeHtml(location)}</span>` : ""}
                  ${firstCourse.country ? `<span>${escapeHtml(firstCourse.country)}</span>` : ""}
                </div>
              </div>
              <div class="tee-swatch-list" aria-label="Available tees">
                ${group.courses.map((course) => `
                  <span class="tee-swatch ${teeColorClass(course.tee)}" title="${escapeHtml(course.tee)}">${escapeHtml(teeShortLabel(course.tee))}</span>
                `).join("")}
              </div>
              <span class="round-expand-cue" aria-hidden="true"></span>
            </summary>
            <div class="catalog-tee-list">
              ${group.courses.map((course) => {
                const yards = totalYards(course);
                return `
                  <div class="catalog-tee-row">
                    <div>
                      <div class="catalog-tee-title">
                        <span class="tee-swatch ${teeColorClass(course.tee)}">${escapeHtml(teeShortLabel(course.tee))}</span>
                        <strong>${escapeHtml(course.tee)}</strong>
                        ${remoteCourseBadge(course)}
                      </div>
                      <div class="course-meta">
                        <span>${Number(course.rating).toFixed(1)}/${course.slope}</span>
                        <span>Par ${totalPar(course)}</span>
                        ${yards ? `<span>${yards.toLocaleString()} yards</span>` : ""}
                      </div>
                    </div>
                    <div class="catalog-tee-actions">
                      ${canVerifyCourse(course) ? `<button class="secondary-action" type="button" data-verify-course="${course.id}">Verify</button>` : ""}
                      <button class="secondary-action" type="button" data-report-course="${course.id}">Report</button>
                      <button class="primary-action" type="button" data-start-course-round="${course.id}">Start</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </details>
        </article>
      `;
    })
    .join("");
}

function miniCourseMetric(label, value) {
  return `
    <span>
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(String(value))}</strong>
    </span>
  `;
}

function courseRounds(course) {
  return scoringRecord().filter((round) => round.courseId === course.id);
}

function courseAverageScore(course) {
  const rounds = courseRounds(course);
  if (!rounds.length) return "--";
  const average = rounds.reduce((sum, round) => sum + Number(round.score), 0) / rounds.length;
  return round1(average).toFixed(1);
}

function teeShortLabel(tee) {
  return String(tee || "")
    .split("/")
    .map((part) => part.trim()[0] || "")
    .join("/")
    .toUpperCase();
}

function teeColorClass(tee) {
  const normalized = String(tee || "").toLowerCase();
  if (normalized.includes("black")) return "tee-swatch-black";
  if (normalized.includes("blue")) return "tee-swatch-blue";
  if (normalized.includes("white") && normalized.includes("green")) return "tee-swatch-white-green";
  if (normalized.includes("white")) return "tee-swatch-white";
  if (normalized.includes("green")) return "tee-swatch-green";
  if (normalized.includes("red")) return "tee-swatch-red";
  if (normalized.includes("gold") || normalized.includes("yellow")) return "tee-swatch-gold";
  return "tee-swatch-neutral";
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

function courseNames() {
  return [...new Set(state.courses.map((course) => course.name.trim()))].sort((a, b) => a.localeCompare(b));
}

function coursesByName(name) {
  return state.courses
    .filter((course) => course.name.trim() === name)
    .sort((a, b) => String(a.tee).localeCompare(String(b.tee)));
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
  return `
    <div class="scorecard-mini" aria-label="${escapeHtml(course.name)} ${escapeHtml(course.tee)} hole details">
      ${renderNine("Out", out)}
      ${renderNine("In", inNine)}
    </div>
  `;
}

function renderNine(label, holes) {
  const parTotal = holes.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0);
  const yardTotal = holes.reduce((sum, hole) => sum + (Number(hole.yards) || 0), 0);
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
        <span>Hcp</span>
        ${holes.map((hole) => `<span>${present(hole.handicap)}</span>`).join("")}
        <span></span>
      </div>
    </div>
  `;
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
  const preferredCourse = preferredRoundCourseId ? courseById(preferredRoundCourseId) : null;
  const previousName = preferredCourse?.name || courseSelect.value;
  const names = courseNames();
  courseSelect.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  if (names.includes(previousName)) courseSelect.value = previousName;
  renderTeeSelect();
  updateSelectedCourseMeta();
}

function renderTeeSelect() {
  const previousTeeId = preferredRoundCourseId || teeSelect.value;
  const tees = coursesByName(courseSelect.value);
  teeSelect.innerHTML = tees
    .map((course) => `<option value="${course.id}">${escapeHtml(course.tee)}</option>`)
    .join("");
  if (tees.some((course) => course.id === previousTeeId)) teeSelect.value = previousTeeId;
  else if (tees[0]) teeSelect.value = tees[0].id;
  preferredRoundCourseId = null;
}

function selectedRoundCourse() {
  return courseById(teeSelect.value) || coursesByName(courseSelect.value)[0] || state.courses[0];
}

function updateSelectedCourseMeta() {
  const course = selectedRoundCourse();
  const target = document.querySelector("#selectedCourseMeta");
  const yards = course ? totalYards(course) : null;
  const currentHandicapIndex = handicapSummary().index;
  const courseHandicap = course && Number.isFinite(currentHandicapIndex)
    ? playingHandicap(course, currentHandicapIndex)
    : null;
  target.textContent = course
    ? `Rating ${Number(course.rating).toFixed(1)} · Slope ${course.slope} · Par ${totalPar(course)}${yards ? ` · ${yards.toLocaleString()} yards` : ""}${Number.isFinite(courseHandicap) ? ` · Course hcp ${formatCourseHandicap(courseHandicap)}` : ""}`
    : "Add a course before saving a round.";
}

function startRoundCard(course = selectedRoundCourse()) {
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

function renderAnalytics() {
  if (!analyticsSummary || !holeAnalyticsRows || !analyticsNav || !analyticsDrillList || !analyticsHoleWrap) return;
  const record = completedRoundRecord();
  if (!record.length) {
    if (analyticsLocked) {
      analyticsLocked.hidden = false;
      analyticsLocked.innerHTML = `
        <div class="analytics-lock-icon" aria-hidden="true">◎</div>
        <p class="eyebrow">Locked until your first round</p>
        <h2>Score a round to unlock analytics</h2>
        <p>Hole-by-hole scoring patterns, averages, bests, worsts, and course breakdowns will appear here after you save one completed round.</p>
        <div class="analytics-lock-steps">
          <span>1. Choose or add a course</span>
          <span>2. Tap Add round</span>
          <span>3. Save all 18 hole scores</span>
        </div>
      `;
    }
    if (analyticsContent) analyticsContent.hidden = true;
    analyticsSummary.innerHTML = "";
    analyticsNav.innerHTML = "";
    analyticsDrillList.innerHTML = "";
    holeAnalyticsRows.innerHTML = "";
    return;
  }

  if (analyticsLocked) {
    analyticsLocked.hidden = true;
    analyticsLocked.innerHTML = "";
  }
  if (analyticsContent) analyticsContent.hidden = false;

  const playedNames = playedCourseNames();
  if (statsView === "course" && !playedNames.includes(selectedStatsCourseName)) {
    statsView = "overview";
    selectedStatsCourseName = "";
    selectedStatsTeeId = "";
  }
  if (statsView === "tee" && !courseById(selectedStatsTeeId)) {
    statsView = selectedStatsCourseName ? "course" : "overview";
    selectedStatsTeeId = "";
  }

  if (statsView === "course") {
    renderAnalyticsCourse(record, selectedStatsCourseName);
    return;
  }
  if (statsView === "tee") {
    renderAnalyticsTee(record, selectedStatsTeeId);
    return;
  }

  renderAnalyticsOverview(record);
}

function roundCollectionStats(rounds) {
  const scores = rounds.map((round) => Number(round.score)).filter(Number.isFinite);
  const toPars = rounds.map((round) => Number(round.toPar)).filter(Number.isFinite);
  const average = (values) => values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  return {
    rounds: rounds.length,
    averageScore: average(scores),
    averageToPar: average(toPars),
    best: scores.length ? Math.min(...scores) : null,
    worst: scores.length ? Math.max(...scores) : null
  };
}

function parAverageStats(rounds) {
  const buckets = { 3: [], 4: [], 5: [] };
  rounds.forEach((round) => {
    (round.holes || []).forEach((hole) => {
      const par = Number(hole.par);
      const strokes = Number(hole.strokes);
      if (buckets[par] && Number.isFinite(strokes)) {
        buckets[par].push(strokes);
      }
    });
  });
  return [3, 4, 5].map((par) => {
    const values = buckets[par];
    const average = values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    const toPar = Number.isFinite(average) ? round1(average - par) : null;
    return { par, count: values.length, average, toPar };
  });
}

function clearAnalyticsParBreakdown() {
  if (!analyticsParBreakdown) return;
  analyticsParBreakdown.hidden = true;
  analyticsParBreakdown.innerHTML = "";
}

function renderAnalyticsParBreakdown(rounds) {
  if (!analyticsParBreakdown) return;
  const parStats = parAverageStats(rounds);
  const hasScores = parStats.some((entry) => entry.count > 0);
  if (!hasScores) {
    clearAnalyticsParBreakdown();
    return;
  }
  analyticsParBreakdown.hidden = false;
  analyticsParBreakdown.innerHTML = `
    <div class="par-average-header">
      <span>Average shots per par</span>
      <strong>Par scoring</strong>
    </div>
    <div class="metric-grid par-average-grid">
      ${parStats.map((entry) => {
        const detail = entry.count
          ? `<small>${formatToPar(entry.toPar)} avg to par · ${entry.count} scores</small>`
          : `<small>No scored holes yet</small>`;
        return metric(`Par ${entry.par}`, Number.isFinite(entry.average) ? entry.average.toFixed(1) : "--", detail);
      }).join("")}
    </div>
  `;
}

function renderAnalyticsInsights(items = []) {
  if (!analyticsInsights) return;
  const visible = items.filter((item) => item && item.value);
  analyticsInsights.innerHTML = visible.length
    ? visible.map((item) => `
      <div class="insight-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
        ${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ""}
      </div>
    `).join("")
    : "";
}

function bestParTypeLabel(rounds) {
  const stats = parAverageStats(rounds).filter((entry) => entry.count > 0 && Number.isFinite(entry.toPar));
  if (!stats.length) return null;
  const best = stats.sort((a, b) => a.toPar - b.toPar)[0];
  return {
    value: `Par ${best.par}`,
    detail: `${formatToPar(best.toPar)} avg to par`
  };
}

function hardestHoleInsight(rounds, course) {
  if (!course || !rounds.length) return null;
  const holes = course.holes.map((hole) => {
    const scores = rounds
      .map((round) => round.holes.find((roundHole) => roundHole.hole === hole.hole)?.strokes)
      .map(Number)
      .filter(Number.isFinite);
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
    return {
      hole: hole.hole,
      average,
      toPar: Number.isFinite(average) ? round1(average - Number(hole.par)) : null
    };
  }).filter((hole) => Number.isFinite(hole.toPar));
  if (!holes.length) return null;
  const hardest = holes.sort((a, b) => b.toPar - a.toPar)[0];
  return {
    value: `Hole ${hardest.hole}`,
    detail: `${formatToPar(hardest.toPar)} avg to par`
  };
}

function renderAnalyticsOverview(record) {
  const stats = roundCollectionStats(record);
  const summary = handicapSummary();
  const handicapRecord = scoringRecord();
  const latestHandicapRound = handicapRecord[0];
  const latestChange = latestHandicapRound ? handicapChangesByRound(handicapRecord)[latestHandicapRound.id] : null;
  analyticsHoleWrap.hidden = true;
  clearAnalyticsParBreakdown();
  analyticsNav.innerHTML = `<div class="analytics-breadcrumb"><span>Account stats</span></div>`;
  analyticsSummary.innerHTML = [
    metric("Rounds", stats.rounds),
    metric("Avg score", Number.isFinite(stats.averageScore) ? stats.averageScore.toFixed(1) : "--"),
    metric("Best", Number.isFinite(stats.best) ? stats.best : "--"),
    metric("Worst", Number.isFinite(stats.worst) ? stats.worst : "--"),
    metric("Index", summary.index === null ? "--" : summary.index.toFixed(1)),
    metric("Latest change", latestHandicapChangeLabel(latestChange))
  ].join("");
  const bestParType = bestParTypeLabel(record);
  renderAnalyticsInsights([
    favoriteCourseName(record) ? { label: "Favorite course", value: favoriteCourseName(record), detail: "Most rounds played" } : null,
    bestParType ? { label: "Best par type", ...bestParType } : null,
    stats.best ? { label: "Best round", value: String(stats.best), detail: stats.averageScore ? `${stats.averageScore.toFixed(1)} average` : "" } : null
  ]);

  analyticsDrillList.innerHTML = playedCourseNames()
    .map((name) => {
      const rounds = record.filter((round) => round.course.name === name);
      const courseStats = roundCollectionStats(rounds);
      const tees = playedTeesByName(name);
      const first = tees[0];
      const location = first ? [first.city, first.state].filter(Boolean).join(", ") : "";
      return `
        <button class="analytics-drill-card" type="button" data-analytics-course="${escapeHtml(name)}">
          <span>
            <strong>${escapeHtml(name)}</strong>
            <small>${[location, `${tees.length} ${tees.length === 1 ? "tee" : "tees"}`].filter(Boolean).map(escapeHtml).join(" · ")}</small>
          </span>
          <span>
            <small>Rounds</small>
            <strong>${courseStats.rounds}</strong>
          </span>
          <span>
            <small>Avg</small>
            <strong>${Number.isFinite(courseStats.averageScore) ? courseStats.averageScore.toFixed(1) : "--"}</strong>
          </span>
          <span class="analytics-drill-cue" aria-hidden="true"></span>
        </button>
      `;
    })
    .join("");
  holeAnalyticsRows.innerHTML = "";
}

function renderAnalyticsCourse(record, courseName) {
  const rounds = record.filter((round) => round.course.name === courseName && Array.isArray(round.holes));
  const stats = roundCollectionStats(rounds);
  const tees = playedTeesByName(courseName);
  analyticsHoleWrap.hidden = true;
  clearAnalyticsParBreakdown();
  analyticsNav.innerHTML = `
    <button class="secondary-action analytics-back" type="button" data-analytics-back="overview">Back to all stats</button>
    <div class="analytics-breadcrumb"><span>Course</span><strong>${escapeHtml(courseName)}</strong></div>
  `;
  analyticsSummary.innerHTML = [
    metric("Rounds", stats.rounds),
    metric("Avg score", Number.isFinite(stats.averageScore) ? stats.averageScore.toFixed(1) : "--"),
    metric("Best", Number.isFinite(stats.best) ? stats.best : "--"),
    metric("Worst", Number.isFinite(stats.worst) ? stats.worst : "--"),
    metric("Avg to par", Number.isFinite(stats.averageToPar) ? formatToPar(stats.averageToPar) : "--")
  ].join("");
  const bestParType = bestParTypeLabel(rounds);
  renderAnalyticsInsights([
    bestParType ? { label: "Best par type", ...bestParType } : null,
    stats.best ? { label: "Best score", value: String(stats.best), detail: Number.isFinite(stats.averageScore) ? `${stats.averageScore.toFixed(1)} average` : "" } : null
  ]);

  analyticsDrillList.innerHTML = tees
    .map((course) => {
      const teeRounds = rounds.filter((round) => round.courseId === course.id);
      const teeStats = roundCollectionStats(teeRounds);
      const yards = totalYards(course);
      return `
        <button class="analytics-drill-card" type="button" data-analytics-tee="${course.id}">
          <span>
            <strong>${escapeHtml(course.tee)}</strong>
            <small>${Number(course.rating).toFixed(1)}/${course.slope} · Par ${totalPar(course)}${yards ? ` · ${yards.toLocaleString()} yards` : ""}</small>
          </span>
          <span>
            <small>Rounds</small>
            <strong>${teeStats.rounds}</strong>
          </span>
          <span>
            <small>Avg</small>
            <strong>${Number.isFinite(teeStats.averageScore) ? teeStats.averageScore.toFixed(1) : "--"}</strong>
          </span>
          <span class="analytics-drill-cue" aria-hidden="true"></span>
        </button>
      `;
    })
    .join("");
  holeAnalyticsRows.innerHTML = "";
}

function renderAnalyticsTee(record, teeId) {
  const course = courseById(teeId);
  if (!course) {
    statsView = selectedStatsCourseName ? "course" : "overview";
    renderAnalytics();
    return;
  }
  selectedStatsCourseName = course.name;
  const rounds = record.filter((round) => round.courseId === course.id && Array.isArray(round.holes));
  const stats = roundCollectionStats(rounds);
  const currentHandicapIndex = handicapSummary().index;
  const courseHandicap = Number.isFinite(currentHandicapIndex) ? playingHandicap(course, currentHandicapIndex) : null;
  analyticsHoleWrap.hidden = false;
  analyticsNav.innerHTML = `
    <button class="secondary-action analytics-back" type="button" data-analytics-back="course">Back to ${escapeHtml(course.name)}</button>
    <div class="analytics-breadcrumb"><span>Tee</span><strong>${escapeHtml(course.name)} · ${escapeHtml(course.tee)}</strong></div>
  `;
  analyticsSummary.innerHTML = [
    metric("Rounds", stats.rounds),
    metric("Avg score", Number.isFinite(stats.averageScore) ? stats.averageScore.toFixed(1) : "--"),
    metric("Best", Number.isFinite(stats.best) ? stats.best : "--"),
    metric("Worst", Number.isFinite(stats.worst) ? stats.worst : "--"),
    metric("Course hcp", Number.isFinite(courseHandicap) ? formatCourseHandicap(courseHandicap) : "--")
  ].join("");
  const bestParType = bestParTypeLabel(rounds);
  const hardestHole = hardestHoleInsight(rounds, course);
  renderAnalyticsInsights([
    bestParType ? { label: "Best par type", ...bestParType } : null,
    hardestHole ? { label: "Hardest hole", ...hardestHole } : null
  ]);
  renderAnalyticsParBreakdown(rounds);
  analyticsDrillList.innerHTML = "";
  holeAnalyticsRows.innerHTML = course.holes.map((hole) => {
    const scoresForHole = rounds
      .map((round) => round.holes.find((roundHole) => roundHole.hole === hole.hole)?.strokes)
      .map(Number)
      .filter(Number.isFinite);
    const average = scoresForHole.length ? round1(scoresForHole.reduce((sum, score) => sum + score, 0) / scoresForHole.length) : null;
    const toPar = Number.isFinite(average) ? round1(average - Number(hole.par)) : null;
    return `
      <tr>
        <th scope="row">${hole.hole}</th>
        <td>${present(hole.par)}</td>
        <td>${present(hole.yards)}</td>
        <td>${present(hole.handicap)}</td>
        <td>${Number.isFinite(average) ? average.toFixed(1) : "--"}</td>
        <td>${Number.isFinite(toPar) ? formatToPar(toPar) : "--"}</td>
        <td>${scoresForHole.length ? Math.min(...scoresForHole) : "--"}</td>
        <td>${scoresForHole.length ? Math.max(...scoresForHole) : "--"}</td>
      </tr>
    `;
  }).join("");
}

function renderAnalyticsCourseSelect() {
  const previousName = analyticsCourseSelect.value;
  const names = playedCourseNames();
  analyticsCourseSelect.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  if (names.includes(previousName)) analyticsCourseSelect.value = previousName;
}

function renderAnalyticsTeeSelect() {
  const previousTeeId = analyticsTeeSelect.value;
  const tees = playedTeesByName(analyticsCourseSelect.value);
  analyticsTeeSelect.innerHTML = tees
    .map((course) => `<option value="${course.id}">${escapeHtml(course.tee)}</option>`)
    .join("");
  if (tees.some((course) => course.id === previousTeeId)) analyticsTeeSelect.value = previousTeeId;
  if (!analyticsTeeSelect.value && tees[0]) analyticsTeeSelect.value = tees[0].id;
}

function playedCourseNames() {
  const names = new Set(completedRoundRecord().filter((round) => Array.isArray(round.holes)).map((round) => round.course.name));
  return [...names].sort((a, b) => a.localeCompare(b));
}

function playedTeesByName(name) {
  const tees = new Map();
  completedRoundRecord()
    .filter((round) => Array.isArray(round.holes) && round.course.name === name)
    .forEach((round) => tees.set(round.course.id, round.course));
  return [...tees.values()].sort((a, b) => a.tee.localeCompare(b.tee));
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
  document.querySelector("#roundTotalScore").textContent = completed.length ? `${completed.length}/18 · ${total}` : "No holes scored";

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
  scheduleRoundEditAutoSave();
}

function validateRoundCard() {
  if (!roundHoleState.holes.length) return "Choose a course before saving.";
  const scored = roundHoleState.holes.filter(hasHoleScore);
  if (!scored.length) return "Score at least one hole before saving.";
  const invalid = scored.find((hole) => !isValidHoleScore(hole));
  return invalid ? `Hole ${invalid.hole} needs a score from ${scoreOptionsForHole(invalid)[0]} to ${scoreOptionsForHole(invalid).at(-1)}.` : "";
}

function roundPayloadFromDialog(existingRound = null) {
  const formData = new FormData(roundForm);
  const holes = roundHoleState.holes.map((hole) => ({
    ...hole,
    strokes: hasHoleScore(hole) ? Number(hole.strokes) : null
  }));
  return {
    id: existingRound?.id || uid(),
    createdAt: existingRound?.createdAt || Date.now(),
    updatedAt: existingRound ? Date.now() : undefined,
    date: formData.get("date"),
    courseId: formData.get("courseId"),
    pcc: numeric(formData, "pcc") || 0,
    score: roundScore({ holes }),
    holes
  };
}

function setRoundAutoSaveStatus(message) {
  if (roundAutoSaveStatus) roundAutoSaveStatus.textContent = message;
}

function scheduleRoundEditAutoSave() {
  if (!editingRoundId || !hasRemoteSession()) return;
  if (!navigator.onLine) {
    setRoundAutoSaveStatus("Connect to save");
    setSyncStatus("Offline");
    return;
  }
  clearTimeout(roundAutoSaveTimer);
  setRoundAutoSaveStatus("Unsaved changes");
  roundAutoSaveTimer = setTimeout(async () => {
    const existingRound = state.rounds.find((item) => item.id === editingRoundId);
    if (!existingRound || validateRoundCard()) return;
    const round = roundPayloadFromDialog(existingRound);
    try {
      setRoundAutoSaveStatus("Saving...");
      setSyncStatus("Saving round...");
      const saved = await saveRemoteRound(round, existingRound);
      round.id = saved.id;
      round.backendCourseId = saved.course_id;
      round.backendTeeId = saved.tee_id;
      state.rounds = state.rounds.map((item) => item.id === existingRound.id ? round : item);
      setRoundAutoSaveStatus("Saved");
      setSyncStatus("Saved");
      showActionStatus("Round changes saved.");
    } catch {
      setRoundAutoSaveStatus("Save failed");
      setSyncStatus("Round sync failed");
      showActionStatus("Round changes were not saved.", "error");
    }
  }, 900);
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

function remoteCourseOptions() {
  const byBackendId = new Map();
  for (const course of state.courses) {
    if (!course.backendCourseId || byBackendId.has(course.backendCourseId)) continue;
    byBackendId.set(course.backendCourseId, course);
  }
  return [...byBackendId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderExistingCourseSelect() {
  if (!existingCourseSelect) return;
  const selectedValue = existingCourseSelect.value;
  const courses = remoteCourseOptions();
  existingCourseSelect.innerHTML = courses
    .map((course) => `<option value="${course.id}">${escapeHtml([course.name, course.city, course.state].filter(Boolean).join(" · "))}</option>`)
    .join("");
  if (courses.some((course) => course.id === selectedValue)) existingCourseSelect.value = selectedValue;
}

function updateCourseFormMode() {
  if (!courseForm || !courseFormMode) return;
  const mode = courseFormMode.value || "new";
  const isExisting = mode === "existing";
  courseForm.dataset.mode = mode;
  courseForm.querySelectorAll("[data-course-new]").forEach((element) => {
    element.hidden = isExisting;
    element.querySelectorAll("input, select, textarea").forEach((field) => {
      field.disabled = isExisting;
    });
  });
  courseForm.querySelectorAll("[data-course-existing]").forEach((element) => {
    element.hidden = !isExisting;
    element.querySelectorAll("input, select, textarea").forEach((field) => {
      field.disabled = !isExisting;
    });
  });
  if (isExisting) renderExistingCourseSelect();
}

function setCourseFormOpen(isOpen) {
  courseForm.classList.toggle("is-collapsed", !isOpen);
  courseFormToggle.innerHTML = isOpen
    ? `<span aria-hidden="true">−</span> Hide form`
    : `<span aria-hidden="true">+</span> Add course`;
  if (isOpen) {
    renderExistingCourseSelect();
    updateCourseFormMode();
  }
}

function renderProfile() {
  const summary = document.querySelector("#profileSummary");
  if (!summary) return;
  const name = state.profile?.name;
  summary.textContent = name
    ? `${name}'s private ParTrack profile`
    : "Set up your player profile to personalize this device.";
}

function renderSettingsControls() {
  if (preferredCourseSelect) {
    const names = courseNames();
    const storedName = storedPreferredCourseName();
    preferredCourseSelect.innerHTML = [
      `<option value="">No default</option>`,
      ...names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    ].join("");
    if (names.includes(storedName)) preferredCourseSelect.value = storedName;
  }

  if (preferredTeeSelect) {
    const name = preferredCourseSelect?.value || storedPreferredCourseName();
    const tees = name ? coursesByName(name) : [];
    const storedTee = storedPreferredTeeId();
    preferredTeeSelect.innerHTML = [
      `<option value="">First tee listed</option>`,
      ...tees.map((course) => `<option value="${course.id}">${escapeHtml(course.tee)}</option>`)
    ].join("");
    if (tees.some((course) => course.id === storedTee)) preferredTeeSelect.value = storedTee;
  }
}

function openSetupDialog() {
  if (!setupDialog || !setupForm) return;
  setupForm.elements.playerName.value = state.profile?.name || "";
  setupDialog.showModal();
}

function setRoundDialogMode(round = null) {
  editingRoundId = round?.id || null;
  const title = roundForm.querySelector(".dialog-header h2");
  const saveButton = roundForm.querySelector("button[type='submit']");
  if (title) title.textContent = editingRoundId ? "Edit round" : "Add round";
  if (saveButton) saveButton.textContent = editingRoundId ? "Save changes" : "Add round";
}

function openRoundDialog(round = null, preferredCourseId = null) {
  if (!state.courses.length) {
    location.hash = "#courses";
    route();
    return;
  }

  clearTimeout(roundAutoSaveTimer);
  setRoundAutoSaveStatus(round ? "Edits auto-save" : "Saves when you add the round");
  const storedTee = storedPreferredTeeId();
  const storedCourse = storedPreferredCourseName();
  if (preferredCourseId) preferredRoundCourseId = preferredCourseId;
  else if (!round && storedTee && courseById(storedTee)) preferredRoundCourseId = storedTee;
  else if (!round && storedCourse) preferredRoundCourseId = coursesByName(storedCourse)[0]?.id || null;
  roundForm.reset();
  setRoundDialogMode(round);
  roundForm.elements.date.value = round?.date || todayIso();
  renderCourseSelect();

  if (round) {
    const course = courseById(round.courseId);
    if (course) {
      courseSelect.value = course.name;
      renderTeeSelect();
      teeSelect.value = course.id;
      updateSelectedCourseMeta();
      roundHoleState.activeHole = 1;
      roundHoleState.holes = course.holes.map((hole, index) => {
        const saved = round.holes?.[index] || {};
        return {
          hole: hole.hole,
          par: Number(saved.par) || Number(hole.par) || 4,
          yards: Number(saved.yards) || Number(hole.yards) || null,
          handicap: Number(saved.handicap) || Number(hole.handicap) || hole.hole,
          strokes: hasHoleScore(saved) ? Number(saved.strokes) : null
        };
      });
      renderRoundScoringUI();
    } else {
      startRoundCard();
    }
  } else {
    startRoundCard();
  }

  roundDialog.showModal();
}

function setAuthMode(mode) {
  authMode = mode;
  if (!authForm) return;
  authForm.dataset.mode = mode;
  authForm.querySelector("h2").textContent = mode === "signup" ? "Create account" : "Sign in";
  authForm.querySelector("[data-auth-submit]").textContent = mode === "signup" ? "Create account" : "Sign in";
  authForm.querySelector("[data-auth-switch]").textContent = mode === "signup" ? "I already have an account" : "Create an account";
  const nameLabel = authForm.querySelector("[data-auth-name]");
  if (nameLabel) nameLabel.hidden = mode !== "signup";
}

function setAuthStatus(message) {
  if (authStatus) authStatus.textContent = message;
}

async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  remoteSession = null;
  Object.assign(state, blankState());
  setSignedInUi(false);
  setAuthStatus("Signed out.");
}

async function initializeAuth() {
  if (localPreviewMode && !supabaseConfigured) {
    state.profile = {
      name: "Local Preview",
      setupComplete: true
    };
    setSignedInUi(true);
    return;
  }

  await createSupabaseClient();
  if (!supabase) {
    setSignedInUi(false);
    return;
  }

  setSignedInUi(false);
  setAuthMode("login");
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    setAuthStatus(error.message);
    return;
  }
  remoteSession = data.session;
  if (!remoteSession) return;
  setSignedInUi(true);
  await ensureRemoteProfile();
  await loadRemoteData();
}

function saveProfile(formData, setupComplete = true) {
  state.profile = {
    name: String(formData.get("playerName") || "").trim(),
    setupComplete
  };
  renderProfile();
  showActionStatus("Profile saved.");
  if (hasRemoteSession()) {
    supabase
      .from("profiles")
      .upsert({ id: remoteUserId(), display_name: state.profile.name }, { onConflict: "id" })
      .then(({ error }) => {
        if (error) setSyncStatus("Profile sync failed");
        else setSyncStatus("Synced");
      });
  }
}

document.querySelectorAll("[data-open-round]").forEach((button) => {
  button.addEventListener("click", () => openRoundDialog());
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) {
    setAuthStatus("Account sync is not configured for this build.");
    return;
  }
  const formData = new FormData(authForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  setAuthStatus(authMode === "signup" ? "Creating account..." : "Signing in...");
  const result = authMode === "signup"
    ? await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: authRedirectUrl()
      }
    })
    : await supabase.auth.signInWithPassword({ email, password });
  if (result.error) {
    setAuthStatus(result.error.message);
    return;
  }
  remoteSession = result.data.session;
  if (!remoteSession) {
    setAuthStatus("Check your email to confirm the account, then sign in.");
    return;
  }
  await ensureRemoteProfile(displayName);
  await loadRemoteData();
  setSignedInUi(true);
  showActionStatus("Signed in. Your account is synced.");
  render();
  route();
});

document.querySelector("[data-auth-switch]")?.addEventListener("click", () => {
  setAuthMode(authMode === "signup" ? "login" : "signup");
  setAuthStatus("");
});

document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", signOut);
});

themeSelect?.addEventListener("change", () => {
  const theme = themeSelect.value;
  localStorage.setItem(themeStorageKey, theme);
  applyTheme(theme);
  showActionStatus("Theme saved.");
});

handicapBasisSelect?.addEventListener("change", () => {
  localStorage.setItem(handicapBasisStorageKey, handicapBasisSelect.value);
  applyHandicapBasis(handicapBasisSelect.value);
  showActionStatus("Handicap basis saved.");
});

preferredCourseSelect?.addEventListener("change", () => {
  localStorage.setItem(preferredCourseStorageKey, preferredCourseSelect.value);
  localStorage.removeItem(preferredTeeStorageKey);
  renderSettingsControls();
  showActionStatus(preferredCourseSelect.value ? "Default course saved." : "Default course cleared.");
});

preferredTeeSelect?.addEventListener("change", () => {
  localStorage.setItem(preferredTeeStorageKey, preferredTeeSelect.value);
  showActionStatus(preferredTeeSelect.value ? "Default tee saved." : "Default tee cleared.");
});

links.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    navigateToView(link.dataset.viewLink);
  });
});

document.querySelectorAll("[data-close-round]").forEach((button) => {
  button.addEventListener("click", () => roundDialog.close());
});

courseSelect.addEventListener("change", () => {
  renderTeeSelect();
  updateSelectedCourseMeta();
  startRoundCard();
});

teeSelect.addEventListener("change", () => {
  updateSelectedCourseMeta();
  startRoundCard();
});

analyticsCourseSelect?.addEventListener("change", () => {
  renderAnalyticsTeeSelect();
  renderAnalytics();
});

analyticsTeeSelect?.addEventListener("change", renderAnalytics);
cloudCourseSearch?.addEventListener("input", () => {
  remoteCourseSearchTerm = cloudCourseSearch.value.trim().toLowerCase();
  renderCourses();
});

courseList?.addEventListener("toggle", (event) => {
  const details = event.target.closest(".catalog-course-details");
  if (!details) return;
  const groupName = details.dataset.courseGroup;
  if (!groupName) return;
  if (details.open) openCourseGroups.add(groupName);
  else openCourseGroups.delete(groupName);
}, true);

courseForm.addEventListener("input", (event) => {
  if (event.target.closest(".hole-table")) updateHoleTotals();
});
courseFormMode?.addEventListener("change", updateCourseFormMode);
document.querySelector("[data-reset-holes]")?.addEventListener("click", () => renderHoleEditor(false));
courseFormToggle.addEventListener("click", () => {
  const shouldOpen = courseForm.classList.contains("is-collapsed");
  setCourseFormOpen(shouldOpen);
});
document.querySelector("[data-cancel-course-form]")?.addEventListener("click", () => {
  courseForm.reset();
  renderHoleEditor(false);
  updateCourseFormMode();
  setCourseFormOpen(false);
});

document.querySelector("[data-open-setup]")?.addEventListener("click", openSetupDialog);

document.querySelector("[data-skip-setup]")?.addEventListener("click", () => {
  setupDialog.close();
});

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveProfile(new FormData(setupForm), true);
  setupDialog.close();
});

roundForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.courses.length) return;
  const saveButton = roundForm.querySelector("button[type='submit']");
  const originalButtonText = saveButton?.textContent || "Add round";
  if (!hasRemoteSession()) {
    document.querySelector("#roundTotalScore").textContent = localPreviewMode
      ? "Open the hosted app and sign in to save rounds to your account."
      : "Sign in to save rounds.";
    return;
  }
  if (!navigator.onLine) {
    setRoundAutoSaveStatus("Connect to save");
    showActionStatus("You are offline. Reconnect before saving this round.", "error");
    return;
  }
  const roundError = validateRoundCard();
  if (roundError) {
    document.querySelector("#roundTotalScore").textContent = roundError;
    return;
  }
  const existingRound = editingRoundId ? state.rounds.find((item) => item.id === editingRoundId) : null;
  const round = roundPayloadFromDialog(existingRound);
  try {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }
    setSyncStatus("Saving round...");
    setRoundAutoSaveStatus("Saving...");
    const saved = await saveRemoteRound(round, existingRound);
    round.id = saved.id;
    round.backendCourseId = saved.course_id;
    round.backendTeeId = saved.tee_id;
    if (existingRound) state.rounds = state.rounds.map((item) => item.id === existingRound.id ? round : item);
    else state.rounds.push(round);
    await loadRemoteData();
    setSyncStatus("Synced");
    setRoundAutoSaveStatus("Saved");
    const holesPlayed = scoredHoleCount(round);
    const saveMessage = holesPlayed === 18
      ? "Round saved."
      : holesPlayed === 9
        ? "9-hole round saved for your handicap estimate."
        : "Round progress saved.";
    showActionStatus(existingRound ? "Round changes saved." : saveMessage);
  } catch (error) {
    document.querySelector("#roundTotalScore").textContent = error.message || "Could not save round.";
    setSyncStatus("Round sync failed");
    setRoundAutoSaveStatus("Save failed");
    showActionStatus("Round was not saved. Check your connection and try again.", "error");
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = originalButtonText;
    }
    return;
  }
  editingRoundId = null;
  if (saveButton) {
    saveButton.disabled = false;
    saveButton.textContent = originalButtonText;
  }
  roundDialog.close();
  render();
});

courseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(courseForm);
  const holes = parseHoleCard(formData);
  const holeError = validateHoleCard(holes);
  if (holeError) {
    holeTotals.textContent = holeError;
    return;
  }
  if (!hasRemoteSession()) {
    holeTotals.textContent = "Sign in to save courses.";
    return;
  }
  if (!navigator.onLine) {
    holeTotals.textContent = "Connect to save this course.";
    showActionStatus("You are offline. Reconnect before saving this course.", "error");
    return;
  }
  const saveButton = courseForm.querySelector("button[type='submit']");
  const originalButtonText = saveButton?.textContent || "Save course";
  try {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }
    setSyncStatus("Saving course...");
    holeTotals.textContent = "Saving course...";
    const remoteCourse = await saveRemoteCourse(formData, holes);
    preferredRoundCourseId = remoteCourse.id;
    await loadRemoteData();
    const savedCourse = courseById(remoteCourse.id) || remoteCourse;
    selectedCourseIdsByName[savedCourse.name] = savedCourse.id;
    courseForm.reset();
    renderHoleEditor();
    updateCourseFormMode();
    setCourseFormOpen(false);
    setSyncStatus("Synced");
    showActionStatus("Course saved and ready to use.");
    render();
  } catch (error) {
    holeTotals.textContent = error.message || "Could not save course.";
    setSyncStatus("Course sync failed");
    showActionStatus("Course was not saved. Check the form and try again.", "error");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = originalButtonText;
    }
  }
});

document.addEventListener("click", async (event) => {
  const editRoundButton = event.target.closest("[data-edit-round]");
  const resumeRoundButton = event.target.closest("[data-resume-round]");
  const roundButton = event.target.closest("[data-delete-round]");
  const courseButton = event.target.closest("[data-delete-course]");
  const startCourseRoundButton = event.target.closest("[data-start-course-round]");
  const publishCourseButton = event.target.closest("[data-publish-course]");
  const verifyCourseButton = event.target.closest("[data-verify-course]");
  const reportCourseButton = event.target.closest("[data-report-course]");
  const analyticsCourseButton = event.target.closest("[data-analytics-course]");
  const analyticsTeeButton = event.target.closest("[data-analytics-tee]");
  const analyticsBackButton = event.target.closest("[data-analytics-back]");
  const strokeButton = event.target.closest("[data-stroke]");
  const roundHoleButton = event.target.closest("[data-round-hole]");
  const prevHoleButton = event.target.closest("[data-prev-hole]");
  const nextHoleButton = event.target.closest("[data-next-hole]");
  if (strokeButton) setActiveHoleScore(Number(strokeButton.dataset.stroke));
  if (roundHoleButton) setActiveRoundHole(Number(roundHoleButton.dataset.roundHole));
  if (prevHoleButton) setActiveRoundHole(roundHoleState.activeHole - 1);
  if (nextHoleButton) setActiveRoundHole(roundHoleState.activeHole + 1);
  if (editRoundButton) {
    const round = state.rounds.find((item) => item.id === editRoundButton.dataset.editRound);
    if (round) openRoundDialog(round);
  }
  if (resumeRoundButton) {
    event.preventDefault();
    event.stopPropagation();
    const round = state.rounds.find((item) => item.id === resumeRoundButton.dataset.resumeRound);
    if (round) openRoundDialog(round);
  }
  if (startCourseRoundButton) {
    event.preventDefault();
    event.stopPropagation();
    openRoundDialog(null, startCourseRoundButton.dataset.startCourseRound);
  }
  if (publishCourseButton) {
    event.preventDefault();
    event.stopPropagation();
    const course = courseById(publishCourseButton.dataset.publishCourse);
    if (!course?.backendCourseId) return;
    if (course?.name) openCourseGroups.add(course.name);
    if (!navigator.onLine) {
      showActionStatus("You are offline. Reconnect before publishing this course.", "error");
      return;
    }
    publishCourseButton.disabled = true;
    setSyncStatus("Publishing...");
    const { error } = await supabase
      .from("courses")
      .update({ is_public_unverified: true })
      .eq("id", course.backendCourseId);
    if (error) {
      publishCourseButton.disabled = false;
      setSyncStatus("Publish failed");
      alert(error.message);
      return;
    }
    await loadRemoteData();
    setSyncStatus("Published as unverified");
    showActionStatus("Course shared for the community.");
    render();
  }
  if (verifyCourseButton) {
    event.preventDefault();
    event.stopPropagation();
    const course = courseById(verifyCourseButton.dataset.verifyCourse);
    if (!course?.backendCourseId) return;
    if (course?.name) openCourseGroups.add(course.name);
    if (!navigator.onLine) {
      showActionStatus("You are offline. Reconnect before verifying this course.", "error");
      return;
    }
    verifyCourseButton.disabled = true;
    verifyCourseButton.textContent = "Verifying...";
    setSyncStatus("Verifying...");
    const { error } = await supabase
      .from("courses")
      .update({ status: "approved", is_public_unverified: false })
      .eq("id", course.backendCourseId);
    if (error) {
      verifyCourseButton.disabled = false;
      verifyCourseButton.textContent = "Verify";
      setSyncStatus("Verification failed");
      alert(error.message);
      return;
    }
    markCourseApprovedLocal(course.backendCourseId);
    render();
    await loadRemoteData();
    setSyncStatus("Verified and published");
    showActionStatus("Course verified and published.");
    render();
  }
  if (reportCourseButton) {
    event.preventDefault();
    event.stopPropagation();
    const course = courseById(reportCourseButton.dataset.reportCourse);
    if (!course) return;
    const subject = encodeURIComponent(`ParTrack course data issue: ${course.name} ${course.tee}`);
    const body = encodeURIComponent([
      `Course: ${course.name}`,
      `Tee: ${course.tee}`,
      `Location: ${[course.city, course.state, course.country].filter(Boolean).join(", ")}`,
      `Rating/Slope: ${course.rating}/${course.slope}`,
      "",
      "What should be corrected?"
    ].join("\n"));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }
  if (analyticsCourseButton) {
    statsView = "course";
    selectedStatsCourseName = analyticsCourseButton.dataset.analyticsCourse;
    selectedStatsTeeId = "";
    renderAnalytics();
  }
  if (analyticsTeeButton) {
    const course = courseById(analyticsTeeButton.dataset.analyticsTee);
    statsView = "tee";
    selectedStatsTeeId = analyticsTeeButton.dataset.analyticsTee;
    selectedStatsCourseName = course?.name || selectedStatsCourseName;
    renderAnalytics();
  }
  if (analyticsBackButton) {
    if (analyticsBackButton.dataset.analyticsBack === "overview") {
      statsView = "overview";
      selectedStatsCourseName = "";
      selectedStatsTeeId = "";
    } else {
      statsView = "course";
      selectedStatsTeeId = "";
    }
    renderAnalytics();
  }
  if (roundButton) {
    if (!confirm("Delete this round from your account?")) return;
    if (!hasRemoteSession()) {
      alert("Open the hosted app and sign in to delete synced rounds.");
      return;
    }
    if (!navigator.onLine) {
      showActionStatus("You are offline. Reconnect before deleting this round.", "error");
      return;
    }
    roundButton.disabled = true;
    roundButton.textContent = "Deleting...";
    setSyncStatus("Deleting round...");
    const { data, error } = await supabase
      .from("rounds")
      .delete()
      .eq("id", roundButton.dataset.deleteRound)
      .eq("user_id", remoteUserId())
      .select("id")
      .maybeSingle();
    if (error || !data) {
      roundButton.disabled = false;
      roundButton.textContent = "Delete";
      setSyncStatus("Delete failed");
      alert(error?.message || "That round could not be deleted. It may already be gone or may not belong to this account.");
      return;
    }
    state.rounds = state.rounds.filter((round) => round.id !== roundButton.dataset.deleteRound);
    render();
    await loadRemoteData();
    setSyncStatus("Synced");
    showActionStatus("Round deleted.");
    render();
    return;
  }
  if (courseButton) {
    const courseId = courseButton.dataset.deleteCourse;
    const affectedRounds = state.rounds.filter((round) => round.courseId === courseId).length;
    const message = affectedRounds
      ? `Delete this course and ${affectedRounds} linked ${affectedRounds === 1 ? "round" : "rounds"} from your account?`
      : "Delete this course from your account?";
    if (!confirm(message)) return;
    const course = courseById(courseId);
    if (!hasRemoteSession() || !course?.backendCourseId) {
      alert("Open the hosted app and sign in to delete synced courses.");
      return;
    }
    if (!navigator.onLine) {
      showActionStatus("You are offline. Reconnect before deleting this course.", "error");
      return;
    }
    courseButton.disabled = true;
    courseButton.textContent = "Deleting...";
    setSyncStatus("Deleting course...");
    const { data, error } = await supabase
      .from("courses")
      .delete()
      .eq("id", course.backendCourseId)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      courseButton.disabled = false;
      courseButton.textContent = "Delete";
      setSyncStatus("Delete failed");
      alert(error?.message || "That course could not be deleted.");
      return;
    }
    state.courses = state.courses.filter((course) => course.backendCourseId !== data.id);
    state.rounds = state.rounds.filter((round) => round.backendCourseId !== data.id);
    render();
    await loadRemoteData();
    setSyncStatus("Synced");
    showActionStatus("Course deleted.");
    render();
    return;
  }
});

document.addEventListener("change", (event) => {
  const teeSelect = event.target.closest("[data-course-tee-select]");
  if (!teeSelect) return;
  selectedCourseIdsByName[teeSelect.dataset.courseTeeSelect] = teeSelect.value;
  renderCourses();
});

document.querySelectorAll("[data-course-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    courseMode = button.dataset.courseMode || "mine";
    renderCourses();
  });
});

document.querySelector("[data-export]")?.addEventListener("click", () => {
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
window.addEventListener("online", async () => {
  if (!hasRemoteSession()) return;
  try {
    setSyncStatus("Checking...");
    await loadRemoteData();
    setSyncStatus("Synced");
    showActionStatus("Back online. Your account is up to date.");
    render();
  } catch {
    setSyncStatus("Online, sync failed");
    showActionStatus("Back online, but refresh failed. Try again in a moment.", "error");
  }
});

window.addEventListener("offline", () => {
  setSyncStatus("Offline");
  showActionStatus("You are offline. Changes need a connection to save.", "warning");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(
    () => {
      document.querySelector("#offlineStatus") && (document.querySelector("#offlineStatus").textContent = "Offline cache is active after the first visit.");
    },
    () => {
      document.querySelector("#offlineStatus") && (document.querySelector("#offlineStatus").textContent = "Offline cache needs a web server or GitHub Pages.");
    }
  );
} else {
  document.querySelector("#offlineStatus") && (document.querySelector("#offlineStatus").textContent = "This browser does not support service workers.");
}

async function startApp() {
  applyTheme();
  applyHandicapBasis();
  renderHoleEditor();
  document.querySelector("#todayLabel").textContent = todayLabel();
  await initializeAuth();
  route();
}

startApp().catch((error) => {
  setAuthStatus(error.message || "Could not start ParTrack.");
  setSyncStatus("Setup needed");
  setSignedInUi(false);
  route();
});
