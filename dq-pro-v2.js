/* =====================================================================
   DQ Pro v2 — admin üçün canlı dizayn redaktoru
   • Yalnız admin daxil olanda sağ kənarda "✦ Pro v2" düyməsi görünür.
   • Redaktə rejimində istənilən bloka toxun → seç → sürüşdür / sıra dəyiş /
     mətni dəyiş / sil / ölçü, rəng.
   • Dəyişikliklər Supabase-də ("pro2" kolleksiyası) saxlanır və bütün
     istifadəçilərə avtomatik tətbiq olunur.
   • app.js-ə TOXUNMUR. index.html-də app.js-dən sonra qoşulur.
   ===================================================================== */
(function () {
  "use strict";
  if (window.DQPro2) return;

  var COL = "pro2";
  var S = {
    id: null, rules: {}, on: false, sel: null, mode: "free", direct: false,
    grid: false, fr: true, step: 4, undo: [], redo: [], tm: 0, busy: false,
    editing: null, built: false, rail: false, min: false, status: ""
  };
  var orig = new Map();      // el -> {style, html, txt}
  var permParents = new Set();
  var D = null;              // aktiv sürüşdürmə
  var obs = null, applyTm = 0;

  var $ = function (id) { return document.getElementById(id); };
  var isAdm = function () { return window.__dqAuthed === true; };
  var SKIPTAG = /^(SCRIPT|STYLE|NOSCRIPT|LINK|META|TEMPLATE)$/;
  var INLINE_UP = /^(B|STRONG|EM|U|SMALL|BR|SUB|SUP|MARK|TSPAN|PATH|CIRCLE|RECT|G|LINE|POLYGON|POLYLINE|ELLIPSE|USE|TEXT)$/i;
  var INLINE_OK = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, SPAN: 1, SMALL: 1, SUB: 1, SUP: 1, MARK: 1 };
  var NOTEXT = /^(IMG|INPUT|SELECT|TEXTAREA|SVG|CANVAS|TABLE|VIDEO|IFRAME|HR)$/i;
  var UIQ = "#p2-root,#p2-root *,#p2-h,#p2-h *,#p2-done,#p2-done *,#p2-toast,.p2-g";

  /* ---------- köməkçilər ---------- */
  function kids(p) {
    return p ? [].filter.call(p.children, function (c) {
      return !c.hasAttribute("data-p2ui") && !SKIPTAG.test(c.tagName);
    }) : [];
  }
  function stamp(par) {
    var ks = kids(par), has = ks.some(function (c) { return c.hasAttribute("data-p2i"); });
    ks.forEach(function (c, i) {
      if (!c.hasAttribute("data-p2i")) c.setAttribute("data-p2i", has ? 1000 + i : i);
    });
  }
  function idxOf(n) {
    return n.hasAttribute("data-p2i") ? +n.getAttribute("data-p2i") : kids(n.parentNode).indexOf(n);
  }
  function keyOf(el) {
    var parts = [], n = el;
    while (n && n !== document.body && n !== document.documentElement) {
      if (n.id && !/\d{5,}/.test(n.id) && !/^p2-/.test(n.id)) {
        parts.unshift("#" + n.id);
        return parts.join("/");
      }
      parts.unshift(idxOf(n));
      n = n.parentNode;
    }
    parts.unshift("body");
    return parts.join("/");
  }
  function resolve(k) {
    var p = k.split("/"), h = p.shift(), n;
    n = h === "body" ? document.body : document.getElementById(h.slice(1));
    if (!n) return null;
    for (var i = 0; i < p.length; i++) {
      var idx = +p[i], ks = kids(n), found = null;
      if (ks.some(function (c) { return c.hasAttribute("data-p2i"); })) {
        found = ks.filter(function (c) { return +c.getAttribute("data-p2i") === idx; })[0] || null;
      } else found = ks[idx] || null;
      if (!found) return null;
      n = found;
    }
    return n;
  }
  function hzKey() {
    var n = document.querySelector("#v3-hz .hz-nav .nav-btn.active [data-p]"),
      t = document.querySelector("#v3-hz .hz-tab.active [data-p]");
    return (n ? n.getAttribute("data-p") : "") + "|" + (t ? t.getAttribute("data-p") : "");
  }
  function pkOf(el) {
    var s = el.closest && el.closest(".screen");
    if (!s) return "g";
    if (s.id === "v3-hz") return el.closest(".hz-main") ? "hz:" + hzKey() : "hz:chrome";
    return s.id || "s";
  }
  function curPages() {
    var ks = ["g"];
    [].forEach.call(document.querySelectorAll(".screen"), function (s) {
      if (s.id === "v3-hz") { ks.push("hz:chrome"); ks.push("hz:" + hzKey()); }
      else if (s.id) ks.push(s.id);
    });
    return ks;
  }
  function activePk() {
    var s = document.querySelector(".screen.active");
    if (!s) return "g";
    return s.id === "v3-hz" ? "hz:" + hzKey() : (s.id || "s");
  }
  function rule(el) {
    var pk = pkOf(el), k = keyOf(el);
    S.rules[pk] = S.rules[pk] || {};
    return S.rules[pk][k] || (S.rules[pk][k] = {});
  }
  function getRule(el) {
    var pk = pkOf(el), k = keyOf(el);
    return (S.rules[pk] || {})[k] || {};
  }
  function clean() {
    Object.keys(S.rules).forEach(function (pk) {
      Object.keys(S.rules[pk]).forEach(function (k) {
        var r = S.rules[pk][k];
        Object.keys(r).forEach(function (f) {
          if (r[f] === "" || r[f] == null || r[f] === false || ((f === "x" || f === "y") && !r[f]) ||
            (f === "perm" && r[f].every(function (v, i) { return v === i; }))) delete r[f];
        });
        if (!Object.keys(r).length) delete S.rules[pk][k];
      });
      if (!Object.keys(S.rules[pk]).length) delete S.rules[pk];
    });
  }
  function remember(el, withText) {
    var o = orig.get(el);
    if (!o) { o = { style: el.getAttribute("style"), html: null, txt: false }; orig.set(el, o); }
    if (withText && !o.txt) { o.html = el.innerHTML; o.txt = true; }
    return o;
  }
  function label(el) {
    var c = typeof el.className === "string" ? el.className.split(/\s+/).filter(function (x) { return x && x.indexOf("p2-") !== 0; })[0] : "";
    return el.tagName.toLowerCase() + (c ? "." + c : "");
  }
  function snippet(el, n) {
    return String(el.textContent || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, n || 24);
  }
  function getT(el) {
    var m = String(el.style.translate || "").match(/-?[\d.]+/g);
    return m ? [parseFloat(m[0]) || 0, parseFloat(m[1]) || 0] : [0, 0];
  }
  function setT(el, x, y) {
    x = Math.round(x * 2) / 2; y = Math.round(y * 2) / 2;
    if (x || y) el.style.setProperty("translate", x + "px " + y + "px");
    else el.style.removeProperty("translate");
  }
  function canText(el) {
    if (!el || NOTEXT.test(el.tagName)) return false;
    return [].every.call(el.children, function (c) { return INLINE_OK[c.tagName]; });
  }
  function sanitize(h) {
    var ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, SPAN: 1, SMALL: 1, SUB: 1, SUP: 1, MARK: 1 };
    var d = new DOMParser().parseFromString("<body>" + String(h) + "</body>", "text/html");
    (function w(n) {
      [].slice.call(n.children).forEach(function (c) {
        w(c);
        if (!ALLOW[c.tagName]) { c.replaceWith.apply(c, [].slice.call(c.childNodes)); return; }
        [].slice.call(c.attributes).forEach(function (a) {
          if (a.name === "style") {
            var s = a.value.split(";").map(function (x) { return x.trim(); }).filter(function (x) {
              return /^(color|font-weight|font-size|background-color|text-decoration|font-style)\s*:\s*[#\w\s(),.%-]+$/i.test(x);
            }).join(";");
            s ? c.setAttribute("style", s) : c.removeAttribute("style");
          } else if (a.name === "class" && /^[\w\s-]+$/.test(a.value)) { /* saxla */ }
          else c.removeAttribute(a.name);
        });
      });
    })(d.body);
    return d.body.innerHTML;
  }
  function toast(t) {
    var e = $("p2-toast");
    if (!e) return;
    e.textContent = t; e.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove("on"); }, 1800);
  }

  /* ---------- qaydaları DOM-a tətbiq et ---------- */
  function applyPerm(par, perm) {
    stamp(par);
    var ks = kids(par);
    if (ks.length !== perm.length) return;
    var byI = {};
    ks.forEach(function (c) { byI[c.getAttribute("data-p2i")] = c; });
    var want = perm.map(function (i) { return byI[i]; });
    if (want.some(function (x) { return !x; })) return;
    if (want.every(function (c, i) { return c === ks[i]; })) return;
    permParents.add(par);
    var ref = ks[ks.length - 1].nextSibling;
    want.forEach(function (c) { par.insertBefore(c, ref); });
  }
  function paint(el, r) {
    remember(el);
    if (r.perm) applyPerm(el, r.perm);
    setT(el, r.x || 0, r.y || 0);
    r.s ? el.style.setProperty("scale", r.s) : el.style.removeProperty("scale");
    r.fs ? el.style.setProperty("font-size", r.fs + "px", "important") : el.style.removeProperty("font-size");
    r.c ? el.style.setProperty("color", r.c, "important") : el.style.removeProperty("color");
    r.bg ? el.style.setProperty("background-color", r.bg, "important") : el.style.removeProperty("background-color");
    if (r.h) {
      if (S.on) { el.style.removeProperty("display"); el.classList.add("p2-ghost"); }
      else { el.classList.remove("p2-ghost"); el.style.setProperty("display", "none", "important"); }
    } else {
      el.classList.remove("p2-ghost");
      if (el.style.display === "none" && orig.get(el) && !/display\s*:\s*none/.test(orig.get(el).style || "")) el.style.removeProperty("display");
    }
    if (r.t != null && el.__p2t !== r.t) {
      remember(el, true);
      el.innerHTML = sanitize(r.t);
      el.__p2t = r.t;
    }
  }
  function applyAll() {
    if (S.busy) return;
    S.busy = true;
    if (obs) obs.disconnect();
    try {
      // əvvəl valideyn (perm), sonra qalanı: açarlar uzunluğuna görə
      curPages().forEach(function (pk) {
        var pr = S.rules[pk];
        if (!pr) return;
        Object.keys(pr).sort(function (a, b) { return a.length - b.length; }).forEach(function (k) {
          var el = resolve(k);
          if (el && !el.matches(UIQ)) paint(el, pr[k]);
        });
      });
    } catch (e) { console.warn("[Pro v2]", e); }
    S.busy = false;
    observe();
  }
  function observe() {
    if (!obs) {
      obs = new MutationObserver(function () {
        clearTimeout(applyTm);
        applyTm = setTimeout(applyAll, 140);
      });
    }
    obs.observe(document.body, { childList: true, subtree: true });
  }
  function revertAll() {
    if (obs) obs.disconnect();
    orig.forEach(function (o, el) {
      if (o.style == null) el.removeAttribute("style"); else el.setAttribute("style", o.style);
      if (o.txt) { el.innerHTML = o.html; delete el.__p2t; }
      el.classList.remove("p2-ghost");
    });
    permParents.forEach(function (par) {
      var ks = kids(par);
      ks.filter(function (c) { return c.hasAttribute("data-p2i"); })
        .sort(function (a, b) { return +a.getAttribute("data-p2i") - +b.getAttribute("data-p2i"); })
        .forEach(function (c) { par.appendChild(c); });
    });
    orig.clear(); permParents.clear();
    observe();
  }

  /* ---------- saxla / yüklə ---------- */
  async function load() {
    try {
      await V2.probe();
      var l = await V2.list(COL);
      if (l && l[0]) { S.id = l[0]._id; S.rules = l[0].rules || {}; }
    } catch (e) { /* oflayn */ }
    applyAll();
  }
  function save() {
    clearTimeout(S.tm);
    setStatus("Saxlanır…");
    S.tm = setTimeout(async function () {
      try {
        clean();
        await V2.put(COL, { rules: S.rules, t: Date.now() }, S.id);
        if (!S.id) { var l = await V2.list(COL); S.id = l[0] && l[0]._id; }
        setStatus("Saxlanıldı ✓");
      } catch (e) { setStatus("Xəta: saxlanmadı"); }
    }, 500);
  }
  function snap() {
    S.undo.push(JSON.stringify(S.rules));
    if (S.undo.length > 60) S.undo.shift();
    S.redo = [];
  }
  function setStatus(t) {
    S.status = t;
    var s = $("p2-st"); if (s) s.textContent = t;
  }
  function restoreRules(js) {
    revertAll();
    S.rules = JSON.parse(js);
    applyAll(); save(); renderAll();
  }

  /* ---------- seçim ---------- */
  function norm(t) {
    if (t && t.nodeType !== 1) t = t.parentElement;
    if (!t) return null;
    var sv = t.closest && t.closest("svg");
    if (sv && t !== sv) t = sv;
    while (t && INLINE_UP.test(t.tagName) && t.parentElement) t = t.parentElement;
    if (!t || /^(HTML|BODY|HEAD)$/.test(t.tagName) || t.classList.contains("screen")) return null;
    return t;
  }
  function select(el) {
    if (S.sel) S.sel.classList.remove("p2-sel", "p2-mvon");
    S.sel = el || null;
    S.direct = false;
    if (el) el.classList.add("p2-sel");
    renderAll();
  }
  function chain(el) {
    var out = [], n = el;
    while (n && out.length < 7 && n !== document.body && !n.classList.contains("screen")) { out.push(n); n = n.parentElement; }
    return out;
  }

  /* ---------- sürüşdürmə ---------- */
  function startDrag(e) {
    var el = S.sel;
    if (!el || D) return;
    e.preventDefault(); e.stopPropagation();
    snap();
    remember(el);
    stamp(el.parentNode);
    var fixed = getComputedStyle(el).position === "fixed";
    var r0 = el.getBoundingClientRect();
    var sx = window.scrollX, sy = window.scrollY;
    D = {
      el: el, mode: S.mode, id: e.pointerId, fixed: fixed, moved: false,
      spX: e.clientX + (fixed ? 0 : sx), spY: e.clientY + (fixed ? 0 : sy),
      r0: { l: r0.left + (fixed ? 0 : sx), t: r0.top + (fixed ? 0 : sy), w: r0.width, h: r0.height },
      last: e, cand: null, lastSwap: 0
    };
    el.style.pointerEvents = "none";
    el.classList.add("p2-drag");
    document.documentElement.classList.add("p2-dragging");
    // yapışma xətləri üçün namizədlər (səhifə koordinatları)
    var cx = [], cy = [], par = el.parentNode;
    if (S.mode === "free") {
      var pr = par.getBoundingClientRect();
      cx.push(pr.left + sx, pr.left + sx + pr.width / 2, pr.left + sx + pr.width);
      cy.push(pr.top + sy, pr.top + sy + pr.height / 2, pr.top + sy + pr.height);
      kids(par).filter(function (c) { return c !== el; }).slice(0, 60).forEach(function (c) {
        var r = c.getBoundingClientRect();
        if (!r.width && !r.height) return;
        cx.push(r.left + sx, r.left + sx + r.width / 2, r.left + sx + r.width);
        cy.push(r.top + sy, r.top + sy + r.height / 2, r.top + sy + r.height);
      });
    }
    D.cand = { x: cx, y: cy };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
    D.auto = setInterval(autoScroll, 16);
  }
  function autoScroll() {
    if (!D || !D.last) return;
    var y = D.last.clientY, v = 0;
    if (y < 80) v = -Math.ceil((80 - y) / 6);
    else if (y > innerHeight - 120) v = Math.ceil((y - (innerHeight - 120)) / 6);
    if (v) { scrollBy(0, v); doMove(D.last); }
  }
  function onMove(e) {
    if (!D || e.pointerId !== D.id) return;
    e.preventDefault();
    D.last = e;
    doMove(e);
  }
  function doMove(e) {
    var el = D.el, sx = D.fixed ? 0 : scrollX, sy = D.fixed ? 0 : scrollY;
    var dx = e.clientX + sx - D.spX, dy = e.clientY + sy - D.spY;
    if (!D.moved && Math.hypot(dx, dy) < 4) return;
    D.moved = true;
    var wl = D.r0.l + dx, wt = D.r0.t + dy, gx = null, gy = null;
    if (D.mode === "free") {
      var best = 7, i, v;
      [0, D.r0.w / 2, D.r0.w].forEach(function (off) {
        D.cand.x.forEach(function (c) { var d = c - (wl + off); if (Math.abs(d) < Math.abs(best)) { best = d; gx = c; } });
      });
      if (gx != null && Math.abs(best) < 7) wl += best; else gx = null;
      best = 7;
      [0, D.r0.h / 2, D.r0.h].forEach(function (off) {
        D.cand.y.forEach(function (c) { var d = c - (wt + off); if (Math.abs(d) < Math.abs(best)) { best = d; gy = c; } });
      });
      if (gy != null && Math.abs(best) < 7) wt += best; else gy = null;
    }
    // natural mövqe (translate olmadan)
    el.style.setProperty("translate", "none");
    var n = el.getBoundingClientRect();
    var tx = wl - sx - n.left, ty = wt - sy - n.top;
    if (S.grid && D.mode === "free") { tx = Math.round(tx / 8) * 8; ty = Math.round(ty / 8) * 8; }
    el.style.setProperty("translate", tx + "px " + ty + "px");
    drawGuides(gx != null ? gx - sx : null, gy != null ? gy - sy : null);
    if (D.mode === "order") reorderAt(e.clientX, e.clientY);
  }
  function reorderAt(px, py) {
    var now = Date.now();
    if (now - D.lastSwap < 90) return;
    var el = D.el, par = el.parentNode, list = document.elementsFromPoint(px, py), hit = null;
    for (var i = 0; i < list.length && !hit; i++) {
      var a = list[i];
      while (a && a.parentNode !== par) a = a.parentNode;
      if (a && a !== el && !a.hasAttribute("data-p2ui") && !SKIPTAG.test(a.tagName)) hit = a;
    }
    if (!hit) return;
    var r = hit.getBoundingClientRect(), cxm = r.left + r.width / 2, cym = r.top + r.height / 2;
    var horiz = Math.abs(px - cxm) / Math.max(1, r.width) > Math.abs(py - cym) / Math.max(1, r.height);
    var before = horiz ? px < cxm : py < cym;
    if (before ? el.nextElementSibling === hit : el.previousElementSibling === hit) return;
    permParents.add(par);
    par.insertBefore(el, before ? hit : hit.nextElementSibling);
    D.lastSwap = now;
  }
  function drawGuides(x, y) {
    var gx = $("p2-gx"), gy = $("p2-gy");
    if (gx) { gx.style.display = x == null ? "none" : "block"; if (x != null) gx.style.left = Math.round(x) + "px"; }
    if (gy) { gy.style.display = y == null ? "none" : "block"; if (y != null) gy.style.top = Math.round(y) + "px"; }
  }
  function endDrag(e) {
    if (!D || (e && e.pointerId !== D.id)) return;
    var el = D.el, d = D;
    D = null;
    clearInterval(d.auto);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", endDrag, true);
    window.removeEventListener("pointercancel", endDrag, true);
    el.style.removeProperty("pointer-events");
    el.classList.remove("p2-drag");
    document.documentElement.classList.remove("p2-dragging");
    drawGuides(null, null);
    if (!d.moved) { S.undo.pop(); return; }
    if (d.mode === "order") {
      var par = el.parentNode;
      el.style.setProperty("transition", "translate .18s ease");
      el.style.setProperty("translate", "none");
      setTimeout(function () { el.style.removeProperty("transition"); }, 230);
      var pr = rule(par);
      pr.perm = kids(par).map(function (c) { return +c.getAttribute("data-p2i"); });
      var er = getRule(el); if (er.x || er.y) { er.x = 0; er.y = 0; }
      toast("Sıra dəyişdi ✓");
    } else {
      var t = getT(el), r = rule(el);
      r.x = t[0]; r.y = t[1];
      toast("Yer dəyişdi ✓");
    }
    save(); renderAll();
  }

  /* ---------- əməliyyatlar ---------- */
  function nudge(dx, dy) {
    var el = S.sel; if (!el) return;
    snap(); remember(el);
    var t = getT(el), r = rule(el);
    r.x = t[0] + dx * S.step; r.y = t[1] + dy * S.step;
    setT(el, r.x, r.y);
    save();
  }
  function startText() {
    var el = S.sel;
    if (!el) return;
    if (!canText(el)) { toast("Bu blokda mətni dəyişmək üçün içindəki yazıya toxunun"); return; }
    remember(el, true);
    S.editing = el;
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "false");
    el.classList.add("p2-edit");
    el.focus();
    try { var rg = document.createRange(); rg.selectNodeContents(el); rg.collapse(false); var sl = getSelection(); sl.removeAllRanges(); sl.addRange(rg); } catch (er) { }
    $("p2-done").hidden = false;
    $("p2-sheet").hidden = true;
    el.addEventListener("blur", function fin() {
      el.removeEventListener("blur", fin);
      endText();
    });
  }
  function endText() {
    var el = S.editing;
    if (!el) return;
    S.editing = null;
    el.removeAttribute("contenteditable");
    el.classList.remove("p2-edit");
    $("p2-done").hidden = true;
    var h = sanitize(el.innerHTML), r = getRule(el);
    if (h !== (r.t != null ? r.t : (orig.get(el) && orig.get(el).html != null ? sanitize(orig.get(el).html) : h))) {
      snap();
      var rr = rule(el); rr.t = h; el.__p2t = h;
      save(); toast("Mətn saxlandı ✓");
    }
    renderAll();
  }
  function hideEl() {
    var el = S.sel; if (!el) return;
    snap(); remember(el);
    var r = rule(el); r.h = !r.h;
    paint(el, r); save(); renderAll();
    toast(r.h ? "Silindi (Gizlədilənlərdən qaytara bilərsən)" : "Geri qaytarıldı");
  }
  function resetEl() {
    var el = S.sel; if (!el) return;
    snap();
    var pk = pkOf(el), k = keyOf(el);
    if (S.rules[pk]) delete S.rules[pk][k];
    var o = orig.get(el);
    if (o) {
      if (o.style == null) el.removeAttribute("style"); else el.setAttribute("style", o.style);
      if (o.txt) { el.innerHTML = o.html; delete el.__p2t; }
      el.classList.remove("p2-ghost");
    } else { ["translate", "scale", "font-size", "color", "background-color"].forEach(function (p) { el.style.removeProperty(p); }); }
    save(); renderAll(); toast("Element sıfırlandı");
  }
  function resetPage() {
    var pk = activePk();
    if (!confirm("Bu səhifədəki bütün Pro v2 dəyişiklikləri silinsin?")) return;
    snap();
    revertAll();
    delete S.rules[pk];
    if (pk.indexOf("hz:") === 0) delete S.rules["hz:chrome"];
    applyAll(); save(); select(null); toast("Səhifə sıfırlandı");
  }
  function setProp(prop, val) {
    var el = S.sel; if (!el) return;
    remember(el);
    var r = rule(el);
    if (!setProp.snapped) { snap(); setProp.snapped = true; }
    clearTimeout(setProp.t);
    setProp.t = setTimeout(function () { setProp.snapped = false; }, 700);
    r[prop] = val;
    paint(el, r); save();
  }

  /* ---------- UI ---------- */
  var CSS = [
    "#p2-root,#p2-root *{box-sizing:border-box;font-family:inherit}",
    "#p2-tab{position:fixed;right:0;top:34%;z-index:100030;border:0;cursor:pointer;color:#fff;font:800 13px/1 inherit;letter-spacing:.5px;padding:14px 8px;border-radius:14px 0 0 14px;background:linear-gradient(160deg,#6366f1,#1e1b4b);box-shadow:-4px 6px 18px #0006;writing-mode:vertical-rl;text-orientation:mixed}",
    "#p2-tab.on{background:linear-gradient(160deg,#f59e0b,#b45309)}",
    "#p2-rail{position:fixed;right:8px;top:50%;transform:translateY(-50%);z-index:100031;width:218px;max-height:82vh;overflow:auto;background:#fff;color:#1e1b4b;border-radius:18px;box-shadow:0 14px 44px #0007;padding:10px;font:700 13px inherit}",
    "#p2-rail[hidden],#p2-sheet[hidden],#p2-done[hidden],#p2-h[hidden]{display:none!important}",
    "#p2-rail .t{display:flex;align-items:center;justify-content:space-between;font-weight:900;font-size:14px;margin-bottom:8px}",
    "#p2-rail button,#p2-sheet button{border:1px solid #d9dcf3;background:#f6f6fd;border-radius:11px;padding:9px 10px;font:700 13px inherit;color:#1e1b4b;cursor:pointer;-webkit-tap-highlight-color:transparent}",
    "#p2-rail button{display:block;width:100%;text-align:left;margin:5px 0}",
    "#p2-rail button.p,#p2-sheet button.p{background:#4f46e5;border-color:#4f46e5;color:#fff}",
    "#p2-rail button.on,#p2-sheet button.on{background:#f59e0b;border-color:#f59e0b;color:#1c1917}",
    "#p2-rail button.d,#p2-sheet button.d{background:#fee2e2;border-color:#fecaca;color:#b91c1c}",
    "#p2-rail button:disabled,#p2-sheet button:disabled{opacity:.38}",
    "#p2-rail .row2{display:flex;gap:6px}#p2-rail .row2 button{margin:5px 0}",
    "#p2-st{font-size:12px;color:#64748b;margin:6px 2px 0;min-height:16px}",
    "#p2-hid{margin-top:6px;border-top:1px solid #e5e7ef;padding-top:6px}",
    "#p2-sheet{position:fixed;left:0;right:0;bottom:0;z-index:100032;max-height:48vh;overflow:auto;background:#fff;color:#1e1b4b;border-radius:20px 20px 0 0;box-shadow:0 -10px 40px #0005;padding:10px 12px calc(14px + env(safe-area-inset-bottom,0px));font:700 13px inherit}",
    "#p2-sheet .r{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}",
    "#p2-sheet .big{flex:1 1 140px;padding:13px 10px;font-size:14px;text-align:center}",
    "#p2-sheet .t{font-weight:900;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "#p2-sheet .chips{display:flex;gap:5px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}",
    "#p2-sheet .chips button{flex:0 0 auto;padding:6px 9px;font-size:12px;border-radius:99px}",
    "#p2-sheet .pad{display:grid;grid-template-columns:repeat(3,44px);grid-template-rows:repeat(2,40px);gap:5px}",
    "#p2-sheet .pad button{padding:0;font-size:18px}",
    "#p2-sheet label{display:flex;align-items:center;gap:6px;font-size:12px;color:#475569}",
    "#p2-sheet input[type=number]{width:62px;padding:7px;border:1px solid #d9dcf3;border-radius:8px}",
    "#p2-sheet input[type=color]{width:36px;height:34px;padding:0;border:1px solid #d9dcf3;border-radius:8px;background:none}",
    "#p2-sheet input[type=range]{width:110px}",
    "#p2-sheet .hint{font-size:12px;color:#64748b;font-weight:600}",
    "#p2-h{position:fixed;z-index:100033;width:44px;height:44px;border-radius:50%;background:#4f46e5;color:#fff;font:900 20px/44px inherit;text-align:center;box-shadow:0 6px 18px #0007;border:3px solid #fff;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}",
    "#p2-h.order{background:#f59e0b;color:#1c1917}",
    "#p2-done{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:100034;border:0;border-radius:99px;padding:12px 22px;font:800 14px inherit;color:#fff;background:#16a34a;box-shadow:0 8px 22px #0006}",
    "#p2-toast{position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom,0px));transform:translate(-50%,20px);opacity:0;z-index:100040;background:#1e1b4b;color:#fff;border-radius:99px;padding:10px 18px;font:700 13px inherit;pointer-events:none;transition:.25s;max-width:90vw;text-align:center}",
    "#p2-toast.on{opacity:1;transform:translate(-50%,0)}",
    ".p2-g{position:fixed;z-index:100029;background:#f43f5e;display:none;pointer-events:none}",
    "#p2-gx{top:0;bottom:0;width:1px}#p2-gy{left:0;right:0;height:1px}",
    "html.p2-on .p2-sel{outline:3px solid #4f46e5!important;outline-offset:1px!important}",
    "html.p2-on .p2-mvon{outline:3px solid #f59e0b!important;touch-action:none!important;cursor:grab}",
    "html.p2-on .p2-drag{opacity:.88;z-index:100028!important;box-shadow:0 14px 34px #0008!important;position:relative}",
    "html.p2-on .p2-edit{outline:3px solid #16a34a!important;-webkit-user-select:text!important;user-select:text!important;cursor:text}",
    "html.p2-on .p2-ghost{opacity:.35!important;outline:2px dashed #ef4444!important}",
    "html.p2-on.p2-fr .screen.active :is(div,section,article,p,h1,h2,h3,h4,h5,a,button,table,img,li,ul,header,footer,nav,form,figure):not(.p2-sel):not(.p2-edit){outline:1px dashed rgba(99,102,241,.4);outline-offset:-1px}",
    "html.p2-on .screen.active *{-webkit-touch-callout:none}",
    "html.p2-on:not(.p2-typing) .screen.active *{-webkit-user-select:none;user-select:none}",
    "html.p2-sheet{padding-bottom:300px}",
    "html.p2-dragging,html.p2-dragging *{cursor:grabbing!important}"
  ].join("\n");

  function buildUI() {
    if (S.built) return;
    S.built = true;
    var st = document.createElement("style");
    st.id = "p2-css"; st.textContent = CSS;
    document.head.appendChild(st);

    var root = document.createElement("div");
    root.id = "p2-root"; root.setAttribute("data-p2ui", "1");
    root.innerHTML =
      '<button id="p2-tab" type="button">✦ Pro v2</button>' +
      '<div id="p2-rail" hidden></div>' +
      '<div id="p2-sheet" hidden></div>';
    document.body.appendChild(root);

    var h = document.createElement("div");
    h.id = "p2-h"; h.setAttribute("data-p2ui", "1"); h.hidden = true; h.textContent = "⠿";
    document.body.appendChild(h);
    var dn = document.createElement("button");
    dn.id = "p2-done"; dn.type = "button"; dn.setAttribute("data-p2ui", "1"); dn.hidden = true; dn.textContent = "✓ Mətn redaktəsini bitir";
    document.body.appendChild(dn);
    var tt = document.createElement("div"); tt.id = "p2-toast"; tt.setAttribute("data-p2ui", "1"); document.body.appendChild(tt);
    ["x", "y"].forEach(function (a) {
      var g = document.createElement("div"); g.id = "p2-g" + a; g.className = "p2-g"; g.setAttribute("data-p2ui", "1"); document.body.appendChild(g);
    });

    $("p2-tab").addEventListener("click", function () { S.rail = true; renderAll(); });
    $("p2-rail").addEventListener("click", onRail);
    $("p2-sheet").addEventListener("click", onSheet);
    $("p2-sheet").addEventListener("input", onInput);
    $("p2-sheet").addEventListener("change", onInput);
    dn.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    dn.addEventListener("click", function () { if (S.editing) S.editing.blur(); });
    h.addEventListener("pointerdown", function (e) { if (S.on && S.sel) { try { h.setPointerCapture(e.pointerId); } catch (er) { } startDrag(e); } });
    renderAll();
    posLoop();
  }
  function destroyUI() {
    if (!S.built) return;
    if (S.on) toggle(false);
    ["p2-root", "p2-h", "p2-done", "p2-toast", "p2-gx", "p2-gy", "p2-css"].forEach(function (i) { var e = $(i); e && e.remove(); });
    S.built = false;
  }

  function renderAll() {
    if (!S.built) return;
    var tab = $("p2-tab"), rail = $("p2-rail");
    tab.hidden = S.rail;
    tab.classList.toggle("on", S.on);
    rail.hidden = !S.rail;
    if (S.rail) renderRail();
    renderSheet();
    var hd = $("p2-h");
    if (hd) { hd.hidden = !(S.on && S.sel && !S.editing); hd.className = S.mode === "order" ? "order" : ""; hd.title = S.mode === "order" ? "Sıranı dəyiş" : "Sürüşdür"; hd.textContent = S.mode === "order" ? "⇅" : "⠿"; }
    var de = document.documentElement;
    de.classList.toggle("p2-on", S.on);
    de.classList.toggle("p2-fr", S.on && S.fr);
    de.classList.toggle("p2-typing", !!S.editing);
    if (S.sel) S.sel.classList.toggle("p2-mvon", S.direct);
  }
  function hiddenList() {
    var out = [];
    curPages().forEach(function (pk) {
      var pr = S.rules[pk] || {};
      Object.keys(pr).forEach(function (k) {
        if (pr[k].h) { var el = resolve(k); if (el) out.push({ pk: pk, k: k, el: el }); }
      });
    });
    return out;
  }
  function renderRail() {
    var hl = hiddenList(), r = $("p2-rail");
    r.innerHTML =
      '<div class="t"><span>✦ Pro v2</span><button data-a="close" style="width:auto;margin:0;padding:6px 10px">✕</button></div>' +
      '<button data-a="toggle" class="' + (S.on ? "on" : "p") + '">' + (S.on ? "✏️ Redaktə: AÇIQ" : "✏️ Redaktəni aç") + "</button>" +
      '<div class="row2"><button data-a="un" ' + (S.undo.length ? "" : "disabled") + '>↶ Geri</button><button data-a="re" ' + (S.redo.length ? "" : "disabled") + '>↷ İrəli</button></div>' +
      '<button data-a="grid" class="' + (S.grid ? "on" : "") + '">🧲 Tor yapışması: ' + (S.grid ? "açıq" : "bağlı") + "</button>" +
      '<button data-a="fr" class="' + (S.fr ? "on" : "") + '">▦ Çərçivələr: ' + (S.fr ? "açıq" : "bağlı") + "</button>" +
      '<button data-a="rp" class="d">⟲ Bu səhifəni sıfırla</button>' +
      '<div id="p2-st">' + (S.status || "") + "</div>" +
      (hl.length ? '<div id="p2-hid"><div class="hint" style="font-size:12px;color:#64748b">Silinənlər (' + hl.length + "):</div>" +
        hl.map(function (x, i) { return '<button data-a="show" data-i="' + i + '">↺ ' + (snippet(x.el, 16) || label(x.el)).replace(/[<>&"]/g, "") + "</button>"; }).join("") + "</div>" : "") +
      '<div class="hint" style="font-size:12px;color:#64748b;margin-top:8px;font-weight:600">' +
      (S.on ? "Səhifədə istənilən bloka toxun → seç → sürüşdür." : "Redaktəni açıb bloka toxun.") + "</div>";
    r.__hl = hl;
  }
  function renderSheet() {
    var sh = $("p2-sheet"), de = document.documentElement;
    if (!S.on || !S.sel || S.editing) { sh.hidden = true; de.classList.remove("p2-sheet"); return; }
    sh.hidden = false;
    var el = S.sel, cs = getComputedStyle(el), r = getRule(el), ch = chain(el);
    var head = '<div class="r"><span class="t">&lt;' + label(el).replace(/[<>&"]/g, "") + "&gt; " + snippet(el, 22).replace(/[<>&"]/g, "") + "</span>" +
      '<button data-a="min">' + (S.min ? "▴" : "▾") + '</button><button data-a="desel">✕</button></div>';
    if (S.min) { sh.innerHTML = head; de.classList.remove("p2-sheet"); return; }
    de.classList.add("p2-sheet");
    sh.innerHTML = head +
      '<div class="chips">' + ch.map(function (n, i) {
        return '<button data-a="pick" data-i="' + i + '" class="' + (i === 0 ? "p" : "") + '">' + label(n).replace(/[<>&"]/g, "").slice(0, 16) + "</button>";
      }).reverse().join("") + "</div>" +
      '<div class="r"><button class="big ' + (S.direct && S.mode === "free" ? "on" : "p") + '" data-a="free">↔ Sürüşdür (sərbəst)</button>' +
      '<button class="big ' + (S.direct && S.mode === "order" ? "on" : "") + '" data-a="order">⇅ Sıra dəyiş</button></div>' +
      '<div class="hint">' + (S.direct ? (S.mode === "free" ? "Seçilmiş bloku barmağınla tutub istədiyin yerə çək. Qırmızı xətt = düzlənmə." : "Bloku tutub başqa blokun üstünə çək — yeri dəyişəcək.") : "Sürüşdürmək üçün yuxarıdakı düyməni və ya blokdakı ⠿ dəstəyi işlət.") + "</div>" +
      '<div class="r"><button data-a="txt">✎ Mətn</button><button data-a="hide" class="d">🗑 ' + (r.h ? "Qaytar" : "Sil") + '</button><button data-a="up">⤴ Üst blok</button><button data-a="rst">↺ Sıfırla</button></div>' +
      '<div class="r"><div class="pad"><span></span><button data-a="nu">▲</button><span></span><button data-a="nl">◀</button><button data-a="nd">▼</button><button data-a="nr">▶</button></div>' +
      '<button data-a="step">Addım: ' + S.step + "px</button>" +
      '<label>Ölçü <input type="range" min="40" max="200" step="5" data-p="s" value="' + Math.round((r.s || 1) * 100) + '"></label></div>' +
      '<div class="r"><label>Yazı <input type="number" min="8" max="96" data-p="fs" value="' + (r.fs || parseInt(cs.fontSize) || 14) + '"></label>' +
      '<label>Rəng <input type="color" data-p="c" value="' + hex(cs.color) + '"></label>' +
      '<label>Fon <input type="color" data-p="bg" value="' + hex(cs.backgroundColor) + '"></label></div>';
  }
  function hex(c) {
    var m = String(c).match(/[\d.]+/g);
    if (!m || (m.length > 3 && +m[3] === 0)) return "#ffffff";
    return "#" + m.slice(0, 3).map(function (n) { return Math.round(+n).toString(16).padStart(2, "0"); }).join("");
  }

  function onRail(e) {
    var b = e.target.closest("button"); if (!b) return;
    var a = b.dataset.a;
    if (a === "close") { S.rail = false; return renderAll(); }
    if (a === "toggle") return toggle(!S.on);
    if (a === "un" || a === "re") {
      var from = a === "un" ? S.undo : S.redo, to = a === "un" ? S.redo : S.undo;
      if (!from.length) return;
      to.push(JSON.stringify(S.rules));
      return restoreRules(from.pop());
    }
    if (a === "grid") { S.grid = !S.grid; return renderAll(); }
    if (a === "fr") { S.fr = !S.fr; return renderAll(); }
    if (a === "rp") return resetPage();
    if (a === "show") {
      var x = $("p2-rail").__hl[+b.dataset.i]; if (!x) return;
      snap();
      var rr = S.rules[x.pk][x.k]; delete rr.h;
      x.el.classList.remove("p2-ghost"); x.el.style.removeProperty("display");
      save(); renderAll(); toast("Geri qaytarıldı");
    }
  }
  function onSheet(e) {
    var b = e.target.closest("button"); if (!b) return;
    var a = b.dataset.a, el = S.sel;
    if (a === "desel") return select(null);
    if (a === "min") { S.min = !S.min; return renderAll(); }
    if (a === "pick") { var c = chain(el)[+b.dataset.i]; return c && select(c); }
    if (a === "free" || a === "order") {
      var same = S.direct && S.mode === (a === "free" ? "free" : "order");
      S.mode = a === "free" ? "free" : "order";
      S.direct = !same;
      if (S.direct) toast(a === "free" ? "İndi bloku barmaqla sürüşdür" : "Bloku başqa blokun üstünə çək");
      return renderAll();
    }
    if (a === "txt") return startText();
    if (a === "hide") return hideEl();
    if (a === "rst") return resetEl();
    if (a === "up") { var p = el.parentElement; return p && !p.classList.contains("screen") && p !== document.body ? select(p) : toast("Daha yuxarı blok yoxdur"); }
    if (a === "step") { var st = [1, 4, 10, 20], i = st.indexOf(S.step); S.step = st[(i + 1) % st.length]; return renderAll(); }
    if (a === "nl") return nudge(-1, 0);
    if (a === "nr") return nudge(1, 0);
    if (a === "nu") return nudge(0, -1);
    if (a === "nd") return nudge(0, 1);
  }
  function onInput(e) {
    var p = e.target.dataset && e.target.dataset.p; if (!p || !S.sel) return;
    var v = e.target.value;
    if (p === "s") return setProp("s", Math.abs(+v - 100) < 3 ? 0 : +v / 100);
    if (p === "fs") return setProp("fs", Math.max(8, Math.min(96, +v || 14)));
    setProp(p, v);
  }

  function toggle(on) {
    S.on = !!on;
    if (!S.on) { endText(); select(null); }
    document.documentElement.classList.toggle("p2-on", S.on);
    applyAll();   // ghost-ları yenilə
    renderAll();
    if (S.on) toast("Redaktə açıq — istənilən bloka toxun");
  }

  /* ---------- hadisələr ---------- */
  function onClick(e) {
    if (!S.on || !S.built) return;
    if (e.target.closest && e.target.closest(UIQ)) return;
    e.stopPropagation();
    var inEdit = S.editing && S.editing.contains(e.target);
    if (!inEdit) e.preventDefault();
    if (inEdit || D) return;
    var el = norm(e.target);
    if (!el || el.matches(UIQ)) return;
    if (S.editing) S.editing.blur();
    select(el);
  }
  function onDown(e) {
    if (!S.on || !S.sel || !S.direct || D || S.editing) return;
    if (e.target.closest && e.target.closest(UIQ)) return;
    if (!S.sel.contains(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startDrag(e);
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerdown", onDown, true);

  function posLoop() {
    var hd = $("p2-h");
    if (!hd) return;
    if (!hd.hidden && S.sel && document.contains(S.sel)) {
      var r = S.sel.getBoundingClientRect();
      var x = Math.min(Math.max(r.left + 4, 6), innerWidth - 50);
      var y = Math.min(Math.max(r.top - 22, 8), innerHeight - 60);
      hd.style.left = Math.round(x) + "px"; hd.style.top = Math.round(y) + "px";
    }
    requestAnimationFrame(posLoop);
  }

  /* admin vəziyyəti və lazımsız ekranlar */
  function sync() {
    var adm = isAdm();
    var blocked = !!document.querySelector("#exam-screen.active,#admin-panel.active,#v2-root[style*='block'],#v4-root[style*='block']");
    if (adm && !blocked && !S.built) buildUI();
    if ((!adm || blocked) && S.built) destroyUI();
    if (S.built) {
      if (S.sel && !document.contains(S.sel)) select(null);
      var tab = $("p2-tab"); if (tab) tab.hidden = S.rail;
    }
  }
  setInterval(sync, 600);

  window.DQPro2 = { apply: applyAll, rules: function () { return S.rules; }, toggle: toggle };
  var start = function () { observe(); load(); sync(); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
