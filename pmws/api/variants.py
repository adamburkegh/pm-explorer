from flask import Blueprint, jsonify, request
import pm4py
from pmws.xes import load_xes

variants_bp = Blueprint("variants", __name__)


@variants_bp.post("/api/variants")
def variants():
    if "xes_file" not in request.files:
        return jsonify({"error": "xes_file required"}), 400

    log = load_xes(request.files["xes_file"])
    raw = pm4py.get_variants(log)

    result = sorted(
        [{"trace": list(variant), "frequency": len(cases)} for variant, cases in raw.items()],
        key=lambda v: v["frequency"],
        reverse=True,
    )
    for rank, v in enumerate(result, 1):
        v["rank"] = rank

    return jsonify({"variants": result})
