(function () {
  'use strict';

  /* ---------- helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isVideoUrl(url) {
    return /\.(mp4|webm|mov|mkv)(\?|$)/i.test(url || '');
  }
  function mediaThumb(url) {
    return isVideoUrl(url)
      ? '<video src="' + esc(url) + '" muted preload="metadata"></video>'
      : '<img src="' + esc(url) + '" loading="lazy">';
  }

  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 3200);
  }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(path, Object.assign({ credentials: 'include', cache: 'no-store' }, opts, {
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    }));
    if (res.status === 401) {
      showLogin();
      throw new Error('Session expired, please log in again');
    }
    var body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((body && body.error) || 'Request failed');
    return body;
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadFile(file) {
    // Videos (and anything else too big for a base64 JSON POST) go straight
    // to Blob storage from the browser, bypassing the serverless function's
    // request-size limit entirely.
    var isVideo = file.type.indexOf('video/') === 0;
    if (isVideo || file.size > 4 * 1024 * 1024) {
      if (!window.__bwBlobUpload) throw new Error('Upload helper failed to load — please refresh the page and try again.');
      var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var key = 'uploads/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safeName;
      var blob = await window.__bwBlobUpload(key, file, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
      });
      return blob.url;
    }
    var dataBase64 = await fileToBase64(file);
    var result = await api('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, dataBase64: dataBase64, contentType: file.type }),
    });
    return result.url;
  }

  /* ---------- auth ---------- */
  function showLogin() {
    $('#login-screen').hidden = false;
    $('#app').hidden = true;
  }
  function showApp() {
    $('#login-screen').hidden = true;
    $('#app').hidden = false;
  }

  async function checkSession() {
    try {
      var r = await fetch('/api/me', { credentials: 'include' });
      var body = await r.json();
      if (body && body.authenticated) {
        showApp();
        initAppData();
      } else {
        showLogin();
      }
    } catch (e) {
      showLogin();
    }
  }

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var username = $('#login-username').value.trim();
    var password = $('#login-password').value;
    var errEl = $('#login-error');
    errEl.hidden = true;
    var btn = $('#login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ username: username, password: password }) });
      showApp();
      initAppData();
    } catch (err) {
      errEl.textContent = err.message || 'Invalid username or password';
      errEl.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  $('#logout-btn').addEventListener('click', async function () {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
    showLogin();
  });

  /* ---------- forgot / reset password ---------- */
  function showCard(id) {
    ['login-form', 'forgot-form', 'reset-form'].forEach(function (f) { $('#' + f).hidden = f !== id; });
  }
  function showMsg(el, text, ok) {
    el.textContent = text;
    el.classList.toggle('ok-msg', !!ok);
    el.hidden = false;
  }

  // The emailed link opens /new-pillar/?reset=<token>; drop it from the address bar right away.
  var resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) history.replaceState(null, '', location.pathname);

  $('#forgot-link').addEventListener('click', function () {
    $('#forgot-username').value = $('#login-username').value.trim();
    $('#forgot-msg').hidden = true;
    showCard('forgot-form');
  });
  $all('[data-back-to-login]').forEach(function (b) {
    b.addEventListener('click', function () { showCard('login-form'); });
  });

  $('#forgot-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = $('#forgot-msg');
    msg.hidden = true;
    var btn = $('#forgot-btn');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      var r = await api('/api/login', { method: 'POST', body: JSON.stringify({ action: 'forgot', username: $('#forgot-username').value.trim() }) });
      showMsg(msg, r.message, true);
    } catch (err) {
      showMsg(msg, err.message || 'Could not send the reset link');
    } finally {
      btn.disabled = false; btn.textContent = 'Send reset link';
    }
  });

  $('#reset-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = $('#reset-msg');
    msg.hidden = true;
    var password = $('#reset-password').value;
    if (password !== $('#reset-confirm').value) {
      showMsg(msg, 'The two passwords do not match.');
      return;
    }
    var btn = $('#reset-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ action: 'reset', token: resetToken, password: password }) });
      resetToken = null;
      showCard('login-form');
      showApp();
      initAppData();
      toast('Password updated');
    } catch (err) {
      showMsg(msg, err.message || 'Could not update the password');
    } finally {
      btn.disabled = false; btn.textContent = 'Set new password';
    }
  });

  /* ---------- tabs ---------- */
  $all('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $all('.nav-item').forEach(function (b) { b.classList.remove('is-active'); });
      $all('.tab-panel').forEach(function (p) { p.classList.remove('is-active'); });
      btn.classList.add('is-active');
      $('#tab-' + btn.dataset.tab).classList.add('is-active');
    });
  });

  /* ---------- modal helpers ---------- */
  function openModal(id) { $('#' + id).hidden = false; }
  function closeModal(id) { $('#' + id).hidden = true; }
  $all('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
  });
  $all('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) m.hidden = true; });
  });

  /* ---------- rich text editor (Quill, WordPress-style, with a Visual/Text toggle) ---------- */
  function createRTE(container) {
    container.innerHTML = '';

    var modeBar = document.createElement('div');
    modeBar.className = 'rte-modebar';
    modeBar.innerHTML = '<button type="button" class="rte-mode-btn is-active" data-mode="visual">Visual</button>' +
      '<button type="button" class="rte-mode-btn" data-mode="text">Text (HTML)</button>';
    container.appendChild(modeBar);

    var editorHost = document.createElement('div');
    container.appendChild(editorHost);

    var codeArea = document.createElement('textarea');
    codeArea.className = 'rte-code';
    codeArea.hidden = true;
    codeArea.spellcheck = false;
    container.appendChild(codeArea);

    var quill = new Quill(editorHost, {
      theme: 'snow',
      placeholder: 'Write content here…',
      modules: {
        toolbar: {
          container: [
            [{ header: [2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['blockquote', 'link', 'image', 'video'],
            ['clean'],
          ],
          handlers: {
            image: function () {
              var range = quill.getSelection(true);
              mediaPicker.open({
                multiple: false,
                onSelect: function (urls) {
                  if (urls[0]) {
                    quill.insertEmbed(range.index, 'image', urls[0], 'user');
                    quill.setSelection(range.index + 1);
                  }
                },
              });
            },
            video: function () {
              var range = quill.getSelection(true);
              var url = prompt('Paste a YouTube link, or the link to an uploaded video file (mp4/webm):', 'https://');
              if (!url || url === 'https://') return;
              var yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{6,})/);
              // Quill only recognizes its own 'video' embed (an iframe) — a
              // raw <video> tag isn't a format it knows about, so it gets
              // silently dropped the instant it's inserted. Browsers happily
              // play a direct video file inside an iframe too, so route both
              // YouTube and direct file links through the same native embed.
              var embedUrl = yt ? ('https://www.youtube.com/embed/' + yt[1]) : url;
              quill.insertEmbed(range.index, 'video', embedUrl, 'user');
              quill.setSelection(range.index + 1);
            },
          },
        },
      },
    });

    var mode = 'visual';
    modeBar.querySelectorAll('.rte-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.mode === mode) return;
        if (btn.dataset.mode === 'text') {
          codeArea.value = quill.root.innerHTML.trim();
          editorHost.hidden = true;
          codeArea.hidden = false;
          mode = 'text';
        } else {
          var hasCustomWidgets = /<button|<svg|<form|<video/i.test(codeArea.value);
          if (hasCustomWidgets && !confirm(
            'This content has custom elements (like buttons, icons, an uploaded video, or an FAQ accordion) that the Visual editor cannot display — switching will permanently strip them out.\n\n' +
            'Click Cancel to stay in Text mode and keep this content safe, or OK to continue anyway.'
          )) {
            return;
          }
          quill.root.innerHTML = codeArea.value.trim() || '<p><br></p>';
          codeArea.hidden = true;
          editorHost.hidden = false;
          mode = 'visual';
        }
        modeBar.querySelectorAll('.rte-mode-btn').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      });
    });

    function setActiveMode(newMode) {
      mode = newMode;
      codeArea.hidden = newMode !== 'text';
      editorHost.hidden = newMode === 'text';
      modeBar.querySelectorAll('.rte-mode-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.mode === newMode); });
    }

    return {
      getHTML: function () {
        var html = (mode === 'text' ? codeArea.value : quill.root.innerHTML).trim();
        return html === '<p><br></p>' ? '' : html;
      },
      setHTML: function (html) {
        codeArea.value = html || '';
        // Content with custom widgets (buttons, SVG icons, forms — e.g. an FAQ
        // accordion) gets silently stripped the instant it enters Quill's DOM,
        // even just by opening it. Keep it safely in Text mode until the user
        // explicitly opts into Visual (and accepts the strip-warning there).
        if (/<button|<svg|<form|<video/i.test(html || '')) {
          setActiveMode('text');
        } else {
          quill.root.innerHTML = html && html.trim() ? html : '<p><br></p>';
          setActiveMode('visual');
        }
      },
    };
  }

  /* ---------- media picker popup (Elementor-style) ---------- */
  function createMediaPicker() {
    var gridEl = $('#media-picker-grid');
    var uploadBtn = $('#media-picker-upload-btn');
    var uploadInput = $('#media-picker-upload-input');
    var confirmBtn = $('#media-picker-confirm-btn');
    var hintEl = $('#media-picker-hint');
    var allMedia = [];
    var selected = [];
    var multiple = true;
    var onSelectCb = null;

    function renderGrid() {
      if (!allMedia.length) {
        gridEl.innerHTML = '<div class="empty-note" style="grid-column:1/-1">No images uploaded yet. Click "Upload new image" to add one.</div>';
      } else {
        gridEl.innerHTML = allMedia.map(function (m) {
          var isSel = selected.indexOf(m.url) !== -1;
          return '<div class="media-item' + (isSel ? ' is-selected' : '') + '" data-url="' + esc(m.url) + '">' + mediaThumb(m.url) + '</div>';
        }).join('');
        $all('.media-item', gridEl).forEach(function (el) {
          el.addEventListener('click', function () {
            var url = el.dataset.url;
            if (multiple) {
              var idx = selected.indexOf(url);
              if (idx === -1) selected.push(url); else selected.splice(idx, 1);
            } else {
              selected = [url];
            }
            renderGrid();
          });
        });
      }
      hintEl.textContent = selected.length ? selected.length + ' selected' : '';
    }

    async function loadMedia() {
      gridEl.innerHTML = '<div class="empty-note" style="grid-column:1/-1">Loading…</div>';
      try {
        var media = await api('/api/media');
        // This picker is only ever used for image fields (blog/project images,
        // author photo) — videos live in the Media Library tab and get used
        // via the Content editor's own Video button instead.
        allMedia = media.filter(function (m) { return !isVideoUrl(m.url); });
        renderGrid();
      } catch (err) {
        gridEl.innerHTML = '<div class="empty-note" style="grid-column:1/-1">' + esc(err.message) + '</div>';
      }
    }

    uploadBtn.addEventListener('click', function () { uploadInput.click(); });
    uploadInput.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(uploadInput.files);
      uploadInput.value = '';
      for (var i = 0; i < files.length; i++) {
        hintEl.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
        try {
          var url = await uploadFile(files[i]);
          allMedia.unshift({ url: url });
          if (multiple) selected.push(url); else selected = [url];
        } catch (err) {
          toast('Upload failed: ' + err.message, true);
        }
      }
      renderGrid();
    });

    confirmBtn.addEventListener('click', function () {
      if (onSelectCb) onSelectCb(selected.slice());
      closeModal('media-picker-modal');
    });

    return {
      open: function (opts) {
        opts = opts || {};
        multiple = opts.multiple !== false;
        selected = (opts.current || []).slice();
        onSelectCb = opts.onSelect || null;
        openModal('media-picker-modal');
        loadMedia();
      },
    };
  }
  var mediaPicker = createMediaPicker();

  /* ---------- image uploader (multi or single, backed by the media picker) ---------- */
  function createImageUploader(addBtn, thumbsEl, initial, opts) {
    opts = opts || {};
    var multiple = opts.multiple !== false;
    var featurable = !!opts.featurable;
    var items = (initial || []).slice(); // [{url}]

    function render() {
      thumbsEl.innerHTML = '';
      items.forEach(function (item, i) {
        var d = document.createElement('div');
        d.className = 'thumb' + (featurable && i === 0 ? ' is-featured' : '');
        d.innerHTML = '<img src="' + esc(item.url) + '">' +
          (featurable && i === 0 ? '<span class="thumb-badge">Featured</span>' : '') +
          (featurable && i !== 0 ? '<button type="button" class="thumb-star" data-star="' + i + '" title="Set as featured image">&#9733;</button>' : '') +
          '<button type="button" class="rm" data-i="' + i + '">&times;</button>';
        thumbsEl.appendChild(d);
      });
    }
    thumbsEl.addEventListener('click', function (e) {
      if (e.target.classList.contains('rm')) {
        items.splice(parseInt(e.target.dataset.i, 10), 1);
        render();
      } else if (e.target.classList.contains('thumb-star')) {
        var idx = parseInt(e.target.dataset.star, 10);
        var picked = items.splice(idx, 1)[0];
        items.unshift(picked);
        render();
      }
    });
    addBtn.addEventListener('click', function () {
      mediaPicker.open({
        multiple: multiple,
        current: items.map(function (it) { return it.url; }),
        onSelect: function (urls) {
          if (!multiple) {
            items = urls.length ? [{ url: urls[0] }] : [];
          } else {
            urls.forEach(function (u) {
              if (!items.some(function (it) { return it.url === u; })) items.push({ url: u });
            });
          }
          render();
        },
      });
    });
    render();
    return {
      getItems: function () { return items.slice(); },
      setItems: function (list) { items = (list || []).slice(); render(); },
    };
  }

  /* ---------- BLOG ---------- */
  var blogRTE = null;
  function getBlogRTE() { if (!blogRTE) blogRTE = createRTE($('#blog-content-rte')); return blogRTE; }
  var blogUploader = createImageUploader($('#blog-images-add-btn'), $('#blog-images-thumbs'), [], { multiple: true });
  var blogPosts = [];

  $all('input[name="blog-media-type"]').forEach(function (r) {
    r.addEventListener('change', updateBlogMediaVisibility);
  });
  function updateBlogMediaVisibility() {
    var type = $('input[name="blog-media-type"]:checked').value;
    $('#blog-media-video-wrap').hidden = type !== 'video';
    $('#blog-media-images-wrap').hidden = type === 'video';
  }

  function renderBlogList() {
    var el = $('#blog-list');
    if (!blogPosts.length) {
      el.innerHTML = '<div class="empty-note">No blog posts yet. Click "New blog post" to add one.</div>';
      return;
    }
    el.innerHTML = blogPosts.map(function (p) {
      var img = p.coverImage || (p.media && p.media[0] && p.media[0].url) || '';
      return '<div class="item-card">' +
        (img ? '<img src="' + esc(img) + '">' : '<div style="width:56px;height:56px;background:#eee;border-radius:8px"></div>') +
        '<div class="info"><h4>' + esc(p.title) + '</h4><p>' + esc(p.category || 'Uncategorised') + (p.tags && p.tags.length ? ' · ' + esc(p.tags.join(', ')) : '') + '</p></div>' +
        '<span class="badge' + (p.published !== false ? ' on' : '') + '">' + (p.published !== false ? 'Published' : 'Draft') + '</span>' +
        '<div class="actions">' +
        '<button class="btn btn-sm" data-edit="' + p.id + '">Edit</button>' +
        '<button class="btn btn-sm" data-dup="' + p.id + '">Duplicate</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
    $all('[data-edit]', el).forEach(function (b) {
      b.addEventListener('click', function () { openBlogModal(blogPosts.find(function (p) { return p.id === b.dataset.edit; })); });
    });
    $all('[data-dup]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var src = blogPosts.find(function (p) { return p.id === b.dataset.dup; });
        openBlogModal(Object.assign({}, src, { id: '', title: src.title + ' (Copy)', slug: '' }));
      });
    });
    $all('[data-del]', el).forEach(function (b) {
      b.addEventListener('click', function () { deleteBlog(b.dataset.del); });
    });
  }

  function refreshCategoryList(datalistId, items, field) {
    var vals = Array.from(new Set(items.map(function (i) { return i[field]; }).filter(Boolean)));
    $(datalistId).innerHTML = vals.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
  }

  async function loadBlog() {
    blogPosts = await api('/api/blog');
    renderBlogList();
    refreshCategoryList('#blog-category-list', blogPosts, 'category');
  }

  var faqState = [];
  function renderFaqEditor() {
    var listEl = $('#blog-faq-list');
    if (!faqState.length) {
      listEl.innerHTML = '<p class="faq-hint">No FAQs yet — the FAQ section stays hidden on the site until you add at least one.</p>';
      return;
    }
    listEl.innerHTML = faqState.map(function (f, i) {
      return '<div class="faq-item">' +
        '<div class="faq-item-head"><b>FAQ ' + (i + 1) + '</b><button type="button" class="btn btn-sm btn-danger" data-faq-remove="' + i + '">Remove</button></div>' +
        '<input type="text" data-faq-q="' + i + '" placeholder="Question" value="' + esc(f.question) + '">' +
        '<textarea data-faq-a="' + i + '" placeholder="Answer — start a line with - for a bullet point">' + esc(f.answer) + '</textarea>' +
        '</div>';
    }).join('');
    $all('[data-faq-remove]', listEl).forEach(function (b) {
      b.addEventListener('click', function () { faqState.splice(parseInt(b.dataset.faqRemove, 10), 1); renderFaqEditor(); });
    });
    $all('[data-faq-q]', listEl).forEach(function (i) {
      i.addEventListener('input', function () { faqState[parseInt(i.dataset.faqQ, 10)].question = i.value; });
    });
    $all('[data-faq-a]', listEl).forEach(function (i) {
      i.addEventListener('input', function () { faqState[parseInt(i.dataset.faqA, 10)].answer = i.value; });
    });
  }
  $('#blog-faq-add-btn').addEventListener('click', function () {
    faqState.push({ question: '', answer: '' });
    renderFaqEditor();
  });

  function openBlogModal(post) {
    $('#blog-modal-title').textContent = post ? 'Edit blog post' : 'New blog post';
    $('#blog-id').value = post ? post.id : '';
    $('#blog-title').value = post ? post.title : '';
    $('#blog-excerpt').value = post ? post.excerpt : '';
    $('#blog-category').value = post ? post.category : '';
    $('#blog-tags').value = post && post.tags ? post.tags.join(', ') : '';
    $('#blog-author').value = post ? (post.authorId || '') : '';
    var mediaType = post ? (post.mediaType || 'grid') : 'grid';
    $all('input[name="blog-media-type"]').forEach(function (r) { r.checked = r.value === mediaType; });
    $('#blog-video-url').value = post ? (post.videoUrl || '') : '';
    blogUploader.setItems(post ? (post.media || []) : []);
    updateBlogMediaVisibility();
    faqState = post && Array.isArray(post.faqs) ? post.faqs.map(function (f) { return { question: f.question, answer: f.answer }; }) : [];
    renderFaqEditor();
    $('#blog-published').checked = !post || post.published !== false;
    openModal('blog-modal');
    // Quill must initialize while its container is actually visible, or its
    // toolbar/editor sizing breaks — so create/populate it after the modal opens.
    getBlogRTE().setHTML(post ? post.content : '');
  }
  $('#blog-new-btn').addEventListener('click', function () { openBlogModal(null); });

  $('#blog-save-btn').addEventListener('click', async function () {
    var title = $('#blog-title').value.trim();
    if (!title) { toast('Title is required', true); return; }
    var payload = {
      id: $('#blog-id').value || undefined,
      title: title,
      excerpt: $('#blog-excerpt').value.trim(),
      content: getBlogRTE().getHTML(),
      category: $('#blog-category').value.trim(),
      tags: $('#blog-tags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      faqs: faqState.filter(function (f) { return f.question.trim() && f.answer.trim(); }),
      authorId: $('#blog-author').value,
      mediaType: $('input[name="blog-media-type"]:checked').value,
      media: blogUploader.getItems(),
      videoUrl: $('#blog-video-url').value.trim(),
      published: $('#blog-published').checked,
    };
    payload.coverImage = payload.media[0] ? payload.media[0].url : '';
    var btn = $('#blog-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (payload.id) {
        await api('/api/blog', { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        delete payload.id;
        await api('/api/blog', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal('blog-modal');
      toast('Blog post saved');
      await loadBlog();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Save post';
    }
  });

  async function deleteBlog(id) {
    if (!confirm('Delete this blog post? This cannot be undone.')) return;
    try {
      await api('/api/blog?id=' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Deleted');
      await loadBlog();
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- PROJECTS ---------- */
  var projectRTE = null;
  function getProjectRTE() { if (!projectRTE) projectRTE = createRTE($('#project-content-rte')); return projectRTE; }
  var projectUploader = createImageUploader($('#project-images-add-btn'), $('#project-images-thumbs'), [], { multiple: true, featurable: true });
  var projects = [];
  var tableState = { headers: ['Field', 'Value'], rows: [['Status', 'Ongoing'], ['Location', 'Gujarat, India']] };

  function renderTableEditor() {
    var t = $('#project-table-editor');
    var thead = '<thead><tr>' + tableState.headers.map(function (h, ci) {
      return '<th><input type="text" data-h="' + ci + '" value="' + esc(h) + '" placeholder="Header"></th>';
    }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + tableState.rows.map(function (row, ri) {
      return '<tr>' + row.map(function (cell, ci) {
        return '<td><input type="text" data-r="' + ri + '" data-c="' + ci + '" value="' + esc(cell) + '"></td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
    t.innerHTML = thead + tbody;
    $all('th input', t).forEach(function (inp) {
      inp.addEventListener('input', function () { tableState.headers[parseInt(inp.dataset.h, 10)] = inp.value; });
    });
    $all('td input', t).forEach(function (inp) {
      inp.addEventListener('input', function () {
        tableState.rows[parseInt(inp.dataset.r, 10)][parseInt(inp.dataset.c, 10)] = inp.value;
      });
    });
  }
  $('#table-add-row').addEventListener('click', function () {
    tableState.rows.push(tableState.headers.map(function () { return ''; }));
    renderTableEditor();
  });
  $('#table-remove-row').addEventListener('click', function () {
    if (tableState.rows.length > 1) tableState.rows.pop();
    renderTableEditor();
  });
  $('#table-add-col').addEventListener('click', function () {
    tableState.headers.push('');
    tableState.rows.forEach(function (r) { r.push(''); });
    renderTableEditor();
  });
  $('#table-remove-col').addEventListener('click', function () {
    if (tableState.headers.length > 1) {
      tableState.headers.pop();
      tableState.rows.forEach(function (r) { r.pop(); });
    }
    renderTableEditor();
  });

  function renderProjectsList() {
    var el = $('#projects-list');
    if (!projects.length) {
      el.innerHTML = '<div class="empty-note">No projects yet. Click "New project" to add one.</div>';
      return;
    }
    el.innerHTML = projects.map(function (p) {
      var img = p.images && p.images[0] ? p.images[0].url : '';
      return '<div class="item-card">' +
        (img ? '<img src="' + esc(img) + '">' : '<div style="width:56px;height:56px;background:#eee;border-radius:8px"></div>') +
        '<div class="info"><h4>' + esc(p.title) + '</h4><p>' + esc(p.status) + (p.category ? ' · ' + esc(p.category) : '') + '</p></div>' +
        '<span class="badge' + (p.published !== false ? ' on' : '') + '">' + (p.published !== false ? 'Published' : 'Draft') + '</span>' +
        '<div class="actions">' +
        '<button class="btn btn-sm" data-edit="' + p.id + '">Edit</button>' +
        '<button class="btn btn-sm" data-dup="' + p.id + '">Duplicate</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
    $all('[data-edit]', el).forEach(function (b) {
      b.addEventListener('click', function () { openProjectModal(projects.find(function (p) { return p.id === b.dataset.edit; })); });
    });
    $all('[data-dup]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var src = projects.find(function (p) { return p.id === b.dataset.dup; });
        openProjectModal(Object.assign({}, src, { id: '', title: src.title + ' (Copy)', slug: '', legacyUrl: '' }));
      });
    });
    $all('[data-del]', el).forEach(function (b) {
      b.addEventListener('click', function () { deleteProject(b.dataset.del); });
    });
  }

  async function loadProjects() {
    projects = await api('/api/projects');
    renderProjectsList();
    refreshCategoryList('#project-category-list', projects, 'category');
  }

  function openProjectModal(p) {
    $('#project-modal-title').textContent = p ? 'Edit project' : 'New project';
    $('#project-id').value = p ? p.id : '';
    $('#project-title').value = p ? p.title : '';
    $('#project-status').value = p ? p.status : 'Ongoing';
    $('#project-category').value = p ? p.category : '';
    $('#project-tags').value = p && p.tags ? p.tags.join(', ') : '';
    $('#project-photo-caption').value = p ? (p.photoCaption || '') : '';
    $('#project-photo-credit').value = p ? (p.photoCredit || '') : '';
    projectUploader.setItems(p ? (p.images || []) : []);
    tableState = p && p.table && p.table.headers && p.table.headers.length
      ? { headers: p.table.headers.slice(), rows: p.table.rows.map(function (r) { return r.slice(); }) }
      : { headers: ['Field', 'Value'], rows: [['Status', 'Ongoing'], ['Location', 'Gujarat, India']] };
    renderTableEditor();
    $('#project-published').checked = !p || p.published !== false;
    openModal('project-modal');
    getProjectRTE().setHTML(p ? p.content : '');
  }
  $('#projects-new-btn').addEventListener('click', function () { openProjectModal(null); });

  $('#project-save-btn').addEventListener('click', async function () {
    var title = $('#project-title').value.trim();
    if (!title) { toast('Title is required', true); return; }
    var payload = {
      id: $('#project-id').value || undefined,
      title: title,
      status: $('#project-status').value,
      category: $('#project-category').value.trim(),
      tags: $('#project-tags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      content: getProjectRTE().getHTML(),
      images: projectUploader.getItems(),
      photoCaption: $('#project-photo-caption').value.trim(),
      photoCredit: $('#project-photo-credit').value.trim(),
      table: tableState,
      published: $('#project-published').checked,
    };
    var btn = $('#project-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (payload.id) {
        await api('/api/projects', { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        delete payload.id;
        await api('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal('project-modal');
      toast('Project saved');
      await loadProjects();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Save project';
    }
  });

  async function deleteProject(id) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await api('/api/projects?id=' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Deleted');
      await loadProjects();
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- CAREERS ---------- */
  var careerRTE = null;
  function getCareerRTE() { if (!careerRTE) careerRTE = createRTE($('#career-content-rte')); return careerRTE; }
  var careers = [];

  function renderCareersList() {
    var el = $('#careers-list');
    if (!careers.length) {
      el.innerHTML = '<div class="empty-note">No openings yet. Click "New opening" to add one.</div>';
      return;
    }
    el.innerHTML = careers.map(function (c) {
      return '<div class="item-card">' +
        '<div class="info"><h4>' + esc(c.title) + '</h4><p>' + esc(c.tag || c.type) + ' · ' + esc(c.location) + '</p></div>' +
        '<span class="badge' + (c.active !== false ? ' on' : '') + '">' + (c.active !== false ? 'Active' : 'Hidden') + '</span>' +
        '<div class="actions">' +
        '<button class="btn btn-sm" data-edit="' + c.id + '">Edit</button>' +
        '<button class="btn btn-sm" data-dup="' + c.id + '">Duplicate</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + c.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
    $all('[data-edit]', el).forEach(function (b) {
      b.addEventListener('click', function () { openCareerModal(careers.find(function (c) { return c.id === b.dataset.edit; })); });
    });
    $all('[data-dup]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        var src = careers.find(function (c) { return c.id === b.dataset.dup; });
        openCareerModal(Object.assign({}, src, { id: '', title: src.title + ' (Copy)' }));
      });
    });
    $all('[data-del]', el).forEach(function (b) {
      b.addEventListener('click', function () { deleteCareer(b.dataset.del); });
    });
  }

  async function loadCareers() {
    careers = await api('/api/careers');
    renderCareersList();
  }

  function openCareerModal(c) {
    $('#career-modal-title').textContent = c ? 'Edit opening' : 'New opening';
    $('#career-id').value = c ? c.id : '';
    $('#career-title').value = c ? c.title : '';
    $('#career-tag').value = c ? c.tag : '';
    $('#career-type').value = c ? c.type : 'Full-time';
    $('#career-location').value = c ? c.location : 'Ahmedabad';
    $('#career-email').value = c ? c.applyEmail : 'careers@bluewingconstruction.com';
    $('#career-active').checked = !c || c.active !== false;
    openModal('career-modal');
    getCareerRTE().setHTML(c ? c.description : '');
  }
  $('#careers-new-btn').addEventListener('click', function () { openCareerModal(null); });

  $('#career-save-btn').addEventListener('click', async function () {
    var title = $('#career-title').value.trim();
    if (!title) { toast('Job title is required', true); return; }
    var payload = {
      id: $('#career-id').value || undefined,
      title: title,
      tag: $('#career-tag').value.trim(),
      type: $('#career-type').value,
      location: $('#career-location').value.trim(),
      applyEmail: $('#career-email').value.trim(),
      description: getCareerRTE().getHTML(),
      active: $('#career-active').checked,
    };
    var btn = $('#career-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (payload.id) {
        await api('/api/careers', { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        delete payload.id;
        await api('/api/careers', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal('career-modal');
      toast('Opening saved');
      await loadCareers();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Save opening';
    }
  });

  async function deleteCareer(id) {
    if (!confirm('Delete this opening? This cannot be undone.')) return;
    try {
      await api('/api/careers?id=' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Deleted');
      await loadCareers();
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- AUTHORS (Settings tab) ---------- */
  var authorUploader = createImageUploader($('#author-image-add-btn'), $('#author-image-thumbs'), [], { multiple: false });
  var authors = [];

  function renderAuthorsList() {
    var el = $('#authors-list');
    if (!authors.length) {
      el.innerHTML = '<div class="empty-note">No authors yet. Click "New author" to add one.</div>';
      return;
    }
    el.innerHTML = authors.map(function (a) {
      return '<div class="item-card">' +
        (a.image ? '<img src="' + esc(a.image) + '">' : '<div style="width:56px;height:56px;background:#eee;border-radius:var(--r)"></div>') +
        '<div class="info"><h4>' + esc(a.name) + '</h4><p>' + esc(a.designation || '') + '</p></div>' +
        '<div class="actions">' +
        '<button class="btn btn-sm" data-edit="' + a.id + '">Edit</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + a.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
    $all('[data-edit]', el).forEach(function (b) {
      b.addEventListener('click', function () { openAuthorModal(authors.find(function (a) { return a.id === b.dataset.edit; })); });
    });
    $all('[data-del]', el).forEach(function (b) {
      b.addEventListener('click', function () { deleteAuthor(b.dataset.del); });
    });
  }

  function populateAuthorSelect() {
    var sel = $('#blog-author');
    var current = sel.value;
    sel.innerHTML = '<option value="">No author</option>' + authors.map(function (a) {
      return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
    }).join('');
    sel.value = current;
  }

  async function loadAuthors() {
    authors = await api('/api/authors');
    renderAuthorsList();
    populateAuthorSelect();
  }

  function openAuthorModal(a) {
    $('#author-modal-title').textContent = a ? 'Edit author' : 'New author';
    $('#author-id').value = a ? a.id : '';
    $('#author-name').value = a ? a.name : '';
    $('#author-designation').value = a ? a.designation : '';
    authorUploader.setItems(a && a.image ? [{ url: a.image }] : []);
    openModal('author-modal');
  }
  $('#author-new-btn').addEventListener('click', function () { openAuthorModal(null); });

  $('#author-save-btn').addEventListener('click', async function () {
    var name = $('#author-name').value.trim();
    if (!name) { toast('Name is required', true); return; }
    var items = authorUploader.getItems();
    var payload = {
      id: $('#author-id').value || undefined,
      name: name,
      designation: $('#author-designation').value.trim(),
      image: items.length ? items[items.length - 1].url : '',
    };
    var btn = $('#author-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (payload.id) {
        await api('/api/authors', { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        delete payload.id;
        await api('/api/authors', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal('author-modal');
      toast('Author saved');
      await loadAuthors();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Save author';
    }
  });

  async function deleteAuthor(id) {
    if (!confirm('Delete this author? Posts assigned to them will show no author.')) return;
    try {
      await api('/api/authors?id=' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Deleted');
      await loadAuthors();
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- MEDIA LIBRARY TAB ---------- */
  async function loadMediaTab() {
    var gridEl = $('#media-tab-grid');
    gridEl.innerHTML = '<div class="empty-note" style="grid-column:1/-1">Loading…</div>';
    try {
      var media = await api('/api/media');
      if (!media.length) {
        gridEl.innerHTML = '<div class="empty-note" style="grid-column:1/-1">Nothing uploaded yet. Click "+ Upload image or video" to add one.</div>';
        return;
      }
      gridEl.innerHTML = media.map(function (m) {
        return '<div class="media-item">' + mediaThumb(m.url) +
          '<button type="button" class="copy-link" data-url="' + esc(m.url) + '">Copy link</button>' +
          (m.source === 'upload' ? '<button type="button" class="rm" data-url="' + esc(m.url) + '">Delete</button>' : '') +
          '</div>';
      }).join('');
      $all('.rm', gridEl).forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          deleteMedia(b.dataset.url);
        });
      });
      $all('.copy-link', gridEl).forEach(function (b) {
        b.addEventListener('click', async function (e) {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(b.dataset.url);
            toast('Link copied');
          } catch (err) {
            prompt('Copy this link:', b.dataset.url);
          }
        });
      });
    } catch (err) {
      gridEl.innerHTML = '<div class="empty-note" style="grid-column:1/-1">' + esc(err.message) + '</div>';
    }
  }

  $('#media-tab-upload-btn').addEventListener('click', function () { $('#media-tab-upload-input').click(); });
  $('#media-tab-upload-input').addEventListener('change', async function () {
    var input = $('#media-tab-upload-input');
    var files = Array.prototype.slice.call(input.files);
    input.value = '';
    for (var i = 0; i < files.length; i++) {
      try {
        await uploadFile(files[i]);
      } catch (err) {
        toast('Upload failed: ' + err.message, true);
      }
    }
    loadMediaTab();
  });

  async function deleteMedia(url) {
    if (!confirm('Delete this image? Any page currently using it will show a broken image.')) return;
    try {
      await api('/api/media?url=' + encodeURIComponent(url), { method: 'DELETE' });
      toast('Deleted');
      loadMediaTab();
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- ENQUIRIES TAB ---------- */
  var FIELD_LABELS = {
    name: 'Name', company: 'Company', email: 'Email', phone: 'Phone', interest: 'Interest',
    category: 'Category of supply', city: 'City / state', gst: 'GST number',
    years: 'Years in business', website: 'Website / catalogue', applyFor: 'Apply for', resumeUrl: 'Resume',
  };
  var FIELD_ORDER = {
    'project-enquiry': ['name', 'company', 'email', 'phone', 'interest'],
    'vendor-registration': ['company', 'name', 'email', 'phone', 'category', 'city', 'gst', 'years', 'website'],
    'job-application': ['name', 'email', 'phone', 'company', 'applyFor', 'resumeUrl'],
    'sygnific-enquiry': ['name', 'company', 'email', 'phone'],
  };

  $all('.subtab-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $all('.subtab-item').forEach(function (b) { b.classList.remove('is-active'); });
      $all('.subtab-panel').forEach(function (p) { p.classList.remove('is-active'); });
      btn.classList.add('is-active');
      $('#subtab-' + btn.dataset.subtab).classList.add('is-active');
    });
  });

  function renderEnquiries(listEl, entries, formType) {
    if (!entries.length) {
      listEl.innerHTML = '<div class="empty-note">No submissions yet.</div>';
      return;
    }
    var order = FIELD_ORDER[formType];
    listEl.innerHTML = entries.map(function (e) {
      var f = e.fields || {};
      var when = e.submittedAt ? new Date(e.submittedAt).toLocaleString() : '';
      var grid = order.filter(function (k) { return f[k]; }).map(function (k) {
        var value = k === 'resumeUrl'
          ? '<a href="' + esc(f[k]) + '" target="_blank" rel="noopener">Download resume</a>'
          : esc(f[k]);
        return '<div><b>' + esc(FIELD_LABELS[k] || k) + '</b>' + value + '</div>';
      }).join('');
      return '<div class="enquiry-card">' +
        '<div class="eq-head"><h4>' + esc(f.name || f.company || 'Submission') + '</h4>' +
        '<span>' + esc(when) + ' &middot; <button class="btn btn-sm btn-danger" data-del="' + esc(e.id) + '" data-type="' + formType + '" style="padding:2px 8px;margin-left:6px">Delete</button></span></div>' +
        '<div class="eq-grid">' + grid + '</div>' +
        (f.message ? '<div class="eq-msg">' + esc(f.message) + '</div>' : '') +
        (e.emailError ? '<div class="eq-err">Email delivery failed: ' + esc(e.emailError) + '</div>' : '') +
        '</div>';
    }).join('');
    $all('[data-del]', listEl).forEach(function (b) {
      b.addEventListener('click', function () { deleteEnquiry(b.dataset.type, b.dataset.del); });
    });
  }

  var enquiryData = { 'project-enquiry': [], 'vendor-registration': [], 'job-application': [], 'sygnific-enquiry': [] };

  async function loadEnquiries() {
    try {
      var projectEntries = await api('/api/submissions?type=project-enquiry');
      enquiryData['project-enquiry'] = projectEntries;
      renderEnquiries($('#enquiries-project-list'), projectEntries, 'project-enquiry');
    } catch (err) {
      $('#enquiries-project-list').innerHTML = '<div class="empty-note">' + esc(err.message) + '</div>';
    }
    try {
      var vendorEntries = await api('/api/submissions?type=vendor-registration');
      enquiryData['vendor-registration'] = vendorEntries;
      renderEnquiries($('#enquiries-vendor-list'), vendorEntries, 'vendor-registration');
    } catch (err) {
      $('#enquiries-vendor-list').innerHTML = '<div class="empty-note">' + esc(err.message) + '</div>';
    }
    try {
      var jobEntries = await api('/api/submissions?type=job-application');
      enquiryData['job-application'] = jobEntries;
      renderEnquiries($('#enquiries-job-list'), jobEntries, 'job-application');
    } catch (err) {
      $('#enquiries-job-list').innerHTML = '<div class="empty-note">' + esc(err.message) + '</div>';
    }
    try {
      var sygnificEntries = await api('/api/submissions?type=sygnific-enquiry');
      enquiryData['sygnific-enquiry'] = sygnificEntries;
      renderEnquiries($('#enquiries-sygnific-list'), sygnificEntries, 'sygnific-enquiry');
    } catch (err) {
      $('#enquiries-sygnific-list').innerHTML = '<div class="empty-note">' + esc(err.message) + '</div>';
    }
    ['project-enquiry', 'vendor-registration', 'job-application', 'sygnific-enquiry'].forEach(updateExportState);
  }

  function getDateFilter(formType) {
    var sel = document.querySelector('.export-date-filter[data-date-filter="' + formType + '"]');
    return sel ? sel.value : 'all';
  }

  function filterEntriesByDate(entries, range) {
    if (range === 'all') return entries;
    var now = new Date();
    return entries.filter(function (e) {
      var d = new Date(e.submittedAt);
      if (range === 'today') return d.toDateString() === now.toDateString();
      if (range === '7d') return (now - d) <= 7 * 24 * 60 * 60 * 1000;
      if (range === '30d') return (now - d) <= 30 * 24 * 60 * 60 * 1000;
      if (range === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return true;
    });
  }

  function updateExportState(formType) {
    var count = filterEntriesByDate(enquiryData[formType] || [], getDateFilter(formType)).length;
    $all('[data-export-csv="' + formType + '"], [data-export-pdf="' + formType + '"]').forEach(function (b) {
      b.disabled = count === 0;
    });
  }

  $all('.export-date-filter').forEach(function (sel) {
    sel.addEventListener('change', function () { updateExportState(sel.dataset.dateFilter); });
  });

  function exportRows(formType) {
    var entries = filterEntriesByDate(enquiryData[formType] || [], getDateFilter(formType));
    var order = FIELD_ORDER[formType];
    var headers = ['Submitted At'].concat(order.map(function (k) { return FIELD_LABELS[k] || k; })).concat(['Message']);
    var rows = entries.map(function (e) {
      var f = e.fields || {};
      var when = e.submittedAt ? new Date(e.submittedAt).toLocaleString() : '';
      return [when].concat(order.map(function (k) { return f[k] || ''; })).concat([f.message || '']);
    });
    return { headers: headers, rows: rows };
  }

  function exportCSV(formType) {
    var data = exportRows(formType);
    if (!data.rows.length) { toast('No submissions in this date range', true); return; }
    var esc2 = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var csv = [data.headers.map(esc2).join(',')].concat(
      data.rows.map(function (r) { return r.map(esc2).join(','); })
    ).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = formType + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportPDF(formType) {
    if (!window.jspdf) { toast('PDF library failed to load', true); return; }
    var data = exportRows(formType);
    if (!data.rows.length) { toast('No submissions in this date range', true); return; }
    var titles = {
      'vendor-registration': 'Vendor Registrations',
      'job-application': 'Job Applications',
      'project-enquiry': 'Project Enquiries',
      'sygnific-enquiry': 'Sygnific Infra Enquiries',
    };
    var doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(titles[formType] || 'Leads', 14, 14);
    doc.autoTable({
      head: [data.headers],
      body: data.rows,
      startY: 20,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [52, 68, 111] },
    });
    doc.save(formType + '-' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  $all('[data-export-csv]').forEach(function (b) {
    b.addEventListener('click', function () { exportCSV(b.dataset.exportCsv); });
  });
  $all('[data-export-pdf]').forEach(function (b) {
    b.addEventListener('click', function () { exportPDF(b.dataset.exportPdf); });
  });

  async function deleteEnquiry(type, id) {
    if (!confirm('Delete this submission? This cannot be undone.')) return;
    try {
      await api('/api/submissions?type=' + type + '&id=' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Deleted');
      loadEnquiries();
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- company switcher (sidebar logo) ---------- */
  var COMPANIES = {
    bluewing: { logo: '/assets/BlueWing-logo-2026.svg', name: 'BlueWing Group' },
    sygnificinfra: { logo: 'https://faak0js5bca1hkm3.public.blob.vercel-storage.com/uploads/1790589781391-z23if3-sy-new-logo-flCmjGVEZAr2ws3v25JHq9RGadYQfk.png', name: 'Sygnific Infra' },
    bhaaratprecast: { logo: 'https://bluewing.brandismtechnologies.in/wp-content/uploads/2026/06/bh-new-logo.png', name: 'Bhaarat Precast' },
  };

  // Logos uploaded from here replace the built-in logo on that company's website
  // (header, mobile menu, footer). Remove falls back to the built-in logo.
  var customLogos = {};

  function currentCompany() {
    return COMPANIES[$('#company-switch').value] ? $('#company-switch').value : 'bluewing';
  }

  function setCompany(key) {
    if (!COMPANIES[key]) key = 'bluewing';
    var co = COMPANIES[key];
    var logo = $('#sidebar-logo');
    logo.src = customLogos[key] || co.logo;
    logo.alt = co.name;
    $('#company-switch').value = key;
    $('#logo-remove-btn').disabled = !customLogos[key];
    try { localStorage.setItem('bw_admin_company', key); } catch (e) {}
  }

  async function loadLogos() {
    customLogos = await api('/api/media?logos');
    setCompany(currentCompany());
  }

  $('#company-switch').addEventListener('change', function (e) { setCompany(e.target.value); });
  try { setCompany(localStorage.getItem('bw_admin_company') || 'bluewing'); } catch (e) { setCompany('bluewing'); }

  $('#logo-upload-btn').addEventListener('click', function () { $('#logo-file').click(); });

  $('#logo-file').addEventListener('change', async function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].indexOf(file.type) === -1) { toast('Please choose a PNG, JPG, WebP or SVG image', true); return; }
    var key = currentCompany();
    var btn = $('#logo-upload-btn');
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      var url = await uploadFile(file);
      customLogos = await api('/api/media?logos', { method: 'PUT', body: JSON.stringify({ company: key, url: url }) });
      setCompany(key);
      toast(COMPANIES[key].name + ' logo updated — the website shows it on the next refresh');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload / Edit logo';
    }
  });

  $('#logo-remove-btn').addEventListener('click', async function () {
    var key = currentCompany();
    if (!customLogos[key]) return;
    if (!confirm('Remove the uploaded ' + COMPANIES[key].name + ' logo? The website will go back to the original logo.')) return;
    try {
      customLogos = await api('/api/media?logos&company=' + key, { method: 'DELETE' });
      setCompany(key);
      toast(COMPANIES[key].name + ' logo removed — original logo restored');
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ---------- form email recipients ---------- */
  function renderRecipients(forms) {
    $('#recipients-fields').innerHTML = forms.map(function (f) {
      var now = f.value || f.default;
      return '<label>' + esc(f.label) +
        '<input type="text" data-recipient="' + esc(f.key) + '" value="' + esc(f.value) + '" placeholder="' + esc(f.default || 'name@example.com') + '">' +
        '<span class="recipient-now">' + (now
          ? 'Emails go to: <b>' + esc(now) + '</b>' + (f.value ? '' : ' (default)')
          : 'No email address set') + '</span>' +
        '</label>';
    }).join('');
  }

  async function loadRecipients() {
    try {
      renderRecipients(await api('/api/submissions?recipients'));
    } catch (err) {
      $('#recipients-fields').innerHTML = '<div class="empty-note">' + esc(err.message) + '</div>';
    }
  }

  $('#recipients-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var recipients = {};
    $all('[data-recipient]').forEach(function (input) { recipients[input.dataset.recipient] = input.value.trim(); });
    var btn = $('#recipients-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      renderRecipients(await api('/api/submissions?recipients', { method: 'PUT', body: JSON.stringify({ recipients: recipients }) }));
      toast('Email recipients saved');
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Save email recipients';
    }
  });

  /* ---------- init ---------- */
  function initAppData() {
    loadLogos().catch(function (e) { toast(e.message, true); });
    loadBlog().catch(function (e) { toast(e.message, true); });
    loadProjects().catch(function (e) { toast(e.message, true); });
    loadCareers().catch(function (e) { toast(e.message, true); });
    loadAuthors().catch(function (e) { toast(e.message, true); });
    loadMediaTab().catch(function (e) { toast(e.message, true); });
    loadEnquiries().catch(function (e) { toast(e.message, true); });
    loadRecipients();
  }

  if (resetToken) {
    showLogin();
    showCard('reset-form');
  } else {
    checkSession();
  }
})();
