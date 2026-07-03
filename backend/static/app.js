/* ============================================================
   Garden Planner — vanilla JS SPA
   ============================================================ */

const BED_COLORS = ['#4a7c59','#7c4a4a','#4a5e7c','#7c724a','#6b4a7c','#4a7c72','#7c5c4a','#5a7c4a']

const PLANT_EMOJI = {
  'tomato':'🍅','courgette':'🥒','cucumber':'🥒','potato':'🥔','carrot':'🥕',
  'beetroot':'🫐','onion':'🧅','garlic':'🧄','broccoli':'🥦','cabbage':'🥬',
  'cauliflower':'🥦','kale':'🥬','lettuce':'🥬','spinach':'🥬','leek':'🌱',
  'broad bean':'🫘','french bean':'🫘','runner bean':'🫘','pea':'🫛',
  'pumpkin':'🎃','pepper':'🌶️','aubergine':'🍆','strawberry':'🍓',
  'raspberry':'🍓','parsnip':'🌿','brussels sprout':'🥦','basil':'🌿',
  'parsley':'🌿','mint':'🌿','chives':'🌿',
}
function plantEmoji(name) {
  const key = name.toLowerCase()
  for (const [k, v] of Object.entries(PLANT_EMOJI)) { if (key.includes(k)) return v }
  return '🌱'
}

/* Toast notifications — non-blocking, auto-dismiss */
function showToast(msg, kind = '', ms = 5000) {
  const stack = $('toast-stack')
  if (!stack) return
  const t = document.createElement('div')
  t.className = 'toast' + (kind ? ' ' + kind : '')
  t.textContent = msg
  stack.appendChild(t)
  setTimeout(() => { t.classList.add('fade'); setTimeout(() => t.remove(), 450) }, ms)
}

/* Companion planting check — uses the species' companion_plants / avoid_plants
   free-text lists, matching tokens against other species' names and families
   (case-insensitive, tolerant of plurals like "brassicas"). */
function companionCheck(bed, speciesId) {
  const sp = S.species.find(s => s.id === speciesId)
  if (!sp || !bed) return
  const otherIds = [...new Set(S.placements
    .filter(p => p.bed_id === bed.id && !p.harvested_date && p.species_id !== speciesId)
    .map(p => p.species_id))]
  const others = otherIds.map(id => S.species.find(s => s.id === id)).filter(Boolean)

  const tokenMatch = (tokens, other) => (tokens || '').split(',').some(tok => {
    let t = tok.trim().toLowerCase()
    if (!t) return false
    if (t.endsWith('s')) t = t.slice(0, -1)   // brassicas → brassica, beans → bean
    const name = other.name.toLowerCase()
    const fam = (other.family || '').toLowerCase()
    return name.includes(t) || t.includes(name) || (fam && (fam.includes(t) || t.includes(fam)))
  })

  const warns = [], goods = []
  for (const o of others) {
    if (tokenMatch(sp.avoid_plants, o) || tokenMatch(o.avoid_plants, sp))
      warns.push(`${sp.name} and ${o.name} don't grow well together`)
    else if (tokenMatch(sp.companion_plants, o) || tokenMatch(o.companion_plants, sp))
      goods.push(`${sp.name} + ${o.name} are good companions`)
  }
  warns.slice(0, 2).forEach(w => showToast('⚠️ ' + w + ` (${bed.name})`, 'warn', 7000))
  if (!warns.length) goods.slice(0, 1).forEach(g => showToast('🤝 ' + g, 'good'))
}
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const FAMILIES = ['allium','brassica','cucurbit','fruit','herb','leaf','legume','nightshade','root','other']
const TYPE_ICON = { harvest:'🌾', feed:'🧪', water:'💧', seasonal:'📅' }

/* ---- State ---- */
const S = {
  gardens: [], activeGarden: null,
  beds: [], placements: [], species: [], settings: {},
  selectedBed: null,
  pendingPos: null,    // {x, y} in grid units — where next plant will be dropped
  zoom: 1,
  drawing: null,       // { x1,y1,x2,y2 }
  newBedKind: 'raised',// what a freshly-drawn bed will be: 'raised' or 'container'
  armedSpecies: null,  // species selected in the palette by tap — next tap on a bed plants it (touch-friendly alternative to drag)
  iconDrag: null,      // { placeid, placeindex, placement, bed, startPt, startX, startY, curX, curY }
  plantFilter: '',
  selectedSpecies: null,
  speciesForm: {},
}
const PX = 40   // base pixels per grid unit

/* ============================================================
   API
   ============================================================ */
const api = {
  async req(method, path, body) {
    const r = await fetch('/api' + path, {
      method,
      headers: body ? {'Content-Type':'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) throw new Error(await r.text())
    if (r.status === 204) return null
    return r.json()
  },
  getGardens:           ()     => api.req('GET',  '/gardens/'),
  createGarden:         (d)    => api.req('POST', '/gardens/', d),
  updateGarden:         (id,d) => api.req('PATCH',`/gardens/${id}`, d),
  deleteGarden:         (id)   => api.req('DELETE',`/gardens/${id}`),
  getGardenBeds:        (id)   => api.req('GET',  `/gardens/${id}/beds`),
  getGardenPlacements:  (id)   => api.req('GET',  `/gardens/${id}/placements`),
  createBed:            (gid,d)=> api.req('POST', `/beds/${gid}`, d),
  updateBed:            (id,d) => api.req('PATCH',`/beds/${id}`, d),
  deleteBed:            (id)   => api.req('DELETE',`/beds/${id}`),
  addPlacement:         (bid,d)=> api.req('POST', `/beds/${bid}/placements`, d),
  updatePlacement:      (id,d) => api.req('PATCH',`/beds/placements/${id}`, d),
  deletePlacement:      (id)   => api.req('DELETE',`/beds/placements/${id}`),
  getSpecies:           ()     => api.req('GET',  '/species/'),
  createSpecies:        (d)    => api.req('POST', '/species/', d),
  updateSpecies:        (id,d) => api.req('PATCH',`/species/${id}`, d),
  deleteSpecies:        (id)   => api.req('DELETE',`/species/${id}`),
  getTasks:             (gid)  => api.req('GET',  `/tasks/${gid?'?garden_id='+gid:''}`),
  completeTask:         (key)  => api.req('POST', '/tasks/complete', {key}),
  logHarvest:           (pid,d)=> api.req('POST', `/harvests/${pid}`, d),
  getHarvests:          (gid)  => api.req('GET',  `/harvests/${gid?'?garden_id='+gid:''}`),
  deleteHarvest:        (id)   => api.req('DELETE',`/harvests/${id}`),
  getSuccession:        (pid)  => api.req('GET',  `/tasks/succession/${pid}`),
  getSeasonalTasks:     ()     => api.req('GET',  '/tasks/seasonal'),
  createSeasonalTask:   (d)    => api.req('POST', '/tasks/seasonal', d),
  updateSeasonalTask:   (id,d) => api.req('PATCH',`/tasks/seasonal/${id}`, d),
  deleteSeasonalTask:   (id)   => api.req('DELETE',`/tasks/seasonal/${id}`),
  getSettings:          ()     => api.req('GET',  '/settings/'),
  saveSettings:         (d)    => api.req('POST', '/settings/bulk', d),
  exportData:           ()     => api.req('GET',  '/export/json'),
}

/* ============================================================
   Utils
   ============================================================ */
const $  = id => document.getElementById(id)
const el = (tag, cls, html) => { const e = document.createElement(tag); if(cls) e.className=cls; if(html) e.innerHTML=html; return e }
const snap = v => Math.round(v * 2) / 2
const fmt  = d => new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})
const todayStr = () => new Date().toISOString().split('T')[0]
const numOrNull = v => (v===''||v==null) ? null : Number(v)
const strVal = v => v == null ? '' : String(v)

function showMsg(container, text, isError=false) {
  const d = el('div', isError ? 'save-msg' : 'save-msg')
  d.style.color = isError ? '#dc2626' : 'var(--green)'
  d.style.background = isError ? '#fee2e2' : 'var(--green-light)'
  d.textContent = text
  container.prepend(d)
  setTimeout(() => d.remove(), 3000)
}

/* ============================================================
   Modal
   ============================================================ */
function openModal(html) {
  $('modal-content').innerHTML = html
  $('modal-overlay').classList.remove('hidden')
  const openedAt = Date.now()
  // Guard: ignore backdrop clicks that arrive within 100ms of opening (same event chain)
  $('modal-overlay').onclick = e => {
    if (Date.now() - openedAt < 100) return
    if (e.target === $('modal-overlay')) closeModal()
  }
}
function closeModal() {
  $('modal-overlay').classList.add('hidden')
  $('modal-content').innerHTML = ''
}

/* ============================================================
   Tab switching
   ============================================================ */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===tab))
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-'+tab))
  if (tab==='garden') renderGardenView()
  if (tab==='tasks')  loadTasks()
  if (tab==='plants') renderPlantView()
  if (tab==='seasonal') loadSeasonal()
  if (tab==='journal') loadJournal()
  if (tab==='settings') renderSettings()
}

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)))

/* ============================================================
   Garden selector (header)
   ============================================================ */
function renderGardenSelector() {
  const sel = $('garden-selector')
  sel.innerHTML = ''
  S.gardens.forEach(g => {
    const b = el('button', 'garden-tab' + (S.activeGarden?.id===g.id?' active':''))
    b.textContent = g.name
    b.onclick = () => selectGarden(g)
    sel.appendChild(b)
  })
  // Add garden button
  const addBtn = el('button','btn-ghost')
  addBtn.textContent = '+ New garden'
  addBtn.onclick = () => showNewGardenForm(sel, addBtn)
  sel.appendChild(addBtn)
}

function showNewGardenForm(sel, addBtn) {
  addBtn.classList.add('hidden')
  const form = el('form','inline-form')
  form.innerHTML = `<input placeholder="Garden name" autofocus required>
    <button type="submit" class="btn btn-sm">Add</button>
    <button type="button" class="btn btn-sm">✕</button>`
  form.querySelector('button[type=button]').onclick = () => { form.remove(); addBtn.classList.remove('hidden') }
  form.onsubmit = async e => {
    e.preventDefault()
    const name = form.querySelector('input').value.trim()
    if (!name) return
    const g = await api.createGarden({ name })
    S.gardens.push(g)
    selectGarden(g)
    renderGardenSelector()
  }
  sel.insertBefore(form, addBtn)
}

async function selectGarden(g) {
  S.activeGarden = g
  S.selectedBed = null
  ;[S.beds, S.placements] = await Promise.all([
    api.getGardenBeds(g.id),
    api.getGardenPlacements(g.id),
  ])
  renderGardenSelector()
  renderGardenView()
}

/* ============================================================
   Garden view — SVG canvas
   ============================================================ */
function renderGardenView() {
  const view = $('view-garden')
  if (!S.activeGarden) {
    view.innerHTML = '<div class="empty-state"><h2>No garden yet</h2><p>Create one using "+ New garden" above.</p></div>'
    return
  }
  view.innerHTML = `
    <div class="garden-layout">
      <div class="canvas-area">
        <div class="canvas-toolbar">
          <span id="canvas-hint">${S.selectedBed ? '<b>' + esc(S.selectedBed.name) + '</b> selected — drag a plant onto it, or click inside to place.' : 'Draw a shape to create a new ' + (S.newBedKind === 'container' ? 'container' : 'raised bed') + ', or click one to select it.'}</span>
          <span class="bed-kind-toggle" id="bed-kind-toggle">
            <button class="kind-btn${S.newBedKind==='raised'?' active':''}" data-kind="raised" title="New shapes become rectangular raised beds">▭ Raised bed</button>
            <button class="kind-btn${S.newBedKind==='container'?' active':''}" data-kind="container" title="New shapes become round containers / pots">⬤ Container</button>
          </span>
          <span id="scale-label"></span>
          <button class="btn btn-secondary btn-sm" id="zoom-out">−</button>
          <span id="zoom-label">${Math.round(S.zoom*100)}%</span>
          <button class="btn btn-secondary btn-sm" id="zoom-in">+</button>
        </div>
        <div class="canvas-scroll">
          <div class="canvas-wrap" id="canvas-wrap">
            <svg class="garden-svg" id="garden-svg"></svg>
          </div>
        </div>
        <div class="plant-palette" id="plant-palette">
          <div class="palette-label">🌱 Drag a plant onto a bed</div>
          <div class="palette-items" id="palette-items"></div>
        </div>
      </div>
      <div class="side-panel" id="side-panel"></div>
    </div>`

  updateScaleLabel()
  $('zoom-in').onclick  = () => { S.zoom = Math.min(3, S.zoom+0.2); redrawCanvas() }
  $('zoom-out').onclick = () => { S.zoom = Math.max(0.3, S.zoom-0.2); redrawCanvas() }
  $('bed-kind-toggle').querySelectorAll('.kind-btn').forEach(btn => {
    btn.onclick = () => {
      S.newBedKind = btn.dataset.kind
      $('bed-kind-toggle').querySelectorAll('.kind-btn').forEach(b => b.classList.toggle('active', b === btn))
      const hint = $('canvas-hint')
      if (hint && !S.selectedBed) hint.innerHTML = 'Draw a shape to create a new ' + (S.newBedKind === 'container' ? 'container' : 'raised bed') + ', or click one to select it.'
    }
  })

  initCanvas()
  renderSidePanel()
  renderPlantPalette()
}

function renderPlantPalette() {
  const el = $('palette-items')
  if (!el) return
  el.innerHTML = S.species.map(sp => {
    const emoji = plantEmoji(sp.name)
    return `<div class="palette-item" draggable="true" data-spid="${sp.id}" title="${esc(sp.name)}">
      <span class="palette-emoji">${emoji}</span>
      <span class="palette-name">${esc(sp.name.split(' ')[0])}</span>
    </div>`
  }).join('')
  // Dragstart: store species id (desktop drag-and-drop)
  el.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('spid', item.dataset.spid)
      e.dataTransfer.effectAllowed = 'copy'
    })
    // Tap to arm/disarm (touch-friendly): armed species plants on the next bed tap
    item.addEventListener('click', () => {
      const sp = S.species.find(s => s.id == item.dataset.spid)
      if (!sp) return
      if (S.armedSpecies?.id === sp.id) {
        S.armedSpecies = null
        showToast('Planting mode off', '', 2000)
      } else {
        S.armedSpecies = sp
        showToast(`${plantEmoji(sp.name)} Tap a bed to plant ${sp.name} — tap the tile again to stop`, 'good', 4500)
      }
      el.querySelectorAll('.palette-item').forEach(i =>
        i.classList.toggle('armed', i.dataset.spid == (S.armedSpecies?.id ?? -1)))
    })
  })
}

function updateScaleLabel() {
  const lbl = $('scale-label')
  if (lbl && S.activeGarden) lbl.textContent = `1 square = ${S.activeGarden.grid_scale_cm} cm`
}

function pxPerUnit() { return PX * S.zoom }

// Which bed is under this point? Containers get a proper ellipse test so the
// corners of their bounding box still count as grass.
function bedAtPoint(pt) {
  return S.beds.find(b => {
    if (pt.x < b.x || pt.x > b.x + b.width || pt.y < b.y || pt.y > b.y + b.height) return false
    if (b.kind === 'container') {
      const nx = (pt.x - b.x - b.width / 2) / (b.width / 2)
      const ny = (pt.y - b.y - b.height / 2) / (b.height / 2)
      return nx * nx + ny * ny <= 1
    }
    return true
  })
}

function svgCoords(e) {
  const svg = $('garden-svg')
  const rect = svg.getBoundingClientRect()
  const px = pxPerUnit()
  return { x: snap((e.clientX-rect.left)/px), y: snap((e.clientY-rect.top)/px) }
}

function initCanvas() {
  redrawCanvas()
  const svg = $('garden-svg')
  if (!svg) return

  let drawMoved = false
  let iconDragMoved = false  // true if we actually moved an icon (to suppress the following click)
  // State for dragging an existing plant icon within a bed
  // S.iconDrag = { placeid, placeindex, placement, bed, curX, curY } — in grid units relative to bed origin
  // curX/curY are updated on every mousemove and used by redrawCanvas to render the ghost

  // Pointer events (not mouse events) so everything also works on touch screens
  svg.addEventListener('pointerdown', e => {
    // Priority 1: dragging an existing plant icon
    const iconEl = e.target.closest('[data-placeid]')
    if (iconEl) {
      e.preventDefault()
      e.stopPropagation()
      try { svg.setPointerCapture(e.pointerId) } catch(_) {}
      const placeid = iconEl.dataset.placeid
      const placeindex = parseInt(iconEl.dataset.placeindex || '0')
      const placement = S.placements.find(p => p.id == placeid)
      const bed = S.beds.find(b => b.id === placement?.bed_id)
      if (!placement || !bed) return
      const pt = svgCoords(e)
      // Compute where this specific icon currently sits in bed-relative coords
      const px2 = pxPerUnit()
      const STEP = 38 / px2
      const bw = bed.width
      const originX = placement.x_pos ?? (pt.x - bed.x)
      const originY = placement.y_pos ?? (pt.y - bed.y)
      const maxCols = Math.max(1, Math.floor((bw - originX - 0.5) / STEP) + 1)
      const iconX = originX + (placeindex % maxCols) * STEP
      const iconY = originY + Math.floor(placeindex / maxCols) * (STEP + 0.1)
      // Store drag state in S so redrawCanvas can render ghost position
      S.iconDrag = { placeid, placeindex, placement, bed,
        startPt: pt, startX: iconX, startY: iconY,
        curX: iconX, curY: iconY }
      svg.style.cursor = 'grabbing'
      redrawCanvas()
      return
    }
    // Priority 2: start drawing a new bed on empty canvas
    if (e.target.closest('[data-bedid]')) return
    e.preventDefault()
    drawMoved = false
    const pt = svgCoords(e)
    S.drawing = { x1:pt.x, y1:pt.y, x2:pt.x, y2:pt.y }
  })

  svg.addEventListener('pointermove', e => {
    // Move icon drag — update position in state and redraw
    if (S.iconDrag) {
      const pt = svgCoords(e)
      const dx = pt.x - S.iconDrag.startPt.x
      const dy = pt.y - S.iconDrag.startPt.y
      if (Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15) iconDragMoved = true
      const bed = S.iconDrag.bed
      S.iconDrag.curX = Math.max(0.3, Math.min(bed.width - 0.3, S.iconDrag.startX + dx))
      S.iconDrag.curY = Math.max(0.3, Math.min(bed.height - 0.3, S.iconDrag.startY + dy))
      redrawCanvas()
      return
    }
    if (!S.drawing) return
    const pt = svgCoords(e)
    if (Math.abs(pt.x - S.drawing.x1) > 0.3 || Math.abs(pt.y - S.drawing.y1) > 0.3) drawMoved = true
    S.drawing.x2 = pt.x; S.drawing.y2 = pt.y
    updatePreviewRect()
  })

  // Also handle release on document so drops outside the SVG are caught
  document.addEventListener('pointerup', async e => {
    if (!S.iconDrag) return
    const drag = S.iconDrag
    S.iconDrag = null
    svg.style.cursor = ''
    const newX = +drag.curX.toFixed(2)
    const newY = +drag.curY.toFixed(2)
    try {
      const { placement } = drag
      if (placement.quantity > 1) {
        const updated = await api.updatePlacement(placement.id, { quantity: placement.quantity - 1 })
        S.placements = S.placements.map(p => p.id == updated.id ? updated : p)
        const newP = await api.addPlacement(drag.bed.id, {
          species_id: placement.species_id,
          planted_date: placement.planted_date,
          quantity: 1,
          notes: placement.notes,
          x_pos: newX, y_pos: newY,
        })
        S.placements.push(newP)
      } else {
        const updated = await api.updatePlacement(placement.id, { x_pos: newX, y_pos: newY })
        S.placements = S.placements.map(p => p.id == updated.id ? updated : p)
      }
    } catch(err) { console.error('icon drag save failed', err) }
    redrawCanvas(); renderSidePanel()
  })

  svg.addEventListener('pointerup', async e => {
    // Icon drag is handled by document pointerup above
    if (S.iconDrag) return
    if (!S.drawing) return
    const pt = svgCoords(e)
    const d = S.drawing; S.drawing = null
    removePreviewRect()
    if (!drawMoved) return
    const x = Math.min(d.x1,pt.x), y = Math.min(d.y1,pt.y)
    const w = Math.abs(pt.x-d.x1), h = Math.abs(pt.y-d.y1)
    if (w < 0.5 || h < 0.5) return
    const color = BED_COLORS[S.beds.length % BED_COLORS.length]
    const kind = S.newBedKind || 'raised'
    const label = kind === 'container' ? 'Pot' : 'Bed'
    const bed = await api.createBed(S.activeGarden.id, { name:`${label} ${S.beds.length+1}`, x, y, width:w, height:h, color, kind })
    S.beds.push(bed)
    S.selectedBed = bed
    redrawCanvas()
    renderSidePanel()
  })

  // click handles bed selection and plant placement (works with touch & simulated clicks)
  svg.addEventListener('click', async e => {
    if (drawMoved) return  // ignore click that ended a draw gesture
    if (iconDragMoved) { iconDragMoved = false; return }  // ignore click that ended an icon drag

    const placementId = e.target.closest('[data-placeid]')?.dataset.placeid
    if (placementId) return  // tapping an icon selects the bed, not a second-click place

    const bedId = e.target.closest('[data-bedid]')?.dataset.bedid
    if (bedId) {
      const bed = S.beds.find(b => b.id == bedId)
      if (!bed) return
      // Armed species from the palette → plant it right where they tapped
      if (S.armedSpecies) {
        const pt = svgCoords(e)
        const xPos = +(Math.max(0.3, Math.min(bed.width - 0.3, pt.x - bed.x))).toFixed(2)
        const yPos = +(Math.max(0.3, Math.min(bed.height - 0.3, pt.y - bed.y))).toFixed(2)
        try {
          const p = await api.addPlacement(bed.id, {
            species_id: S.armedSpecies.id, planted_date: todayStr(),
            quantity: 1, x_pos: +xPos, y_pos: +yPos,
          })
          S.placements.push(p)
          S.selectedBed = bed
          redrawCanvas(); renderSidePanel()
          companionCheck(bed, S.armedSpecies.id)
        } catch(err) { console.error('Tap placement failed', err) }
        return
      }
      if (S.selectedBed?.id == bed.id) {
        // Second click on already-selected bed → place plant at this spot
        const pt = svgCoords(e)
        S.pendingPos = { x: +(pt.x - bed.x).toFixed(2), y: +(pt.y - bed.y).toFixed(2) }
        showPlantPicker()
      } else {
        // First click → select bed
        S.selectedBed = bed
        S.pendingPos = null
        redrawCanvas()
        renderSidePanel()
      }
      return
    }

    // Clicked empty canvas → deselect
    if (S.selectedBed) {
      S.selectedBed = null
      S.pendingPos = null
      redrawCanvas()
      renderSidePanel()
    }
  })

  svg.addEventListener('pointerleave', () => {
    if (S.drawing) { S.drawing=null; drawMoved=false; removePreviewRect() }
  })

  // Drag-and-drop from plant palette onto beds
  svg.addEventListener('dragover', e => {
    e.preventDefault()
    const pt = svgCoords(e)
    const px = pxPerUnit()
    const bed = bedAtPoint(pt)
    // Highlight drop target bed
    svg.querySelectorAll('rect[data-bedid]').forEach(r => {
      const isTarget = bed && r.parentElement.dataset.bedid == bed.id
      r.setAttribute('stroke', isTarget ? '#c8860a' : (S.selectedBed && r.parentElement.dataset.bedid == S.selectedBed.id ? '#c8860a' : '#8B5E3C'))
      r.setAttribute('stroke-width', isTarget ? 5 : (S.selectedBed && r.parentElement.dataset.bedid == S.selectedBed.id ? 4 : 3))
    })
    e.dataTransfer.dropEffect = bed ? 'copy' : 'none'
  })

  svg.addEventListener('dragleave', () => {
    // Reset highlights when leaving SVG
    svg.querySelectorAll('rect[data-bedid]').forEach(r => {
      const isSel = S.selectedBed && r.parentElement.dataset.bedid == S.selectedBed.id
      r.setAttribute('stroke', isSel ? '#c8860a' : '#8B5E3C')
      r.setAttribute('stroke-width', isSel ? 4 : 3)
    })
  })

  svg.addEventListener('drop', async e => {
    e.preventDefault()
    const spid = e.dataTransfer.getData('spid')
    if (!spid) return
    const pt = svgCoords(e)
    const bed = bedAtPoint(pt)
    if (!bed) return
    // Select the bed and place plant at drop position
    S.selectedBed = bed
    const xPos = +(pt.x - bed.x).toFixed(2)
    const yPos = +(pt.y - bed.y).toFixed(2)
    try {
      const p = await api.addPlacement(bed.id, {
        species_id: parseInt(spid),
        planted_date: todayStr(),
        quantity: 1,
        x_pos: xPos,
        y_pos: yPos,
      })
      S.placements.push(p)
      redrawCanvas(); renderSidePanel()
      companionCheck(bed, parseInt(spid))
    } catch(err) { console.error('Drop placement failed', err) }
    // Reset highlights
    svg.querySelectorAll('rect[data-bedid]').forEach(r => {
      const isSel = S.selectedBed && r.parentElement.dataset.bedid == S.selectedBed.id
      r.setAttribute('stroke', isSel ? '#c8860a' : '#8B5E3C')
      r.setAttribute('stroke-width', isSel ? 4 : 3)
    })
  })
}

function redrawCanvas() {
  const svg = $('garden-svg')
  if (!svg || !S.activeGarden) return
  const g = S.activeGarden
  const px = pxPerUnit()
  const W = g.width_units*px, H = g.height_units*px
  svg.setAttribute('width', W)
  svg.setAttribute('height', H)
  // Build SVG patterns for grass background and soil beds
  const grassBlades = [
    [4,40,2,30],[9,40,11,28],[16,40,14,31],[22,40,24,29],[29,40,27,32],[35,40,37,27],[39,40,41,31],
    [6,20,4,10],[13,20,15,9],[20,20,18,11],[27,20,29,8],[34,20,32,12],[38,20,40,10],
  ].map(([x1,y1,x2,y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6aad48" stroke-width="1.3" stroke-linecap="round"/>`).join('')

  svg.innerHTML = `
    <defs>
      <pattern id="grass-pat" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
        <rect width="40" height="40" fill="#4a8030"/>
        <rect x="0" y="0" width="20" height="20" fill="#3d7028" opacity="0.5"/>
        <rect x="20" y="20" width="20" height="20" fill="#3d7028" opacity="0.5"/>
        <rect x="10" y="5" width="8" height="8" fill="#559040" opacity="0.4" rx="4"/>
        <rect x="28" y="22" width="6" height="6" fill="#559040" opacity="0.4" rx="3"/>
        ${grassBlades}
      </pattern>
      <pattern id="soil-pat" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
        <rect width="30" height="30" fill="#7a4e28"/>
        <ellipse cx="5" cy="8" rx="3" ry="2" fill="#5c3518" opacity="0.7"/>
        <ellipse cx="18" cy="4" rx="2" ry="1.5" fill="#5c3518" opacity="0.6"/>
        <ellipse cx="25" cy="14" rx="3" ry="2" fill="#5c3518" opacity="0.7"/>
        <ellipse cx="10" cy="22" rx="2" ry="1.5" fill="#5c3518" opacity="0.6"/>
        <ellipse cx="22" cy="25" rx="3" ry="2" fill="#5c3518" opacity="0.7"/>
        <ellipse cx="3" cy="27" rx="1.5" ry="1" fill="#9a6840" opacity="0.5"/>
        <ellipse cx="14" cy="14" rx="2" ry="1.5" fill="#9a6840" opacity="0.4"/>
        <ellipse cx="27" cy="6" rx="1.5" ry="1" fill="#9a6840" opacity="0.5"/>
      </pattern>
      <pattern id="grid" width="${px}" height="${px}" patternUnits="userSpaceOnUse">
        <path d="M ${px} 0 L 0 0 0 ${px}" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#grass-pat)"/>
    <rect width="${W}" height="${H}" fill="url(#grid)" opacity="0.35"/>`

  S.beds.forEach(bed => {
    const bx=bed.x*px, by=bed.y*px, bw=bed.width*px, bh=bed.height*px
    const isSel = S.selectedBed?.id===bed.id
    const bp = S.placements.filter(p=>p.bed_id===bed.id && !p.harvested_date)

    const g = document.createElementNS('http://www.w3.org/2000/svg','g')
    g.dataset.bedid = bed.id
    const isContainer = bed.kind === 'container'

    if (isContainer) {
      // Round container / pot: soil ellipse inside a terracotta rim
      const cxc = bx + bw/2, cyc = by + bh/2
      const rxOuter = bw/2, ryOuter = bh/2
      const rim = document.createElementNS('http://www.w3.org/2000/svg','ellipse')
      rim.setAttribute('cx',cxc); rim.setAttribute('cy',cyc)
      rim.setAttribute('rx',rxOuter); rim.setAttribute('ry',ryOuter)
      rim.setAttribute('fill', '#b5673a')  // terracotta rim
      rim.setAttribute('stroke', isSel ? '#c8860a' : '#8a4a28')
      rim.setAttribute('stroke-width', isSel ? 4 : 3)
      rim.dataset.bedid = bed.id
      rim.style.cursor = isSel ? 'crosshair' : 'pointer'
      g.appendChild(rim)

      const soil = document.createElementNS('http://www.w3.org/2000/svg','ellipse')
      soil.setAttribute('cx',cxc); soil.setAttribute('cy',cyc)
      soil.setAttribute('rx',Math.max(2, rxOuter-5)); soil.setAttribute('ry',Math.max(2, ryOuter-5))
      soil.setAttribute('fill', 'url(#soil-pat)')
      soil.setAttribute('stroke', isSel ? '#e8a020' : '#a07040')
      soil.setAttribute('stroke-width','1.5')
      soil.dataset.bedid = bed.id
      soil.style.cursor = isSel ? 'crosshair' : 'pointer'
      g.appendChild(soil)
    } else {
      // Soil fill with wooden border for raised bed look
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect')
      rect.setAttribute('x',bx); rect.setAttribute('y',by)
      rect.setAttribute('width',bw); rect.setAttribute('height',bh)
      rect.setAttribute('fill', 'url(#soil-pat)')
      rect.setAttribute('stroke', isSel ? '#c8860a' : '#8B5E3C')
      rect.setAttribute('stroke-width', isSel ? 4 : 3)
      rect.setAttribute('rx', 4)
      rect.dataset.bedid = bed.id
      rect.style.cursor = isSel ? 'crosshair' : 'pointer'
      g.appendChild(rect)

      // Inner shadow line for raised-bed plank effect
      const inner = document.createElementNS('http://www.w3.org/2000/svg','rect')
      inner.setAttribute('x',bx+3); inner.setAttribute('y',by+3)
      inner.setAttribute('width',bw-6); inner.setAttribute('height',bh-6)
      inner.setAttribute('fill','none')
      inner.setAttribute('stroke', isSel ? '#e8a020' : '#a07040')
      inner.setAttribute('stroke-width','1.5')
      inner.setAttribute('rx','2')
      inner.style.pointerEvents = 'none'
      g.appendChild(inner)
    }

    // Bed name label on a semi-transparent tag
    const labelBg = document.createElementNS('http://www.w3.org/2000/svg','rect')
    const nameW = bed.name.length * 6 + 10
    labelBg.setAttribute('x',bx+4); labelBg.setAttribute('y',by+3)
    labelBg.setAttribute('width', nameW); labelBg.setAttribute('height',14)
    labelBg.setAttribute('rx',3); labelBg.setAttribute('fill','rgba(0,0,0,0.45)')
    labelBg.style.pointerEvents='none'
    g.appendChild(labelBg)

    const label = document.createElementNS('http://www.w3.org/2000/svg','text')
    label.setAttribute('x',bx+9); label.setAttribute('y',by+13)
    label.setAttribute('font-size',9); label.setAttribute('fill','#fff')
    label.setAttribute('font-weight','700')
    label.style.pointerEvents='none'
    label.textContent = bed.name
    g.appendChild(label)

    // Drop-here hint when selected and empty
    if (isSel && bp.length === 0) {
      const hint = document.createElementNS('http://www.w3.org/2000/svg','text')
      hint.setAttribute('x', bx + bw/2); hint.setAttribute('y', by + bh/2 + 4)
      hint.setAttribute('text-anchor','middle'); hint.setAttribute('font-size', 11)
      hint.setAttribute('fill', 'rgba(255,255,255,0.7)')
      hint.style.pointerEvents='none'
      hint.textContent = 'Drag a plant here or click to place'
      g.appendChild(hint)
    }

    // Plant markers — one emoji circle per individual plant (quantity expands to N icons)
    // First compute a base origin for each placement, then tile N copies from there
    const ICON_STEP = 38  // px between icons in a row
    const ICON_R = 16     // circle radius
    bp.forEach(p => {
      let originX, originY
      if (p.x_pos != null && p.y_pos != null) {
        originX = bx + p.x_pos * px
        originY = by + p.y_pos * px
      } else if (isContainer) {
        // Pots: centre unpositioned plants in a row across the middle
        const unpos = bp.filter(q => q.x_pos == null)
        const idx = unpos.indexOf(p)
        originX = bx + bw/2 - ((unpos.length - 1) * ICON_STEP) / 2 + idx * ICON_STEP
        originY = by + bh/2
      } else {
        const idx = bp.filter(q => q.x_pos == null).indexOf(p)
        const cols = Math.max(1, Math.floor(bw / ICON_STEP))
        originX = bx + ICON_R + 4 + (idx % cols) * ICON_STEP
        originY = by + ICON_R + 14 + Math.floor(idx / cols) * (ICON_STEP + 4)
      }

      const emoji = plantEmoji(p.species_name)
      // How many icons fit in a row from origin before wrapping
      const maxCols = Math.max(1, Math.floor((bx + bw - originX - ICON_R) / ICON_STEP) + 1)

      for (let i = 0; i < p.quantity; i++) {
        const isDragged = S.iconDrag && S.iconDrag.placeid == p.id && S.iconDrag.placeindex === i
        let cx, cy
        if (isDragged) {
          // Render at cursor position during drag
          cx = bx + S.iconDrag.curX * px
          cy = by + S.iconDrag.curY * px
        } else {
          const col = i % maxCols
          const row = Math.floor(i / maxCols)
          cx = originX + col * ICON_STEP
          cy = originY + row * (ICON_STEP + 4)
          cx = Math.max(bx + ICON_R + 2, Math.min(bx + bw - ICON_R - 2, cx))
          cy = Math.max(by + ICON_R + 12, Math.min(by + bh - ICON_R - 2, cy))
        }

        const pg = document.createElementNS('http://www.w3.org/2000/svg','g')
        pg.dataset.placeid = p.id
        pg.dataset.placeindex = i
        pg.dataset.bedid = bed.id
        pg.style.cursor = 'pointer'
        if (isDragged) { pg.style.opacity = '0.85'; pg.style.filter = 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))' }

        const circle = document.createElementNS('http://www.w3.org/2000/svg','circle')
        circle.setAttribute('cx', cx); circle.setAttribute('cy', cy)
        circle.setAttribute('r', ICON_R)
        circle.setAttribute('fill', isDragged ? 'rgba(255,255,200,0.95)' : 'rgba(255,255,255,0.85)')
        circle.setAttribute('stroke', isDragged ? '#e8a020' : (isSel ? '#c8860a' : '#8B5E3C'))
        circle.setAttribute('stroke-width', isDragged ? '2.5' : '1.5')
        pg.appendChild(circle)

        const etext = document.createElementNS('http://www.w3.org/2000/svg','text')
        etext.setAttribute('x', cx); etext.setAttribute('y', cy + 1)
        etext.setAttribute('text-anchor','middle'); etext.setAttribute('dominant-baseline','middle')
        etext.setAttribute('font-size', 18)
        etext.style.pointerEvents = 'none'
        etext.textContent = emoji
        pg.appendChild(etext)

        // Name label only on first icon of each placement to avoid clutter
        if (i === 0) {
          const nameTag = document.createElementNS('http://www.w3.org/2000/svg','text')
          nameTag.setAttribute('x', cx); nameTag.setAttribute('y', cy + ICON_R + 9)
          nameTag.setAttribute('text-anchor','middle'); nameTag.setAttribute('font-size', 8)
          nameTag.setAttribute('fill','rgba(255,255,255,0.95)'); nameTag.setAttribute('font-weight','700')
          nameTag.style.pointerEvents = 'none'
          nameTag.textContent = p.species_name.split(' ')[0].slice(0,8)
          pg.appendChild(nameTag)
        }

        g.appendChild(pg)
      }
    })

    svg.appendChild(g)
  })

  const zl = $('zoom-label'); if(zl) zl.textContent=Math.round(S.zoom*100)+'%'
}

function highlightSelected() {
  const svg = $('garden-svg'); if(!svg) return
  svg.querySelectorAll('rect[data-bedid]').forEach(r => {
    const sw = S.selectedBed && r.parentElement.dataset.bedid == S.selectedBed.id ? 3 : 2
    r.setAttribute('stroke-width', sw)
  })
}

function updatePreviewRect() {
  const svg = $('garden-svg'); if(!svg||!S.drawing) return
  let prev = svg.querySelector('#preview-rect')
  if (!prev) { prev=document.createElementNS('http://www.w3.org/2000/svg','rect'); prev.id='preview-rect'; svg.appendChild(prev) }
  const px=pxPerUnit(), d=S.drawing
  prev.setAttribute('x',Math.min(d.x1,d.x2)*px); prev.setAttribute('y',Math.min(d.y1,d.y2)*px)
  prev.setAttribute('width',Math.abs(d.x2-d.x1)*px); prev.setAttribute('height',Math.abs(d.y2-d.y1)*px)
  prev.setAttribute('fill','rgba(61,122,82,0.25)'); prev.setAttribute('stroke','#3d7a52')
  prev.setAttribute('stroke-width',2); prev.setAttribute('stroke-dasharray','6,3')
}

function removePreviewRect() {
  const p = document.querySelector('#preview-rect'); if(p) p.remove()
}

/* ---- Side panel ---- */
function renderSidePanel() {
  const panel = $('side-panel'); if(!panel) return
  // Refresh toolbar hint whenever selection changes
  const toolbar = $('canvas-hint')
  if (toolbar) toolbar.innerHTML = S.selectedBed
    ? '<b>' + esc(S.selectedBed.name) + '</b> selected — drag a plant onto it, or click inside to place.'
    : 'Click a bed to select it, or draw a rectangle to create a new bed.'
  if (!S.selectedBed) {
    panel.innerHTML = `<div class="panel-section">
      <p class="panel-hint">Click a bed to select it, or draw a rectangle on the canvas to create a new bed.</p>
      <button class="btn btn-primary btn-sm" id="quick-add-bed" style="margin-top:10px">+ Add ${S.newBedKind === 'container' ? 'container' : 'bed'}</button>
      <p class="panel-hint" style="margin-top:6px;font-size:.75rem">Handy on touch screens — adds one you can then resize.</p>
    </div>`
    // Touch-friendly bed creation: place a default-size bed in a free spot
    $('quick-add-bed').onclick = async () => {
      const kind = S.newBedKind || 'raised'
      const w = kind === 'container' ? 2 : 4, h = kind === 'container' ? 2 : 3
      // Find a free position scanning the grid
      const g2 = S.activeGarden
      let x = 1, y = 1
      outer: for (let ty = 1; ty <= g2.height_units - h - 1; ty++) {
        for (let tx = 1; tx <= g2.width_units - w - 1; tx++) {
          const clash = S.beds.some(b => tx < b.x + b.width + 0.5 && tx + w + 0.5 > b.x && ty < b.y + b.height + 0.5 && ty + h + 0.5 > b.y)
          if (!clash) { x = tx; y = ty; break outer }
        }
      }
      const color = BED_COLORS[S.beds.length % BED_COLORS.length]
      const label = kind === 'container' ? 'Pot' : 'Bed'
      const bed = await api.createBed(g2.id, { name: `${label} ${S.beds.length + 1}`, x, y, width: w, height: h, color, kind })
      S.beds.push(bed)
      S.selectedBed = bed
      redrawCanvas(); renderSidePanel()
    }
    return
  }
  const bed = S.selectedBed
  const g = S.activeGarden
  const wm = (bed.width * g.grid_scale_cm / 100).toFixed(1)
  const hm = (bed.height * g.grid_scale_cm / 100).toFixed(1)
  const bp = S.placements.filter(p=>p.bed_id===bed.id)

  panel.innerHTML = `
    <div class="panel-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div id="bed-name-display" style="font-weight:700;font-size:1rem">${esc(bed.name)}</div>
        <button class="btn btn-secondary btn-sm" id="rename-btn">Rename</button>
      </div>
      <div id="rename-form" class="hidden" style="display:flex;gap:6px;margin-bottom:8px">
        <input id="rename-input" value="${esc(bed.name)}" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:6px">
        <button class="btn btn-primary btn-sm" id="rename-save">Save</button>
        <button class="btn btn-secondary btn-sm" id="rename-cancel">✕</button>
      </div>
      <div class="bed-dim">${wm} m × ${hm} m</div>
      <div class="form-row" style="margin-top:8px">
        <div class="form-group">
          <label>Width (m)</label>
          <input type="number" step="0.1" min="0.1" id="bed-w" value="${wm}">
        </div>
        <div class="form-group">
          <label>Height (m)</label>
          <input type="number" step="0.1" min="0.1" id="bed-h" value="${hm}">
        </div>
      </div>
      <div style="margin-top:10px">
        <label style="font-size:.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase">Colour</label>
        <div class="color-row" id="color-row">${BED_COLORS.map(c=>`<div class="color-swatch${bed.color===c?' selected':''}" style="background:${c}" data-color="${c}"></div>`).join('')}</div>
      </div>
      <button class="btn btn-danger btn-sm" id="delete-bed-btn" style="margin-top:10px">Delete bed</button>
    </div>
    <div class="panel-section" style="flex:1">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>Plants</h3>
        <button class="btn btn-primary btn-sm" id="add-plant-btn">+ Add</button>
      </div>
      <div class="placement-list" id="placement-list">
        ${bp.length===0 ? '<p class="panel-hint" style="margin-top:6px">No plants yet.</p>' : ''}
        ${bp.map(p => `
          <div class="placement-item${p.harvested_date?' harvested':''}">
            <div>
              <div class="pi-name">${esc(p.species_name)}${p.variety?` <span class="pi-variety">· ${esc(p.variety)}</span>`:''}${p.quantity>1?' ×'+p.quantity:''}</div>
              <div class="pi-meta">Planted ${fmt(p.planted_date)}${p.harvested_date?' · Finished '+fmt(p.harvested_date):''}</div>
            </div>
            <div class="pi-actions">
              ${!p.harvested_date?`<button class="btn btn-secondary btn-sm" data-harvest="${p.id}" title="Log a harvest">🧺</button>`:`<button class="btn btn-secondary btn-sm" data-unharvest="${p.id}" title="Undo finished">↩</button>`}
              <button class="btn btn-secondary btn-sm" data-del-place="${p.id}" title="Remove">✕</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`

  // Rename
  $('rename-btn').onclick = () => { $('rename-form').classList.remove('hidden'); $('rename-input').focus() }
  $('rename-cancel').onclick = () => $('rename-form').classList.add('hidden')
  $('rename-save').onclick = async () => {
    const name = $('rename-input').value.trim(); if(!name) return
    const updated = await api.updateBed(bed.id, {name})
    S.beds = S.beds.map(b=>b.id===updated.id?updated:b); S.selectedBed=updated
    redrawCanvas(); renderSidePanel()
  }

  // Size inputs
  $('bed-w').onblur = async () => {
    const v=parseFloat($('bed-w').value); if(isNaN(v)||v<=0) return
    const updated = await api.updateBed(bed.id, {width: v*100/g.grid_scale_cm})
    S.beds=S.beds.map(b=>b.id===updated.id?updated:b); S.selectedBed=updated
    redrawCanvas(); renderSidePanel()
  }
  $('bed-h').onblur = async () => {
    const v=parseFloat($('bed-h').value); if(isNaN(v)||v<=0) return
    const updated = await api.updateBed(bed.id, {height: v*100/g.grid_scale_cm})
    S.beds=S.beds.map(b=>b.id===updated.id?updated:b); S.selectedBed=updated
    redrawCanvas(); renderSidePanel()
  }

  // Colors
  $('color-row').querySelectorAll('.color-swatch').forEach(sw => {
    sw.onclick = async () => {
      const updated = await api.updateBed(bed.id,{color:sw.dataset.color})
      S.beds=S.beds.map(b=>b.id===updated.id?updated:b); S.selectedBed=updated
      redrawCanvas(); renderSidePanel()
    }
  })

  // Delete bed
  $('delete-bed-btn').onclick = async () => {
    if (!confirm(`Delete "${bed.name}" and all its plants?`)) return
    await api.deleteBed(bed.id)
    S.beds=S.beds.filter(b=>b.id!==bed.id)
    S.placements=S.placements.filter(p=>p.bed_id!==bed.id)
    S.selectedBed=null; redrawCanvas(); renderSidePanel()
  }

  // Add plant
  $('add-plant-btn').onclick = () => showPlantPicker()

  // Harvest / delete placements
  panel.querySelectorAll('[data-harvest]').forEach(btn => {
    btn.onclick = () => {
      const p = S.placements.find(q => q.id == btn.dataset.harvest)
      if (p) showHarvestModal(p)
    }
  })
  panel.querySelectorAll('[data-unharvest]').forEach(btn => {
    btn.onclick = async () => {
      const updated = await api.updatePlacement(btn.dataset.unharvest, {harvested_date: null})
      S.placements=S.placements.map(p=>p.id===updated.id?updated:p)
      redrawCanvas(); renderSidePanel()
    }
  })
  panel.querySelectorAll('[data-del-place]').forEach(btn => {
    btn.onclick = async () => {
      await api.deletePlacement(btn.dataset.delPlace)
      S.placements=S.placements.filter(p=>p.id!=btn.dataset.delPlace)
      redrawCanvas(); renderSidePanel()
    }
  })
}

/* ============================================================
   Plant picker modal
   ============================================================ */
let pickerSelected = null

function showPlantPicker() {
  pickerSelected = null
  const filtered = S.species

  openModal(`
    <h2>Add plant</h2>
    <p class="subtitle">Search and select a plant, then set planting details.</p>
    <input id="picker-search" placeholder="Search plants..." style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;font-size:.9rem">
    <div class="picker-list" id="picker-list">${renderPickerItems(filtered,'')}</div>
    <div id="picker-info" class="picker-info hidden"></div>
    <div class="form-row" style="margin-top:8px">
      <div class="form-group">
        <label>Planting date</label>
        <input type="date" id="picker-date" value="${todayStr()}">
      </div>
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" id="picker-qty" value="1" min="1">
      </div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label>Variety (optional)</label>
      <input type="text" id="picker-variety" list="variety-options" placeholder="e.g. Gardener's Delight">
      <datalist id="variety-options"></datalist>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label>Notes (optional)</label>
      <input type="text" id="picker-notes" placeholder="e.g. pot size, position...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="picker-add" disabled>Add plant</button>
    </div>`)

  $('picker-search').oninput = e => {
    const q = e.target.value.toLowerCase()
    $('picker-list').innerHTML = renderPickerItems(S.species, q)
    attachPickerClicks()
  }
  attachPickerClicks()
  $('picker-add').onclick = async () => {
    if (!pickerSelected) return
    const qty = parseInt($('picker-qty').value)||1
    const date = $('picker-date').value
    const variety = $('picker-variety').value.trim()||null
    const notes = $('picker-notes').value||null
    // Create one record per plant so each can be positioned individually
    for (let i = 0; i < qty; i++) {
      const p = await api.addPlacement(S.selectedBed.id, {
        species_id: pickerSelected.id,
        planted_date: date,
        quantity: 1,
        variety,
        notes,
        x_pos: S.pendingPos?.x ?? null,
        y_pos: S.pendingPos?.y ?? null,
      })
      S.placements.push(p)
    }
    S.pendingPos = null
    closeModal(); redrawCanvas(); renderSidePanel()
    companionCheck(S.selectedBed, pickerSelected.id)
  }
}

/* ============================================================
   Harvest logging
   ============================================================ */
function showHarvestModal(p) {
  const UNITS = ['kg', 'g', 'count', 'bunches']
  // Remember the unit last used for this species (courgettes counted, spuds weighed)
  const savedUnit = localStorage.getItem('harvest-unit:' + p.species_id) || 'kg'
  openModal(`
    <h2>🧺 Log harvest</h2>
    <p class="subtitle">${esc(p.species_name)}${p.variety?` · ${esc(p.variety)}`:''} — ${esc(S.beds.find(b=>b.id===p.bed_id)?.name||'')}</p>
    <div class="form-row">
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="hv-date" value="${todayStr()}">
      </div>
      <div class="form-group">
        <label>Amount (optional)</label>
        <div style="display:flex;gap:6px">
          <input type="number" id="hv-qty" min="0" step="any" placeholder="e.g. 1.5" style="flex:1;min-width:0">
          <select id="hv-unit">${UNITS.map(u=>`<option${u===savedUnit?' selected':''}>${u}</option>`).join('')}</select>
        </div>
      </div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label>Notes (optional)</label>
      <input type="text" id="hv-notes" placeholder="e.g. best picking yet">
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer">
      <input type="checkbox" id="hv-finished" style="width:18px;height:18px">
      <span>Plant is finished — remove it from the bed</span>
    </label>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="hv-save">Log harvest</button>
    </div>`)

  $('hv-save').onclick = async () => {
    const qty = parseFloat($('hv-qty').value)
    const unit = $('hv-unit').value
    const finished = $('hv-finished').checked
    try {
      await api.logHarvest(p.id, {
        date: $('hv-date').value,
        quantity: isNaN(qty) ? null : qty,
        unit: isNaN(qty) ? null : unit,
        notes: $('hv-notes').value || null,
        finished,
      })
      if (!isNaN(qty)) localStorage.setItem('harvest-unit:' + p.species_id, unit)
      closeModal()
      showToast('🧺 Harvest logged' + (finished ? ' — plant finished' : ''), 'good')
      if (finished) {
        const updated = { ...p, harvested_date: $('hv-date').value }
        S.placements = S.placements.map(q => q.id === p.id ? updated : q)
        redrawCanvas(); renderSidePanel()
        showSuccessionModal(updated)
      }
    } catch(err) { console.error('harvest log failed', err); showToast('Could not log harvest', 'warn') }
  }
}

function renderPickerItems(list, q) {
  const filtered = q ? list.filter(s=>s.name.toLowerCase().includes(q)||(s.family||'').includes(q)) : list
  if (!filtered.length) return '<div style="padding:10px;color:var(--text-muted);font-size:.85rem">No plants found.</div>'
  return filtered.map(s=>`
    <div class="picker-item${pickerSelected?.id===s.id?' selected':''}" data-spid="${s.id}">
      <span>${esc(s.name)}</span>
      <span class="family-badge">${s.family||''}</span>
    </div>`).join('')
}

function attachPickerClicks() {
  $('picker-list').querySelectorAll('.picker-item').forEach(item => {
    item.onclick = () => {
      const sp = S.species.find(s=>s.id==item.dataset.spid)
      pickerSelected = sp
      $('picker-list').querySelectorAll('.picker-item').forEach(i=>i.classList.remove('selected'))
      item.classList.add('selected')
      $('picker-add').disabled = false
      // Offer varieties previously used for this species
      const dl = $('variety-options')
      if (dl) {
        const used = [...new Set(S.placements
          .filter(p => p.species_id === sp.id && p.variety)
          .map(p => p.variety))]
        dl.innerHTML = used.map(v => `<option value="${esc(v)}">`).join('')
      }
      // Show info
      const info = $('picker-info')
      info.classList.remove('hidden')
      const parts = []
      if (sp.sow_outdoor_start) parts.push(`Sow outdoors: ${MONTHS_SHORT[sp.sow_outdoor_start-1]}–${MONTHS_SHORT[sp.sow_outdoor_end-1]}`)
      if (sp.plant_out_start) parts.push(`Plant out: ${MONTHS_SHORT[sp.plant_out_start-1]}–${MONTHS_SHORT[sp.plant_out_end-1]}`)
      if (sp.spacing_cm) parts.push(`Spacing: ${sp.spacing_cm} cm`)
      if (sp.days_to_harvest_min) parts.push(`Days to harvest: ${sp.days_to_harvest_min}–${sp.days_to_harvest_max}`)
      info.innerHTML = `<strong>${esc(sp.name)}</strong>${parts.length?' — '+parts.join(' · '):''}`
    }
  })
}

/* ============================================================
   Succession modal
   ============================================================ */
async function showSuccessionModal(placement) {
  openModal(`<h2>Succession suggestions</h2>
    <p class="subtitle">${esc(placement.species_name)} harvested. What to plant next in this bed based on crop rotation and current season:</p>
    <div id="succ-list"><em style="color:var(--text-muted)">Loading…</em></div>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>`)
  try {
    const suggestions = await api.getSuccession(placement.id)
    const el = $('succ-list')
    if (!suggestions.length) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem">No suggestions for this time of year — consider a green manure or overwintering cover crop.</p>'
    } else {
      el.innerHTML = suggestions.map(s=>`
        <div class="suggestion-item">
          <div class="s-name">${esc(s.name)}</div>
          <div class="s-meta">
            <span class="family-badge">${s.family}</span>
            ${s.action}
            ${s.days_to_harvest_min ? ` · ${s.days_to_harvest_min}–${s.days_to_harvest_max} days to harvest` : ''}
          </div>
          ${s.notes?`<div class="s-meta" style="margin-top:3px">${esc(s.notes)}</div>`:''}
        </div>`).join('')
    }
  } catch(e) {
    $('succ-list').innerHTML = '<p style="color:#dc2626">Could not load suggestions.</p>'
  }
}

/* ============================================================
   Tasks view
   ============================================================ */
async function loadTasks() {
  const view = $('view-tasks')
  view.innerHTML = '<div class="tasks-view"><h1>Task list</h1><p style="color:var(--text-muted)">Loading…</p></div>'
  const tasks = await api.getTasks(S.activeGarden?.id)
  const now = tasks.filter(t=>t.urgency==='now')
  const soon = tasks.filter(t=>t.urgency==='soon')
  const routine = tasks.filter(t=>t.urgency==='routine')
  const today = new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
  view.innerHTML = `<div class="tasks-view">
    <h1>Task list</h1>
    <div class="tasks-date">${today}</div>
    ${!tasks.length ? '<p style="color:var(--text-muted)">No tasks right now. Add plants to your garden to generate tasks.</p>' : ''}
    ${taskGroup('Do now', now)}
    ${taskGroup('Coming up', soon)}
    ${taskGroup('Routine reminders', routine)}
  </div>`

  // Tick-off buttons: record completion, then refresh the list
  view.querySelectorAll('[data-taskkey]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true
      try {
        await api.completeTask(btn.dataset.taskkey)
        showToast('✓ Done — nice work', 'good', 2500)
        loadTasks()
      } catch(err) { console.error('complete failed', err); btn.disabled = false }
    }
  })
  // Harvest tasks: open the log-harvest modal
  view.querySelectorAll('[data-loghv]').forEach(btn => {
    btn.onclick = () => {
      const p = S.placements.find(q => q.id == btn.dataset.loghv)
      if (p) showHarvestModal(p)
      else showToast('Open the Garden tab first to load plants', 'warn')
    }
  })
}

function taskGroup(title, tasks) {
  if (!tasks.length) return ''
  return `<div class="task-group"><h2>${title}</h2>${tasks.map(taskCard).join('')}</div>`
}

function taskCard(t) {
  const icon = TYPE_ICON[t.type]||'📌'
  return `<div class="task-card ${t.urgency}">
    <div class="task-icon">${icon}</div>
    <div class="task-body">
      <div class="task-title">${esc(t.title)} <span class="badge badge-${t.urgency}">${t.urgency}</span></div>
      <div class="task-desc">${esc(t.description)}</div>
      ${t.bed_name?`<div class="task-meta">📍 ${esc(t.bed_name)}</div>`:''}
    </div>
    ${t.key?`<button class="btn btn-secondary btn-sm task-done-btn" data-taskkey="${esc(t.key)}" title="Mark done">✓</button>`:''}
    ${t.type==='harvest'&&t.placement_id?`<button class="btn btn-secondary btn-sm task-done-btn" data-loghv="${t.placement_id}" title="Log a harvest">🧺</button>`:''}
  </div>`
}

/* ============================================================
   Harvest journal
   ============================================================ */
async function loadJournal() {
  const view = $('view-journal')
  view.innerHTML = '<div class="tasks-view"><h1>📓 Harvest journal</h1><p style="color:var(--text-muted)">Loading…</p></div>'
  const logs = await api.getHarvests(S.activeGarden?.id)
  const year = String(new Date().getFullYear())

  // Year summary — totals per species + variety
  const groups = {}
  logs.filter(l => l.date.startsWith(year)).forEach(l => {
    const k = l.species_name + (l.variety ? ' · ' + l.variety : '')
    groups[k] = groups[k] || { picks: 0, units: {} }
    groups[k].picks++
    if (l.quantity != null && l.unit) groups[k].units[l.unit] = (groups[k].units[l.unit] || 0) + l.quantity
  })
  const summaryRows = Object.entries(groups)
    .sort((a, b) => b[1].picks - a[1].picks)
    .map(([k, g]) => {
      const amounts = Object.entries(g.units).map(([u, q]) => `${+q.toFixed(2)} ${u}`).join(', ')
      return `<div class="journal-summary-row"><span class="js-name">${esc(k)}</span><span class="js-amount">${amounts || '—'} · ${g.picks} picking${g.picks > 1 ? 's' : ''}</span></div>`
    }).join('')

  // Log entries grouped by month, newest first
  const byMonth = {}
  logs.forEach(l => { const m = l.date.slice(0, 7); (byMonth[m] = byMonth[m] || []).push(l) })
  const months = Object.keys(byMonth).sort().reverse()
  const monthName = m => new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  view.innerHTML = `<div class="tasks-view">
    <h1>📓 Harvest journal</h1>
    ${!logs.length ? '<p style="color:var(--text-muted)">Nothing logged yet. Use the 🧺 button on a plant (Garden tab) or on a harvest task to record a picking.</p>' : ''}
    ${summaryRows ? `<div class="task-group"><h2>${year} totals</h2><div class="journal-summary">${summaryRows}</div></div>` : ''}
    ${months.map(m => `<div class="task-group"><h2>${monthName(m)}</h2>${byMonth[m].map(l => `
      <div class="task-card routine">
        <div class="task-icon">🧺</div>
        <div class="task-body">
          <div class="task-title">${esc(l.species_name)}${l.variety ? ` · ${esc(l.variety)}` : ''}${l.quantity != null ? ` — ${l.quantity} ${esc(l.unit || '')}` : ''}</div>
          <div class="task-desc">${fmt(l.date)} · 📍 ${esc(l.bed_name)}${l.notes ? ' · ' + esc(l.notes) : ''}</div>
        </div>
        <button class="btn btn-secondary btn-sm task-done-btn" data-delhv="${l.id}" title="Delete entry">✕</button>
      </div>`).join('')}</div>`).join('')}
  </div>`

  view.querySelectorAll('[data-delhv]').forEach(btn => {
    btn.onclick = async () => {
      await api.deleteHarvest(btn.dataset.delhv)
      showToast('Entry deleted', '', 2000)
      loadJournal()
    }
  })
}

/* ============================================================
   Plant admin
   ============================================================ */
function renderPlantView() {
  const view = $('view-plants')
  const filtered = S.species.filter(s=>s.name.toLowerCase().includes(S.plantFilter.toLowerCase())||(s.family||'').toLowerCase().includes(S.plantFilter.toLowerCase()))
  view.innerHTML = `
    <div class="plant-admin">
      <div class="plant-list-panel">
        <div class="plant-list-header">
          <button class="btn btn-primary btn-sm" id="new-species-btn">+ New plant</button>
          <input placeholder="Search…" value="${esc(S.plantFilter)}" id="species-search">
        </div>
        <div class="plant-list-items" id="species-list">
          ${filtered.map(s=>`
            <div class="plant-list-item${S.selectedSpecies?.id===s.id?' active':''}" data-spid="${s.id}">
              <span>${esc(s.name)}</span><span class="family-badge">${s.family||''}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="plant-detail" id="plant-detail">${S.selectedSpecies ? renderSpeciesForm() : '<p style="color:var(--text-muted);padding:20px">Select a plant or create a new one.</p>'}</div>
    </div>`

  $('species-search').oninput = e => { S.plantFilter=e.target.value; renderPlantView() }
  $('new-species-btn').onclick = () => { S.selectedSpecies=null; renderPlantView() }
  view.querySelectorAll('[data-spid]').forEach(item => {
    item.onclick = () => { S.selectedSpecies=S.species.find(s=>s.id==item.dataset.spid); renderPlantView() }
  })
  if ($('species-form')) attachSpeciesForm()
}

const SF = () => S.speciesForm

function renderSpeciesForm() {
  const s = S.selectedSpecies
  if (s && s.id !== SF()._forId) {
    S.speciesForm = {
      _forId: s.id,
      name:s.name, family:s.family||'',
      sow_indoor_start:strVal(s.sow_indoor_start), sow_indoor_end:strVal(s.sow_indoor_end),
      sow_outdoor_start:strVal(s.sow_outdoor_start), sow_outdoor_end:strVal(s.sow_outdoor_end),
      plant_out_start:strVal(s.plant_out_start), plant_out_end:strVal(s.plant_out_end),
      days_to_harvest_min:strVal(s.days_to_harvest_min), days_to_harvest_max:strVal(s.days_to_harvest_max),
      feeding_notes:s.feeding_notes||'', feeding_frequency_days:strVal(s.feeding_frequency_days),
      watering_notes:s.watering_notes||'', spacing_cm:strVal(s.spacing_cm),
      companion_plants:s.companion_plants||'', avoid_plants:s.avoid_plants||'', notes:s.notes||'',
    }
  } else if (!s) {
    S.speciesForm = { _forId: null, name:'', family:'', sow_indoor_start:'', sow_indoor_end:'', sow_outdoor_start:'', sow_outdoor_end:'', plant_out_start:'', plant_out_end:'', days_to_harvest_min:'', days_to_harvest_max:'', feeding_notes:'', feeding_frequency_days:'', watering_notes:'', spacing_cm:'', companion_plants:'', avoid_plants:'', notes:'' }
  }
  const f = S.speciesForm
  const monthOpts = `<option value="">—</option>${MONTHS_SHORT.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('')}`
  const mSel = (field) => `<select id="sf-${field}">${MONTHS_SHORT.map((m,i)=>`<option value="${i+1}"${f[field]==i+1?' selected':''}>${m}</option>`).join('<option value="">—</option>')}</select>`

  return `<form id="species-form">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="font-size:1.05rem">${s?esc(s.name):'New plant'}</h2>
      <div style="display:flex;gap:6px">
        ${s?`<button type="button" class="btn btn-danger btn-sm" id="del-species-btn">Delete</button>`:''}
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
      </div>
    </div>
    <div id="species-msg"></div>
    <div class="plant-form">
      <div class="form-section">
        <h3>Basic info</h3>
        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label>Name *</label><input id="sf-name" value="${esc(f.name)}" required>
          </div>
          <div class="form-group" style="flex:1">
            <label>Family</label>
            <select id="sf-family">
              <option value="">—</option>
              ${FAMILIES.map(fm=>`<option value="${fm}"${f.family===fm?' selected':''}>${fm}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-top:8px">
          <label>Notes</label>
          <textarea id="sf-notes" rows="2">${esc(f.notes)}</textarea>
        </div>
      </div>
      <div class="form-section">
        <h3>Sowing &amp; planting (UK)</h3>
        ${monthPairRow('Sow indoors','sow_indoor_start','sow_indoor_end',f)}
        ${monthPairRow('Sow outdoors','sow_outdoor_start','sow_outdoor_end',f)}
        ${monthPairRow('Plant out','plant_out_start','plant_out_end',f)}
      </div>
      <div class="form-section">
        <h3>Growing info</h3>
        <div class="form-row">
          <div class="form-group">
            <label>Days to harvest (min)</label>
            <input type="number" id="sf-days_to_harvest_min" value="${f.days_to_harvest_min}">
          </div>
          <div class="form-group">
            <label>Days to harvest (max)</label>
            <input type="number" id="sf-days_to_harvest_max" value="${f.days_to_harvest_max}">
          </div>
        </div>
        <div class="form-group" style="margin-top:8px">
          <label>Spacing (cm)</label>
          <input type="number" id="sf-spacing_cm" value="${f.spacing_cm}">
        </div>
      </div>
      <div class="form-section">
        <h3>Feeding</h3>
        <div class="form-group"><label>Feeding notes</label><textarea id="sf-feeding_notes" rows="2">${esc(f.feeding_notes)}</textarea></div>
        <div class="form-group" style="margin-top:8px"><label>Feed every (days)</label><input type="number" id="sf-feeding_frequency_days" value="${f.feeding_frequency_days}"></div>
      </div>
      <div class="form-section">
        <h3>Watering</h3>
        <div class="form-group"><label>Watering notes</label><textarea id="sf-watering_notes" rows="2">${esc(f.watering_notes)}</textarea></div>
      </div>
      <div class="form-section">
        <h3>Companion planting</h3>
        <div class="form-group"><label>Good companions</label><input id="sf-companion_plants" value="${esc(f.companion_plants)}" placeholder="e.g. Basil, Marigold"></div>
        <div class="form-group" style="margin-top:8px"><label>Avoid near</label><input id="sf-avoid_plants" value="${esc(f.avoid_plants)}" placeholder="e.g. Fennel, Onion"></div>
      </div>
    </div>
  </form>`
}

function monthPairRow(label, startField, endField, f) {
  const opts = `<option value="">—</option>${MONTHS_SHORT.map((m,i)=>`<option value="${i+1}"${f[startField]==i+1?' selected':''}>${m}</option>`).join('')}`
  const optsE = `<option value="">—</option>${MONTHS_SHORT.map((m,i)=>`<option value="${i+1}"${f[endField]==i+1?' selected':''}>${m}</option>`).join('')}`
  return `<div class="form-row" style="margin-bottom:6px">
    <div class="form-group"><label>${label} from</label><select id="sf-${startField}">${opts}</select></div>
    <div class="form-group"><label>${label} to</label><select id="sf-${endField}">${optsE}</select></div>
  </div>`
}

function attachSpeciesForm() {
  const form = $('species-form')
  form.onsubmit = async e => {
    e.preventDefault()
    const readField = id => { const el=document.getElementById('sf-'+id); return el?el.value:'' }
    const payload = {
      name: readField('name'), family: readField('family')||null,
      sow_indoor_start: numOrNull(readField('sow_indoor_start')), sow_indoor_end: numOrNull(readField('sow_indoor_end')),
      sow_outdoor_start: numOrNull(readField('sow_outdoor_start')), sow_outdoor_end: numOrNull(readField('sow_outdoor_end')),
      plant_out_start: numOrNull(readField('plant_out_start')), plant_out_end: numOrNull(readField('plant_out_end')),
      days_to_harvest_min: numOrNull(readField('days_to_harvest_min')), days_to_harvest_max: numOrNull(readField('days_to_harvest_max')),
      feeding_notes: readField('feeding_notes')||null, feeding_frequency_days: numOrNull(readField('feeding_frequency_days')),
      watering_notes: readField('watering_notes')||null, spacing_cm: numOrNull(readField('spacing_cm')),
      companion_plants: readField('companion_plants')||null, avoid_plants: readField('avoid_plants')||null,
      notes: readField('notes')||null, is_custom: true,
    }
    try {
      let result
      if (S.selectedSpecies) {
        result = await api.updateSpecies(S.selectedSpecies.id, payload)
        S.species = S.species.map(s=>s.id===result.id?result:s)
      } else {
        result = await api.createSpecies(payload)
        S.species.push(result)
        S.species.sort((a,b)=>a.name.localeCompare(b.name))
      }
      S.selectedSpecies = result
      S.speciesForm._forId = null // force re-read
      renderPlantView()
      const msgEl = $('species-msg'); if(msgEl){ showMsg(msgEl, S.selectedSpecies?'Saved!':'Plant added!') }
    } catch(err) {
      const msgEl=$('species-msg'); if(msgEl) showMsg(msgEl,'Error: '+err.message, true)
    }
  }
  const delBtn = $('del-species-btn')
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!S.selectedSpecies) return
      if (!confirm(`Delete "${S.selectedSpecies.name}"?`)) return
      try {
        await api.deleteSpecies(S.selectedSpecies.id)
        S.species = S.species.filter(s=>s.id!==S.selectedSpecies.id)
        S.selectedSpecies = null
        renderPlantView()
      } catch(err) { alert('Cannot delete: '+err.message) }
    }
  }
}

/* ============================================================
   Seasonal tasks
   ============================================================ */
async function loadSeasonal() {
  const tasks = await api.getSeasonalTasks()
  renderSeasonal(tasks)
}

// Sow / plant-out / harvest windows for the crops actually in this garden —
// not the whole plant database. Lets the calendar act as a year planner.
function plantCalendarEvents() {
  const events = []  // {month, icon, title, desc}
  const active = S.placements.filter(p => !p.harvested_date)
  const speciesIds = [...new Set(active.map(p => p.species_id))]
  const short = m => MONTH_NAMES[m-1].slice(0,3)
  const rangeLabel = (a,b) => a===b ? MONTH_NAMES[a-1] : `${short(a)}–${short(b)}`

  speciesIds.forEach(id => {
    const sp = S.species.find(s => s.id === id)
    if (!sp) return
    const win = (a, b, icon, verb) => {
      if (!a || !b) return
      for (let m = a; m <= b; m++)
        events.push({ month: m, icon, title: `${verb} ${sp.name}`, desc: `Window: ${rangeLabel(a,b)}` })
    }
    win(sp.sow_indoor_start,  sp.sow_indoor_end,  '🌱', 'Sow indoors —')
    win(sp.sow_outdoor_start, sp.sow_outdoor_end, '🌱', 'Sow outdoors —')
    win(sp.plant_out_start,   sp.plant_out_end,   '🪴', 'Plant out —')
  })

  // Expected harvest windows from what's actually planted
  const seen = new Set()
  active.forEach(p => {
    const sp = S.species.find(s => s.id === p.species_id)
    if (!sp?.days_to_harvest_min || !sp?.days_to_harvest_max) return
    const d1 = new Date(p.planted_date); d1.setDate(d1.getDate() + sp.days_to_harvest_min)
    const d2 = new Date(p.planted_date); d2.setDate(d2.getDate() + sp.days_to_harvest_max)
    const dfmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const cur = new Date(d1.getFullYear(), d1.getMonth(), 1)
    while (cur <= d2) {
      const m = cur.getMonth() + 1
      const k = sp.name + ':' + m
      if (!seen.has(k)) {
        seen.add(k)
        events.push({ month: m, icon: '🧺', title: `Harvest ${sp.name}`, desc: `Expected ${dfmt(d1)} – ${dfmt(d2)}` })
      }
      cur.setMonth(cur.getMonth() + 1)
    }
  })
  return events
}

function renderSeasonal(tasks) {
  const view = $('view-seasonal')
  const byMonth = {}
  tasks.forEach(t => { const k=t.month||0; (byMonth[k]||(byMonth[k]=[])).push(t) })
  // Merge in the garden's plant timeline
  const eventsByMonth = {}
  plantCalendarEvents().forEach(ev => { (eventsByMonth[ev.month]||(eventsByMonth[ev.month]=[])).push(ev) })
  const monthKeys = [...new Set([...Object.keys(byMonth), ...Object.keys(eventsByMonth)])].sort((a,b)=>+a-+b)

  view.innerHTML = `<div class="seasonal-view">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <h1>Seasonal calendar</h1>
      <button class="btn btn-primary btn-sm" id="new-seasonal-btn">+ Add task</button>
    </div>
    <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:16px">Your year at a glance: general tasks plus sow, plant-out and harvest windows for the crops in this garden.</p>
    ${monthKeys.map(mk => `
      <div class="seasonal-month">
        <h2>${mk==='0'?'Any time':MONTH_NAMES[+mk-1]}</h2>
        ${(byMonth[mk]||[]).map(t=>`
          <div class="seasonal-item">
            <span style="font-size:1.2rem">📅</span>
            <div class="task-body">
              <div class="task-title">${esc(t.name)}</div>
              ${t.description?`<div class="task-desc">${esc(t.description)}</div>`:''}
              ${t.is_recurring?'<div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">Recurring</div>':''}
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0">
              <button class="btn btn-secondary btn-sm" data-edit-seasonal="${t.id}">Edit</button>
              <button class="btn btn-secondary btn-sm" data-del-seasonal="${t.id}">✕</button>
            </div>
          </div>`).join('')}
        ${(eventsByMonth[mk]||[]).map(ev=>`
          <div class="seasonal-item plant-event">
            <span style="font-size:1.2rem">${ev.icon}</span>
            <div class="task-body">
              <div class="task-title">${esc(ev.title)}</div>
              <div class="task-desc">${esc(ev.desc)}</div>
            </div>
          </div>`).join('')}
      </div>`).join('')}
  </div>`

  $('new-seasonal-btn').onclick = () => showSeasonalForm(null, tasks)
  view.querySelectorAll('[data-edit-seasonal]').forEach(btn => {
    btn.onclick = () => showSeasonalForm(tasks.find(t=>t.id==btn.dataset.editSeasonal), tasks)
  })
  view.querySelectorAll('[data-del-seasonal]').forEach(btn => {
    btn.onclick = async () => {
      const t = tasks.find(t=>t.id==btn.dataset.delSeasonal)
      if (!confirm(`Delete "${t.name}"?`)) return
      await api.deleteSeasonalTask(t.id)
      renderSeasonal(tasks.filter(x=>x.id!==t.id))
    }
  })
}

function showSeasonalForm(task, allTasks) {
  const f = task ? {name:task.name, description:task.description||'', month:task.month||'', is_recurring:task.is_recurring} : {name:'',description:'',month:'',is_recurring:true}
  openModal(`
    <h2>${task?'Edit task':'New seasonal task'}</h2>
    <form id="seasonal-form" style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
      <div class="form-group"><label>Task name *</label><input id="st-name" value="${esc(f.name)}" required autofocus></div>
      <div class="form-group"><label>Description</label><textarea id="st-desc" rows="2">${esc(f.description)}</textarea></div>
      <div class="form-row">
        <div class="form-group">
          <label>Month</label>
          <select id="st-month">
            <option value="">Any time</option>
            ${MONTH_NAMES.map((m,i)=>`<option value="${i+1}"${f.month==i+1?' selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="justify-content:center">
          <label>Recurring</label>
          <input type="checkbox" id="st-recurring" ${f.is_recurring?'checked':''} style="width:20px;height:20px;margin-top:4px">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`)
  $('seasonal-form').onsubmit = async e => {
    e.preventDefault()
    const payload = {
      name: $('st-name').value.trim(),
      description: $('st-desc').value||null,
      month: $('st-month').value ? parseInt($('st-month').value) : null,
      is_recurring: $('st-recurring').checked,
    }
    let updated
    if (task) {
      updated = await api.updateSeasonalTask(task.id, payload)
      renderSeasonal(allTasks.map(t=>t.id===updated.id?updated:t))
    } else {
      updated = await api.createSeasonalTask(payload)
      renderSeasonal([...allTasks, updated].sort((a,b)=>(a.month||0)-(b.month||0)))
    }
    closeModal()
  }
}

/* ============================================================
   Settings
   ============================================================ */
function renderSettings() {
  const view = $('view-settings')
  const g = S.activeGarden
  const s = S.settings
  const wm = g ? (g.width_units*g.grid_scale_cm/100).toFixed(1) : '-'
  const hm = g ? (g.height_units*g.grid_scale_cm/100).toFixed(1) : '-'

  view.innerHTML = `<div class="settings-view">
    <h1>Settings</h1>
    <div id="settings-msg"></div>
    ${g ? `
    <div class="settings-section">
      <h2>Garden: ${esc(g.name)}</h2>
      <div class="form-group"><label>Garden name</label><input id="gs-name" value="${esc(g.name)}"></div>
      <div class="form-group"><label>Grid square size (cm)</label>
        <input type="number" id="gs-scale" value="${g.grid_scale_cm}" min="5" max="500">
        <span style="font-size:.78rem;color:var(--text-muted)">Each square = this many cm. e.g. 30 means 1 square = 30 cm.</span>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Canvas width (squares)</label><input type="number" id="gs-w" value="${g.width_units}" min="5" max="200"></div>
        <div class="form-group"><label>Canvas height (squares)</label><input type="number" id="gs-h" value="${g.height_units}" min="5" max="200"></div>
      </div>
      <div style="font-size:.82rem;color:var(--text-muted)" id="gs-size-preview">Total: ${wm} m × ${hm} m</div>
      <button class="btn btn-primary btn-sm" id="save-garden-btn">Save garden settings</button>
    </div>` : '<p style="color:var(--text-muted)">No garden selected.</p>'}
    <div class="settings-section">
      <h2>UK growing conditions</h2>
      <div class="form-row">
        <div class="form-group"><label>Last frost date</label><input type="date" id="ss-frost-last" value="${s.last_frost_date||''}"></div>
        <div class="form-group"><label>First autumn frost</label><input type="date" id="ss-frost-first" value="${s.first_frost_date||''}"></div>
      </div>
      <div class="form-group"><label>Region / notes</label><input id="ss-region" value="${esc(s.region||'')}" placeholder="e.g. South East England"></div>
      <button class="btn btn-primary btn-sm" id="save-settings-btn">Save</button>
    </div>
    <div class="settings-section">
      <h2>Data backup</h2>
      <p style="font-size:.85rem;color:var(--text-muted)">Export all garden data as a JSON file.</p>
      <button class="btn btn-secondary" id="export-btn">Export JSON backup</button>
    </div>
  </div>`

  if (g) {
    // Live size preview
    const preview = () => {
      const scale = parseFloat($('gs-scale')?.value)||g.grid_scale_cm
      const w = parseInt($('gs-w')?.value)||g.width_units
      const h = parseInt($('gs-h')?.value)||g.height_units
      const el = $('gs-size-preview')
      if(el) el.textContent = `Total: ${(w*scale/100).toFixed(1)} m × ${(h*scale/100).toFixed(1)} m`
    }
    $('gs-scale').oninput = preview; $('gs-w').oninput = preview; $('gs-h').oninput = preview

    $('save-garden-btn').onclick = async () => {
      const updated = await api.updateGarden(g.id, {
        name: $('gs-name').value.trim() || g.name,
        grid_scale_cm: parseFloat($('gs-scale').value),
        width_units: parseInt($('gs-w').value),
        height_units: parseInt($('gs-h').value),
      })
      S.activeGarden = updated
      S.gardens = S.gardens.map(x=>x.id===updated.id?updated:x)
      renderGardenSelector()
      showMsg($('settings-msg'), 'Garden settings saved!')
    }
  }

  $('save-settings-btn').onclick = async () => {
    await api.saveSettings({
      last_frost_date: $('ss-frost-last').value,
      first_frost_date: $('ss-frost-first').value,
      region: $('ss-region').value,
    })
    S.settings = await api.getSettings()
    showMsg($('settings-msg'), 'Settings saved!')
  }

  $('export-btn').onclick = async () => {
    const data = await api.exportData()
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href=url; a.download=`garden-export-${todayStr()}.json`; a.click()
    URL.revokeObjectURL(url)
  }
}

/* ============================================================
   XSS helper
   ============================================================ */
function esc(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
  try {
    ;[S.gardens, S.species, S.settings] = await Promise.all([
      api.getGardens(),
      api.getSpecies(),
      api.getSettings(),
    ])
    if (S.gardens.length > 0) {
      await selectGarden(S.gardens[0])
    } else {
      renderGardenSelector()
      renderGardenView()
    }
  } catch(e) {
    document.querySelector('.app-main').innerHTML =
      `<div class="empty-state"><h2>Cannot reach the API</h2><p>Make sure the backend is running on port 8000.<br><code>${e.message}</code></p></div>`
  }
}

init()
