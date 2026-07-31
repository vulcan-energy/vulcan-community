# IfcOpenShell WebAssembly wheel notice

This file travels with
`ifcopenshell-0.8.3+34a1bc6-cp313-cp313-emscripten_4_0_9_wasm32.whl`.

- SHA-256:
  `0092a71cfd56753b16f78541e1b9ea74446c2f51f9cbf0897aeaef615a5c89ab`
- Exact upstream artifact:
  <https://ifcopenshell.github.io/wasm-wheels/ifcopenshell-0.8.3%2B34a1bc6-cp313-cp313-emscripten_4_0_9_wasm32.whl>
- IfcOpenShell source revision:
  <https://github.com/IfcOpenShell/IfcOpenShell/tree/34a1bc6f04c6dfc66915ca5345bfdf78e23447c6>
- Upstream artifact commit:
  <https://github.com/IfcOpenShell/wasm-wheels/commit/d1126cec5b6deec97575e7f66fcb429eb7db605c>

The artifact stored here is byte-for-byte identical to that upstream wheel. The
wheel embeds IfcOpenShell's GNU General Public License version 3 and GNU Lesser
General Public License version 3 texts in its `.dist-info/licenses` directory.

IfcOpenShell is licensed under `LGPL-3.0-or-later`. That is not, however, a
complete licence description of this compiled wheel. The upstream recipe uses
static dependencies, and `_ifcopenshell_wrapper.so` contains identifiable
`CGAL::Nef_polyhedron_3` code. CGAL's Nef_3 package is
`GPL-3.0-or-later`. The combined binary must therefore be handled as a
GPL-inclusive artifact and must not be represented as LGPL-only.

Other exact build inputs include Open CASCADE Technology 7.8.1, FreeType
2.11.1, Boost 1.86.0, libxml2 2.13.8, nlohmann/json 3.6.1, Eigen 3.3.9,
GMP 6.2.1 and MPFR 3.1.6. They retain their own licences. In particular:

> This artifact uses or is based on Open CASCADE Technology facilities.

That statement preserves the prominent notice required by the Open CASCADE
Technology LGPL exception. The exact component inventory, source links and
licence expressions are in
`community/third_party/ifc/dependencies.json`.

Public distribution of this wheel requires the full corresponding-source and
licence/notice bundle for the exact compiled inputs. A source URL alone is not a
substitute for satisfying the applicable object-code distribution conditions.
Do not publicly export this historical wheel. The Public Release Gate must use
an authoritative upstream artifact with exact Corresponding Source or a
replacement whose native and Python build toolchain is fully hash-locked; CGAL
should be excluded if the supported importer does not need it.

The Vulcan IFC parser next to this wheel is separate first-party Home Energy
Foundry Limited work licensed under `AGPL-3.0-only` plus the Vulcan Origin Terms.
