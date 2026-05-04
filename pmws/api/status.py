from flask import Blueprint, jsonify
import pm4py

status_bp = Blueprint("status", __name__)


@status_bp.get("/api/status")
def status():
    return jsonify({"status": "ok", "pm4py": pm4py.__version__})
