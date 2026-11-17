#!/usr/bin/env python3
"""Check patch 0007 on a tight version of EnergyPlus's own AirflowNetwork_Multizone_HorizontalOpening example.

usage: horizontal_opening_check.py --energyplus PATCHED_EXE --source ENERGYPLUS_CHECKOUT --out FRESH_DIR
                                   [--baseline UNPATCHED_EXE] [--wait CMD]

The script derives one input from testfiles/AirflowNetwork_Multizone_HorizontalOpening.idf, run for a full year
on the repository's Chicago TMY3 weather. The upper zone NORTH_ZONE_T keeps two AirflowNetwork links: the open
horizontal opening to NORTH_ZONE below (HORIZONTAL_T) and one envelope crack (SURFACE_14_T) with a coefficient of
1e-5 kg/s at 1 Pa. Its window, other envelope cracks and interzone links are removed (no AirflowNetwork object:
airtight). The net flow through the opening then equals the small crack flow, so the opening runs near zero
pressure difference all year.

Checks:
  1. The patched engine completes the year (design days and run period) with no severe error.
  2. Mass balance: at every timestep the net flow up through the opening equals the net flow out through the
     crack within the input's absolute convergence tolerance (1e-6 kg/s).
  3. With --baseline: the unpatched engine stops with "Too many iterations (SOLVZP)".
--wait is a shell command run before every EnergyPlus run, for hosts that allow one run at a time.
"""
import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

ABSOLUTE_TOLERANCE_KG_S = 1e-6  # the input's AirflowNetwork:SimulationControl absolute convergence tolerance
CRACK_COEFFICIENT = 1e-5
REMOVED = {'Surface_15_T', 'Window2_T', 'Surface_16_T', 'Surface_11_T', 'Surface_3_T', 'DoorInSurface_3_T'}


def run(exe, directory, model, weather, wait):
    if wait:
        subprocess.run(wait, shell=True, check=True)
    directory.mkdir(parents=True)
    subprocess.run([str(exe), '-w', str(weather), '-d', str(directory), str(model)], capture_output=True)
    return (directory / 'eplusout.err').read_text(errors='replace')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--energyplus', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--wait')
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit('output directory exists; choose a fresh path')
    weather = args.source / 'weather/USA_IL_Chicago-OHare.Intl.AP.725300_TMY3.epw'
    convert = args.out / 'convert'
    convert.mkdir(parents=True)
    idf = convert / 'source.idf'
    idf.write_bytes((args.source / 'testfiles/AirflowNetwork_Multizone_HorizontalOpening.idf').read_bytes())
    subprocess.run([str(args.energyplus), '--convert-only', '-d', str(convert), str(idf)], check=True, capture_output=True)
    model = json.loads((convert / 'source.epJSON').read_text())

    surfaces = model['AirflowNetwork:MultiZone:Surface']
    for key in [key for key, value in surfaces.items() if value['surface_name'] in REMOVED]:
        del surfaces[key]
    model['AirflowNetwork:MultiZone:Surface:Crack']['CR-tight'] = {
        'air_mass_flow_coefficient_at_reference_conditions': CRACK_COEFFICIENT, 'air_mass_flow_exponent': 0.667,
        'reference_crack_conditions': 'ReferenceCrackConditions'}
    [crack] = [value for value in surfaces.values() if value['surface_name'] == 'Surface_14_T']
    crack['leakage_component_name'] = 'CR-tight'
    for period in model['RunPeriod'].values():
        period.update(begin_month=1, begin_day_of_month=1, end_month=12, end_day_of_month=31)
    model['Output:Variable'] = {f'check {i}': {'key_value': '*', 'variable_name': name, 'reporting_frequency': 'Timestep'}
                                for i, name in enumerate(['AFN Linkage Node 1 to Node 2 Mass Flow Rate',
                                                          'AFN Linkage Node 2 to Node 1 Mass Flow Rate'])}
    model['OutputControl:Files'] = {'Files': {'output_csv': 'Yes'}}
    tight = args.out / 'tight.epJSON'
    tight.write_text(json.dumps(model, indent=1))

    failures = []
    err = run(args.energyplus, args.out / 'patched', tight, weather, args.wait)
    if 'EnergyPlus Completed Successfully' not in err or ' 0 Severe Errors' not in err:
        failures.append('patched engine did not complete the year without a severe error')
    else:
        rows = list(csv.reader(open(args.out / 'patched/eplusout.csv', newline='')))
        header = rows[0]

        def column(link, direction):
            return header.index(f'{link}:AFN Linkage Node {direction} Mass Flow Rate [kg/s](TimeStep)')

        # HORIZONTAL_T: node 1 NORTH_ZONE_T (its zone), node 2 NORTH_ZONE. SURFACE_14_T: node 1 NORTH_ZONE_T, node 2 outdoors.
        stair = [column('HORIZONTAL_T', d) for d in ('1 to Node 2', '2 to Node 1')]
        envelope = [column('SURFACE_14_T', d) for d in ('1 to Node 2', '2 to Node 1')]
        worst = 0.0
        for row in rows[1:]:
            into_zone = float(row[stair[1]]) - float(row[stair[0]])
            out_of_zone = float(row[envelope[0]]) - float(row[envelope[1]])
            worst = max(worst, abs(into_zone - out_of_zone))
        if worst > ABSOLUTE_TOLERANCE_KG_S:
            failures.append(f'opening and crack flows differ by {worst:.3g} kg/s')
        print(f'patched: completed, {len(rows) - 1} timesteps, |opening - crack| <= {worst:.4g} kg/s')
    if args.baseline:
        base_err = run(args.baseline, args.out / 'baseline', tight, weather, args.wait)
        if 'Too many iterations (SOLVZP)' not in base_err:
            failures.append('unpatched engine did not stop with "Too many iterations (SOLVZP)"')
        else:
            print('baseline: stopped with "Too many iterations (SOLVZP)"')
    if failures:
        print('FAIL: ' + '; '.join(failures))
        sys.exit(1)
    print('PASS')


if __name__ == '__main__':
    main()
