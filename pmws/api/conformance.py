import json
import pm4py
from flask import Blueprint, jsonify, request
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


@conformance_bp.post("/api/conformance/dfg")
def dfg_conformance():
    """Token-replay conformance against a Petri net derived from the log's DFG.

    Discovers the DFG from the log, converts it to a Petri net via pm4py's DFG
    converter, then runs token-based replay for both fitness and precision.
    Returns both metrics in a single response — no separate Petri net needed.
    """
    if "xes_file" not in request.files:
        return jsonify({"error": "xes_file required"}), 400

    try:
        log = load_xes(request.files["xes_file"])
        dfg_map, start_activities, end_activities = pm4py.discover_dfg(log)
        net, im, fm = pm4py.convert_to_petri_net(dfg_map, start_activities, end_activities)

        fitness_result   = pm4py.fitness_token_based_replay(log, net, im, fm)
        precision_result = pm4py.precision_token_based_replay(log, net, im, fm)

        return jsonify({
            "logFitness":              fitness_result["log_fitness"],
            "percentageFittingTraces": fitness_result["percentage_of_fitting_traces"] / 100.0,
            "precision":               precision_result,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
