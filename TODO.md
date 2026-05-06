
DFG conformance
Option to suppress tokens and simulation (currently just suppressed)
Better trace variant visualisation (using another lib I have not yet shared)

BPMN layout follow-up (`pmws/bpmn_layout.py`):
- Task vertical alignment: tasks between two gateways sit low; centre should
  align with gateway centres (rank-local vertical centering)
- Arc crossovers: same underlying problem as Petri net arc crossovers;
  needs a crossing-minimisation pass, not a quick fix


