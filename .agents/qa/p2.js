(async () => {
  const g = window.__game, o = {};
  const ov = (p, q) => !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top);
  for (const id of ['btnPhoto','btnMenu']) { const b = document.getElementById(id).getBoundingClientRect(); const el = document.elementFromPoint(b.x+b.width/2, b.y+b.height/2); o[id] = el && el.id; }
  const btn = document.getElementById('btnAction'); btn.classList.remove('hidden'); document.getElementById('actLabel').textContent = '薪をくべる (12)';
  o.actOverRun = ov(btn.getBoundingClientRect(), document.getElementById('btnRun').getBoundingClientRect());
  o.actOverCrouch = ov(btn.getBoundingClientRect(), document.getElementById('btnCrouch').getBoundingClientRect());
  o.fpsOverAct = ov(btn.getBoundingClientRect(), document.getElementById('fps').getBoundingClientRect());
  const mats = []; g.tent.traverse((m) => { if (m.isMesh && m.material.sheen) mats.push(m.material); });
  o.tentPrograms = [...new Set(mats.map((m) => g.R.r.properties.get(m).currentProgram?.id))].length;
  o.dofPassEnabled = g.R.dofPass.enabled;
  g.togglePhoto(true); await new Promise(r => setTimeout(r, 50));
  o.photoLookVisible = getComputedStyle(document.getElementById('lookzone')).display !== 'none';
  o.photoTopRightHidden = getComputedStyle(document.getElementById('topright')).display === 'none';
  o.dofInPhoto = g.R.dofPass.enabled;
  await new Promise(r => setTimeout(r, 300)); g.input.onTap(); o.photoExitByTap = !g.photo;
  g.fire.addFuel(0.5); g.interact.startIgnite(); g.togglePhoto(true); o.photoBlockedInMinigame = !g.photo; g.interact.close();
  g.fire.addFuel(1); g.fire.ignite(); g.fire.intensity = 1; g.state.inv.fish = 1; g.interact.startCook('fish'); o.fishDuringCook = g.state.inv.fish; g.interact.mode.v = 0.6; g.interact.mode.tap(); o.fishAfter = g.state.inv.fish; o.cooked = g.state.inv.cooked;
  o.trunkCols = Array.isArray(g.world.choppables[0].col) ? g.world.choppables[0].col.length : 1;
  o.berryInstanced = g.world.pickups.find(p => p.type === 'berry').berries.isInstancedMesh;
  for (let i = 0; i < 3; i++) g.frame(1/30);
  return o;
})()
