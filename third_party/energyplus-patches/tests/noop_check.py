#!/usr/bin/env python3
"""Prove an EnergyPlus patch changes nothing for models it does not target: run every case on the
baseline and the patched engine and require byte-identical output.

usage: noop_check.py --baseline EXE --patched EXE --cases FILE [FILE ...] --out FRESH_DIR [--wait CMD]

Each cases file has one "id<TAB>input<TAB>weather" line per case (blank lines and # comments ignored).
--wait is a shell command run before every EnergyPlus run, for hosts that allow one run at a time.
Every output file must match byte for byte after removing the lines that carry the run's date and
elapsed time. A case whose input and weather are byte-identical to an earlier case's is listed with
"sameInputAs" and not run again. Where eplusout.csv differs, the report gives the largest absolute
difference per unit and the column that has it (csvMaxAbsDiff). Run it at every EnergyPlus re-pin, with
the engine built with and without a patch, on models that have a path to outdoors.
"""
import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

# Lines that differ between two runs of one engine: the run date (YMD=) and timings.
VOLATILE = re.compile(rb'YMD=|Elapsed Time|EnergyPlus Starting|Run Time=|Simulation Time')


def stable(path):
    return b''.join(line for line in path.read_bytes().splitlines(keepends=True) if not VOLATILE.search(line))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def csv_max_diff(baseline, patched):
    """Largest absolute difference between two eplusout.csv files, per unit, with the column that has it."""
    with open(baseline, newline='') as a, open(patched, newline='') as b:
        rows_a, rows_b = list(csv.reader(a)), list(csv.reader(b))
    if rows_a[0] != rows_b[0] or len(rows_a) != len(rows_b):
        return {'shapeDiffers': True}
    worst = {}
    for column, name in enumerate(rows_a[0][1:], 1):
        unit = re.search(r'\[([^\]]*)\]', name).group(1) if '[' in name else ''
        diff = max((abs(float(x[column]) - float(y[column])) for x, y in zip(rows_a[1:], rows_b[1:]) if x[column] and y[column]), default=0.0)
        if diff > worst.get(unit, {}).get('maxAbs', -1.0):
            worst[unit] = {'maxAbs': diff, 'column': name}
    return worst


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--patched', required=True, type=Path)
    parser.add_argument('--cases', required=True, nargs='+', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--wait')
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit('output directory exists; choose a fresh path')
    cases = []
    for file in args.cases:
        for line in file.read_text().splitlines():
            if line.strip() and not line.startswith('#'):
                case_id, case_input, weather = line.split('\t')
                cases.append((case_id, Path(case_input).expanduser(), Path(weather).expanduser()))
    if len({case[0] for case in cases}) != len(cases):
        raise SystemExit('duplicate case ids')
    report = {'baseline': {'path': str(args.baseline), 'sha256': sha(args.baseline)},
              'patched': {'path': str(args.patched), 'sha256': sha(args.patched)}, 'cases': []}
    mismatches = 0
    seen = {}
    for index, (case_id, case_input, weather) in enumerate(cases, 1):
        record = {'id': case_id, 'inputSha256': sha(case_input), 'weatherSha256': sha(weather)}
        key = (record['inputSha256'], record['weatherSha256'])
        if key in seen:
            record['sameInputAs'] = seen[key]
            report['cases'].append(record)
            print(f'[{index}/{len(cases)}] {case_id}: same input as {seen[key]}', flush=True)
            continue
        seen[key] = case_id
        outputs = {}
        for label, exe in [('baseline', args.baseline), ('patched', args.patched)]:
            if args.wait:
                subprocess.run(args.wait, shell=True, check=True)
            directory = args.out / re.sub(r'[^A-Za-z0-9._-]+', '_', case_id) / label
            directory.mkdir(parents=True)
            result = subprocess.run([str(exe), '-w', str(weather), '-d', str(directory), str(case_input)], capture_output=True)
            err = (directory / 'eplusout.err').read_text(errors='replace') if (directory / 'eplusout.err').exists() else ''
            summary = re.search(r'(\d+) Warning; (\d+) Severe Errors', err)
            record[label] = {'exit': result.returncode, 'warnings': int(summary.group(1)) if summary else None,
                             'severe': int(summary.group(2)) if summary else None}
            outputs[label] = directory
        names = sorted({p.name for p in outputs['baseline'].iterdir()} | {p.name for p in outputs['patched'].iterdir()})
        differing = [name for name in names if not ((outputs['baseline'] / name).exists() and (outputs['patched'] / name).exists()
                                                     and stable(outputs['baseline'] / name) == stable(outputs['patched'] / name))]
        record['comparedFiles'] = names
        record['differingFiles'] = differing
        patched_csv = outputs['patched'] / 'eplusout.csv'
        if 'eplusout.csv' in differing and (outputs['baseline'] / 'eplusout.csv').exists() and patched_csv.exists():
            record['csvMaxAbsDiff'] = csv_max_diff(outputs['baseline'] / 'eplusout.csv', patched_csv)
        record['csvSha256'] = sha(patched_csv) if patched_csv.exists() else None
        ok = not differing and record['baseline']['exit'] == 0 and patched_csv.exists()
        record['identical'] = ok
        mismatches += not ok
        report['cases'].append(record)
        status = 'identical' if ok else f"DIFFERS {differing} exit {record['baseline']['exit']}"
        print(f'[{index}/{len(cases)}] {case_id}: {status}', flush=True)
        (args.out / 'noop-report.json').write_text(json.dumps(report, indent=1) + '\n')
    print(f'{len(seen) - mismatches}/{len(seen)} distinct models byte-identical ({len(cases)} cases); report {args.out / "noop-report.json"}')
    sys.exit(1 if mismatches else 0)


if __name__ == '__main__':
    main()
