"""
quantum_backend.py - Qiskit engine for Quantum Space Lab
=========================================================
Noise model: the space channel delivers a Werner state
    rho = p |Phi+><Phi+| + (1 - p) I/4
which is exactly a 2-qubit depolarizing channel with lambda = 1 - p applied
after the entangling gate.
"""
import math

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error

import qiskit

QISKIT_VERSION = qiskit.__version__


def noisy_simulator(p):
    """Qiskit Aer simulator whose entangled pairs have good-pair fraction p."""
    noise = NoiseModel()
    lam = min(max(1.0 - float(p), 0.0), 1.0)
    if lam > 0:
        noise.add_all_qubit_quantum_error(depolarizing_error(lam, 2), ["cx"])
    return AerSimulator(noise_model=noise)


def bell_pair_circuit(theta_a, theta_b):
    """|Phi+> pair; Alice (qubit 0) and Bob (qubit 1) measure at Bloch angles theta."""
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.ry(-theta_a, 0)
    qc.ry(-theta_b, 1)
    qc.measure_all()
    return qc


def correlation(counts):
    """E = (agree - disagree) / total, from a Qiskit counts dict."""
    total = sum(counts.values())
    if total == 0:
        return 0.0
    agree = sum(n for bits, n in counts.items() if bits[-1] == bits[-2])
    return (2 * agree - total) / total


CHSH_ANGLES = {"a": 0.0, "a'": math.pi / 2, "b": math.pi / 4, "b'": -math.pi / 4}


def run_chsh(p, shots=2000):
    """CHSH Bell test. Returns S and the four correlations."""
    sim = noisy_simulator(p)
    pairs = [("a", "b"), ("a", "b'"), ("a'", "b"), ("a'", "b'")]
    circuits = [transpile(bell_pair_circuit(CHSH_ANGLES[x], CHSH_ANGLES[y]), sim) for x, y in pairs]
    result = sim.run(circuits, shots=int(shots)).result()
    rows = []
    for k, (x, y) in enumerate(pairs):
        raw = result.get_counts(k)          # keys are 'bob alice' bit strings
        rows.append({"a": x, "b": y, "counts": dict(raw), "E": correlation(raw)})
    E = [r["E"] for r in rows]
    S = E[0] + E[1] + E[2] - E[3]
    return {"S": S, "rows": rows}


# --------------------------------------------------------------------------- E91
ALICE_BASES = [0.0, math.pi / 4, math.pi / 2]
BOB_BASES = [math.pi / 4, math.pi / 2, 3 * math.pi / 4]
EVE_BASES = [0.0, math.pi / 2]


def _binary_entropy(x):
    if x <= 0 or x >= 1:
        return 0.0
    return -x * math.log2(x) - (1 - x) * math.log2(1 - x)


def _toeplitz_hash(bits, out_len, seed):
    """Privacy amplification: multiply the key by a random Toeplitz matrix (mod 2)."""
    n = len(bits)
    rng = np.random.default_rng(seed)
    diag = rng.integers(0, 2, n + out_len - 1)
    idx = np.arange(out_len)[:, None] - np.arange(n)[None, :] + (n - 1)
    T = diag[idx]
    return (T @ np.array(bits)) % 2


def run_e91(p, pairs=4000, eve=0.0, seed=None):
    """
    Full E91 protocol through a noisy channel with an optional intercept-resend
    eavesdropper on Bob's photon. Returns statistics and the final keys.
    """
    pairs = int(min(max(pairs, 200), 50000))
    rng = np.random.default_rng(seed)
    sim = noisy_simulator(p)
    a_idx = rng.integers(0, 3, pairs)
    b_idx = rng.integers(0, 3, pairs)
    eve_on = rng.random(pairs) < float(eve)
    e_idx = rng.integers(0, 2, pairs)

    # group identical settings into one circuit each, then scatter results back
    groups = {}
    for i in range(pairs):
        key = (a_idx[i], b_idx[i], int(eve_on[i]), e_idx[i] if eve_on[i] else 0)
        groups.setdefault(key, []).append(i)
    circuits, keys = [], []
    for key in groups:
        ai, bi, on, ei = key
        qc = QuantumCircuit(2, 3)
        qc.h(0)
        qc.cx(0, 1)
        if on:  # Eve measures Bob's photon in her basis and resends what she saw
            qc.ry(-EVE_BASES[ei], 1)
            qc.measure(1, 2)
            qc.ry(EVE_BASES[ei], 1)
        qc.ry(-ALICE_BASES[ai], 0)
        qc.ry(-BOB_BASES[bi], 1)
        qc.measure(0, 0)
        qc.measure(1, 1)
        circuits.append(transpile(qc, sim))
        keys.append(key)
    alice = np.zeros(pairs, dtype=int)
    bob = np.zeros(pairs, dtype=int)
    # run each group with shots = group size and memory=True for per-pair results
    for qc, key in zip(circuits, keys):
        members = groups[key]
        mem = sim.run(qc, shots=len(members), memory=True).result().get_memory()
        for i, m in zip(members, mem):
            alice[i] = int(m[-1])
            bob[i] = int(m[-2])

    A, B = np.array(ALICE_BASES)[a_idx], np.array(BOB_BASES)[b_idx]
    same = np.isclose(A, B)
    chsh_mask = np.isin(a_idx, [0, 2]) & np.isin(b_idx, [0, 2])

    def E(ai, bi):
        m = (a_idx == ai) & (b_idx == bi)
        n = m.sum()
        return 0.0 if n == 0 else float(np.mean(np.where(alice[m] == bob[m], 1, -1)))

    S = E(0, 0) - E(0, 2) + E(2, 0) + E(2, 2)

    key_a, key_b = alice[same], bob[same]
    n_sift = int(same.sum())
    # sacrifice a random 20 % of the sifted key to estimate the error rate
    sample = rng.random(n_sift) < 0.2
    qber = float(np.mean(key_a[sample] != key_b[sample])) if sample.any() else 0.0
    key_a, key_b = key_a[~sample], key_b[~sample]
    n_raw = len(key_a)

    leak = int(math.ceil(1.16 * _binary_entropy(qber) * n_raw))
    final_len = int(math.floor(n_raw * (1 - _binary_entropy(qber)) - leak))
    out = {
        "S": S, "qber": qber, "n_pairs": pairs, "n_sift": n_sift, "n_chsh": int(chsh_mask.sum()),
        "n_discard": int(pairs - n_sift - chsh_mask.sum()), "n_sample": int(sample.sum()),
        "leak_bits": leak, "final_bits": max(final_len, 0),
    }
    if abs(S) <= 2:
        out.update(secure=False, reason=f"|S| = {abs(S):.3f} <= 2: no proof of entanglement (noise or eavesdropper).")
        return out
    if qber >= 0.11 or final_len <= 0:
        out.update(secure=False, reason=f"QBER {qber * 100:.1f} % is too high: no secret key can be extracted.")
        return out
    # error correction (assumed ideal, cost counted in 'leak'): Bob's key becomes Alice's key
    corrected_b = key_a.copy()
    seed_pa = int(rng.integers(0, 2**31))
    fa = _toeplitz_hash(key_a, final_len, seed_pa)
    fb = _toeplitz_hash(corrected_b, final_len, seed_pa)
    to_hex = lambda bits: "".join(f"{int(''.join(map(str, bits[i:i + 4])).ljust(4, '0'), 2):x}" for i in range(0, min(len(bits), 128), 4))
    out.update(secure=True, key_alice=to_hex(fa) + ("…" if final_len > 128 else ""),
               key_bob=to_hex(fb) + ("…" if final_len > 128 else ""))
    return out
