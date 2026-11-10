/*
 * Evolutionary dynamic optimization background.
 *
 * A population of candidate solutions (white dots) evolves on a fitness
 * landscape made of several Gaussian peaks (the glowing contours).
 * Every few seconds the environment changes: peaks move and their heights
 * swap, so the global optimum jumps somewhere else. The population has to
 * re-converge. Random immigrants + log-normal mutation keep enough
 * diversity to track the optimum.
 */
(() => {
  const canvas = document.getElementById('evo-bg');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- parameters --------------------------------------------------------
  const GEN_MS = 450;            // time between generations
  const N_PEAKS = 4;
  const ELITE = 1;               // best individual survives unchanged
  const IMMIGRANT_RATE = 0.08;   // random immigrants per generation
  const PARENT_FRACTION = 0.25;  // truncation selection
  const SIGMA = 0.035;           // base mutation step (fraction of min(W,H))

  let W, H, DPR, size;
  let peaks = [], pop = [];
  let genStart = 0, lastT = 0, nextShift = 0;

  // low-res fitness heat map
  const heat = document.createElement('canvas');
  const hctx = heat.getContext('2d');
  let img, gw, gh;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const randn = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // ---- landscape ---------------------------------------------------------
  function initPeaks() {
    peaks = [];
    for (let i = 0; i < N_PEAKS; i++) {
      const x = rand(0.12, 0.88) * W, y = rand(0.12, 0.88) * H;
      const h = i === 0 ? 1 : rand(0.45, 0.9);
      peaks.push({ x, y, tx: x, ty: y, w: size * rand(0.09, 0.15), h, th: h });
    }
  }

  function fitness(x, y) {
    let f = 0;
    for (const p of peaks) {
      const dx = x - p.x, dy = y - p.y;
      const v = p.h * Math.exp(-(dx * dx + dy * dy) / (2 * p.w * p.w));
      if (v > f) f = v;
    }
    return f;
  }

  function updateLandscape(dt, now) {
    const k = 1 - Math.exp(-dt / 1200);
    for (const p of peaks) {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.h += (p.th - p.h) * k;
    }
    if (now > nextShift) {
      // environment change: move some peaks and shuffle heights
      const n = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const p = peaks[Math.floor(Math.random() * peaks.length)];
        p.tx = rand(0.1, 0.9) * W;
        p.ty = rand(0.1, 0.9) * H;
      }
      if (Math.random() < 0.6) {
        const a = peaks[Math.floor(Math.random() * peaks.length)];
        const b = peaks[Math.floor(Math.random() * peaks.length)];
        [a.th, b.th] = [b.th, a.th];
      }
      nextShift = now + rand(6500, 10000);
    }
  }

  // ---- population --------------------------------------------------------
  function initPop() {
    const n = clamp(Math.round((W * H) / 14000), 40, 110);
    pop = [];
    for (let i = 0; i < n; i++) {
      const x = rand(0, W), y = rand(0, H);
      pop.push({ x, y, fx: x, fy: y, f: 0 });
    }
  }

  function nextGeneration() {
    for (const p of pop) p.f = fitness(p.x, p.y);
    pop.sort((a, b) => b.f - a.f);

    const n = pop.length;
    const mu = Math.max(4, Math.round(n * PARENT_FRACTION));
    const parents = pop.slice(0, mu);
    const next = [];

    for (let i = 0; i < ELITE; i++) {
      const e = parents[i];
      next.push({ x: e.x, y: e.y, fx: e.x, fy: e.y, f: e.f, elite: true });
    }
    const nImm = Math.round(n * IMMIGRANT_RATE);
    for (let i = 0; i < nImm; i++) {
      const x = rand(0, W), y = rand(0, H);
      next.push({ x, y, fx: x, fy: y, f: 0 });
    }
    while (next.length < n) {
      // rank-biased parent choice (favours the top of the sorted list)
      const p = parents[Math.floor(Math.random() * Math.random() * mu)];
      const s = size * SIGMA * Math.exp(0.7 * randn());
      next.push({
        fx: p.x, fy: p.y,
        x: clamp(p.x + randn() * s, 0, W),
        y: clamp(p.y + randn() * s, 0, H),
        f: 0
      });
    }
    pop = next;
  }

  // ---- rendering ---------------------------------------------------------
  function drawHeat() {
    const d = img.data;
    let i = 0;
    for (let gy = 0; gy < gh; gy++) {
      const y = ((gy + 0.5) / gh) * H;
      for (let gx = 0; gx < gw; gx++) {
        const x = ((gx + 0.5) / gw) * W;
        const v = fitness(x, y);
        const b = v * 8, fr = b - Math.floor(b);
        const band = fr < 0.07 && v > 0.06 ? 0.12 : 0;   // contour lines
        d[i++] = 110; d[i++] = 195; d[i++] = 240;
        d[i++] = 255 * (v * 0.26 + band);
      }
    }
    hctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(heat, 0, 0, W, H);
  }

  function drawPop(now) {
    const t = clamp((now - genStart) / (GEN_MS * 0.8), 0, 1);
    const e = 1 - Math.pow(1 - t, 3);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(150,205,255,0.22)';
    ctx.beginPath();
    for (const p of pop) {
      ctx.moveTo(p.fx, p.fy);
      ctx.lineTo(p.fx + (p.x - p.fx) * e, p.fy + (p.y - p.fy) * e);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const p of pop) {
      const x = p.fx + (p.x - p.fx) * e, y = p.fy + (p.y - p.fy) * e;
      ctx.beginPath();
      ctx.arc(x, y, p.elite ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (p.elite) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ---- main loop ---------------------------------------------------------
  function frame(now) {
    const dt = Math.min(now - lastT, 100);
    lastT = now;

    updateLandscape(dt, now);
    if (now - genStart >= GEN_MS) { nextGeneration(); genStart = now; }

    ctx.clearRect(0, 0, W, H);
    drawHeat();
    drawPop(now);
    requestAnimationFrame(frame);
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    size = Math.min(W, H);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    gw = clamp(Math.round(W / 8), 60, 160);
    gh = Math.max(30, Math.round(gw * H / W));
    heat.width = gw; heat.height = gh;
    img = hctx.createImageData(gw, gh);

    initPeaks();
    initPop();

    if (reduceMotion) {
      // static picture: let the population converge, draw once
      for (let i = 0; i < 80; i++) nextGeneration();
      pop.forEach(p => { p.fx = p.x; p.fy = p.y; });
      ctx.clearRect(0, 0, W, H);
      drawHeat();
      drawPop(genStart + GEN_MS);
    }
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  resize();
  if (!reduceMotion) {
    const t0 = performance.now();
    lastT = t0; genStart = t0; nextShift = t0 + 5000;
    requestAnimationFrame(frame);
  }
})();
