/* Project enquiry form for pages other than Contact Us (which keeps its own inline copy).
   Needs /assets/country-codes.js loaded first, and the reCAPTCHA script on the page.
   Any <form data-enquiry data-form-type="project-enquiry"> on the page is wired up. */
(function () {
  'use strict';
  var SITE_KEY = '6LcCbLAtAAAAAP96kJR_8BtgttqaFCYXDA5oBVO4';
  var COUNTRIES = window.BW_COUNTRY_CODES || [];
  var COUNTRY_BY_ISO = {};
  COUNTRIES.forEach(function (c) { COUNTRY_BY_ISO[c[0]] = c; });
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // reCAPTCHA is heavy, so it loads only once someone starts using a form (or submits one).
  var captcha = null;
  function loadCaptcha() {
    if (!captcha) {
      captcha = new Promise(function (resolve) {
        if (window.grecaptcha && grecaptcha.ready) return grecaptcha.ready(function () { resolve(true); });
        var s = document.createElement('script');
        s.src = 'https://www.google.com/recaptcha/api.js?render=' + SITE_KEY;
        s.async = true;
        s.onload = function () { grecaptcha.ready(function () { resolve(true); }); };
        s.onerror = function () { resolve(false); };
        document.head.appendChild(s);
        setTimeout(function () { resolve(false); }, 10000);
      });
    }
    return captcha;
  }
  function captchaToken() {
    return loadCaptcha().then(function (ok) {
      return ok ? grecaptcha.execute(SITE_KEY, { action: 'submit' }) : '';
    }).catch(function () { return ''; });
  }

  document.querySelectorAll('form[data-enquiry]').forEach(function (form) {
    var note = form.querySelector('[data-note]');
    var sel = form.querySelector('select[name="phoneCode"]');
    var phoneInput = form.querySelector('input[type="tel"]');
    var emailInput = form.querySelector('input[type="email"]');
    var applyCountry = function () {};

    function clearErrors() { form.querySelectorAll('.fld.has-err').forEach(function (f) { f.classList.remove('has-err'); }); }
    function clearError(input) { var f = input.closest('.fld'); if (f) f.classList.remove('has-err'); }
    function markError(input, msg) {
      var f = input.closest('.fld'); if (!f) return;
      f.classList.add('has-err');
      if (msg) { var e = f.querySelector('.field-err'); if (e) e.textContent = msg; }
    }
    function say(text, colour) { if (note) { note.textContent = text; note.style.color = colour || ''; } }

    function checkEmail() {
      if (!emailInput) return true;
      var v = emailInput.value.trim();
      if (!v) {
        if (emailInput.hasAttribute('required')) { markError(emailInput, 'Please enter your email address.'); return false; }
        clearError(emailInput); return true;
      }
      if (!EMAIL_RE.test(v)) { markError(emailInput, 'Please enter a valid email address, e.g. name@company.com'); return false; }
      clearError(emailInput); return true;
    }
    function checkPhone() {
      if (!phoneInput) return true;
      var digits = phoneInput.value.replace(/\D/g, '');
      if (!digits) {
        if (phoneInput.hasAttribute('required')) { markError(phoneInput, 'Please enter your phone number.'); return false; }
        clearError(phoneInput); return true;
      }
      var country = sel ? COUNTRY_BY_ISO[sel.value] : null;
      var min = country ? country[3] : 6, max = country ? country[4] : 14;
      if (digits.length < min || digits.length > max) {
        var where = country ? country[1] : 'this country';
        markError(phoneInput, min === max ? 'Enter a ' + min + '-digit number for ' + where + '.' : 'Enter a ' + min + '–' + max + '-digit number for ' + where + '.');
        return false;
      }
      clearError(phoneInput); return true;
    }

    if (sel && phoneInput) {
      sel.innerHTML = COUNTRIES.map(function (c) {
        return '<option value="' + c[0] + '" data-dial="' + c[2] + '"' + (c[0] === 'IN' ? ' selected' : '') + '>' + c[0] + ' +' + c[2] + '</option>';
      }).join('');
      applyCountry = function () {
        var country = COUNTRY_BY_ISO[sel.value];
        if (sel.value && country) {
          phoneInput.disabled = false; phoneInput.placeholder = ''; phoneInput.setAttribute('maxlength', String(country[4]));
        } else {
          phoneInput.disabled = true; phoneInput.value = ''; phoneInput.placeholder = 'Select code first'; phoneInput.removeAttribute('maxlength');
        }
      };
      applyCountry();
      sel.addEventListener('change', function () { applyCountry(); checkPhone(); });
      phoneInput.addEventListener('keypress', function (e) { if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault(); });
      phoneInput.addEventListener('input', function () {
        var country = COUNTRY_BY_ISO[sel.value];
        phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, country ? country[4] : 15);
      });
      phoneInput.addEventListener('blur', checkPhone);
    }
    if (emailInput) emailInput.addEventListener('blur', checkEmail);
    form.querySelectorAll('input[required], select[required]').forEach(function (i) {
      i.addEventListener('input', function () { if (i.value.trim()) clearError(i); });
      i.addEventListener('change', function () { if (i.value.trim()) clearError(i); });
    });

    function validate() {
      clearErrors();
      var firstBad = null;
      form.querySelectorAll('input[required]:not([type="tel"]):not([type="email"]), select[required]:not([name="phoneCode"])').forEach(function (i) {
        if (!i.value.trim()) { markError(i); if (!firstBad) firstBad = i; }
      });
      if (!checkEmail() && !firstBad) firstBad = emailInput;
      if (!checkPhone() && !firstBad) firstBad = phoneInput;
      return firstBad;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstBad = validate();
      if (firstBad) { say('Please fix the highlighted field(s) so we can reply.', 'var(--error)'); firstBad.focus(); return; }

      var data = Object.fromEntries(new FormData(form).entries());
      if (sel && sel.value && data.phone) data.phone = '+' + sel.selectedOptions[0].getAttribute('data-dial') + ' ' + data.phone;
      delete data.phoneCode;
      data.formType = form.getAttribute('data-form-type') || 'project-enquiry';

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.style.opacity = '.6';
      say('Sending…');

      function submitWithToken(token) {
        data.recaptchaToken = token || '';
        return fetch('/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
          .then(function (r) { if (!r.ok) throw new Error('failed'); return r.json(); })
          .then(function () {
            say('Thank you — an engineer from our team will respond within two working days.', '#2f9e63');
            form.reset(); applyCountry(); clearErrors();
          })
          .catch(function () { say('Something went wrong sending this — please try again, or email info@bluewingconstruction.com.', 'var(--error)'); })
          .finally(function () { btn.disabled = false; btn.style.opacity = ''; });
      }
      captchaToken().then(submitWithToken);
    });
    form.addEventListener('focusin', loadCaptcha, { once: true });
  });
})();
