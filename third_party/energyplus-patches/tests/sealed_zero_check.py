#!/usr/bin/env python3
"""Check patch 0006 on sealed versions of EnergyPlus's own AirflowNetwork3zVent example.

usage: sealed_zero_check.py --energyplus PATCHED_EXE --source ENERGYPLUS_CHECKOUT --out FRESH_DIR

The script derives four inputs from testfiles/AirflowNetwork3zVent.idf (run for a full year on the
repository's Chicago TMY3 weather, windows always closed):

  isolated  every coefficient 0, interzone cracks and the closed interzone door included, so each zone is
            its own sealed group.
  reference the isolated model with every AirflowNetwork object removed: EnergyPlus's own no-airflow case.
  loop      only the envelope coefficients 0; the interzone cracks and closed door keep their values, so
            the three zones form one sealed group with stack-driven exchange between them.
  fan       the loop model with a continuous zone exhaust fan in EAST_ZONE.

Closed forms checked:
  1. Envelope: every link to outdoors carries exactly 0 kg/s in both directions at every timestep, and
     AFN Zone Infiltration and Ventilation volumes are exactly 0 (F = C * dP^n with C = 0).
  2. Mass balance: with zero envelope flow, each zone's net interzone flow is 0 to within the solver's
     absolute convergence tolerance (1e-6 kg/s in this input).
  3. Isolated: every link carries exactly 0 kg/s, so the model has no air exchange at all and its zone
     temperatures equal the no-airflow reference within 1e-4 K.
  4. Fan: a fan that drives net air out of a sealed group has no solution; the run must stop with the
     patch's fatal error.
"""
import argparse
import csv
import re
import subprocess
import sys
from pathlib import Path

ABSOLUTE_TOLERANCE_KG_S = 1e-6  # the input's AirflowNetwork:SimulationControl absolute convergence tolerance
TEMPERATURE_TOLERANCE_K = 1e-4
EXTERIOR_LINKS = ['SURFACE_1', 'WINDOW11', 'WINDOW12', 'SURFACE_2', 'SURFACE_8', 'SURFACE_9', 'SURFACE_14', 'SURFACE_15',
                  'WINDOW2', 'SURFACE_16']
# Node 1 is the surface's zone, node 2 its partner's (testfiles/AirflowNetwork3zVent.idf).
INTERZONE_LINKS = {'SURFACE_3': ('WEST_ZONE', 'NORTH_ZONE'), 'DOORINSURFACE_3': ('WEST_ZONE', 'NORTH_ZONE'),
                   'SURFACE_4': ('WEST_ZONE', 'EAST_ZONE'), 'SURFACE_11': ('EAST_ZONE', 'NORTH_ZONE')}
ZONES = ['WEST_ZONE', 'EAST_ZONE', 'NORTH_ZONE']


def objects(idf):
    """Split an IDF into (class name, text) objects, keeping comments with the object that follows."""
    out, start = [], 0
    for match in re.finditer(r';[^\n]*\n', idf):
        text = idf[start:match.end()]
        body = re.sub(r'!.*', '', text).strip()
        out.append((body.split(',')[0].strip().split(';')[0].strip(), text))
        start = match.end()
    return out, idf[start:]


def set_field(text, comment, value):
    """Replace the value of the field whose IDF comment is `comment`."""
    pattern = re.compile(r'^(\s*)[^,;!\n]*([,;])(\s*!- ' + re.escape(comment) + r'\b)', re.M)
    new, count = pattern.subn(lambda m: f'{m.group(1)}{value}{m.group(2)}{m.group(3)}', text)
    if count != 1:
        raise SystemExit(f'expected one "{comment}" field, found {count}')
    return new


def derive(source):
    items, tail = objects(source)
    edited = []
    for cls, text in items:
        name = re.sub(r'!.*', '', text).split(',')[1].strip() if ',' in re.sub(r'!.*', '', text) else ''
        if cls == 'RunPeriod':
            for field, value in [('Begin Month', 1), ('Begin Day of Month', 1), ('End Month', 12), ('End Day of Month', 31)]:
                text = set_field(text, field, value)
        if cls == 'AirflowNetwork:MultiZone:Zone':
            text = set_field(text, 'Ventilation Control Mode', 'NoVent')
        if cls == 'AirflowNetwork:MultiZone:Surface:Crack' and name == 'CR-1':
            text = set_field(text, 'Air Mass Flow Coefficient at Reference Conditions', 0)
        if cls == 'AirflowNetwork:MultiZone:Component:DetailedOpening' and name == 'WiOpen1':
            text = set_field(text, 'Air Mass Flow Coefficient When Opening is Closed', 0)
        edited.append((cls, name, text))
    outputs = ''.join(f'Output:Variable,*,{v},timestep;\n' for v in [
        'AFN Linkage Node 1 to Node 2 Mass Flow Rate', 'AFN Linkage Node 2 to Node 1 Mass Flow Rate', 'AFN Zone Infiltration Volume',
        'AFN Zone Ventilation Volume']) + 'OutputControl:Files,Yes;\n'

    def join(rows, extra=''):
        return ''.join(text for _, _, text in rows) + tail + outputs + extra

    loop = join(edited)
    isolated_rows = []
    for cls, name, text in edited:
        if cls == 'AirflowNetwork:MultiZone:Surface:Crack' and name == 'CRcri':
            text = set_field(text, 'Air Mass Flow Coefficient at Reference Conditions', 0)
        if cls == 'AirflowNetwork:MultiZone:Component:DetailedOpening' and name == 'DrOpen':
            text = set_field(text, 'Air Mass Flow Coefficient When Opening is Closed', 0)
        isolated_rows.append((cls, name, text))
    isolated = join(isolated_rows)
    reference = join([row for row in isolated_rows if not row[0].startswith('AirflowNetwork:')])
    fan_rows = []
    for cls, name, text in edited:
        if cls == 'AirflowNetwork:MultiZone:Surface' and name == 'Surface_9':
            text = set_field(text, 'Leakage Component Name', 'Sealed Exhaust Fan')
        fan_rows.append((cls, name, text))
    fan = join(fan_rows, '\n'.join([
        'Fan:ZoneExhaust,Sealed Exhaust Fan,,0.6,125,0.02,Sealed Exhaust Inlet,Sealed Exhaust Outlet,General;',
        'ZoneHVAC:EquipmentList,East Equipment,SequentialLoad,Fan:ZoneExhaust,Sealed Exhaust Fan,1,1,,;',
        'ZoneHVAC:EquipmentConnections,EAST_ZONE,East Equipment,,Sealed Exhaust Inlet,East Zone Air Node,East Return Node;',
        'AirflowNetwork:MultiZone:Component:ZoneExhaustFan,Sealed Exhaust Fan,0,0.667;', '']))
    return {'isolated': isolated, 'reference': reference, 'loop': loop, 'fan': fan}


def run(exe, weather, idf_text, out):
    out.mkdir(parents=True)
    (out / 'in.idf').write_text(idf_text)
    result = subprocess.run([str(exe), '-w', str(weather), '-d', str(out), str(out / 'in.idf')], capture_output=True, text=True)
    err = (out / 'eplusout.err').read_text(errors='replace') if (out / 'eplusout.err').exists() else result.stderr
    return result.returncode, err


def table(path):
    with open(path, newline='') as handle:
        rows = list(csv.reader(handle))
    header = [h.strip() for h in rows[0]]
    return {name: [row[i] for row in rows[1:] if len(row) == len(header)] for i, name in enumerate(header)}


def column(data, key, variable):
    matches = [name for name in data if name.upper().startswith(f'{key}:{variable}'.upper()) and '(TimeStep)' in name]
    if len(matches) != 1:
        raise SystemExit(f'expected one {key}:{variable} column, found {matches}')
    return [float(value) for value in data[matches[0]]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--energyplus', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit('output directory exists; choose a fresh path')
    weather = args.source / 'weather/USA_IL_Chicago-OHare.Intl.AP.725300_TMY3.epw'
    inputs = derive((args.source / 'testfiles/AirflowNetwork3zVent.idf').read_text())
    failures, results = [], {}
    for name, text in inputs.items():
        code, err = run(args.energyplus, weather, text, args.out / name)
        severe = int(re.search(r'(\d+) Severe Errors', err).group(1)) if re.search(r'(\d+) Severe Errors', err) else None
        results[name] = (code, err, severe)
        if name != 'fan' and (code != 0 or severe != 0):
            failures.append(f'{name}: exit {code}, severe {severe}')
    if failures:
        raise SystemExit('; '.join(failures))

    data = {name: table(args.out / name / 'eplusout.csv') for name in ['isolated', 'reference', 'loop']}
    for name in ['isolated', 'loop']:
        steps = len(data[name]['Date/Time'])
        if steps != 8760 * 6:
            failures.append(f'{name}: {steps} timesteps, expected {8760 * 6}')
        for link in EXTERIOR_LINKS:
            for direction in ['1 to Node 2', '2 to Node 1']:
                if any(column(data[name], link, f'AFN Linkage Node {direction} Mass Flow Rate')):
                    failures.append(f'{name}: {link} Node {direction} flow is not exactly 0')
        for zone in ZONES:
            for variable in ['AFN Zone Infiltration Volume', 'AFN Zone Ventilation Volume']:
                if any(column(data[name], zone, variable)):
                    failures.append(f'{name}: {zone} {variable} is not exactly 0')
    links = [n.split(':')[0] for n in data['isolated'] if 'AFN Linkage Node 1 to Node 2 Mass Flow Rate' in n]
    for link in links:
        for direction in ['1 to Node 2', '2 to Node 1']:
            if any(column(data['isolated'], link, f'AFN Linkage Node {direction} Mass Flow Rate')):
                failures.append(f'isolated: {link} Node {direction} flow is not exactly 0')
    worst_temperature = 0.0
    for zone in ZONES:
        sealed = column(data['isolated'], zone, 'Zone Mean Air Temperature')
        reference = column(data['reference'], zone, 'Zone Mean Air Temperature')
        worst_temperature = max(worst_temperature, max(abs(a - b) for a, b in zip(sealed, reference)))
    if worst_temperature > TEMPERATURE_TOLERANCE_K:
        failures.append(f'isolated vs reference: zone temperature differs by {worst_temperature} K')
    # Loop: every zone's net interzone flow is 0 within the solver tolerance.
    worst_zone = 0.0
    for zone in ZONES:
        net = [0.0] * len(data['loop']['Date/Time'])
        for link in [n.split(':')[0] for n in data['loop'] if 'AFN Linkage Node 1 to Node 2 Mass Flow Rate' in n]:
            if link in EXTERIOR_LINKS:
                continue
            ends = INTERZONE_LINKS[link]
            if zone not in ends:
                continue
            sign = -1.0 if ends[0] == zone else 1.0
            forward = column(data['loop'], link, 'AFN Linkage Node 1 to Node 2 Mass Flow Rate')
            backward = column(data['loop'], link, 'AFN Linkage Node 2 to Node 1 Mass Flow Rate')
            net = [n + sign * (f - b) for n, f, b in zip(net, forward, backward)]
        worst_zone = max(worst_zone, max(abs(value) for value in net))
    if worst_zone > ABSOLUTE_TOLERANCE_KG_S:
        failures.append(f'loop: zone net interzone flow {worst_zone} kg/s exceeds {ABSOLUTE_TOLERANCE_KG_S}')
    code, err, _ = results['fan']
    if code == 0 or 'has no airflow path to outdoors, and its fans and specified flows do not balance' not in err:
        failures.append('fan: the run did not stop with the sealed-group fatal error')
    if failures:
        raise SystemExit('FAILED: ' + '; '.join(failures))
    print(f'PASS: envelope flows exactly 0 in {8760 * 6} timesteps (isolated, loop); isolated: all {len(links)} links exactly 0, '
          f'|dT| vs no-airflow reference <= {worst_temperature:.3g} K; loop: zone |net| <= {worst_zone:.3g} kg/s; fan run stopped.')


if __name__ == '__main__':
    main()
