/**
 * Smart Study Planner — Frontend Application Logic
 * =================================================
 * Handles:
 *  - Subject form (add / edit / delete)
 *  - API calls to Flask backend
 *  - Rendering study plan, revision plan, priority table, suggestions
 *  - Progress tracking (checkboxes)
 *  - Dynamic plan regeneration on edit
 *  - Tab switching, filtering, toast notifications
 */

"use strict";

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let subjects = [];           // Array of subject objects entered by user
let currentPlanData = null;  // Last response from backend
let allPlanRows = [];        // Combined study + revision rows for filter

// Colour palette for subject items (cycles)
const SUBJECT_COLOURS = [
  "#4285F4","#EA4335","#34A853","#FBBC05",
  "#9C27B0","#00BCD4","#FF5722","#607D8B"
];

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Set min exam date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = tomorrow.toISOString().split("T")[0];
  document.getElementById("examDate").min = iso;
  document.getElementById("examDate").value = "";

  // Sync slider label
  updateSliderBackground(document.getElementById("dailyHoursSlider"));
});

// ─────────────────────────────────────────────
//  SCROLL HELPERS
// ─────────────────────────────────────────────
function scrollToPlanner() {
  document.getElementById("plannerSection").scrollIntoView({ behavior: "smooth" });
}

// ─────────────────────────────────────────────
//  SLIDER SYNC
// ─────────────────────────────────────────────
function syncHoursInput(val) {
  document.getElementById("dailyHours").value = val;
  updateSliderBackground(document.getElementById("dailyHoursSlider"));
}

function syncHoursSlider(val) {
  document.getElementById("dailyHoursSlider").value = val;
  updateSliderBackground(document.getElementById("dailyHoursSlider"));
}

function updateSliderBackground(slider) {
  const min = parseFloat(slider.min) || 1;
  const max = parseFloat(slider.max) || 12;
  const val = parseFloat(slider.value) || 4;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty("--val", pct + "%");
  slider.style.background =
    `linear-gradient(to right, #4285F4 0%, #4285F4 ${pct}%, #DADCE0 ${pct}%)`;
}

// ─────────────────────────────────────────────
//  SAMPLE DATA LOADER
// ─────────────────────────────────────────────
function loadSampleData() {
  const today = new Date();
  const samples = [
    { name: "Physics",     daysAhead: 14, chapters: 12, difficulty: "hard",   is_weak: true,  is_strong: false },
    { name: "Mathematics", daysAhead: 21, chapters: 18, difficulty: "hard",   is_weak: false, is_strong: false },
    { name: "Chemistry",   daysAhead: 10, chapters: 8,  difficulty: "medium", is_weak: true,  is_strong: false },
    { name: "Biology",     daysAhead: 30, chapters: 14, difficulty: "medium", is_weak: false, is_strong: false },
    { name: "English",     daysAhead: 18, chapters: 6,  difficulty: "easy",   is_weak: false, is_strong: true  },
  ];

  subjects = samples.map((s, i) => {
    const examDate = new Date(today);
    examDate.setDate(today.getDate() + s.daysAhead);
    return {
      ...s,
      exam_date: examDate.toISOString().split("T")[0],
      colour: SUBJECT_COLOURS[i % SUBJECT_COLOURS.length],
    };
  });

  document.getElementById("dailyHours").value = 5;
  document.getElementById("dailyHoursSlider").value = 5;
  updateSliderBackground(document.getElementById("dailyHoursSlider"));

  renderSubjectsList();
  showToast("📚 Sample subjects loaded! Click Generate Smart Plan.");
  scrollToPlanner();
}

// ─────────────────────────────────────────────
//  ADD SUBJECT
// ─────────────────────────────────────────────
function addSubject() {
  const name       = document.getElementById("subjectName").value.trim();
  const exam_date  = document.getElementById("examDate").value;
  const chapters   = parseInt(document.getElementById("chapters").value);
  const difficulty = document.getElementById("difficulty").value;
  const is_weak    = document.getElementById("isWeak").checked;
  const is_strong  = document.getElementById("isStrong").checked;

  // Validation
  if (!name)       { showToast("⚠️ Please enter a subject name.", "warn"); return; }
  if (!exam_date)  { showToast("⚠️ Please select an exam date.", "warn"); return; }
  if (!chapters || chapters < 1) { showToast("⚠️ Enter a valid chapter count (≥1).", "warn"); return; }

  const today = new Date(); today.setHours(0,0,0,0);
  const exam  = new Date(exam_date);
  if (exam <= today) { showToast("⚠️ Exam date must be in the future.", "warn"); return; }

  // Duplicate check
  if (subjects.find(s => s.name.toLowerCase() === name.toLowerCase())) {
    showToast("⚠️ Subject already added. Edit it instead.", "warn");
    return;
  }

  subjects.push({
    name, exam_date, chapters, difficulty, is_weak, is_strong,
    colour: SUBJECT_COLOURS[subjects.length % SUBJECT_COLOURS.length],
  });

  renderSubjectsList();
  clearSubjectForm();
  showToast(`✅ "${name}" added!`);
}

// ─────────────────────────────────────────────
//  CLEAR FORM
// ─────────────────────────────────────────────
function clearSubjectForm() {
  document.getElementById("subjectName").value = "";
  document.getElementById("examDate").value    = "";
  document.getElementById("chapters").value    = "";
  document.getElementById("difficulty").value  = "medium";
  document.getElementById("isWeak").checked    = false;
  document.getElementById("isStrong").checked  = false;
}

// ─────────────────────────────────────────────
//  RENDER SUBJECTS LIST (sidebar)
// ─────────────────────────────────────────────
function renderSubjectsList() {
  const card = document.getElementById("subjectsListCard");
  const list = document.getElementById("subjectsList");
  const countBadge = document.getElementById("subjectCount");

  if (subjects.length === 0) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  countBadge.textContent = subjects.length;

  list.innerHTML = subjects.map((s, i) => {
    const examLabel = new Date(s.exam_date + "T00:00:00").toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric"});
    return `
      <div class="subject-item" id="subjectItem-${i}">
        <div class="subject-item__color" style="background:${s.colour}"></div>
        <div class="subject-item__info">
          <div class="subject-item__name">${escHtml(s.name)}</div>
          <div class="subject-item__meta">📅 ${examLabel} &nbsp;|&nbsp; 📖 ${s.chapters} ch</div>
          <div class="subject-item__tags" style="margin-top:4px">
            <span class="tag tag--${s.difficulty}">${s.difficulty}</span>
            ${s.is_weak   ? '<span class="tag tag--weak">Weak</span>'   : ""}
            ${s.is_strong ? '<span class="tag tag--strong">Strong</span>' : ""}
          </div>
        </div>
        <div class="subject-item__actions">
          <button class="btn btn--icon" onclick="openEditModal(${i})" title="Edit">
            <span class="material-icons-round" style="font-size:18px;color:#5F6368">edit</span>
          </button>
          <button class="btn btn--icon" onclick="removeSubject(${i})" title="Remove">
            <span class="material-icons-round" style="font-size:18px;color:#EA4335">delete_outline</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// ─────────────────────────────────────────────
//  REMOVE SUBJECT
// ─────────────────────────────────────────────
function removeSubject(i) {
  const name = subjects[i].name;
  subjects.splice(i, 1);
  renderSubjectsList();
  showToast(`🗑️ "${name}" removed.`);
  // If plan exists, reset it
  if (currentPlanData) {
    document.getElementById("resultsSection").style.display = "none";
    document.getElementById("emptyState").style.display = "flex";
    currentPlanData = null;
  }
}

// ─────────────────────────────────────────────
//  EDIT MODAL
// ─────────────────────────────────────────────
function openEditModal(i) {
  const s = subjects[i];
  document.getElementById("editIndex").value     = i;
  document.getElementById("editName").value      = s.name;
  document.getElementById("editExamDate").value  = s.exam_date;
  document.getElementById("editChapters").value  = s.chapters;
  document.getElementById("editDifficulty").value = s.difficulty;
  document.getElementById("editIsWeak").checked  = s.is_weak;
  document.getElementById("editIsStrong").checked = s.is_strong;

  // Set min date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById("editExamDate").min = tomorrow.toISOString().split("T")[0];

  document.getElementById("editModal").style.display = "flex";
}

function closeEditModal() {
  document.getElementById("editModal").style.display = "none";
}

function saveEdit() {
  const i = parseInt(document.getElementById("editIndex").value);
  const name      = document.getElementById("editName").value.trim();
  const exam_date = document.getElementById("editExamDate").value;
  const chapters  = parseInt(document.getElementById("editChapters").value);
  const difficulty = document.getElementById("editDifficulty").value;
  const is_weak   = document.getElementById("editIsWeak").checked;
  const is_strong = document.getElementById("editIsStrong").checked;

  if (!name || !exam_date || !chapters || chapters < 1) {
    showToast("⚠️ Please fill all fields correctly.", "warn");
    return;
  }

  subjects[i] = { ...subjects[i], name, exam_date, chapters, difficulty, is_weak, is_strong };
  closeEditModal();
  renderSubjectsList();
  showToast(`✏️ "${name}" updated. Regenerating plan…`);

  // Auto-recalculate if a plan existed
  if (currentPlanData) {
    setTimeout(generatePlan, 400);
  }
}

// Close modal on backdrop click
document.addEventListener("click", e => {
  if (e.target.id === "editModal") closeEditModal();
});

// ─────────────────────────────────────────────
//  GENERATE PLAN (main API call)
// ─────────────────────────────────────────────
async function generatePlan() {
  if (subjects.length === 0) {
    showToast("⚠️ Please add at least one subject.", "warn");
    return;
  }

  const daily_hours = parseFloat(document.getElementById("dailyHours").value) || 4;

  // Show loading
  document.getElementById("emptyState").style.display   = "none";
  document.getElementById("resultsSection").style.display = "none";
  document.getElementById("loadingState").style.display = "flex";

  try {
    const response = await fetch("/api/generate_plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjects, daily_hours }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Server error");
    }

    const data = await response.json();
    currentPlanData = data;

    document.getElementById("loadingState").style.display   = "none";
    document.getElementById("resultsSection").style.display = "block";

    renderAnalysisCards(data);
    renderStudyPlan(data.study_plan, data.revision_plan);
    renderRevisionPlan(data.revision_plan);
    renderPriorityTable(data.subjects);
    renderSuggestions(data.suggestions);

    // Switch to study plan tab
    const firstTab = document.querySelector(".tab-btn");
    if (firstTab) switchTabByName("studyPlan");

    scrollToPlanner();
    showToast("🎉 Your smart study plan is ready!");

  } catch (err) {
    document.getElementById("loadingState").style.display = "none";
    document.getElementById("emptyState").style.display   = "flex";
    showToast("❌ Error: " + err.message, "error");
    console.error(err);
  }
}

// ─────────────────────────────────────────────
//  RENDER: ANALYSIS CARDS
// ─────────────────────────────────────────────
function renderAnalysisCards(data) {
  const row = document.getElementById("analysisRow");
  const totalStudyDays = new Set(data.study_plan.map(r => r.date)).size;
  const totalStudyHours = data.study_plan.reduce((acc, r) => acc + r.hours, 0);

  const shortage = data.has_shortage
    ? `<span style="color:#EA4335">⚠️ Shortage detected</span>`
    : `<span style="color:#34A853">✅ Feasible</span>`;

  const cards = [
    {
      icon: "emoji_events",
      colour: "#4285F4",
      bg: "rgba(66,133,244,.1)",
      label: "Top Priority Subject",
      value: data.top_subject || "—",
      sub: `Score: ${data.subjects[0]?.priority ?? "—"}`,
    },
    {
      icon: "calendar_today",
      colour: "#34A853",
      bg: "rgba(52,168,83,.1)",
      label: "Study Days Planned",
      value: totalStudyDays,
      sub: `${data.subjects.length} subject(s)`,
    },
    {
      icon: "schedule",
      colour: "#FBBC05",
      bg: "rgba(251,188,5,.1)",
      label: "Total Study Hours",
      value: totalStudyHours.toFixed(1) + "h",
      sub: `${data.daily_hours}h/day avg`,
    },
    {
      icon: "health_and_safety",
      colour: data.has_shortage ? "#EA4335" : "#34A853",
      bg: data.has_shortage ? "rgba(234,67,53,.1)" : "rgba(52,168,83,.1)",
      label: "Feasibility",
      value: shortage,
      sub: data.has_shortage ? "See insights" : "Plan is achievable",
    },
  ];

  row.innerHTML = cards.map(c => `
    <div class="analysis-card">
      <div class="analysis-card__icon" style="background:${c.bg}">
        <span class="material-icons-round" style="color:${c.colour};font-size:22px">${c.icon}</span>
      </div>
      <div class="analysis-card__label">${c.label}</div>
      <div class="analysis-card__value">${c.value}</div>
      <div class="analysis-card__sub">${c.sub}</div>
    </div>
  `).join("");
}

// ─────────────────────────────────────────────
//  RENDER: STUDY PLAN TABLE
// ─────────────────────────────────────────────
function renderStudyPlan(studyRows, revisionRows) {
  allPlanRows = [...studyRows, ...revisionRows].sort((a, b) => a.date.localeCompare(b.date));
  renderFilteredTable(allPlanRows);
}

function renderFilteredTable(rows) {
  const tbody = document.getElementById("studyPlanBody");
  const maxHours = Math.max(...rows.map(r => r.hours), 1);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-hint);padding:32px">No entries to show.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, idx) => {
    const rowClass = r.is_weak ? "row--weak " : "";
    const typeClass = r.type === "Revision" ? "row--revision" : "row--study";
    const barPct = Math.round((r.hours / maxHours) * 100);
    const barColour = r.type === "Revision" ? "#9C27B0" : "#4285F4";
    const subj = currentPlanData?.subjects?.find(s => s.name === r.subject);
    const colour = subjects.find(s => s.name === r.subject)?.colour || "#4285F4";

    return `
      <tr class="${rowClass}${typeClass}" id="planRow-${idx}">
        <td>
          <div style="font-weight:500">${r.day_label}</div>
          <div style="font-size:11px;color:var(--text-hint)">${r.date}</div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:${colour};flex-shrink:0;display:inline-block"></span>
            <span style="font-weight:500">${escHtml(r.subject)}</span>
          </div>
          ${r.is_weak ? '<span class="tag tag--weak" style="margin-top:3px;display:inline-block">Weak</span>' : ""}
        </td>
        <td>
          <div class="hours-chip">
            <span class="material-icons-round" style="font-size:14px;color:${barColour}">schedule</span>
            ${r.hours}h
          </div>
          <div class="progress-mini" style="margin-top:6px;width:80px">
            <div class="progress-mini__fill" style="width:${barPct}%;background:${barColour}"></div>
          </div>
        </td>
        <td><span class="type-pill type-pill--${r.type.toLowerCase()}">${r.type}</span></td>
        <td>
          <input type="checkbox" class="check-done" id="done-${idx}"
            onchange="markDone(${idx}, '${escHtml(r.subject)}', this.checked)" />
        </td>
      </tr>
    `;
  }).join("");
}

// ─────────────────────────────────────────────
//  FILTER TABLE
// ─────────────────────────────────────────────
function filterTable(type) {
  if (!allPlanRows.length) return;
  const filtered = type === "All"
    ? allPlanRows
    : allPlanRows.filter(r => r.type === type);
  renderFilteredTable(filtered);
}

// ─────────────────────────────────────────────
//  MARK DONE (progress tracking)
// ─────────────────────────────────────────────
function markDone(idx, subject, done) {
  const row = document.getElementById(`planRow-${idx}`);
  if (!row) return;
  if (done) {
    row.style.opacity = "0.45";
    row.style.textDecoration = "line-through";
    showToast(`✅ Marked "${subject}" session as complete!`);
  } else {
    row.style.opacity = "1";
    row.style.textDecoration = "none";
  }
}

// ─────────────────────────────────────────────
//  RENDER: REVISION PLAN TABLE
// ─────────────────────────────────────────────
function renderRevisionPlan(rows) {
  const tbody = document.getElementById("revisionPlanBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-hint);padding:32px">No revision entries generated.</td></tr>`;
    return;
  }

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  tbody.innerHTML = sorted.map(r => {
    const focusLevel = r.is_weak ? "🔥 High" : (r.difficulty === "hard" ? "⚡ Intense" : "📖 Regular");
    const colour = subjects.find(s => s.name === r.subject)?.colour || "#9C27B0";
    return `
      <tr class="${r.is_weak ? 'row--weak' : ''} row--revision">
        <td>
          <div style="font-weight:500">${r.day_label}</div>
          <div style="font-size:11px;color:var(--text-hint)">${r.date}</div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;border-radius:50%;background:${colour};flex-shrink:0;display:inline-block"></span>
            <span style="font-weight:500">${escHtml(r.subject)}</span>
          </div>
        </td>
        <td>
          <div class="hours-chip">
            <span class="material-icons-round" style="font-size:14px;color:#9C27B0">replay</span>
            ${r.hours}h
          </div>
        </td>
        <td>${focusLevel}</td>
      </tr>
    `;
  }).join("");
}

// ─────────────────────────────────────────────
//  RENDER: PRIORITY TABLE
// ─────────────────────────────────────────────
function renderPriorityTable(enrichedSubjects) {
  const tbody = document.getElementById("priorityTableBody");
  const maxPriority = Math.max(...enrichedSubjects.map(s => s.priority), 1);

  tbody.innerHTML = enrichedSubjects.map((s, i) => {
    const colour = subjects.find(sub => sub.name === s.name)?.colour || "#4285F4";
    const barPct = Math.round((s.priority / maxPriority) * 100);
    const statusIcon = s.days_left <= 7
      ? '<span class="status-badge status-badge--warn"><span class="material-icons-round" style="font-size:14px">warning</span> Urgent</span>'
      : '<span class="status-badge status-badge--ok"><span class="material-icons-round" style="font-size:14px">check_circle</span> OK</span>';

    return `
      <tr>
        <td>
          <div style="width:28px;height:28px;border-radius:50%;background:${colour};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${i+1}</div>
        </td>
        <td>
          <div style="font-weight:500">${escHtml(s.name)}</div>
          ${s.is_weak ? '<span class="tag tag--weak">Weak</span>' : ""}
          ${s.is_strong ? '<span class="tag tag--strong">Strong</span>' : ""}
        </td>
        <td><span class="diff-dot diff-dot--${s.difficulty}">${s.difficulty}</span></td>
        <td>
          <span style="font-weight:600;color:${s.days_left <= 7 ? '#EA4335' : 'inherit'}">${s.days_left}</span>
          <span style="color:var(--text-hint)"> days</span>
        </td>
        <td>${s.required_hours}h</td>
        <td>
          <div class="priority-bar-wrap">
            <div class="priority-bar">
              <div class="priority-bar__fill" style="width:${barPct}%;background:${colour}"></div>
            </div>
            <span style="font-weight:700;min-width:40px;text-align:right">${s.priority}</span>
          </div>
        </td>
        <td>${statusIcon}</td>
      </tr>
    `;
  }).join("");
}

// ─────────────────────────────────────────────
//  RENDER: SUGGESTIONS / INSIGHTS
// ─────────────────────────────────────────────
function renderSuggestions(suggestions) {
  const body = document.getElementById("suggestionsBody");
  const badge = document.getElementById("insightsBadge");

  badge.textContent = suggestions.length;

  if (!suggestions.length) {
    body.innerHTML = `
      <div class="insight-card success">
        <span class="insight-card__icon material-icons-round" style="color:#34A853">thumb_up</span>
        <div class="insight-card__text">Everything looks great! Your plan is well-balanced and feasible.</div>
      </div>
    `;
    return;
  }

  body.innerHTML = suggestions.map(s => {
    // Classify card type based on emoji / keyword
    let type = "";
    if (s.includes("⚠️") || s.includes("shortfall") || s.includes("shortage")) type = "warn";
    else if (s.includes("🔥") || s.includes("immediately")) type = "error";
    else if (s.includes("✅") || s.includes("Strong")) type = "success";

    return `
      <div class="insight-card ${type}">
        <div class="insight-card__text">${s}</div>
      </div>
    `;
  }).join("");
}

// ─────────────────────────────────────────────
//  TAB SWITCHING
// ─────────────────────────────────────────────
function switchTab(btn, tabName) {
  // Deactivate all tabs
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("tab-btn--active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.style.display = "none");

  // Activate chosen tab
  btn.classList.add("tab-btn--active");
  const panel = document.getElementById("tab-" + tabName);
  if (panel) panel.style.display = "block";
}

function switchTabByName(tabName) {
  const btn = document.querySelector(`[data-tab="${tabName}"]`);
  if (btn) switchTab(btn, tabName);
}

// ─────────────────────────────────────────────
//  TOAST NOTIFICATION
// ─────────────────────────────────────────────
let toastTimeout;
function showToast(msg, type = "default") {
  const toast = document.getElementById("toast");
  toast.innerHTML = msg;
  toast.className = "toast toast--show";

  if (type === "warn")  toast.style.background = "#FBBC05";
  else if (type === "error") toast.style.background = "#EA4335";
  else toast.style.background = "#202124";

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("toast--show");
  }, 3000);
}

// ─────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
