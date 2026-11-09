MathWorker.js bundles MathJax 3.2.2 under the Apache License 2.0 (MathJax-LICENSE.txt).
The source package and build tool versions are pinned in package-lock.json.

Rebuild from the project root with `npm ci --ignore-scripts` and `npm run build:math`.
tools/math_entry.js selects the base, AMS and newcommand TeX packages and the offline SVG font paths.
No HTML, require, autoload, remote fonts or browser DOM are enabled.

The build renames MathJax's internal Styles.connect map to Styles.styleConnections,
because Qt reserves Function.connect for signal connections. It bundles a plain worker
script for Qt's WorkerScript engine. The installed dependency and Qt globals are unchanged.
