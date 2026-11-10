"""
code_runner.py - runs one Code Lab snippet in its own Python process.
Usage: python code_runner.py <code_file> <link_json_file>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from qiskit import QuantumCircuit, transpile  # noqa: E402
from qiskit_aer import AerSimulator  # noqa: E402

from quantum_backend import correlation, noisy_simulator, run_chsh, run_e91, bell_pair_circuit  # noqa: E402

with open(sys.argv[2], encoding="utf-8") as f:
    link = json.load(f)
with open(sys.argv[1], encoding="utf-8") as f:
    source = f.read()

namespace = {
    "__name__": "__lab__", "np": np, "QuantumCircuit": QuantumCircuit, "transpile": transpile,
    "AerSimulator": AerSimulator, "noisy_simulator": noisy_simulator, "correlation": correlation,
    "run_chsh": run_chsh, "run_e91": run_e91, "bell_pair_circuit": bell_pair_circuit, "link": link,
}
exec(compile(source, "code_lab.py", "exec"), namespace)
