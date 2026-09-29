(() => {
  const g = window.__game, o = {};
  // 1: long action label overlap with run button
  const lbl = document.getElementById('actLabel'); const btn = document.getElementById('btnAction');
  btn.classList.remove('hidden'); lbl.textContent = '薪をくべる (12)';
  const a = btn.getBoundingClientRect(), r = document.getElementById('btnRun').getBoundingClientRect(), c = document.getElementById('btnCrouch').getBoundingClientRect();
  const ov = (p, q) => !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top);
  o.actOverRun = ov(a, r); o.actOverCrouch = ov(a, c); o.act = [a.left|0, a.right|0, a.top|0, a.bottom|0]; o.run = [r.left|0, r.right|0, r.top|0, r.bottom|0];
  // 2: trunk sizes vs collider
  o.trunks = g.world.choppables.map((t) => [t.size.x.toFixed(1), t.size.z.toFixed(1), t.col.r]);
  // 3: boat
  const bb = new g.R.camera.constructor(); 
  const THREEBox = g.boat.children[0].geometry; THREEBox.computeBoundingBox();
  o.boatHullMinY = (g.boatBaseY + THREEBox.boundingBox.min.y).toFixed(2); o.boatRimY = (g.boatBaseY + THREEBox.boundingBox.max.y).toFixed(2);
  // 4: tent materials program sharing
  const mats = []; g.tent.traverse((m) => { if (m.isMesh && m.material.onBeforeCompile && m.material.sheen) mats.push(m.material); });
  const props = g.R.r.properties;
  o.tentPrograms = [...new Set(mats.map((m) => props.get(m).currentProgram?.id))];
  o.tentMatCount = new Set(mats).size;
  // 5: overlap inventory vs stats
  const st = document.querySelector('.stats').getBoundingClientRect(); g.state.inv.wood = 3; g.ui.refresh();
  const inv = document.getElementById('inventory').getBoundingClientRect();
  o.statsBottom = st.bottom|0; o.invTop = inv.top|0;
  // 6: menu/photo hit test
  for (const id of ['btnPhoto','btnMenu']) { const b = document.getElementById(id).getBoundingClientRect(); const el = document.elementFromPoint(b.x+b.width/2, b.y+b.height/2); o[id] = el && el.id; }
  // 7: quest vs topright overlap
  const qq = document.getElementById('quest').getBoundingClientRect(), tr = document.getElementById('topright').getBoundingClientRect(), tl = document.getElementById('topleft').getBoundingClientRect();
  o.questOverTL = ov(qq, tl); o.questOverTR = ov(qq, tr);
  return o;
})()
