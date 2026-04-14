"""
planner.py — Core Study Planner Logic
========================================
All calculation, scheduling, and insight functions live here.
app.py only handles HTTP routing and calls these functions.
"""

from datetime import date, timedelta, datetime
import math
from collections import defaultdict #used to give default value to key in dictioanry when key is not present in dictioanry and being used

'''
defaultdict(function)

1. d = defaultdict(int)   # int() → 0
    print(d['a'])  # 0
2. d = defaultdict(list)  # list() → []
    print(d['a'])  # []
3. d = defaultdict(set)  # set() → set()
    print(d['a'])  # set()
'''

# ──────────────────────────────────────────────
#  CONSTANTS
# ──────────────────────────────────────────────

DIFFICULTY_MAP       = {"easy": 1, "medium": 2, "hard": 3}
HOURS_PER_CHAPTER    = {"easy": 1.5, "medium": 2.5, "hard": 4.0} 
#on the basis of this we come to know how many days will be required 
MAX_HOURS_PER_SUBJ   = 4.0   # max hours allocated to one subject per day
REVISION_BUFFER_DAYS = 2     # days reserved before each exam for revision


# ──────────────────────────────────────────────
#  SMALL HELPERS
# ──────────────────────────────────────────────

def days_until(exam_date_str):
    """Days from today to exam. Minimum 1 to avoid zero-division."""
    exam = datetime.strptime(exam_date_str, "%Y-%m-%d").date()
    return max((exam - date.today()).days, 1)


def calc_priority(difficulty, days_left, is_weak):
    """
    Priority = (difficulty × 2) + (10 / days_left)
    Weak subjects get a +3 bonus on top.
    """
    score = (DIFFICULTY_MAP.get(difficulty, 1) * 2) + (10 / days_left)
    if is_weak:
        score += 3.0
    return round(score, 4)


def calc_required_hours(chapters, difficulty):
    """Total hours = chapters × hours-per-chapter for that difficulty level."""
    return round(chapters * HOURS_PER_CHAPTER.get(difficulty, 2.0), 1)


def chapter_label(start_units, end_units, total_chapters):
    """
    Converts fractional progress into a readable chapter range.
    E.g. 0.0 → 2.5 out of 4  →  'Chapters 1-3 (partial)'
    """
    if total_chapters <= 0:
        return "N/A"

    start_units = max(0.0, start_units)
    end_units   = min(float(total_chapters), max(start_units, end_units))

    start_ch = min(total_chapters, int(math.floor(start_units)) + 1)
    end_ch   = min(total_chapters, max(1, int(math.ceil(end_units))))

    label = f"Chapter {start_ch}" if start_ch == end_ch else f"Chapters {start_ch}-{end_ch}"

    notes = []
    if not math.isclose(start_units % 1, 0.0, abs_tol=1e-6):
        notes.append("continues")
    if not math.isclose(end_units % 1, 0.0, abs_tol=1e-6):
        notes.append("partial")
    if notes:
        label += f" ({', '.join(notes)})"

    return label


def get_nearest_upcoming_subject(subjects, current_date):
    """Returns the subject whose exam is soonest after current_date (priority as tiebreaker)."""
    upcoming = [s for s in subjects
                if datetime.strptime(s["exam_date"], "%Y-%m-%d").date() > current_date]
    if not upcoming:
        return None
    upcoming.sort(key=lambda s: (
        (datetime.strptime(s["exam_date"], "%Y-%m-%d").date() - current_date).days,
        -s["priority"],
    ))
    return upcoming[0]


def make_study_row(date_str, day_label, subj, hours, ch_range):
    """Builds a standard study-plan row dict."""
    return {
        "date":          date_str,
        "day_label":     day_label,
        "subject":       subj["name"],
        "hours":         hours,
        "chapter_range": ch_range,
        "type":          "Study",
        "difficulty":    subj["difficulty"],
        "is_weak":       subj["is_weak"],
    }


# ──────────────────────────────────────────────
#  FEASIBILITY CHECK
# ──────────────────────────────────────────────

def check_feasibility(subjects, daily_hours):
    """
    For each subject: checks if (days_left × daily_hours) >= required_hours.
    Returns (warnings list, suggestion strings list).
    """
    warnings, suggestions = [], []

    for s in subjects:
        available = s["days_left"] * daily_hours
        if available < s["required_hours"]:
            shortage      = round(s["required_hours"] - available, 1)
            extra_per_day = round(shortage / s["days_left"], 1)
            warnings.append({
                "subject":            s["name"],
                "shortage_hours":     shortage,
                "extra_daily_needed": extra_per_day,
            })
            suggestions.append(
                f"You need <b>+{extra_per_day}h/day</b> more to complete "
                f"<b>{s['name']}</b> on time ({shortage}h shortfall)."
            )

    return warnings, suggestions


# ──────────────────────────────────────────────
#  TIMETABLE GENERATOR
# ──────────────────────────────────────────────

def generate_timetable(subjects, daily_hours):
    """
    Builds a full study + revision schedule in four phases:

    Phase 1 — Study:    Allocates hours day-by-day, highest priority first.
    Phase 2 — Revision: Reserves REVISION_BUFFER_DAYS before each exam.
    Phase 3 — Fill:     Tops up any day that is under daily_hours.
    Phase 4 — Normalise: Corrects tiny rounding mismatches.

    Returns (study_plan, revision_plan) — lists of schedule row dicts.
    """
    if not subjects:
        return [], []

    today = date.today()

    # Working copies with mutable progress tracking
    work = [{**s, "remaining": s["required_hours"], "units_done": 0.0} for s in subjects]

    last_exam  = max(datetime.strptime(s["exam_date"], "%Y-%m-%d").date() for s in subjects)
    total_days = max((last_exam - today).days, 0)

    study_plan  = []
    daily_usage = {}   # date_str → total hours used that day

    # ── Phase 1: Daily Study Allocation ──────────────────────────────────────
    for offset in range(total_days):
        current_date = today + timedelta(days=offset)
        date_str     = current_date.strftime("%Y-%m-%d")
        day_label    = current_date.strftime("%a, %d %b %Y")

        # Only include subjects whose exam is more than 0 days away
        eligible = [
            s for s in work
            if (datetime.strptime(s["exam_date"], "%Y-%m-%d").date() - current_date).days
               > 0
            and s["remaining"] > 0
        ]
        if not eligible:
            continue

        # Subjects with exam tomorrow jump to the front of the queue
        tomorrow = [s for s in eligible
                    if (datetime.strptime(s["exam_date"], "%Y-%m-%d").date() - current_date).days == 1]
        rest     = [s for s in eligible if s not in tomorrow]
        order    = (sorted(tomorrow, key=lambda x: x["priority"], reverse=True) +
                    sorted(rest,    key=lambda x: x["priority"], reverse=True))

        hours_pool = daily_hours

        for subj in order:
            if hours_pool <= 0 or subj["remaining"] <= 0:
                continue

            cap   = max(MAX_HOURS_PER_SUBJ, daily_hours)
            allot = round(min(subj["remaining"], cap, hours_pool), 1)
            if allot <= 0:
                continue

            rate         = HOURS_PER_CHAPTER.get(subj["difficulty"], 2.0)
            units_before = subj["units_done"]
            units_after  = min(float(subj["chapters"]),
                               units_before + (allot / rate if rate > 0 else 0.0))

            study_plan.append(make_study_row(
                date_str, day_label, subj, allot,
                chapter_label(units_before, units_after, int(subj["chapters"]))
            ))

            subj["remaining"]        = round(subj["remaining"] - allot, 1)
            subj["units_done"]       = units_after
            daily_usage[date_str]    = round(daily_usage.get(date_str, 0.0) + allot, 1)
            hours_pool               = round(hours_pool - allot, 1)

    # ── Phase 2: Revision Scheduling ─────────────────────────────────────────

    def revision_weight(s):
        return DIFFICULTY_MAP.get(s["difficulty"], 1) + (1 if s["is_weak"] else 0)

    revision_plan     = []
    remaining_by_name = {s["name"]: s["remaining"] for s in work}
    total_weight      = sum(revision_weight(s) for s in subjects)

    for subj in sorted(subjects, key=revision_weight, reverse=True):
        weight    = revision_weight(subj)
        rev_hours = max(round((weight / total_weight) * daily_hours * REVISION_BUFFER_DAYS, 1), 1.0)
        exam_date = datetime.strptime(subj["exam_date"], "%Y-%m-%d").date()

        for day_back in range(REVISION_BUFFER_DAYS, 0, -1):
            rev_date = exam_date - timedelta(days=day_back)
            if rev_date < today:
                continue

            date_str        = rev_date.strftime("%Y-%m-%d")
            available_today = round(max(daily_hours - daily_usage.get(date_str, 0.0), 0.0), 1)
            if available_today <= 0:
                continue

            daily_rev = round(min(rev_hours / REVISION_BUFFER_DAYS, available_today), 1)
            if daily_rev <= 0:
                continue

            pending = remaining_by_name.get(subj["name"], 0.0)
            ch_note = (
                f"Targeted revision: important topics + pending chapters (~{round(pending, 1)}h remaining)"
                if pending > 0
                else f"Revision: Chapters 1-{int(subj['chapters'])}"
            )

            revision_plan.append({
                "date":          date_str,
                "day_label":     rev_date.strftime("%a, %d %b %Y"),
                "subject":       subj["name"],
                "hours":         daily_rev,
                "chapter_range": ch_note,
                "type":          "Revision",
                "difficulty":    subj["difficulty"],
                "is_weak":       subj["is_weak"],
            })
            daily_usage[date_str] = round(daily_usage.get(date_str, 0.0) + daily_rev, 1)

    # ── Phase 3: Fill Gaps ───────────────────────────────────────────────────
    for offset in range(total_days):
        current_date = today + timedelta(days=offset)
        date_str     = current_date.strftime("%Y-%m-%d")
        day_label    = current_date.strftime("%a, %d %b %Y")
        deficit      = round(daily_hours - daily_usage.get(date_str, 0.0), 1)

        if deficit <= 0:
            continue

        focus = get_nearest_upcoming_subject(subjects, current_date)
        if focus is None:
            focus = {"name": "General Study", "difficulty": "medium",
                     "is_weak": False, "priority": 0}

        merged = False
        for row in study_plan:
            if row["date"] == date_str and row["subject"] == focus["name"] and row["type"] == "Study":
                row["hours"] = round(float(row["hours"]) + deficit, 1)
                merged = True
                break

        if not merged:
            study_plan.append(make_study_row(
                date_str, day_label, focus, deficit, "Practice / revision buffer"
            ))
        daily_usage[date_str] = round(daily_usage.get(date_str, 0.0) + deficit, 1)

    # ── Phase 4: Exact Normalisation (rounding fix) ──────────────────────────
    rows_by_date = defaultdict(list)
    for row in study_plan:
        rows_by_date[row["date"]].append(("study", row))
    for row in revision_plan:
        rows_by_date[row["date"]].append(("revision", row))

    for offset in range(total_days):
        current_date = today + timedelta(days=offset)
        date_str     = current_date.strftime("%Y-%m-%d")
        day_label    = current_date.strftime("%a, %d %b %Y")
        day_rows     = rows_by_date.get(date_str, [])

        current_total = round(sum(float(r["hours"]) for _, r in day_rows), 1)
        delta         = round(daily_hours - current_total, 1)

        if math.isclose(delta, 0.0, abs_tol=1e-9):
            continue

        if delta > 0:
            focus = get_nearest_upcoming_subject(subjects, current_date)
            if focus is None:
                focus = {"name": "General Study", "difficulty": "medium",
                         "is_weak": False, "priority": 0}

            merged = False
            for _, row in rows_by_date.get(date_str, []):
                if row.get("type") == "Study" and row.get("subject") == focus["name"]:
                    row["hours"] = round(float(row["hours"]) + delta, 1)
                    merged = True
                    break
            if not merged:
                filler = make_study_row(date_str, day_label, focus, delta, "Practice / revision buffer")
                study_plan.append(filler)
                rows_by_date[date_str].append(("study", filler))
        else:
            # Trim — reduce rows (study first, then revision) until balanced
            overflow   = abs(delta)
            adjustable = sorted(day_rows, key=lambda x: 0 if x[0] == "study" else 1)
            for _, row in adjustable:
                if overflow <= 0:
                    break
                cut          = min(float(row["hours"]), overflow)
                row["hours"] = round(float(row["hours"]) - cut, 1)
                overflow     = round(overflow - cut, 1)

            study_plan[:]    = [r for r in study_plan    if float(r["hours"]) > 0]
            revision_plan[:] = [r for r in revision_plan if float(r["hours"]) > 0]

    study_plan.sort(key=lambda x: x["date"])
    revision_plan.sort(key=lambda x: x["date"])
    return study_plan, revision_plan


# ──────────────────────────────────────────────
#  INSIGHTS & SUGGESTIONS
# ──────────────────────────────────────────────

def generate_insights(subjects, daily_hours, warnings):
    """Produces actionable insight strings for the suggestions panel."""
    if not subjects:
        return []

    insights = []
    top = subjects[0]  # already sorted by priority desc

    insights.append(
        f"PRIORITY|<b>Focus most on {top['name']}</b> — it has the highest urgency "
        f"score ({top['priority']}) right now."
    )

    for s in subjects:
        if s["difficulty"] == "hard" and s["days_left"] <= 7:
            insights.append(
                f"RISK|<b>{s['name']}</b>: <b>Hard</b> | "
                f"<b>{s['days_left']} days left</b> | Start immediately"
            )

    if daily_hours < 3:
        insights.append(
            "TIP|You're studying fewer than 3h/day. "
            "Consider increasing to at least <b>4–5 hours</b> for better coverage."
        )

    weak   = [s for s in subjects if s["is_weak"]]
    strong = [s for s in subjects if s["is_strong"]]

    if weak:
        names = ", ".join(f"<b>{s['name']}</b>" for s in weak)
        insights.append(f"TIP|Weak subjects ({names}) have been given extra priority and revision time.")

    if strong:
        names = ", ".join(f"<b>{s['name']}</b>" for s in strong)
        insights.append(f"TIP|Strong subjects ({names}) — less time allocated, but don't skip revision!")

    return insights


def generate_completion_suggestions(subjects, daily_hours, study_plan, revision_plan):
    """Per-subject guidance when syllabus is incomplete or revision couldn't be scheduled."""
    study_hrs    = defaultdict(float)
    revision_hrs = defaultdict(float)

    for row in study_plan:
        study_hrs[row["subject"]] += float(row.get("hours", 0.0))
    for row in revision_plan:
        revision_hrs[row["subject"]] += float(row.get("hours", 0.0))

    suggestions = []
    for s in subjects:
        name      = s["name"]
        required  = float(s["required_hours"])
        studied   = round(study_hrs.get(name, 0.0), 1)
        revised   = round(revision_hrs.get(name, 0.0), 1)
        remaining = round(max(required - studied, 0.0), 1)

        study_days_left = max(int(s["days_left"]) - REVISION_BUFFER_DAYS, 1)

        if remaining > 0:
            extra_needed  = round(remaining / study_days_left, 1)
            complete_rate = round(min(daily_hours + extra_needed, 12.0), 1)
            with_revision = round(min(complete_rate + 1.0, 12.0), 1)
            suggestions.append(
                f"ACTION|<b>{name}</b>: pending <b>{remaining}h</b> | "
                f"Complete: <b>{complete_rate}h/day</b> | "
                f"Complete + Revision: <b>{with_revision}h/day</b>"
            )
        elif revised <= 0:
            recommended = round(min(daily_hours + 1.0, 12.0), 1)
            suggestions.append(
                f"ACTION|<b>{name}</b>: no revision slot | "
                f"Revision possible at <b>{recommended}h/day</b>"
            )

    return suggestions


# ──────────────────────────────────────────────
#  SUBJECT ENRICHMENT
# ──────────────────────────────────────────────

def enrich_subjects(raw_subjects):
    """
    Takes raw subject dicts from the frontend, computes derived fields,
    and returns them sorted by priority (highest first).
    """
    enriched = []
    for s in raw_subjects:
        dl = days_until(s["exam_date"])
        enriched.append({
            "name":           s["name"],
            "exam_date":      s["exam_date"],
            "chapters":       int(s["chapters"]),
            "difficulty":     s["difficulty"],
            "is_weak":        bool(s.get("is_weak", False)),
            "is_strong":      bool(s.get("is_strong", False)),
            "days_left":      dl,
            "priority":       calc_priority(s["difficulty"], dl, s.get("is_weak", False)),
            "required_hours": calc_required_hours(int(s["chapters"]), s["difficulty"]),
        })

    enriched.sort(key=lambda x: x["priority"], reverse=True)
    return enriched


# ──────────────────────────────────────────────
#  TOP-LEVEL PLAN BUILDER
# ──────────────────────────────────────────────

def build_plan(raw_subjects, daily_hours):
    """
    Main entry point called by the Flask route.
    Runs the full pipeline and returns a complete plan dict.
    """
    subjects = enrich_subjects(raw_subjects)

    warnings, feasibility_suggestions = check_feasibility(subjects, daily_hours)
    study_plan, revision_plan         = generate_timetable(subjects, daily_hours)
    insights                          = generate_insights(subjects, daily_hours, warnings)
    completion_suggestions            = generate_completion_suggestions(
                                            subjects, daily_hours, study_plan, revision_plan)

    study_plan.sort(key=lambda x: x["date"])
    revision_plan.sort(key=lambda x: x["date"])

    return {
        "subjects":              subjects,
        "study_plan":            study_plan,
        "revision_plan":         revision_plan,
        "warnings":              warnings,
        "suggestions":           insights + completion_suggestions,
        "top_subject":           subjects[0]["name"] if subjects else None,
        "has_shortage":          len(warnings) > 0,
        "daily_hours":           daily_hours,
        "total_required_hours":  sum(s["required_hours"] for s in subjects),
        "total_available_hours": sum(s["days_left"] * daily_hours for s in subjects),
    }
