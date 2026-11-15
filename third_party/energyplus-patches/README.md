# EnergyPlus patch 0006: zero AirflowNetwork leakage

Vulcan's overheating engine is EnergyPlus 26.1.0 (source commit
`6f2e40d10250a105b49966baa24d843711e61048`) with this patch. Vulcan carries the patch
itself; it is not part of upstream EnergyPlus.

## Why

CIBSE TM59:2026 §3.5: "Infiltration should be modelled as zero for new builds and in
retrofits where airtightness is expected to meet new-build standards." Vulcan models
infiltration with AirflowNetwork (AFN) leakage links on the envelope. Unpatched EnergyPlus
cannot set them to zero:

1. The input schema requires a coefficient above 0 for `AirflowNetwork:MultiZone:Surface:Crack`,
   the closed `AirflowNetwork:MultiZone:Component:DetailedOpening` and the off
   `AirflowNetwork:MultiZone:Component:ZoneExhaustFan`.
2. With every path to outdoors at zero, the AFN pressure equations of the sealed zones are
   singular: flows fix the pressure differences between the zones, not their level. The L-U
   factorisation then stops ("FACSKY ... may not be connected ... to an external node").

A small positive coefficient is not a substitute: results change with its value and the
solver does not converge at tight tolerances.

## What the patch changes

- `idd/Energy+.idd.in`: the three coefficients above accept 0 (`\minimum 0`, was
  `\minimum> 0`). The generated schema changes only in those three fields.
- `src/EnergyPlus/AirflowNetwork/src/Solver.cpp`, `Solver::filjac`: after the Jacobian is
  built, the solver groups the nodes joined by links with a nonzero flow derivative. For each
  group with no known-pressure (external) node, it adds 1 to the diagonal of one node.

This is exact. Every link that leaves such a group has a zero derivative, so its flow does
not depend on the group's pressures. If those flows sum to zero, the group's residuals sum to
zero, and the modified system forces that node's pressure correction to zero while every
other equation is unchanged: all flows are the same for any value added. If the flows do not
sum to zero (a fan or specified flow drives net air into or out of a sealed group), no
pressure can balance them; the run stops with a fatal error that names a node of the group.
The test uses the input's absolute airflow convergence tolerance, the same limit the solver
uses to accept a converged node.

When every group reaches a known-pressure node, the patch adds nothing to the matrix, so
results are unchanged.

## Apply

```sh
git -C EnergyPlus checkout --detach 6f2e40d10250a105b49966baa24d843711e61048
git -C EnergyPlus apply 0006-afn-zero-leakage.patch
```

Vulcan also applies five build-only compatibility patches (0001-0005) from
`islammashaly-auc/browser-energy-simulation` commit
`ccba3147e8d8f21bac567db5061e58208035a613`; they touch no file this patch touches.

## Tests

`tests/sealed_zero_check.py` derives sealed models from EnergyPlus's own
`testfiles/AirflowNetwork3zVent.idf` and runs them for a year on the repository's Chicago
TMY3 weather:

```sh
python3 tests/sealed_zero_check.py --energyplus PATCHED_ENERGYPLUS \
  --source ENERGYPLUS_CHECKOUT --out FRESH_DIR
```

It checks four closed forms: every link to outdoors carries exactly 0 kg/s at every
timestep; with every link at zero the zone temperatures equal EnergyPlus's no-airflow model
of the same building; three zones joined by interzone leakage keep zero net flow per zone;
and an unbalanced exhaust fan in a sealed group stops the run. Result on the patched
26.1.0 build (macOS arm64):

```
PASS: envelope flows exactly 0 in 52560 timesteps (isolated, loop); isolated: all 14 links exactly 0,
|dT| vs no-airflow reference <= 0 K; loop: zone |net| <= 9.74e-07 kg/s; fan run stopped.
```

Unpatched 26.1.0 rejects the same inputs at schema validation.

`tests/noop_check.py` runs a list of models on an engine built with and without the patch
and requires byte-identical output. Vulcan runs it at every EnergyPlus re-pin on its
overheating fixtures, measured-house replays and independent-check models (all with a path
to outdoors).

## Licence

The patch modifies EnergyPlus and is distributed under the EnergyPlus licence in `LICENSE`.
