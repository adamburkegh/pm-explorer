import pm4py
from flask import Blueprint, jsonify

status_bp = Blueprint("status", __name__)


@status_bp.get("/api/status")
def status():
    return jsonify({"status": "ok", "pm4py": pm4py.__version__})
