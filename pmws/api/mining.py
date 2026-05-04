from flask import Blueprint, jsonify, request
import pm4py
from pmws.xes import load_xes
from pmws.pnconvert import to_json

mining_bp = Blueprint("mining", __name__)


def _noise_threshold():
    try:
        return float(request.form.get("noiseThreshold", 0.0))
    except ValueError:
        return 0.0


@mining_bp.post("/api/mine/dfg")
def dfg():
    if "xes_file" not in request.files:
        return jsonify({"error": "xes_file required"}), 400

    log = load_xes(request.files["xes_file"])
    dfg_map, start_activities, end_activities = pm4py.discover_dfg(log)
    activity_counts = pm4py.get_event_attribute_values(log, "concept:name")

    return jsonify({
        "activities": [
            {"id": name, "label": name, "frequency": count}
            for name, count in activity_counts.items()
        ],
        "edges": [
            {"source": src, "target": tgt, "frequency": freq}
            for (src, tgt), freq in dfg_map.items()
        ],
        "startActivities": start_activities,
        "endActivities": end_activities,
    })


@mining_bp.post("/api/mine/inductive")
def inductive():
    if "xes_file" not in request.files:
        return jsonify({"error": "xes_file required"}), 400

    log = load_xes(request.files["xes_file"])
    net, im, fm = pm4py.discover_petri_net_inductive(log, noise_threshold=_noise_threshold())
    return jsonify(to_json(net, im, fm))


@mining_bp.post("/api/mine/inductive/bpmn")
def inductive_bpmn():
    if "xes_file" not in request.files:
        return jsonify({"error": "xes_file required"}), 400

    log = load_xes(request.files["xes_file"])
    bpmn = pm4py.discover_bpmn_inductive(log, noise_threshold=_noise_threshold())

    nodes = [
        {"id": n.get_id(), "type": type(n).__name__, "label": n.get_name() or ""}
        for n in bpmn.get_nodes()
    ]
    flows = [
        {"id": f.get_id(), "source": f.get_source().get_id(), "target": f.get_target().get_id()}
        for f in bpmn.get_flows()
    ]
    return jsonify({"nodes": nodes, "flows": flows})


@mining_bp.post("/api/mine/inductive/tree")
def inductive_tree():
    if "xes_file" not in request.files:
        return jsonify({"error": "xes_file required"}), 400

    log = load_xes(request.files["xes_file"])
    tree = pm4py.discover_process_tree_inductive(log, noise_threshold=_noise_threshold())
    return jsonify(_serialize_tree(tree))


def _serialize_tree(node):
    return {
        "operator": node.operator.name if node.operator else None,
        "label": node.label,
        "children": [_serialize_tree(c) for c in node.children],
    }
