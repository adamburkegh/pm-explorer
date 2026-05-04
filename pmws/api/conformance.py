import json
from flask import Blueprint, jsonify, request
import pm4py
from pmws.xes import load_xes
from pmws.pnconvert import from_json

conformance_bp = Blueprint("conformance", __name__)


def _load_inputs():
    """Return (log, net, im, fm) from a multipart request, or raise ValueError."""
    if "xes_file" not in request.files:
        raise ValueError("xes_file required")
    if "net" not in request.form:
        raise ValueError("net (JSON) required")
    log = load_xes(request.files["xes_file"])
    net, im, fm = from_json(json.loads(request.form["net"]))
    return log, net, im, fm


@conformance_bp.post("/api/conformance/fitness")
def fitness():
    try:
        log, net, im, fm = _load_inputs()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    result = pm4py.fitness_token_based_replay(log, net, im, fm)
    return jsonify({
        "logFitness": result["log_fitness"],
        "percentageFittingTraces": result["percentage_of_fitting_traces"] / 100.0,
    })


@conformance_bp.post("/api/conformance/precision")
def precision():
    try:
        log, net, im, fm = _load_inputs()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    result = pm4py.precision_token_based_replay(log, net, im, fm)
    return jsonify({"precision": result})
