"""
Pure-Python left-to-right BPMN layout.

Implements the grid-based algorithm from:
  "A Simple Algorithm for Automatic Layout of BPMN Processes"
  Kitzmann et al., 2009.

Phases
------
1. Classify each node as start / end / split / join.
2. Modified topological sort — handles cycles by breaking at join nodes
   that already have at least one placed predecessor.
3. Place nodes on a sparse (col, row) integer grid:
   - start nodes at column 0
   - split successors fanned out vertically around the predecessor
   - join nodes at max(predecessor cols) + 1, average predecessor row
   - all others at predecessor col + 1, same row
4. Compact: repeatedly merge adjacent rows that share no column.
5. Convert grid positions to pixel coordinates, size-aware per column/row.
6. Route flow waypoints: forward flows use right→left edge connectors;
   back-edges (loops) route below all ranks.

No external dependencies beyond pm4py's BPMN object model.
Can be used standalone by passing any object graph that exposes the same
get_nodes() / get_flows() / set_x() / set_y() / set_width() / set_height() /
add_waypoint() / del_waypoints() interface.

This pure Python version closely based on the implementation in YAPNE.
"""
import re
from collections import defaultdict

from pm4py.objects.bpmn.obj import BPMN

# ── Node dimensions (bpmn-js defaults) ───────────────────────────────────────

EVENT_W = EVENT_H = 36
GATEWAY_W = GATEWAY_H = 50
TASK_W, TASK_H = 100, 80

# ── Spacing defaults ──────────────────────────────────────────────────────────

DEFAULT_H_GAP   = 60   # horizontal gap between rank columns
DEFAULT_V_GAP   = 40   # vertical gap between node rows
DEFAULT_START_X = 50
DEFAULT_START_Y = 50


def _size(node):
    if isinstance(node, BPMN.Event):
        return EVENT_W, EVENT_H
    if isinstance(node, BPMN.Gateway):
        return GATEWAY_W, GATEWAY_H
    return TASK_W, TASK_H


# ── Phase 1: classification ───────────────────────────────────────────────────

def _classify(nodes, succs, preds):
    """Return {node: set-of-tags}.  Tags: 'start', 'end', 'split', 'join'."""
    types = {}
    for n in nodes:
        tags = {'element'}
        if not preds[n]:      tags.add('start')
        if not succs[n]:      tags.add('end')
        if len(preds[n]) > 1: tags.add('join')
        if len(succs[n]) > 1: tags.add('split')
        types[n] = tags
    return types


# ── Phase 2: modified topological sort ───────────────────────────────────────

def _topo_sort(nodes, succs, preds, types):
    """
    Kahn-style BFS with cycle-breaking.

    When no zero-in-degree node exists (cycle), the algorithm picks a join
    node that already has at least one predecessor placed, then pretends its
    remaining unplaced incoming edges have been satisfied.  This breaks the
    cycle without reversing any edge — unplaced predecessors simply appear
    to the right of the join in the final layout, producing the expected
    backward/loop arc routing.
    """
    in_deg      = {n: len(preds[n]) for n in nodes}
    orig_in_deg = dict(in_deg)
    placed      = set()
    result      = []
    remaining   = list(nodes)   # preserves insertion order as tie-break

    while remaining:
        free = [n for n in remaining if in_deg[n] == 0]

        if free:
            node = free[0]
            result.append(node)
            remaining.remove(node)
            placed.add(node)
            for succ in succs[node]:
                if succ in in_deg:
                    in_deg[succ] -= 1
        else:
            # Cycle detected: break at the best join candidate
            loop_entry = next(
                (n for n in remaining
                 if 'join' in types[n]
                 and in_deg[n] < orig_in_deg[n]),
                remaining[0],
            )
            # Pretend unplaced incoming edges are already satisfied
            for pred in preds[loop_entry]:
                if pred not in placed:
                    in_deg[loop_entry] -= 1

    return result


# ── Phase 3: grid placement ───────────────────────────────────────────────────

class _LayoutGrid:
    """Sparse integer grid.  Cells are (col, row) → node; bumps row on collision."""

    def __init__(self):
        self._cells     = {}   # (col, row) → node
        self._positions = {}   # node → (col, row)
        self.max_col    = 0
        self.max_row    = 0

    def place(self, node, col, row):
        while (col, row) in self._cells:
            row += 1
        self._cells[(col, row)] = node
        self._positions[node]   = (col, row)
        self.max_col = max(self.max_col, col)
        self.max_row = max(self.max_row, row)

    def position(self, node):
        return self._positions.get(node)

    def next_free_row(self, col):
        row = 0
        while (col, row) in self._cells:
            row += 1
        return row


def _place_elements(sorted_nodes, succs, preds, types):
    grid = _LayoutGrid()
    for node in sorted_nodes:
        if 'start' in types[node]:
            grid.place(node, 0, grid.next_free_row(0))
        else:
            _place_relative(node, grid, preds, succs, types)
    _normalize_rows(grid)
    return grid


def _normalize_rows(grid):
    """Shift all row positions upward so the minimum row is 0.

    The split fan-out formula can produce negative row indices when a split
    node sits at row 0 and its first successor is above centre.  This pass
    translates every cell up by |min_row| so all rows are non-negative.
    """
    if not grid._positions:
        return
    min_row = min(r for (_, r) in grid._cells)
    if min_row >= 0:
        return
    shift = -min_row
    new_cells = {}
    for (col, row), node in grid._cells.items():
        new_cells[(col, row + shift)] = node
        grid._positions[node] = (col, row + shift)
    grid._cells = new_cells
    grid.max_row += shift


def _place_relative(node, grid, preds, succs, types):
    pred_nodes     = preds[node]
    pred_positions = [grid.position(p) for p in pred_nodes
                      if grid.position(p) is not None]

    if not pred_positions:
        grid.place(node, 0, 0)
        return

    if 'join' in types[node]:
        col     = max(p[0] for p in pred_positions) + 1
        avg_row = round(sum(p[1] for p in pred_positions) / len(pred_positions))
        grid.place(node, col, avg_row)

    elif len(pred_positions) == 1:
        pred     = pred_nodes[0]
        pred_pos = pred_positions[0]
        if 'split' in types[pred]:
            successors = list(succs[pred])
            arc_index  = successors.index(node) if node in successors else 0
            target_row = pred_pos[1] + arc_index - len(successors) // 2
            grid.place(node, pred_pos[0] + 1, target_row)
        else:
            grid.place(node, pred_pos[0] + 1, pred_pos[1])

    else:
        col     = max(p[0] for p in pred_positions) + 1
        avg_row = round(sum(p[1] for p in pred_positions) / len(pred_positions))
        grid.place(node, col, avg_row)


# ── Phase 4: row interleaving (compaction) ────────────────────────────────────

def _compact(grid):
    """
    Repeatedly merge adjacent rows that share no occupied column.
    Terminates when no further merges are possible.
    """
    changed = True
    while changed:
        changed = False
        for row in range(grid.max_row):
            if _can_interleave(grid, row, row + 1):
                _interleave(grid, row, row + 1)
                changed = True
                break   # restart after each merge


def _can_interleave(grid, row1, row2):
    for col in range(grid.max_col + 1):
        if (col, row1) in grid._cells and (col, row2) in grid._cells:
            return False
    return True


def _interleave(grid, row1, row2):
    # Move row2 cells into the gaps in row1
    for col in range(grid.max_col + 1):
        if (col, row2) in grid._cells:
            node = grid._cells.pop((col, row2))
            grid._cells[(col, row1)] = node
            grid._positions[node]    = (col, row1)
    # Compact: shift everything above row2 down by one
    for row in range(row2 + 1, grid.max_row + 1):
        for col in range(grid.max_col + 1):
            if (col, row) in grid._cells:
                node = grid._cells.pop((col, row))
                grid._cells[(col, row - 1)] = node
                grid._positions[node]       = (col, row - 1)
    grid.max_row -= 1


# ── Phase 5: grid → pixel coordinates ────────────────────────────────────────

def _grid_to_pixel(nodes, grid, h_gap, v_gap, start_x, start_y):
    """
    Column widths and row heights are sized to the widest/tallest node in
    each column/row respectively, so labels of different lengths don't overlap.
    """
    col_w = defaultdict(int)
    row_h = defaultdict(int)
    for n in nodes:
        pos = grid.position(n)
        if pos is None:
            continue
        c, r     = pos
        w, h     = _size(n)
        col_w[c] = max(col_w[c], w)
        row_h[r] = max(row_h[r], h)

    col_cx = {}
    x = start_x
    for c in range(grid.max_col + 1):
        w         = col_w.get(c, TASK_W)
        col_cx[c] = x + w // 2
        x        += w + h_gap

    row_cy = {}
    y = start_y
    for r in range(grid.max_row + 1):
        h         = row_h.get(r, TASK_H)
        row_cy[r] = y + h // 2
        y        += h + v_gap

    return col_cx, row_cy


# ── Public entry point ────────────────────────────────────────────────────────

def apply(bpmn_graph,
          h_gap=DEFAULT_H_GAP, v_gap=DEFAULT_V_GAP,
          start_x=DEFAULT_START_X, start_y=DEFAULT_START_Y,
          compact=True):
    """
    Apply Kitzmann grid layout to *bpmn_graph* in-place.

    Parameters
    ----------
    bpmn_graph : pm4py BPMN graph (or compatible duck-typed object)
    h_gap      : horizontal pixel gap between rank columns
    v_gap      : vertical pixel gap between rows
    start_x    : left margin in pixels
    start_y    : top margin in pixels
    compact    : whether to apply row-interleaving compaction (phase 4)

    Returns
    -------
    bpmn_graph  (same object, mutated)
    """
    nodes = list(bpmn_graph.get_nodes())
    flows = list(bpmn_graph.get_flows())
    if not nodes:
        return bpmn_graph

    succs = defaultdict(list)
    preds = defaultdict(list)
    for f in flows:
        succs[f.get_source()].append(f.get_target())
        preds[f.get_target()].append(f.get_source())

    types        = _classify(nodes, succs, preds)
    sorted_nodes = _topo_sort(nodes, succs, preds, types)
    grid         = _place_elements(sorted_nodes, succs, preds, types)

    if compact:
        _compact(grid)

    col_cx, row_cy = _grid_to_pixel(nodes, grid, h_gap, v_gap, start_x, start_y)

    centers = {}
    for node in nodes:
        pos = grid.position(node)
        if pos is None:
            continue
        cx, cy        = col_cx[pos[0]], row_cy[pos[1]]
        centers[node] = (cx, cy)
        w, h          = _size(node)
        node.set_x(cx - w // 2)
        node.set_y(cy - h // 2)
        node.set_width(w)
        node.set_height(h)

    loop_y = (
        max(cy + _size(n)[1] // 2 for n, (_, cy) in centers.items()) + v_gap
    ) if centers else start_y

    # Bypass lane: above the topmost node row.  start_y is the pixel origin of
    # row 0, so everything above it is empty.  Used when a forward arc's
    # horizontal segment would otherwise cut through intermediate-column nodes.
    bypass_y = max(0, start_y - v_gap)

    def _blocked(s_col, t_col, t_row):
        """True if any node in a strictly intermediate column shares t_row."""
        for c in range(s_col + 1, t_col):
            if (c, t_row) in grid._cells:
                return True
        return False

    for flow in flows:
        src, tgt = flow.get_source(), flow.get_target()
        if src not in centers or tgt not in centers:
            continue
        scx, scy = centers[src]
        tcx, tcy = centers[tgt]
        sw, sh   = _size(src)
        tw, th   = _size(tgt)
        src_col  = (grid.position(src) or (0,))[0]
        tgt_col  = (grid.position(tgt) or (0,))[0]
        tgt_row  = (grid.position(tgt) or (0, 0))[1]

        src_right  = scx + sw // 2
        tgt_left   = tcx - tw // 2
        # exit_x / approach_x sit in the h_gap between columns — no nodes there,
        # so vertical segments at these x values cannot cross any node bbox.
        exit_x     = src_right + h_gap // 2
        approach_x = tgt_left  - h_gap // 2

        flow.del_waypoints()
        if tgt_col > src_col:
            if scy == tcy and not _blocked(src_col, tgt_col, tgt_row):
                # Same row, clear horizontal path
                flow.add_waypoint((src_right, scy))
                flow.add_waypoint((tgt_left,  tcy))
            elif _blocked(src_col, tgt_col, tgt_row):
                # Intermediate column has a node at the target row: bypass above.
                # 6 waypoints, both verticals in column gaps → no node crossings.
                flow.add_waypoint((src_right,  scy))
                flow.add_waypoint((exit_x,     scy))
                flow.add_waypoint((exit_x,     bypass_y))
                flow.add_waypoint((approach_x, bypass_y))
                flow.add_waypoint((approach_x, tcy))
                flow.add_waypoint((tgt_left,   tcy))
            else:
                # Different rows, clear path: orthogonal exit-column routing
                flow.add_waypoint((src_right, scy))
                flow.add_waypoint((exit_x,    scy))
                flow.add_waypoint((exit_x,    tcy))
                flow.add_waypoint((tgt_left,  tcy))
        else:
            # Backward / loop: U-shape below the diagram.
            # Exit via the right-edge gap (exit_x) and enter from the left-edge
            # gap (approach_x) so both vertical segments stay in column gaps —
            # no other node can occupy those x positions.
            flow.add_waypoint((src_right,  scy))
            flow.add_waypoint((exit_x,     scy))
            flow.add_waypoint((exit_x,     loop_y))
            flow.add_waypoint((approach_x, loop_y))
            flow.add_waypoint((approach_x, tcy))
            flow.add_waypoint((tgt_left,   tcy))

    return bpmn_graph


def mark_xor_gateways(xml: str) -> str:
    """Add isMarkerVisible="true" to exclusive gateway BPMNShape DI elements.

    The BPMN 2.0 DI spec places isMarkerVisible on BPMNShape, not on the
    semantic ExclusiveGateway element.  bpmn-js reads it from the DI shape,
    so without this attribute the gateway renders as an empty diamond.
    """
    gw_ids = set(re.findall(r'<bpmn:exclusiveGateway[^>]+\bid="([^"]+)"', xml))
    for gw_id in gw_ids:
        xml = xml.replace(
            f'bpmnElement="{gw_id}"',
            f'bpmnElement="{gw_id}" isMarkerVisible="true"',
        )
    return xml
