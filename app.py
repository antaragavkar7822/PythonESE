"""
app.py — Flask Entry Point
===========================
Handles HTTP routing only.
All planning logic lives in planner.py.

Project layout:
  app.py          ← this file (routes)
  planner.py      ← all scheduling / calculation logic
  templates/
    index.html    ← frontend SPA
  static/
    style.css     ← styles (optional, currently inlined in HTML)
    app.js        ← JS (optional, currently inlined in HTML)
"""

from flask import Flask, render_template, request, jsonify
from planner import build_plan

app = Flask(__name__)
app.secret_key = "smart_study_planner_secret_2024"


@app.route("/")
def index():
    """Serve the single-page app shell."""
    return render_template("index.html")


@app.route("/api/generate_plan", methods=["POST"])
def generate_plan():
    """
    POST  { subjects: [...], daily_hours: float }
    Returns a full JSON study + revision schedule.
    """
    data         = request.get_json(force=True)
    raw_subjects = data.get("subjects", [])
    daily_hours  = float(data.get("daily_hours", 4))

    if not raw_subjects:
        return jsonify({"error": "Please add at least one subject."}), 400

    plan = build_plan(raw_subjects, daily_hours)
    return jsonify(plan)


@app.route("/api/update_plan", methods=["POST"])
def update_plan():
    """Alias for generate_plan — called on dynamic adjustments."""
    return generate_plan()


if __name__ == "__main__":
    app.run(debug=True, port=5000)
