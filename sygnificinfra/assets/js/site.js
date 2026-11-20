/* Shared script for every page of this site (menu, header, sliders, forms, logo).
 * contact-us.html keeps its own inline copy with the phone-code form instead of this file. */
/* ════════════════════════════════════════════════════════════════
   BLUEWING GROUP — BEHAVIOUR LAYER
   Every block is feature-detected, so one file serves all pages.
   Each maps to a React hook/component in the Next.js port.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── sticky header → useScrollState() ─────────────────── */
  var hdr = document.getElementById('hdr');
  if (hdr) {
    var hdrTicking = false;
    var applyStuck = function () {
      hdrTicking = false;
      if (scrollY > 40) hdr.classList.add('stuck');
      else if (scrollY < 10) hdr.classList.remove('stuck');
    };
    var onScroll = function () {
      if (!hdrTicking) { requestAnimationFrame(applyStuck); hdrTicking = true; }
    };
    addEventListener('scroll', onScroll, { passive: true });
    applyStuck();
  }

  /* ── mobile drawer → <MobileDrawer /> ─────────────────── */
  var drw = document.getElementById('drw'), burger = document.getElementById('burger');
  if (drw && burger) {
    var setDrw = function (open) {
      drw.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', function () { setDrw(!drw.classList.contains('open')); });
    drw.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { setDrw(false); });
    });
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drw.classList.contains('open')) { setDrw(false); burger.focus(); }
    });
  }

  /* ── hero project slider → <HeroSlider /> ──────────────
     Slides are declared on the page as window.BW_SLIDES so the
     markup stays static and a CMS can inject the array. */
  var bg = document.getElementById('heroBg');
  var cap = document.getElementById('slide');
  if (bg && cap && window.BW_SLIDES && window.BW_SLIDES.length) {
    var slides = window.BW_SLIDES;
    var imgs = bg.querySelectorAll('img');
    var dots = document.getElementById('dots');
    var cur = 0, timer = null;
    var f = function (n) { return cap.querySelector('[data-f="' + n + '"]'); };

    slides.forEach(function (_, i) {
      var d = document.createElement('button');
      d.className = 'dot';
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-selected', String(i === 0));
      d.setAttribute('aria-label', 'Project ' + (i + 1));
      d.addEventListener('click', function () { go(i); });
      dots.appendChild(d);
    });
    var allDots = dots.querySelectorAll('.dot');

    function paint(i) {
      var s = slides[i];
      imgs.forEach(function (im, n) { im.classList.toggle('on', n === i); });
      f('tag').textContent = s.tag;
      f('name').textContent = s.name;
      f('idx').textContent = ('0' + (i + 1)).slice(-2);
      f('total').textContent = ('0' + slides.length).slice(-2);
      f('href').setAttribute('href', s.href);
      allDots.forEach(function (d, n) {
        d.setAttribute('aria-selected', String(n === i));
        d.classList.remove('run');
        if (n === i && !reduce) { void d.offsetWidth; d.classList.add('run'); }
      });
    }
    function go(i) { cur = (i + slides.length) % slides.length; paint(cur); restart(); }
    function restart() {
      if (reduce) return;
      clearInterval(timer);
      timer = setInterval(function () { go(cur + 1); }, 7000);
    }
    document.getElementById('next').addEventListener('click', function () { go(cur + 1); });
    document.getElementById('prev').addEventListener('click', function () { go(cur - 1); });
    cap.addEventListener('mouseenter', function () { clearInterval(timer); });
    cap.addEventListener('mouseleave', restart);
    cap.addEventListener('focusin', function () { clearInterval(timer); });
    cap.addEventListener('focusout', restart);
    document.addEventListener('visibilitychange', function () {
      document.hidden ? clearInterval(timer) : restart();
    });
    paint(0); restart();
  }

  /* ── FAQ accordion → <Accordion /> ────────────────────── */
  document.querySelectorAll('.acc__b').forEach(function (btn) {
    var body = btn.nextElementSibling;
    var set = function (open) {
      btn.setAttribute('aria-expanded', String(open));
      body.style.height = open ? body.scrollHeight + 'px' : '0px';
    };
    if (btn.getAttribute('aria-expanded') === 'true') requestAnimationFrame(function () { set(true); });
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      // one item open at a time: opening this one closes the others in the same accordion
      if (open) (btn.closest('.acc') || document).querySelectorAll('.acc__b[aria-expanded="true"]').forEach(function (o) {
        if (o !== btn) { o.setAttribute('aria-expanded', 'false'); o.nextElementSibling.style.height = '0px'; }
      });
      set(open);
    });
    addEventListener('resize', function () {
      if (btn.getAttribute('aria-expanded') === 'true') body.style.height = body.scrollHeight + 'px';
    });
  });

  /* ── reveals + stat counters → useInView() ─────────────
     Counters carry data-to plus an optional data-suffix, so the
     figure and its unit stay together in one source of truth. */
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
      if (en.target.classList.contains('stats')) count(en.target);
    });
  }, { threshold: .14, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.rv, .stats').forEach(function (el) { io.observe(el); });

  function count(scope) {
    scope.querySelectorAll('.ct').forEach(function (el) {
      var to = parseFloat(el.dataset.to), dp = (el.dataset.dp | 0), t0 = null;
      if (reduce) { el.textContent = to.toFixed(dp); return; }
      requestAnimationFrame(function tick(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / 1600, 1);
        el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dp);
        if (p < 1) requestAnimationFrame(tick);
      });
    });
  }

  /* ── contact form switcher → <FormTabs /> ──────────────── */
  var ftabs = Array.prototype.slice.call(document.querySelectorAll('.ftab'));
  if (ftabs.length) {
    var pick = function (tab) {
      ftabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    };
    ftabs.forEach(function (tab, i) {
      tab.tabIndex = i === 0 ? 0 : -1;
      tab.addEventListener('click', function () { pick(tab); });
      tab.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = ftabs[(i + d + ftabs.length) % ftabs.length];
        pick(n); n.focus();
      });
    });
  }

  /* ── partner / enquiry form → POST /api/enquiry ────────── */
  document.querySelectorAll('form[data-enquiry]').forEach(function (form) {
    var note = form.querySelector('[data-note]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var bad = null;
      form.querySelectorAll('input[required], select[required]').forEach(function (i) {
        if (!bad && (!i.value || !i.checkValidity())) bad = i;
      });
      if (bad) {
        note.textContent = 'Please complete the highlighted field so we can reply.';
        note.style.color = '#FFB4A8';
        bad.focus();
        return;
      }
      /* TODO: fetch('/api/enquiry', { method:'POST', body:new FormData(form) }) */
      note.textContent = 'Thank you — an engineer from our team will respond within two working days.';
      note.style.color = '#7BE0A8';
      form.reset();
    });
  });

  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();
})();


/* Company logo set from the admin panel; falls back to the logo built into the page. */
(function (site) {
  'use strict';
  var KEY = 'bw_logo_' + site;
  var originals = Array.prototype.slice.call(document.querySelectorAll('.hdr .brand__mark, .drw .brand__mark, .ftr .ftr__lg'));
  if (!originals.length) return;
  var current = originals.slice(), applied = '';
  function apply(url) {
    url = url || '';
    if (url === applied) return;
    applied = url;
    current = current.map(function (el, i) {
      var orig = originals[i], next = orig;
      if (url) {
        next = document.createElement('img');
        next.className = orig.getAttribute('class');
        next.alt = orig.getAttribute('alt') || orig.getAttribute('aria-label') || '';
        next.decoding = 'async';
        next.src = url;
      }
      if (next !== el) el.parentNode.replaceChild(next, el);
      return next;
    });
  }
  try { apply(localStorage.getItem(KEY)); } catch (e) {}
  fetch('/api/media?logos', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      var url = d[site] || '';
      try { url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY); } catch (e) {}
      apply(url);
    })
    .catch(function () {});
})('sygnificinfra');
