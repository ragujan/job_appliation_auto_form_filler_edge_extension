// ─── JobFill AI — Content Script ─────────────────────────────────────────────
// Runs on every page. Handles auto-fill on load and on-demand filling.

(function () {
  if (window.__jobfillInjected) return;
  window.__jobfillInjected = true;

  // ── Field mapping: profile key → list of selector hints ──────────────────
  const FIELD_MAP = {
    // Personal
    first_name:        ['first.*name', 'firstname', 'fname', 'given.*name'],
    last_name:         ['last.*name', 'lastname', 'lname', 'surname', 'family.*name'],
    full_name:         ['full.*name', 'name', 'your.*name'],
    email:             ['email', 'e.?mail', 'email.*address'],
    phone:             ['phone', 'mobile', 'cell', 'tel', 'phone.*number', 'mobile.*number'],
    address:           ['address', 'street', 'street.*address', 'mailing.*address'],
    city:              ['city', 'town'],
    state:             ['state', 'province', 'region'],
    zip:               ['zip', 'postal', 'postcode'],
    country:           ['country', 'nation'],
    linkedin:          ['linkedin', 'linked.*in', 'linkedin.*(profile|url)', 'linked.*in.*(profile|url)'],
    github:            ['github', 'git.*hub', 'github.*(profile|url)', 'git.*hub.*(profile|url)'],
    portfolio:         ['portfolio', 'website', 'personal.*site', 'portfolio.*(url|link|website)', 'personal.*(website|url|site)', 'website.*url'],
    // Professional
    current_title:     ['current.*title', 'job.*title', 'position', 'title'],
    current_company:   ['current.*company', 'employer', 'company', 'organization'],
    years_experience:  ['years.*exp', 'experience.*years', 'yoe'],
    salary_expectation:['salary', 'compensation', 'expected.*salary'],
    availability:      ['availability', 'start.*date', 'available'],
    notice_period:     ['notice', 'notice.*period'],
    // Cover letter / why
    cover_letter:      ['cover.*letter', 'motivation', 'why.*apply', 'message'],
    summary:           ['summary', 'bio', 'about', 'objective', 'about.*you', 'professional.*summary'],
  };

  // ── Utility: normalize a string for loose matching ────────────────────────
  function normalize(str) {
    return (str || '').toLowerCase().replace(/[\s_\-\.\/]+/g, '_');
  }

  // ── Score how well a field element matches a profile key ─────────────────
  function matchScore(el, patterns) {
    const attrs = [
      el.name, el.id, el.placeholder,
      el.getAttribute('aria-label'),
      el.getAttribute('data-fieldname'),
      el.closest('label')?.textContent,
      el.closest('[class]')?.className
    ].map(normalize).join(' ');

    let best = 0;
    for (const pat of patterns) {
      const re = new RegExp(pat, 'i');
      if (re.test(attrs)) best = Math.max(best, 1);
    }
    return best;
  }

  // ── Trigger React/Vue/Angular synthetic events ────────────────────────────
  function triggerInputEvents(el) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) nativeInputValueSetter.call(el, el.value);

    ['input', 'change', 'blur', 'keyup'].forEach(evtName => {
      el.dispatchEvent(new Event(evtName, { bubbles: true }));
    });
  }

  // ── Fill a single element ─────────────────────────────────────────────────
  function fillElement(el, value) {
    if (!value) return false;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (tag === 'select') {
      const opts = Array.from(el.options);
      const val = String(value).toLowerCase();
      const opt = opts.find(o => o.text.toLowerCase().includes(val) || o.value.toLowerCase().includes(val));
      if (opt) { el.value = opt.value; triggerInputEvents(el); return true; }
      return false;
    }

    if (type === 'checkbox') {
      const checked = ['yes', 'true', '1'].includes(String(value).toLowerCase());
      if (el.checked !== checked) { el.click(); }
      return true;
    }

    if (type === 'radio') {
      // handled in group logic
      return false;
    }

    if (tag === 'input' || tag === 'textarea') {
      el.value = String(value);
      triggerInputEvents(el);
      return true;
    }

    // Contenteditable divs (LinkedIn, Greenhouse)
    if (el.isContentEditable) {
      el.textContent = String(value);
      triggerInputEvents(el);
      return true;
    }

    return false;
  }

  // ── Main fill function ────────────────────────────────────────────────────
  function fillForms(profileData, fuzzyMatch = true) {
    const inputs = Array.from(document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=file]),' +
      'textarea, select, [contenteditable="true"]'
    )).filter(el => {
      // Skip elements that were manually modified by user or already filled by extension
      if (el.getAttribute('data-jobfill-user-modified') === 'true' || 
          el.getAttribute('data-jobfill-filled') === 'true') {
        return false;
      }
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled && !el.readOnly;
    });

    let filled = 0;
    const filled_els = new Set();

    // First pass: exact/pattern matching against FIELD_MAP
    for (const [profileKey, patterns] of Object.entries(FIELD_MAP)) {
      const value = profileData[profileKey] || profileData[profileKey.replace(/_/g, ' ')] || profileData[profileKey.replace(/_/g, '-')];
      if (!value) continue;

      let best = null, bestScore = 0;
      for (const el of inputs) {
        if (filled_els.has(el)) continue;
        const score = matchScore(el, patterns);
        if (score > bestScore) { best = el; bestScore = score; }
      }

      if (best && bestScore > 0) {
        if (fillElement(best, value)) { 
          filled++; 
          filled_els.add(best);
          best.setAttribute('data-jobfill-filled', 'true');
        }
      }
    }

    // Second pass: fuzzy — try to match remaining inputs directly against profile keys
    if (fuzzyMatch) {
      for (const el of inputs) {
        if (filled_els.has(el)) continue;
        const attrs = normalize([el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' '));
        for (const [k, v] of Object.entries(profileData)) {
          if (!v) continue;
          if (normalize(k).split('_').some(word => word.length > 2 && attrs.includes(word))) {
            if (fillElement(el, v)) { 
              filled++; 
              filled_els.add(el); 
              el.setAttribute('data-jobfill-filled', 'true');
              break; 
            }
          }
        }
      }
    }

    return filled;
  }

  // ── Extract job description from page ─────────────────────────────────────
  function extractJobDescription() {
    // Try known selectors first
    const selectors = [
      // LinkedIn
      '.jobs-description__content',
      '.job-view-layout',
      // Indeed
      '#jobDescriptionText',
      '.jobsearch-jobDescriptionText',
      // Greenhouse
      '#content',
      '.job__description',
      // Lever
      '.section-wrapper',
      '.posting-description',
      // Workday
      '[data-automation-id="jobPostingDescription"]',
      // Generic
      '[class*="job-desc"]',
      '[class*="jobDescription"]',
      '[class*="description"]',
      'article',
      'main'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 200) {
        return el.innerText.trim();
      }
    }

    // Fallback: biggest text block
    const divs = Array.from(document.querySelectorAll('div, section, article'));
    let longest = '';
    for (const d of divs) {
      const t = d.innerText?.trim() || '';
      if (t.length > longest.length && t.length < 10000) longest = t;
    }
    return longest;
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FILL_FORM') {
      const count = fillForms(msg.profileData, msg.fuzzyMatch);
      sendResponse({ filled: count });
      return true;
    }

    if (msg.type === 'GET_JOB_DESC') {
      const text = extractJobDescription();
      sendResponse({ text });
      return true;
    }

    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
  });

  // ── Listen for user interactions to mark elements as user-modified ─────────
  function markUserModified(e) {
    if (e.isTrusted && e.target && e.target.tagName) {
      const tag = e.target.tagName.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target.getAttribute('contenteditable') === 'true') {
        e.target.setAttribute('data-jobfill-user-modified', 'true');
      }
    }
  }
  document.addEventListener('input', markUserModified, true);
  document.addEventListener('change', markUserModified, true);

  // ── Debounced MutationObserver for dynamic page autofilling ────────────────
  let fillTimeout = null;
  let observer = null;

  function startMutationObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      let hasNewInputs = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const tag = node.tagName.toLowerCase();
              if (['input', 'textarea', 'select'].includes(tag) || node.getAttribute('contenteditable') === 'true') {
                hasNewInputs = true;
                break;
              }
              if (node.querySelector('input, textarea, select, [contenteditable="true"]')) {
                hasNewInputs = true;
                break;
              }
            }
          }
        }
        if (hasNewInputs) break;
      }

      if (hasNewInputs) {
        if (fillTimeout) clearTimeout(fillTimeout);
        fillTimeout = setTimeout(() => {
          chrome.storage.local.get(['autoFill', 'profileData', 'fuzzyMatch', 'notify'], res => {
            if (res.autoFill && res.profileData) {
              const filled = fillForms(res.profileData, res.fuzzyMatch ?? true);
              if (filled > 0 && res.notify) {
                showToast(`⚡ JobFill: auto-filled ${filled} new field(s)`);
              }
            }
          });
        }, 800);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Auto-fill on page load ────────────────────────────────────────────────
  chrome.storage.local.get(['autoFill', 'profileData', 'fuzzyMatch', 'notify'], res => {
    if (res.autoFill) {
      startMutationObserver();
    }
    
    if (!res.autoFill || !res.profileData) return;

    // Slight delay to let SPA forms render
    setTimeout(() => {
      const filled = fillForms(res.profileData, res.fuzzyMatch ?? true);
      if (filled > 0 && res.notify) {
        showToast(`⚡ JobFill: filled ${filled} field(s)`);
      }
    }, 1200);
  });

  // Listen for settings changes to start/stop the observer dynamically
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.autoFill) {
      if (changes.autoFill.newValue) {
        startMutationObserver();
      } else {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
      }
    }
  });

  // ── Toast notification ────────────────────────────────────────────────────
  function showToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '24px', right: '24px',
      background: '#7c6af7', color: '#fff',
      padding: '10px 18px', borderRadius: '10px',
      fontSize: '13px', fontWeight: '600',
      zIndex: '2147483647', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      fontFamily: '-apple-system, sans-serif',
      transition: 'opacity 0.4s',
      opacity: '1'
    });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 3000);
  }
})();
