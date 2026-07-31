// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workerSource = readFileSync(
  resolve(import.meta.dirname, '../communityIfcWorker.ts'),
  'utf8',
);
const inventory = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../../../../third_party/ifc/dependencies.json'),
  'utf8',
));
const gitignoreSource = readFileSync(
  resolve(import.meta.dirname, '../../../../.gitignore'),
  'utf8',
);
const parserPath = resolve(
  import.meta.dirname,
  '../assets/ifc/ifc_parser.py',
);
const parserSource = readFileSync(parserPath, 'utf8');

const pythonContract = String.raw`
import ast
import pathlib
import sys

source_path = pathlib.Path(sys.argv[1])
source = source_path.read_text(encoding='utf-8')
tree = ast.parse(source, filename=str(source_path))
parser_class = next(
    node for node in tree.body
    if isinstance(node, ast.ClassDef) and node.name == 'IfcParser'
)
load_method = next(
    node for node in parser_class.body
    if isinstance(node, ast.FunctionDef) and node.name == 'load_model_from_string'
)
contract_tree = ast.Module(
    body=[ast.ClassDef(
        name='IfcParser',
        bases=[],
        keywords=[],
        body=[load_method],
        decorator_list=[],
    )],
    type_ignores=[],
)
ast.fix_missing_locations(contract_tree)

expected_model = object()
received_content = []

class FakeIfcFile:
    @staticmethod
    def from_string(content):
        received_content.append(content)
        return expected_model

class FakeIfcOpenShell:
    file = FakeIfcFile

namespace = {'ifcopenshell': FakeIfcOpenShell}
exec(compile(contract_tree, str(source_path), 'exec'), namespace)

parser = namespace['IfcParser']()
parser.model = None
parser.initialized = False
payload = 'ISO-10303-21;\nDATA;\nENDSEC;\nEND-ISO-10303-21;'

assert parser.load_model_from_string(payload) is True
assert parser.model is expected_model
assert parser.initialized is True
assert received_content == [payload]
print('ok')
`;

const pythonModuleGuardContract = String.raw`
import ast
import pathlib
import sys
import types

source_path = pathlib.Path(sys.argv[1])
source = source_path.read_text(encoding='utf-8')
tree = ast.parse(source, filename=str(source_path))
module_guard = next(
    node for node in reversed(tree.body)
    if isinstance(node, ast.If)
)
contract_tree = ast.Module(body=[module_guard], type_ignores=[])
ast.fix_missing_locations(contract_tree)

calls = []
namespace = {
    '__name__': '__main__',
    'sys': types.SimpleNamespace(platform='emscripten'),
    'main': lambda: calls.append('main'),
}
exec(compile(contract_tree, str(source_path), 'exec'), namespace)

assert calls == []
print('ok')
`;

describe('Community IFC runtime contract', () => {
  it('serves the fetched wheel under its canonical filename', () => {
    const [wheel] = inventory.distributed_artifacts;
    const wheelName = 'ifcopenshell-0.8.3+34a1bc6-cp313-cp313-emscripten_4_0_9_wasm32.whl';

    expect(wheel.path).toBe(`apps/geometry-editor/public/ifc/${wheelName}`);
    expect(gitignoreSource).toContain('apps/geometry-editor/public/ifc/*.whl');
    expect(workerSource).toContain(`const IFC_WHEEL_FILE_NAME = '${wheelName}';`);
    expect(workerSource).toContain(
      '`${import.meta.env.BASE_URL}ifc/${IFC_WHEEL_FILE_NAME}`',
    );
    expect(workerSource).toContain('self.location.origin');
  });

  it('single-sources the worker virtual-file path in the Python bridge', () => {
    expect(
      workerSource.match(/\/tmp\/vulcan-community-input\.ifc/g),
    ).toHaveLength(1);
    expect(workerSource).toContain(
      "with open('${IFC_INPUT_PATH}', 'r') as source_file:",
    );
  });

  it('passes the uploaded IFC content into the browser parser', () => {
    expect(parserSource).not.toContain('/tmp/input.ifc');
    expect(parserSource).toContain(
      'self.model = ifcopenshell.file.from_string(ifc_content)',
    );
    expect(parserSource).toContain(
      'parser.load_model_from_string(ifc_content, pyodide_fs)',
    );
  });

  it.skipIf(spawnSync('python3', ['--version']).status !== 0)(
    'executes the parser method against the supplied content',
    () => {
      const result = spawnSync('python3', ['-c', pythonContract, parserPath], {
        encoding: 'utf8',
      });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('ok');
    },
  );

  it.skipIf(spawnSync('python3', ['--version']).status !== 0)(
    'does not execute the native CLI footer in Pyodide',
    () => {
      const result = spawnSync(
        'python3',
        ['-c', pythonModuleGuardContract, parserPath],
        { encoding: 'utf8' },
      );

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('ok');
    },
  );
});
