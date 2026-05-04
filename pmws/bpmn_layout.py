"""
Pure-Python left-to-right BPMN layout.  No graphviz required.

Assigns node bounds and flow waypoints using a longest-path rank
assignment from start events.  Forward edges connect right-to-left;
backward edges (loops) route below all ranks.
"""
from collections import defaultdict, deque

from pm4py.objects.bpmn.obj import BPMN

EVENT_W = EVENT_H = 36
GATEWAY_W = GATEWAY_H = 50
TASK_W, TASK_H = 100, 80
H_GAP = 80
V_GAP = 60


def _size(node):
    if isinstance(node, BPMN.Event):
        return EVENT_W, EVENT_H
    if isinstance(node, BPMN.Gateway):
        return GATEWAY_W, GATEWAY_H
    return TASK_W, TASK_H


def apply(bpmn_graph):
    nodes = list(bpmn_graph.get_nodes())
    flows = list(bpmn_graph.get_flows())
    if not nodes:
        return bpmn_graph

    succs = defaultdict(list)
    preds = defaultdict(list)
    for f in flows:
        succs[f.get_source()].append(f.get_target())
        preds[f.get_target()].append(f.get_source())

    starts = [n for n in nodes if isinstance(n, BPMN.StartEvent)]
    if not starts:
        starts = [n for n in nodes if not preds[n]] or [nodes[0]]

    # BFS rank assignment — first-visit wins; handles cycles without looping
    rank = {}
    queue = deque((s, 0) for s in starts)
    while queue:
        node, r = queue.popleft()
        if node in rank:
            continue
        rank[node] = r
        for succ in succs[node]:
            if succ not in rank:
                queue.append((succ, r + 1))
    for n in nodes:
        if n not in rank:
            rank[n] = 0

    by_rank = defaultdict(list)
    for n, r in rank.items():
        by_rank[r].append(n)

    # Sort within each rank: start events first, end events last
    for r in by_rank:
        by_rank[r].sort(key=lambda n: (
            0 if isinstance(n, BPMN.StartEvent) else
            2 if isinstance(n, BPMN.EndEvent) else 1
        ))

    # X centre per rank column, sized to widest node in that rank
    x = 50
    rank_cx = {}
    for r in range(max(by_rank) + 1):
        col_w = max((_size(n)[0] for n in by_rank.get(r, [])), default=TASK_W)
        rank_cx[r] = x + col_w // 2
        x += col_w + H_GAP

    # Y centres within each column
    centers = {}
    for r, group in by_rank.items():
        cx = rank_cx[r]
        cy = 50
        for node in group:
            w, h = _size(node)
            centers[node] = (cx, cy + h // 2)
            cy += h + V_GAP

    # Apply bounds
    for node in nodes:
        cx, cy = centers[node]
        w, h = _size(node)
        node.set_x(cx - w // 2)
        node.set_y(cy - h // 2)
        node.set_width(w)
        node.set_height(h)

    max_y = max(cy + _size(n)[1] // 2 for n, (_, cy) in centers.items())
    loop_y = max_y + V_GAP

    # Apply waypoints
    for flow in flows:
        src, tgt = flow.get_source(), flow.get_target()
        scx, scy = centers[src]
        tcx, tcy = centers[tgt]
        sw, sh = _size(src)
        tw, th = _size(tgt)

        flow.del_waypoints()
        if rank.get(tgt, 0) > rank.get(src, 0):
            # Forward: exit right-centre, enter left-centre
            flow.add_waypoint((scx + sw // 2, scy))
            flow.add_waypoint((tcx - tw // 2, tcy))
        else:
            # Backward (loop): route below all ranks
            flow.add_waypoint((scx, scy + sh // 2))
            flow.add_waypoint((scx, loop_y))
            flow.add_waypoint((tcx, loop_y))
            flow.add_waypoint((tcx, tcy + th // 2))

    return bpmn_graph
