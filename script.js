// ---- Config ----
const VISIBLE = 12;           // stickers on screen at once
const VISIBLE_MOBILE = 7;     // fewer on narrow screens so it doesn't get crowded
const MIN_SIZE = 0.13;        // sticker size range, relative to the screen
const MAX_SIZE = 0.21;
const MOBILE_MIN_SIZE = 0.20; // bigger on narrow screens
const MOBILE_MAX_SIZE = 0.28;
const FLOAT = 0.07;           // how far each sticker drifts from its spot (relative to its size)
const FLOAT_PERIOD = [7, 12]; // seconds for one slow back-and-forth (min, max)
const STICKER_DIR = "stickers/";
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
// Where "Send a sticker" goes: an email address (copied on click) or a form link.
// The button in the info panel stays hidden while this is empty.
const SUBMIT_URL = "reciprocoenazul@gmail.com";

const stage = document.getElementById("stage");
const logo = document.querySelector(".logo");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = window.innerWidth < 700;
const [minSize, maxSize] = isMobile ? [MOBILE_MIN_SIZE, MOBILE_MAX_SIZE] : [MIN_SIZE, MAX_SIZE];

// Pause state, shared by the animation and the info panel
const clock = { paused: false, pausedAt: 0, offset: 0 };

// localStorage can be missing or blocked (private mode etc.), so never let it break the page
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  },
};

// Ask the server for the folder listing (works with Live Server, python -m http.server, etc.).
// Falls back to the list in stickers/stickers.js (made by optimize-stickers.py).
async function loadStickerList() {
  try {
    const res = await fetch(STICKER_DIR);
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const files = [...doc.querySelectorAll("a[href]")]
        .map((a) => decodeURIComponent(a.getAttribute("href").split("?")[0].split("/").pop()))
        .filter((f) => IMAGE_RE.test(f));
      if (files.length) return [...new Set(files)];
    }
  } catch (e) {
    // file:// or no directory listing — use the generated list
  }
  return window.STICKERS || [];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Based on the screen area, so stickers are big on laptops and smaller on phones
function stickerSize(factor) {
  return Math.round(Math.sqrt(window.innerWidth * window.innerHeight) * factor);
}

function start(files) {
  if (!files.length) {
    console.warn("No stickers found. Add images to stickers/ and run: python3 optimize-stickers.py");
    return;
  }

  const stickers = [];
  const rand = (a, b) => a + Math.random() * (b - a);

  // Box around the capital letters of ROFFA (tighter than the h1 box).
  // With line-height: 1, Montserrat caps sit roughly between 0.16em and 0.86em.
  let logoBox;
  function measureLogo() {
    const r = logo.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(logo).fontSize);
    logoBox = { l: r.left, r: r.right, t: r.top + em * 0.16, b: r.top + em * 0.86 };
  }

  // Visible area of a sticker around its spot: the image is "contain"-fitted
  // in a square, so a tall image only fills part of the width (and vice versa).
  // `pad` adds room for the floating movement.
  function homeBox(s, pad = 0) {
    const hw = (s.size * s.fw) / 2 + pad;
    const hh = (s.size * s.fh) / 2 + pad;
    return { l: s.hx - hw, r: s.hx + hw, t: s.hy - hh, b: s.hy + hh };
  }

  // Move a spot out of the logo (shortest way) and back inside the screen
  function keepClear(s) {
    const pad = s.size * FLOAT;
    let h = homeBox(s, pad);
    if (h.r > logoBox.l && h.l < logoBox.r && h.b > logoBox.t && h.t < logoBox.b) {
      const pushes = [
        [h.r - logoBox.l, () => (s.hx -= h.r - logoBox.l)],
        [logoBox.r - h.l, () => (s.hx += logoBox.r - h.l)],
        [h.b - logoBox.t, () => (s.hy -= h.b - logoBox.t)],
        [logoBox.b - h.t, () => (s.hy += logoBox.b - h.t)],
      ];
      pushes.sort((a, b) => a[0] - b[0])[0][1]();
    }
    h = homeBox(s, pad);
    if (h.l < 0) s.hx -= h.l;
    if (h.t < 0) s.hy -= h.t;
    if (h.r > window.innerWidth) s.hx -= h.r - window.innerWidth;
    if (h.b > window.innerHeight) s.hy -= h.b - window.innerHeight;
  }

  // Spots spread evenly along a rounded rectangle that frames the screen,
  // so the stickers sit around ROFFA like in a collage
  function layout() {
    measureLogo();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const n = stickers.length;
    const typical = stickerSize((minSize + maxSize) / 2);
    const a = Math.max(w / 2 - typical * 0.6, 1);
    const b = Math.max(h / 2 - typical * 0.6, 1);

    // Sample the rounded rectangle (a superellipse) and measure its length
    const pts = [];
    const STEPS = 720;
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * Math.PI * 2;
      const c = Math.cos(t);
      const si = Math.sin(t);
      pts.push([
        w / 2 + a * Math.sign(c) * Math.abs(c) ** 0.4,
        h / 2 + b * Math.sign(si) * Math.abs(si) ** 0.4,
      ]);
    }
    // Parts of the frame where a sticker would hit the logo don't count, so the
    // spots spread over the free space (matters on phones, where ROFFA is full width)
    const half = typical * (0.5 + FLOAT);
    const free = ([x, y]) =>
      x + half <= logoBox.l || x - half >= logoBox.r || y + half <= logoBox.t || y - half >= logoBox.b;
    const lens = [0];
    for (let i = 1; i < pts.length; i++) {
      const step = free(pts[i]) && free(pts[i - 1])
        ? Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        : 0;
      lens.push(lens[i - 1] + step);
    }
    const total = lens[lens.length - 1];
    const gap = total / n;

    stickers.forEach((s, i) => {
      const target = (i + 0.5) * gap;
      let k = 0;
      while (k < lens.length - 1 && lens[k] < target) k++;
      s.hx = pts[k][0] + s.jx * gap;
      s.hy = pts[k][1] + s.jy * gap;
      s.size = Math.min(stickerSize(s.factor), gap * 0.85);
      s.el.style.setProperty("--size", s.size + "px");
      keepClear(s);
    });
    if (reducedMotion) render(0);
  }

  // Collection: every sticker someone has seen counts as found (kept between visits)
  const foundEl = document.getElementById("found");
  let saved = [];
  try { saved = JSON.parse(store.get("roffa-found")) || []; } catch (e) {}
  const found = new Set(saved.filter((f) => files.includes(f)));

  function updateFound(isNew) {
    foundEl.textContent =
      found.size === files.length ? `all ${files.length} found ✦` : `${found.size} / ${files.length} found`;
    if (isNew) {
      foundEl.classList.remove("bump");
      void foundEl.offsetWidth; // restart animation
      foundEl.classList.add("bump");
    }
  }

  function setImage(s, file, fromClick = false) {
    s.file = file;
    s.img.src = STICKER_DIR + encodeURIComponent(file);
    s.img.alt = file.replace(IMAGE_RE, "");
    if (!found.has(file)) {
      found.add(file);
      store.set("roffa-found", JSON.stringify([...found]));
      updateFound(fromClick);
    }
  }

  // Prefer a sticker nobody has found yet, then one that isn't on screen,
  // then any other one
  function pickNext(current) {
    const inUse = new Set(stickers.map((s) => s.file));
    const unseen = files.filter((f) => !inUse.has(f) && !found.has(f));
    if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)];
    let options = files.filter((f) => !inUse.has(f));
    if (!options.length) options = files.filter((f) => f !== current);
    if (!options.length) return current;
    return options[Math.floor(Math.random() * options.length)];
  }

  const count = isMobile ? VISIBLE_MOBILE : VISIBLE;
  updateFound(false);

  // Starting set: no repeats unless there are fewer images than slots
  let pool = [];
  while (pool.length < count) pool = pool.concat(shuffle(files));

  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "sticker";
    const img = document.createElement("img");
    img.decoding = "async";
    el.appendChild(img);
    stage.appendChild(el);

    const speed = () => (Math.PI * 2) / rand(FLOAT_PERIOD[0], FLOAT_PERIOD[1]);
    const s = {
      el,
      img,
      file: null,
      factor: rand(minSize, maxSize),
      size: 0,
      fw: 1, // fraction of the square the image fills (width / height)
      fh: 1,
      hx: 0, // center of its spot
      hy: 0,
      jx: rand(-0.1, 0.1), // small random nudge so the layout doesn't look like a grid
      jy: rand(-0.1, 0.1),
      rot: rand(-15, 15),
      fx: speed(), px: rand(0, 6.3),
      fy: speed(), py: rand(0, 6.3),
      fr: speed(), pr: rand(0, 6.3),
    };
    img.addEventListener("load", () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      s.fw = ratio < 1 ? ratio : 1;
      s.fh = ratio > 1 ? 1 / ratio : 1;
      keepClear(s); // a new shape might now touch the logo
    });
    setImage(s, pool[i]);

    el.addEventListener("click", () => {
      setImage(s, pickNext(s.file), true);
      el.classList.remove("pop");
      void el.offsetWidth; // restart animation
      el.classList.add("pop");
    });

    stickers.push(s);
  }

  // Each sticker drifts gently around its spot and tilts a little
  function render(t) {
    for (const s of stickers) {
      const amp = s.size * FLOAT;
      const x = s.hx - s.size / 2 + amp * Math.sin(t * s.fx + s.px);
      const y = s.hy - s.size / 2 + amp * Math.sin(t * s.fy + s.py);
      const rot = s.rot + 4 * Math.sin(t * s.fr + s.pr);
      s.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
    }
  }

  function tick(now) {
    if (!clock.paused) render((now - clock.offset) / 1000);
    requestAnimationFrame(tick);
  }

  layout();
  document.fonts.ready.then(layout);
  window.addEventListener("resize", layout);

  // Preload the rest so swapping on click is instant
  const preload = () => {
    for (const f of files) new Image().src = STICKER_DIR + encodeURIComponent(f);
  };
  if (document.readyState === "complete") preload();
  else window.addEventListener("load", preload);

  if (!reducedMotion) requestAnimationFrame(tick);
}

// ---- Info panel: click the O of ROFFA to pause everything and read about the project ----
const info = document.getElementById("info");
const logoO = document.getElementById("logo-o");
const infoClose = document.getElementById("info-close");
const logoHint = document.getElementById("logo-hint");

// The Clipboard API only works on https/localhost, so fall back to the old way
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) {}
    ta.remove();
    return ok;
  }
}

// "Send a sticker": with an email address it copies the address and says so;
// with anything else (a form link) it opens that in a new tab
if (SUBMIT_URL) {
  const submit = document.getElementById("info-submit");
  const copiedNote = document.getElementById("info-copied");
  const isEmail = /^[^\s@/:]+@[^\s@/]+$/.test(SUBMIT_URL);
  let resetFlash;

  submit.addEventListener("click", async () => {
    if (!isEmail) {
      window.open(SUBMIT_URL, "_blank", "noopener");
      return;
    }
    const ok = await copyText(SUBMIT_URL);
    submit.classList.add("copied");
    // The address stays visible, so it can also be copied by hand if copying failed
    const addr = document.createElement("strong");
    addr.textContent = SUBMIT_URL;
    copiedNote.replaceChildren(addr, ok ? " copied to clipboard ✓" : "");
    clearTimeout(resetFlash);
    resetFlash = setTimeout(() => submit.classList.remove("copied"), 1500);
  });
  submit.hidden = false;
}

// Until someone opens the info once, the O breathes and shows a small hint
if (!store.get("roffa-o-seen")) {
  logoO.classList.add("hinting");
  logoHint.textContent = window.matchMedia("(hover: none)").matches ? "↑ tap" : "↑ click";
  logoHint.hidden = false;
}

function openInfo() {
  logoO.classList.remove("hinting");
  logoHint.hidden = true;
  store.set("roffa-o-seen", "1");
  clock.paused = true;
  clock.pausedAt = performance.now();
  info.hidden = false;
  infoClose.focus();
}

function closeInfo() {
  // Shift the clock so stickers continue exactly where they stopped
  clock.offset += performance.now() - clock.pausedAt;
  clock.paused = false;
  info.hidden = true;
  logoO.focus();
}

logoO.addEventListener("click", openInfo);
infoClose.addEventListener("click", closeInfo);
info.addEventListener("click", (e) => {
  if (e.target === info) closeInfo(); // click outside the box
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !info.hidden) closeInfo();
});

loadStickerList().then(start);
