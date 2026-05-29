"""
Unit tests for pmws.bpmn_layout — Kitzmann grid layout algorithm.

Internal phases (_classify, _topo_sort, _LayoutGrid, _compact) are tested
with plain Python objects so they run without pm4py.  The public apply()
function is tested end-to-end using pm4py BPMN objects.

Run with:
    python -m unittest pmws.test_bpmn_layout
"""

import unittest
from collections import defaultdict

from pmws.bpmn_layout import (
    _classify,
    _topo_sort,
    _LayoutGrid,
    _place_elements,
    _compact,
    _can_interleave,
    apply,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _succs_preds(*edges):
    """Build succs/preds dicts from (src, tgt) pairs using plain strings."""
    succs = defaultdict(list)
    preds = defaultdict(list)
    for src, tgt in edges:
        succs[src].append(tgt)
        preds[tgt].append(src)
    return succs, preds


def _make_bpmn(*node_specs, flows=()):
    """
    Build a minimal pm4py BPMN graph.

    node_specs: list of (id, kind) where kind is 'start', 'end', 'task',
                'xor', or 'par'.
    flows:      list of (source_id, target_id) pairs.

    Returns (bpmn_graph, node_by_id).
    """
    from pm4py.objects.bpmn.obj import BPMN

    bpmn = BPMN()
    node_by_id = {}

    for nid, kind in node_specs:
        if kind == 'start':
            n = BPMN.StartEvent(name=nid, id=nid)
        elif kind == 'end':
            n = BPMN.EndEvent(name=nid, id=nid)
        elif kind == 'xor':
            n = BPMN.ExclusiveGateway(name=nid, id=nid)
        elif kind == 'par':
            n = BPMN.ParallelGateway(name=nid, id=nid)
        else:
            n = BPMN.Task(name=nid, id=nid)
        bpmn.add_node(n)
        node_by_id[nid] = n

    for sid, tid in flows:
        bpmn.add_flow(BPMN.SequenceFlow(
            source=node_by_id[sid],
            target=node_by_id[tid],
            id=f'{sid}__{tid}',
        ))

    return bpmn, node_by_id


# ── _LayoutGrid ───────────────────────────────────────────────────────────────

class TestLayoutGrid(unittest.TestCase):

    def test_basic_placement(self):
        g = _LayoutGrid()
        g.place('a', 0, 0)
        self.assertEqual(g.position('a'), (0, 0))
        self.assertEqual(g.max_col, 0)
        self.assertEqual(g.max_row, 0)

    def test_collision_bumps_row(self):
        g = _LayoutGrid()
        g.place('a', 0, 0)
        g.place('b', 0, 0)   # same cell — should be bumped to row 1
        self.assertEqual(g.position('b'), (0, 1))

    def test_max_col_row_tracked(self):
        g = _LayoutGrid()
        g.place('a', 2, 3)
        self.assertEqual(g.max_col, 2)
        self.assertEqual(g.max_row, 3)

    def test_next_free_row_empty(self):
        g = _LayoutGrid()
        self.assertEqual(g.next_free_row(0), 0)

    def test_next_free_row_occupied(self):
        g = _LayoutGrid()
        g.place('a', 0, 0)
        g.place('b', 0, 1)
        self.assertEqual(g.next_free_row(0), 2)

    def test_position_unknown_returns_none(self):
        g = _LayoutGrid()
        self.assertIsNone(g.position('ghost'))


# ── _classify ─────────────────────────────────────────────────────────────────

class TestClassify(unittest.TestCase):

    def test_isolated_node_is_start_and_end(self):
        succs, preds = _succs_preds()
        types = _classify(['a'], succs, preds)
        self.assertIn('start', types['a'])
        self.assertIn('end',   types['a'])

    def test_source_is_start(self):
        succs, preds = _succs_preds(('a', 'b'))
        types = _classify(['a', 'b'], succs, preds)
        self.assertIn('start', types['a'])
        self.assertNotIn('start', types['b'])

    def test_sink_is_end(self):
        succs, preds = _succs_preds(('a', 'b'))
        types = _classify(['a', 'b'], succs, preds)
        self.assertIn('end', types['b'])
        self.assertNotIn('end', types['a'])

    def test_split_node(self):
        succs, preds = _succs_preds(('a', 'b'), ('a', 'c'))
        types = _classify(['a', 'b', 'c'], succs, preds)
        self.assertIn('split', types['a'])
        self.assertNotIn('split', types['b'])

    def test_join_node(self):
        succs, preds = _succs_preds(('a', 'c'), ('b', 'c'))
        types = _classify(['a', 'b', 'c'], succs, preds)
        self.assertIn('join', types['c'])
        self.assertNotIn('join', types['a'])


# ── _topo_sort ────────────────────────────────────────────────────────────────

class TestTopoSort(unittest.TestCase):

    def _sort(self, nodes, *edges):
        succs, preds = _succs_preds(*edges)
        types = _classify(nodes, succs, preds)
        return _topo_sort(nodes, succs, preds, types)

    def test_chain_order(self):
        result = self._sort(['a', 'b', 'c'], ('a', 'b'), ('b', 'c'))
        self.assertEqual(result, ['a', 'b', 'c'])

    def test_all_nodes_present(self):
        nodes = ['a', 'b', 'c', 'd']
        result = self._sort(nodes, ('a', 'b'), ('a', 'c'), ('b', 'd'), ('c', 'd'))
        self.assertEqual(sorted(result), sorted(nodes))

    def test_source_before_sink(self):
        result = self._sort(['a', 'b', 'c', 'd'],
                            ('a', 'b'), ('a', 'c'), ('b', 'd'), ('c', 'd'))
        self.assertLess(result.index('a'), result.index('d'))

    def test_cycle_does_not_loop(self):
        # Simple 2-cycle: a→b→a  (both are joins)
        result = self._sort(['a', 'b'], ('a', 'b'), ('b', 'a'))
        self.assertEqual(sorted(result), ['a', 'b'])

    def test_cycle_all_nodes_returned(self):
        result = self._sort(['a', 'b', 'c'],
                            ('a', 'b'), ('b', 'c'), ('c', 'a'))
        self.assertEqual(sorted(result), ['a', 'b', 'c'])

    def test_loop_with_forward_path(self):
        # start → body → decision → [end, body (loop)]
        nodes = ['start', 'body', 'dec', 'end']
        result = self._sort(nodes,
                            ('start', 'body'), ('body', 'dec'),
                            ('dec', 'end'), ('dec', 'body'))
        # start must come first, end must come last
        self.assertEqual(result[0], 'start')
        self.assertEqual(result[-1], 'end')


# ── _compact (_can_interleave / _interleave) ──────────────────────────────────

class TestCompact(unittest.TestCase):

    def _grid_from_layout(self, layout):
        """layout: {node: (col, row)}"""
        g = _LayoutGrid()
        for node, (col, row) in layout.items():
            # Force exact placement (no bump) by ensuring cells are free
            g._cells[(col, row)] = node
            g._positions[node]   = (col, row)
            g.max_col = max(g.max_col, col)
            g.max_row = max(g.max_row, row)
        return g

    def test_non_overlapping_rows_can_interleave(self):
        # row0: col0=a   row1: col1=b  — no column conflict
        g = self._grid_from_layout({'a': (0, 0), 'b': (1, 1)})
        self.assertTrue(_can_interleave(g, 0, 1))

    def test_overlapping_rows_cannot_interleave(self):
        # row0: col0=a   row1: col0=b  — col0 conflict
        g = self._grid_from_layout({'a': (0, 0), 'b': (0, 1)})
        self.assertFalse(_can_interleave(g, 0, 1))

    def test_compact_same_column_nodes_stay_separate(self):
        # a and b share column 0 — compact may collapse the empty row between
        # them but must never put them in the same row.
        g = self._grid_from_layout({'a': (0, 0), 'b': (0, 2)})
        _compact(g)
        self.assertNotEqual(g.position('a')[1], g.position('b')[1],
                            "nodes in the same column must remain on different rows")

    def test_compact_merges_staggered_rows(self):
        # a at (0,0), b at (1,1) — different columns, can merge
        g = self._grid_from_layout({'a': (0, 0), 'b': (1, 1)})
        _compact(g)
        self.assertEqual(g.max_row, 0)
        self.assertEqual(g.position('b'), (1, 0))


# ── Crossing detection helpers ────────────────────────────────────────────────

def _arcs_through_nodes(bpmn):
    """Return list of (arc_label, node_name) for arcs whose waypoint segments
    pass through a non-source/non-target node's bounding box.

    Only strictly-interior crossings are counted: touching an edge is fine
    (that is how arcs attach to nodes).
    """
    nodes = list(bpmn.get_nodes())
    hits  = []
    for flow in bpmn.get_flows():
        src, tgt = flow.get_source(), flow.get_target()
        label    = f"{src.get_name()}→{tgt.get_name()}"
        wps      = flow.get_waypoints()
        for (x1, y1), (x2, y2) in zip(wps, wps[1:]):
            for node in nodes:
                if node is src or node is tgt:
                    continue
                nx = node.get_x()
                ny = node.get_y()
                nw = node.get_width()
                nh = node.get_height()
                if x1 == x2:                     # vertical segment
                    x = x1
                    if nx < x < nx + nw:
                        y_lo, y_hi = min(y1, y2), max(y1, y2)
                        if y_lo < ny + nh and y_hi > ny:
                            hits.append((label, node.get_name()))
                else:                             # horizontal segment
                    y = y1
                    if ny < y < ny + nh:
                        x_lo, x_hi = min(x1, x2), max(x1, x2)
                        if x_lo < nx + nw and x_hi > nx:
                            hits.append((label, node.get_name()))
    return hits


# ── apply (end-to-end with pm4py BPMN objects) ───────────────────────────────

class TestApply(unittest.TestCase):

    def test_empty_graph_no_error(self):
        bpmn, _ = _make_bpmn()
        apply(bpmn)   # should not raise

    def test_single_node_gets_position(self):
        bpmn, nodes = _make_bpmn(('t', 'task'))
        apply(bpmn)
        n = nodes['t']
        self.assertIsNotNone(n.get_x())
        self.assertIsNotNone(n.get_y())

    def test_chain_left_to_right(self):
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('t', 'task'), ('e', 'end'),
            flows=[('s', 't'), ('t', 'e')],
        )
        apply(bpmn)
        self.assertLess(nodes['s'].get_x(), nodes['t'].get_x())
        self.assertLess(nodes['t'].get_x(), nodes['e'].get_x())

    def test_xor_split_successors_different_rows(self):
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('gw', 'xor'), ('a', 'task'), ('b', 'task'), ('e', 'end'),
            flows=[('s', 'gw'), ('gw', 'a'), ('gw', 'b'), ('a', 'e'), ('b', 'e')],
        )
        apply(bpmn)
        self.assertNotEqual(nodes['a'].get_y(), nodes['b'].get_y(),
                            "split successors should be on different rows")

    def test_join_to_right_of_split_successors(self):
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('split', 'par'), ('a', 'task'), ('b', 'task'),
            ('join', 'par'), ('e', 'end'),
            flows=[('s', 'split'), ('split', 'a'), ('split', 'b'),
                   ('a', 'join'), ('b', 'join'), ('join', 'e')],
        )
        apply(bpmn)
        join_x = nodes['join'].get_x()
        self.assertGreater(join_x, nodes['a'].get_x())
        self.assertGreater(join_x, nodes['b'].get_x())

    def test_all_nodes_positioned(self):
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('t1', 'task'), ('t2', 'task'), ('e', 'end'),
            flows=[('s', 't1'), ('s', 't2'), ('t1', 'e'), ('t2', 'e')],
        )
        apply(bpmn)
        for n in nodes.values():
            self.assertIsNotNone(n.get_x(), f"{n} missing x")
            self.assertIsNotNone(n.get_y(), f"{n} missing y")

    def test_node_sizes_set(self):
        from pm4py.objects.bpmn.obj import BPMN as _BPMN
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('t', 'task'), ('e', 'end'),
            flows=[('s', 't'), ('t', 'e')],
        )
        apply(bpmn)
        for nid, node in nodes.items():
            self.assertGreater(node.get_width(),  0, f"{nid} width not set")
            self.assertGreater(node.get_height(), 0, f"{nid} height not set")

    def test_forward_flows_have_waypoints(self):
        bpmn, _ = _make_bpmn(
            ('s', 'start'), ('t', 'task'), ('e', 'end'),
            flows=[('s', 't'), ('t', 'e')],
        )
        apply(bpmn)
        for flow in bpmn.get_flows():
            self.assertGreater(len(flow.get_waypoints()), 0,
                               "every flow should have waypoints")

    def test_loop_does_not_raise(self):
        # start → task → gw → [end, task (loop)]
        bpmn, _ = _make_bpmn(
            ('s', 'start'), ('t', 'task'), ('gw', 'xor'), ('e', 'end'),
            flows=[('s', 't'), ('t', 'gw'), ('gw', 'e'), ('gw', 't')],
        )
        apply(bpmn)   # cycle should be handled gracefully

    def test_compact_option_false(self):
        """compact=False should still produce valid positions."""
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('t', 'task'), ('e', 'end'),
            flows=[('s', 't'), ('t', 'e')],
        )
        apply(bpmn, compact=False)
        self.assertLess(nodes['s'].get_x(), nodes['e'].get_x())

    def test_no_arc_crosses_node_bbox(self):
        """No arc segment should pass through a node that is neither its
        source nor its target.  This topology creates a skip arc (c→jp) whose
        horizontal segment would naively cut through node b."""
        bpmn, _ = _make_bpmn(
            ('s', 'start'), ('sp', 'xor'), ('a', 'task'), ('b', 'task'),
            ('c', 'task'), ('jp', 'xor'), ('e', 'end'),
            flows=[('s', 'sp'), ('sp', 'a'), ('sp', 'c'),
                   ('a', 'b'), ('b', 'jp'), ('c', 'jp'), ('jp', 'e')],
        )
        apply(bpmn)
        hits = _arcs_through_nodes(bpmn)
        self.assertEqual(hits, [], f"arcs crossing nodes: {hits}")

    def test_no_arc_crosses_node_a1_log(self):
        """Topology mirroring the a1 log: loop on 'a', then XOR(c, PAR(d,e)→f).
        The c→xor_join arc spans several columns and the par branch occupies
        the same row as the target; the bypass routing must avoid those nodes."""
        bpmn, _ = _make_bpmn(
            ('s',  'start'),
            ('lj', 'xor'), ('a', 'task'), ('ls', 'xor'),
            ('sp', 'xor'), ('c', 'task'),
            ('pp', 'par'), ('d', 'task'), ('e', 'task'),
            ('pj', 'par'), ('f', 'task'),
            ('jp', 'xor'), ('end', 'end'),
            flows=[
                ('s',  'lj'),
                ('lj', 'a'),  ('a',  'ls'), ('ls', 'lj'), ('ls', 'sp'),
                ('sp', 'c'),  ('sp', 'pp'),
                ('pp', 'd'),  ('pp', 'e'),
                ('d',  'pj'), ('e',  'pj'), ('pj', 'f'),
                ('c',  'jp'), ('f',  'jp'), ('jp', 'end'),
            ],
        )
        apply(bpmn)
        hits = _arcs_through_nodes(bpmn)
        self.assertEqual(hits, [], f"arcs crossing nodes: {hits}")

    def test_no_backward_arc_crosses_node(self):
        """A loop-back arc must not pass through any intermediate node.

        Topology:
            s → split → a → join → e
                      ↘ b ↗
                 join ←──── reinit

        'reinit' feeds back to 'join' (backward arc).  In the grid, 'split'
        sits in the same column as the loop source but at a different row;
        the U-shape routing must route around it rather than straight through.
        """
        bpmn, _ = _make_bpmn(
            ('s', 'start'), ('split', 'xor'), ('a', 'task'), ('b', 'task'),
            ('join', 'xor'), ('reinit', 'task'), ('e', 'end'),
            flows=[
                ('s',      'split'),
                ('split',  'a'), ('split', 'b'),
                ('a',      'join'), ('b', 'join'),
                ('join',   'reinit'),
                ('reinit', 'split'),   # backward arc — the loop-back
                ('join',   'e'),
            ],
        )
        apply(bpmn)
        hits = _arcs_through_nodes(bpmn)
        self.assertEqual(hits, [], f"arcs crossing nodes: {hits}")

    def test_backward_arc_does_not_cross_same_column_node(self):
        """Backward arc must not pass through a node that shares the loop source's
        column but sits below it in the grid.

        Topology
        --------
            s → lj → t → xs ─→ reinit ─→ lj   (backward arc: reinit → lj)
                              ↘
                               pay_gw → pay → e

        The XOR split xs has two successors: reinit (arc_index=0, placed one row
        above xs) and pay_gw (arc_index=1, placed at the same row as xs).
        After row-normalisation reinit lands at row 0 and pay_gw at row 1, both
        in column col(xs)+1.

        With the old "U-shape from node center" routing the backward arc's
        downward vertical segment ran through pay_gw.  The gap-based routing
        (exit via src_right + h_gap/2) must stay to the right of both nodes in
        that column, producing no crossing.
        """
        bpmn, _ = _make_bpmn(
            ('s',      'start'),
            ('lj',     'xor'),      # join: 2 preds (s, reinit)
            ('t',      'task'),
            ('xs',     'xor'),      # split: 2 succs (reinit, pay_gw)
            ('reinit', 'task'),     # arc_index=0  → top of column
            ('pay_gw', 'xor'),      # arc_index=1  → below reinit, same column
            ('pay',    'task'),
            ('e',      'end'),
            flows=[
                ('s',      'lj'),
                ('lj',     't'),
                ('t',      'xs'),
                ('xs',     'reinit'),   # first from xs  → arc_index 0
                ('xs',     'pay_gw'),   # second from xs → arc_index 1
                ('pay_gw', 'pay'),
                ('pay',    'e'),
                ('reinit', 'lj'),       # backward arc
            ],
        )
        apply(bpmn)
        hits = _arcs_through_nodes(bpmn)
        self.assertEqual(hits, [], f"backward arc crossing node(s): {hits}")

    def test_forward_arcs_are_orthogonal(self):
        """Every forward arc (tgt_col > src_col) must be axis-aligned:
        each consecutive waypoint pair shares either the same x or the same y.
        A diagonal segment (Δx≠0 and Δy≠0 simultaneously) would cut through
        nodes that occupy the same column but a different row.

        Topology: xor split with one short branch (c) and one long branch
        (a→b), so c→jp skips two columns.
        """
        bpmn, _ = _make_bpmn(
            ('s', 'start'), ('sp', 'xor'), ('a', 'task'), ('b', 'task'),
            ('c', 'task'), ('jp', 'xor'), ('e', 'end'),
            flows=[('s', 'sp'), ('sp', 'a'), ('sp', 'c'),
                   ('a', 'b'), ('b', 'jp'), ('c', 'jp'), ('jp', 'e')],
        )
        apply(bpmn)
        for flow in bpmn.get_flows():
            wps = flow.get_waypoints()
            for (x1, y1), (x2, y2) in zip(wps, wps[1:]):
                self.assertTrue(
                    x1 == x2 or y1 == y2,
                    f"diagonal segment ({x1},{y1})→({x2},{y2}) in flow "
                    f"{flow.get_source().get_name()}→{flow.get_target().get_name()}"
                )

    def test_same_row_skip_is_horizontal(self):
        """A skip flow whose source and target share the same grid row must
        connect with a straight horizontal line — no vertical detour."""
        # Build a graph where the split sends one branch directly to the join
        # (same row as the join's average) and the other through two extra nodes.
        # The direct branch c ends up at the same row as jp because jp is
        # placed at the average of its predecessors' rows and c contributes
        # symmetrically.
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('sp', 'par'), ('a', 'task'), ('b', 'task'),
            ('c', 'task'), ('jp', 'par'), ('e', 'end'),
            flows=[('s', 'sp'), ('sp', 'a'), ('sp', 'c'),
                   ('a', 'b'), ('b', 'jp'), ('c', 'jp'), ('jp', 'e')],
        )
        apply(bpmn)
        skip_flow = next(
            f for f in bpmn.get_flows()
            if f.get_source() is nodes['c'] and f.get_target() is nodes['jp']
        )
        wps = skip_flow.get_waypoints()
        if nodes['c'].get_y() == nodes['jp'].get_y():
            # Same row: must be exactly 2 waypoints, both at the same y
            ys = [wp[1] for wp in wps]
            self.assertEqual(len(set(ys)), 1,
                             "same-row skip should have constant y across all waypoints")

    def test_skip_flow_does_not_cross_diagram_top(self):
        """Skip flows should not use a bypass lane above the diagram.
        All waypoints must stay within or below the diagram's top margin."""
        bpmn, nodes = _make_bpmn(
            ('s', 'start'), ('sp', 'xor'), ('a', 'task'), ('b', 'task'),
            ('c', 'task'), ('jp', 'xor'), ('e', 'end'),
            flows=[('s', 'sp'), ('sp', 'a'), ('sp', 'c'),
                   ('a', 'b'), ('b', 'jp'), ('c', 'jp'), ('jp', 'e')],
        )
        apply(bpmn, start_y=50)
        top_node_y = min(n.get_y() for n in bpmn.get_nodes())
        for flow in bpmn.get_flows():
            for wx, wy in flow.get_waypoints():
                self.assertGreaterEqual(
                    wy, top_node_y,
                    f"waypoint y={wy} is above diagram top y={top_node_y}"
                )

    def test_spacing_options_respected(self):
        """Larger h_gap should produce greater x separation."""
        bpmn_small, ns = _make_bpmn(
            ('s', 'start'), ('t', 'task'), ('e', 'end'),
            flows=[('s', 't'), ('t', 'e')],
        )
        apply(bpmn_small, h_gap=10)
        small_span = ns['e'].get_x() - ns['s'].get_x()

        bpmn_large, nl = _make_bpmn(
            ('s', 'start'), ('t', 'task'), ('e', 'end'),
            flows=[('s', 't'), ('t', 'e')],
        )
        apply(bpmn_large, h_gap=200)
        large_span = nl['e'].get_x() - nl['s'].get_x()

        self.assertGreater(large_span, small_span)


if __name__ == '__main__':
    unittest.main()
