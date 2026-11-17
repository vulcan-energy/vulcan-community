# Vulcan's EnergyPlus patches

Vulcan's overheating engine is EnergyPlus 26.1.0 (source commit
`6f2e40d10250a105b49966baa24d843711e61048`) with two patches, applied in order:

- `0006-afn-zero-leakage.patch`: zero AirflowNetwork leakage.
- `0007-afn-horizontal-opening-laminar.patch`: a laminar regime for the AirflowNetwork horizontal opening.

Vulcan carries the patches itself; they are not part of upstream EnergyPlus.

# Apply

```sh
git -C EnergyPlus checkout --detach 6f2e40d10250a105b49966baa24d843711e61048
git -C EnergyPlus apply 0006-afn-zero-leakage.patch 0007-afn-horizontal-opening-laminar.patch
```

Vulcan also applies five build-only compatibility patches (0001-0005) from
`islammashaly-auc/browser-energy-simulation` commit
`ccba3147e8d8f21bac567db5061e58208035a613`; they touch no file 0006 or 0007 touches.

# Patch 0006: zero AirflowNetwork leakage

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

## Tests

`tests/sealed_zero_check.py` derives sealed models from EnergyPlus's own
`testfiles/AirflowNetwork3zVent.idf` and runs them for a year on the repository's Chicago
TMY3 weather:

```sh
python3 tests/sealed_zero_check.py --energyplus PATCHED_ENERGYPLUS \
  --source ENERGYPLUS_CHECKOUT --out FRESH_DIR
```

It checks five closed forms: every link to outdoors carries exactly 0 kg/s at every
timestep; with every link at zero the zone temperatures equal EnergyPlus's no-airflow model
of the same building; three zones joined by interzone leakage keep zero net flow per zone;
the same three zones with a different node fixed (the AFN zone objects reordered) give the
same flows, while the fixed node moves from WEST_ZONE to EAST_ZONE; and an unbalanced exhaust
fan in a sealed group stops the run. Result on the patched
26.1.0 build (macOS arm64):

```
PASS: envelope flows exactly 0 in 52560 timesteps (isolated, loop); isolated: all 14 links exactly 0,
|dT| vs no-airflow reference <= 0 K; loop: zone |net| <= 9.74e-07 kg/s; datum: |flow - loop| <= 6.18e-07 kg/s;
fan run stopped.
```

Unpatched 26.1.0 rejects the same inputs at schema validation.

`tests/noop_check.py` runs a list of models on an engine built with and without the patch
and requires byte-identical output. Vulcan runs it at every EnergyPlus re-pin on its
overheating fixtures, measured-house replays and independent-check models (all with a path
to outdoors).

# Patch 0007: laminar regime for the AirflowNetwork horizontal opening

## Why

When it is open, `AirflowNetwork:MultiZone:Component:HorizontalOpening` computes its forced flow with the orifice
law at every pressure difference: `m = rho_up A Cd sqrt(2 |dP| / rho_ave)`, derivative
`rho_up A Cd / sqrt(2 |dP| rho_ave)`. The derivative is infinite as dP goes to 0, and at dP = 0 the code returns 0.
When a model's solution has a near-zero net flow through a large horizontal opening (an open stair), Newton's method
does not settle on that pressure difference and the run stops: "Too many iterations (SOLVZP)". Every other
AirflowNetwork element has a laminar (linear) regime at small pressure differences or a finite derivative at zero;
the horizontal opening has neither. Reported upstream as
[NatLabRockies/EnergyPlus#11945](https://github.com/NatLabRockies/EnergyPlus/issues/11945).

The fix is numerical. The linear branch the patch adds is `generic_crack`'s convention, not a physical laminar law
for a large opening: it caps the Jacobian entry near zero flow so Newton's method converges. It acts only where
|dP| < 2.7e-10 Pa for a stair (flow below about 8e-5 kg/s); there the orifice law is outside its range anyway
(1e-5 kg/s through a 1 m² opening is an air speed of about 1e-5 m/s).

## What the patch changes

`src/EnergyPlus/AirflowNetwork/src/Elements.cpp`, `HorizontalOpening::calculate`: the forced flow gets the
laminar/turbulent switch of `generic_crack`. With `Ct = rho_up A Fact Cd sqrt(2 / rho_ave)` the orifice-law
coefficient, the laminar coefficient is `CDM = Ct sqrt(rho_up) / mu_ave`. This follows `generic_crack`'s laminar
coefficient for that turbulent coefficient, with two differences: it uses the mean viscosity of the two nodes where
`generic_crack` uses the upwind viscosity (about a 1% change in the crossover), and it has no reference-condition
correction (the orifice law has none). The patch's code comment calls it `generic_crack`'s coefficient; this
paragraph is the exact statement. The
laminar flow `CDM dP`, derivative `CDM`, is used where it is smaller than the orifice-law flow, and during linear
initialization, as in `generic_crack`. The buoyancy terms are unchanged. The closed opening (opening factor 0) already
used `generic_crack` and is unchanged.

The switch takes the smaller flow, so flow stays continuous in dP. For a 2 m x 2.2 m stair opening the laminar range
is |dP| < 2.7e-10 Pa (flow below about 8e-5 kg/s). Outside it the code computes exactly what it did before.

Models without a horizontal opening give byte-identical output. Models with one change slightly, because Newton
iterations that pass near zero flow take a different path: on Vulcan's no-op corpus, zone temperatures by at most
1.3e-6 K on 15 of 17 such models, and at most 0.29 K and 0.07 K on two runs of a hand-built reference box, with
identical TM59 and Part O verdicts and exceedance hours wherever assessed.

## Tests

`tests/horizontal_opening_check.py` derives a tight model from EnergyPlus's own
`testfiles/AirflowNetwork_Multizone_HorizontalOpening.idf`: the upper zone NORTH_ZONE_T keeps only the open horizontal
opening and one envelope crack of 1e-5 kg/s at 1 Pa, so the opening carries the small crack flow all year. It runs a
year on the repository's Chicago TMY3 weather:

```sh
python3 tests/horizontal_opening_check.py --energyplus PATCHED_ENERGYPLUS --baseline UNPATCHED_ENERGYPLUS \
  --source ENERGYPLUS_CHECKOUT --out FRESH_DIR
```

It checks that the patched engine completes the year with no severe error, that the net flow through the opening
equals the crack flow at every timestep within the absolute convergence tolerance (1e-6 kg/s), and that the
unpatched engine stops with "Too many iterations (SOLVZP)". Result on the patched 26.1.0 build (macOS arm64):

```
patched: completed, 52560 timesteps, |opening - crack| <= 9.999e-07 kg/s
baseline: stopped with "Too many iterations (SOLVZP)"
PASS
```

The mass-balance check is a solver completion and convergence check, not an analytical solution: the largest
imbalance, 9.999e-7 kg/s, is just inside the 1e-6 kg/s tolerance the solver itself accepts.

`tests/noop_check.py` (below) compares engines with and without 0007. It reports, for each model whose
`eplusout.csv` differs, the largest difference per unit.

# Licence

The patches modify EnergyPlus and are distributed under the EnergyPlus licence in `LICENSE`.
