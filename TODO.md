
DFG visualisation
DFG miner -> DFG visualisation
Option to suppress tokens and simulation
BPMN visualisation (using a Camunda JS library I have not yet shared)
BPMN communication using a JSON version of BPMN (?)
Better trace variant visualisation (using another lib I have not yet shared)

BPMN layout follow-up (pmws/bpmn_layout.py):
- XOR gateway still shows empty diamond - isMarkerVisible="true" is being set
  but bpmn-js may require it on the BPMNShape DI element instead; investigate
- Task vertical alignment: tasks between two gateways sit low; centre should
  align with gateway centres (rank-local vertical centering)
- Arc crossovers: same underlying problem as Petri net arc crossovers;
  needs a crossing-minimisation pass, not a quick fix


