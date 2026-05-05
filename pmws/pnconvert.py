"""
Conversion between pm4py Petri net objects and the project's JSON schema
(schema/petrinet.schema.json).
"""
import uuid
from pm4py.objects.petri_net.obj import PetriNet, Marking
from pm4py.objects.petri_net.utils import petri_utils


def to_json(net, initial_marking, final_marking):
    """Convert a pm4py (net, im, fm) triple to the project JSON schema dict."""
    im_tokens = {p.name: count for p, count in initial_marking.items()}
    fm_tokens = {p.name: count for p, count in final_marking.items()}

    places = [
        {
            "id": p.name,
            "label": p.name,
            "tokens": im_tokens.get(p.name, 0),
            "finalMarking": fm_tokens.get(p.name) if p.name in fm_tokens else None,
        }
        for p in net.places
    ]

    transitions = [
        {
            "id": t.name,
            "label": t.label or "",
            "silent": t.label is None,
        }
        for t in net.transitions
    ]

    arcs = [
        {
            "id": f"arc_{i}",
            "source": a.source.name,
            "target": a.target.name,
            "weight": getattr(a, "weight", 1),
        }
        for i, a in enumerate(net.arcs)
    ]

    return {
        "schemaVersion": "1.0",
        "id": str(uuid.uuid4()),
        "name": net.name or "Discovered Net",
        "netType": "ptnet",
        "places": places,
        "transitions": transitions,
        "arcs": arcs,
    }


def from_json(data):
    """Convert a project JSON schema dict to a pm4py (net, im, fm) triple."""
    net = PetriNet(data.get("name", "net"))
    im = Marking()
    fm = Marking()

    place_map = {}
    for p_data in data.get("places", []):
        place = PetriNet.Place(p_data["id"])
        net.places.add(place)
        place_map[p_data["id"]] = place
        tokens = p_data.get("tokens", 0)
        if tokens:
            im[place] = tokens
        final = p_data.get("finalMarking")
        if final:
            fm[place] = final

    trans_map = {}
    for t_data in data.get("transitions", []):
        silent = t_data.get("silent", False)
        raw_label = t_data.get("label", "")
        label = None if (silent or not raw_label) else raw_label
        trans = PetriNet.Transition(t_data["id"], label)
        net.transitions.add(trans)
        trans_map[t_data["id"]] = trans

    node_map = {**place_map, **trans_map}
    for a_data in data.get("arcs", []):
        source = node_map.get(a_data["source"])
        target = node_map.get(a_data["target"])
        if source and target:
            petri_utils.add_arc_from_to(source, target, net, weight=a_data.get("weight", 1))

    return net, im, fm
