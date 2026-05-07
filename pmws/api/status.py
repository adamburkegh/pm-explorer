import pm4py
from flask import Blueprint, jsonify
from pmws import __version__

status_bp = Blueprint("status", __name__)


@status_bp.get("/api/status")
def status():
    return jsonify({"status": "ok", "version": __version__, "pm4py": pm4py.__version__})
