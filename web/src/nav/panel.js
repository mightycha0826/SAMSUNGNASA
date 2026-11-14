export function createPlanningPanel({ plan, stop }) {
  const root = document.createElement('section'); root.id = 'route-planner'; root.setAttribute('aria-label', 'Planetary route planner');
  root.innerHTML = `<style>
    #route-planner{position:fixed;right:18px;top:18px;width:288px;padding:18px;z-index:10;background:rgba(20,24,32,.5);border:1px solid rgba(69,77,96,.7);border-radius:12px;color:#eef1fa;font:14px/1.5 system-ui;box-sizing:border-box;text-shadow:0 1px 2px rgba(0,0,0,.8);transition:background .2s}
    /* See-through so it does not hide the map behind it; solid again while it is being used. */
    #route-planner:hover,#route-planner:focus-within{background:rgba(20,24,32,.94)}
    #route-planner h2{font-size:17px;margin:0 0 5px}#route-planner p{color:#b8c1d6;margin:4px 0 12px;font-size:12px}
    #route-planner label{display:block;margin:10px 0 4px}#route-planner select,#route-planner input{background:rgba(40,47,64,.6);color:#eef1fa;border:1px solid rgba(91,103,130,.8);border-radius:6px;padding:8px;width:100%;box-sizing:border-box}
    #route-planner .cells{display:flex;gap:8px}#route-planner .cells label{flex:1;min-width:0;font-size:12px}#route-planner button{padding:9px 14px;margin:12px 6px 8px 0;border:0;border-radius:6px;background:#8192ff;color:#101522;cursor:pointer;font-weight:600}#route-planner button.secondary{background:rgba(52,61,82,.75);color:#eef1fa}#route-planner button{text-shadow:none}#route-planner option{background:#282f40}
    #route-planner output{display:block;min-height:40px;font-size:13px;white-space:pre-line}#route-planner small{color:#b8c1d6}
    @media(max-width:800px){#route-planner{top:8px;right:8px;width:242px;padding:12px}}
  </style>
  <h2>Mars route planner</h2><p id="route-dataset">Loading map data…</p>
  <label for="route-start">Start</label><select id="route-start"></select>
  <div class="cells"><label>Column<input id="route-col" type="number" min="0" step="1"></label><label>Row<input id="route-row" type="number" min="0" step="1"></label></div>
  <label for="route-target">Destination</label><select id="route-target"></select>
  <button id="route-plan" type="button">Plan route</button><button id="route-stop" class="secondary" type="button">Cancel</button>
  <output id="route-analysis" aria-live="polite">Select a start and destination.</output>
  <small>Distance: map metres · unknown terrain risk ×3<br>Cells steeper than 20° excluded.</small>`;
  document.body.appendChild(root);
  const get = id => root.querySelector(`#${id}`), start = get('route-start'), target = get('route-target');
  const col = get('route-col'), row = get('route-row'), output = get('route-analysis');
  let waypoints = [];
  const setStart = () => { const wp = waypoints.find(w => w.id === start.value); if (wp) { col.value = wp.cell[0]; row.value = wp.cell[1]; } };
  start.addEventListener('change', setStart);
  for (const input of [col, row]) input.addEventListener('input', () => { start.value = 'custom'; });
  get('route-plan').addEventListener('click', () => {
    const point = [Number(col.value), Number(row.value)];
    if (!col.value || !row.value || !point.every(Number.isInteger) || !target.value || !plan(point, target.value)) output.textContent = 'Choose a valid start cell and destination.';
    else output.textContent = 'Computing route…';
  });
  get('route-stop').addEventListener('click', stop);
  return {
    load(layerSet) {
      waypoints = layerSet.waypoints ?? [];
      start.replaceChildren(); target.replaceChildren();
      for (const wp of waypoints) for (const select of [start, target]) {
        const option = document.createElement('option'); option.value = wp.id; option.textContent = wp.labelEn ?? wp.label ?? wp.id; select.appendChild(option);
      }
      const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Custom cell'; start.appendChild(custom);
      start.value = waypoints.some(w => w.id === 'base') ? 'base' : waypoints[0]?.id ?? 'custom';
      target.value = waypoints.some(w => w.id === 'site1') ? 'site1' : waypoints.at(-1)?.id ?? '';
      col.max = layerSet.grid.cols - 1; row.max = layerSet.grid.rows - 1; setStart();
      get('route-dataset').textContent = `${layerSet.mock ? 'Synthetic example' : layerSet.site?.name ?? 'Map'} · ${layerSet.grid.cols}×${layerSet.grid.rows} · ${layerSet.grid.cellSizeM} m/cell`;
    },
    update(route, analysis) {
      if (route.status === 'ok' && analysis) output.textContent = `Route ${analysis.distanceM.toFixed(1)} m\nAscent ${analysis.ascentM.toFixed(1)} m · descent ${analysis.descentM.toFixed(1)} m\nSlope: mean ${analysis.meanSlopeDeg.toFixed(1)}° · max ${analysis.maxSlopeDeg.toFixed(1)}°`;
      else if (route.status === 'ok') output.textContent = `Route ${route.distanceM.toFixed(1)} m. Elevation metrics unavailable.`;
      else output.textContent = route.status === 'blocked' ? `No traversable route (${route.reason}).` : route.status === 'arrived' ? 'Destination reached.' : 'Route cancelled.';
    },
    setVisible(visible) { root.hidden = !visible; },
    dispose() { root.remove(); },
  };
}
