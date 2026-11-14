# Planetary map and route analysis (D)

The planner operates on C's terrain grid in physical map metres. It has no room size, room coordinate model, or dependency on `layerSet.demo`. `coordinates.js` provides one generic map-local Cartesian frame: east is +x, north is -z, and the origin is the centre of the map. A cell is exactly `grid.cellSizeM` metres in both horizontal directions. The 3D map can be enlarged or held in a hand without changing any route cost, distance or position.

## C data used here

The files in `web/public/data/` are copied unchanged from [C's PR #1](https://github.com/mightycha0826/SAMSUNGNASA/pull/1), commit `53a730576dd771a71a5c79a8386768befdabe1e9`. `fixtures/c-data-source.json` records the original Git blob hashes, including the binary grids and images. The regression test checks each file against them. C's processing and interpretation are documented in [DATA.md](https://github.com/kdhkpm11/SAMSUNGNASA/blob/53a730576dd771a71a5c79a8386768befdabe1e9/docs/DATA.md).

- Grid: 512×512, 4 m/cell, 2,048×2,048 m.
- Base and survey site are read from `waypoints`, currently `[247,357]` and `[275,272]`.
- Four map layers: terrain elevation, slope, HiRISE optical, THEMIS night thermal. The thermal view preserves its coarse pixels and labels relative brightness rather than temperature. It does not affect route cost.
- Curiosity's traverse and the two waypoint photographs, RAD and REMS time series are C's observations. They are not live conditions on Mars. Imagery credits remain in `layerset.json` and are shown on the map.

Open `?mock=link` to use the real map with simulated equipment messages; `?mock=1` explicitly selects synthetic terrain. The planner panel lets you select the start/destination or enter a custom start cell. It displays horizontal distance, accumulated ascent/descent and slopes sampled on the supplied grid. The `N`, `H`, `S` mock voice shortcuts also request survey, base and cancellation.

## Route model

Each traversable cell has unit cost `(1 + (slope / 15)²) × riskMultiplier`. Unconfirmed local hazard coverage has multiplier **3**, observed free coverage 1, and obstacles are excluded. Missing elevation/slope and slopes **greater than 20°** are excluded. The 15°/20° values adopt C's proposed planning assumption; they are not a validated Mars human-walking standard. Distance is horizontal map distance. Elevation gain and loss are reported separately, without vertical exaggeration.

Edges connect the 8 neighbouring cell centres. An edge costs its length in metres times the average of its two endpoint costs. Diagonals cannot cut between blocked side cells. Collinear steps are compressed only for display. This computes a minimum on this 8-way graph, without a claim of continuous-space optimality or real-world safety.

A reverse Dijkstra tree is precomputed for every destination. Registered risk changes repair these trees with a zero-heuristic LPA* update. A* answers an active request first if its destination tree is still busy. Work is divided into approximately 6 ms Worker slices, scheduled with MessageChannel. More than 20% changed cells triggers a rebuild; a repair touching more than 25% of the map also falls back to reverse Dijkstra. A change outside the remaining route updates the reusable trees while keeping the current route. A change affecting the route replans it; a newly blocked segment is removed immediately.

The exact choice of route can change after a new destination request or a registered hazard update. Clearing an obstacle outside the current route does not immediately replace the current guidance with a shortcut. Arrival tolerance is 2 map metres and deviation tolerance is 8 map metres; neither is a display/room distance.

## Generic registered hazard input

`Navigation.updateHazard` accepts an obstacle grid only when its `frameId` equals `createGridFrame(layerSet).frameId`. Its `originXZ`, `cellSizeM` and positions must already use the same metre frame, with hazard rows extending toward +z. If a data provider assigns `grid.frameId`, that identifier is used; otherwise an identifier is derived from the map definition. There is no automatic mapping of a local room scan or headset pose onto Mars. Unregistered input leaves the unknown multiplier at 3.

A hazard cell is conservatively expanded by the configurable 0.2 m clearance before intersecting the terrain cells. The effective raster exclusion can be larger than that clearance because a whole intersected terrain cell is excluded. The update event is a snapshot/change contract, so silence does not expire it; older timestamps are rejected.

`nav:route` retains its existing fields and adds `frame: 'map'`, `frameId`, `source: 'planetary-navigation'`, `routeId` and the hazard/data `version`. The route ID stays the same through repairs and changes with a new destination request. Cancellation carries the old destination and route ID. Points and distances use physical map metres. The map draws a piecewise-linear tube through the checked route, preserving its corners instead of rounding them into neighbouring cells.

### Position and guidance ownership

`nav:position` is a live stream of already registered map-metre positions. It accepts `{ point: [x, y, z], frame: 'map', frameId, ts, tracked }`; `ts` is optional Unix milliseconds and `tracked: false` immediately invalidates the position. For compatibility with B's current producer, omitted `frame`/`frameId` still means map metres as documented in INTERFACES.md. Explicit local/foreign frames and older or duplicate timestamps are rejected. Position events time out after `NAV.positionTimeoutMs` (1.5 s, compared with the current 200 ms sending interval), measured from the supplied sample timestamp or receipt time if omitted. Guidance and the explorer marker clear on expiry; a late Worker result cannot announce arrival. A valid new position permits replanning. A start selected in the desktop panel is static and does not expire.

The controller publishes accepted positions and loss as `nav:location` with `point` or `null`, the map frame metadata and the planetary source. The D map uses this event rather than raw device input or the first point of a route. Starting/ending an XR session clears the previous selected position. The provider must retain/relocalize its map anchor after tracking loss; D cannot infer that anchor from a headset pose.

In `app:mode: field`, D cancels its active guidance and does not process route requests, live positions or publish emergency routes over the field guide. Critical alerts remain recorded; returning to Mars mode requests base if a critical alert is still active, and waits for a valid map position. `nav/index.js` initializes this state from the existing core mode. The desktop planning panel is available in Mars mode.

### Integration boundary

The D changes are confined to `map/` and `nav/`. A/B still own sensor-to-map registration and tracking-anchor recovery; unregistered scans remain rejected. Field-planner unknown cost, outside-coverage handling, and weighted-cost-preserving simplification are in `field/` and are not changed here. Its local guide and HUD still need their own integration tests. B's field module may project the planetary route for a demonstration; that projection does not set the planner's metres or costs. This module does not claim physical localization accuracy or headset validation.

## Checks and measured example

```text
cd web
node --test src/nav/navigation.test.js
node src/nav/benchmark.mjs 3
node node_modules/vite/bin/vite.js build
```

On the pinned C map, the base→survey route is **389.71 m**, with **45.32 m ascent**, **0.50 m descent**, and a maximum sampled slope of **14.92°**. C's comparison route is about 390 m. Our route uses a symmetric edge cost and prohibits corner cutting; C's reference is a comparison, not a forced route. Route metrics derive from the 4 m/8 m slope raster and do not resolve smaller rocks or ledges.

Node v24.22.1, Intel Core 3 100U, three runs: two destination trees took 69–87 ms; a cached lookup took 0.13–0.73 ms. A synthetic registered obstacle changing 9 cells on the real C terrain took 57–106 ms to update the full tree plus field, while fresh A* for the single active route took 11–16 ms. Whole-tree repair is not always faster than one-start A*, which is why live requests take priority. Worker scheduling/rendering and Quest hardware are excluded from these timings.

`browser.test.cjs` checks real C loading, physical route distance, rejection of unregistered scans, registered obstacle replanning, layers, emergency return and cancellation. Run a local Vite server first, provide Playwright through Node resolution, and optionally set `CHROME_PATH` and `TEST_URL`.

The original 18 Node checks and nine additional regressions cover position expiry/recovery, frame rejection, field-mode ownership, route identity, rendered route corners, stale Worker errors and delayed samples. On 2026-11-14, all 46 tests across nav/field/scan passed. The extended real-data Chrome/SwiftShader browser test passed, including expiry/recovery and mode isolation; registered-obstacle replanning took 380 ms in that run including UI/Worker scheduling and test waits. Those are PC observations, not latency guarantees or Quest measurements. See [VALIDATION.md](VALIDATION.md) for the verified scope and remaining integration issues.
