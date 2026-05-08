# Process Mining Explorer

Process Mining Explorer is an in-browser, introduction to process mining and analytics. It shows fundamental data structures, process models and algorithms.

Basic features are available purely in browser. More extended features require running a simple local webserver, bundled with the application.

It is implemented in HTML, Javascript, and Python.

# Installation

Download the [ZIP file](https://github.com/adamburkegh/pm-explorer/archive/refs/heads/main.zip) and unpack to a local directory.

## Basic installation

That's it.

## Extended installation (local webserver)

Assuming Python is available. In your install directory, create and activate a virtual environment (venv).

```
python -m venv pme       # ie, create a virtual environment
. pme/Scripts/activate   # On Windows: pme\Scripts\activate.bat
```

Install Python requirements
```
pip install -r requirements.txt
```

# Running

For basic features, just open `static/index.html` in a web browser.

For the server side features, such as process conformance metrics, in the venv,

`python -m pmws.server`

# Sources

This project has made heavy use of copy-paste forks and translations of existing open source tools. 

## Petri Net Viewer

The Petri net viewer is adapted directly from [YAPNE](https://github.com/chimenkamp/YAPNE-Yet-Another-Petri-Net-Editor), a lovely open source in-browswer Petri net editor and simulator.

## Process Mining 

A number of process mining data structures and algorithms have been translated from, or directly use, [pm4py](https://github.com/process-intelligence-solutions/pm4py), including event log parsing and the Inductive Miner.

Support for log editing is based on delimited logs in [koalas](https://github.com/AdamBanham/koalas).


