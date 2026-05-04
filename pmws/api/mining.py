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
    """Return an inductive-miner BPMN model as BPMN 2.0 XML wrapped in a JSON envelope.

    The response is { "bpmn": "<xml string>" } rather than a native JSON model.
    This is a deliberate design choice:

    BPMN 2.0 XML is the OMG-standardised interchange format for BPMN, and it is
    what bpmn-js (the rendering library used in the frontend) consumes directly.
    Neither Camunda nor bpmn-js defines or supports a JSON equivalent for BPMN
    process models — bpmn-js's internal object model (bpmn-moddle) only
    round-trips to/from XML, not JSON.

    A custom JSON-to-BPMN mapping would require non-trivial translation work
    (split/join gateway pairs, loop structures, BPMN DI layout) and produce a
    non-standard format that bpmn-js still could not consume. The XML is therefore
    treated as an opaque payload: pm4py produces it, the JSON envelope carries it
    over HTTP, and bpmn-js consumes it — no translation layer needed.

    The JS inductive miner in the frontend could in principle produce BPMN from
    its process tree output, but the process-tree → BPMN conversion (particularly
    loop and gateway handling) is non-trivial and pm4py's implementation is
    well-tested against edge cases, so server-side generation is preferred.
    """
    if "xes_file" not in request.files:
        return jsonify({"error": "xes_file required"}), 400

    from pm4py.objects.bpmn.exporter.variants.etree import get_xml_string
    from pmws.bpmn_layout import apply as layout_bpmn, mark_xor_gateways
    log = load_xes(request.files["xes_file"])
    bpmn = pm4py.discover_bpmn_inductive(log, noise_threshold=_noise_threshold())
    layout_bpmn(bpmn)
    xml = mark_xor_gateways(get_xml_string(bpmn).decode("utf-8"))
    nodes = list(bpmn.get_nodes())
    flows = list(bpmn.get_flows())
    return jsonify({
        "bpmn": xml,
        "simplicity": {
            "nodes": len(nodes),
            "constructs": len(nodes) + len(flows),
        },
    })


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
