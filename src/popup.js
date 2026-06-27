// ─── Helpers ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const isFloatingWindow = new URLSearchParams(location.search).get('window') === '1';

if (isFloatingWindow) {
  document.body.classList.add('floating-window');
  $('panelHint')?.classList.add('hidden');
  $('popOutBtn')?.classList.add('hidden');
}

$('popOutBtn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_FLOATING_WINDOW' });
});

function showResult(elId, msg, type = 'success') {
  const el = $(elId);
  el.textContent = msg;
  el.className = `result-msg ${type}`;
}

function setStatus(type) {
  $('status-dot').className = `status-dot ${type}`;
}

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ─── Load settings on open ───────────────────────────────────────────────────
chrome.storage.local.get(['autoFill', 'fuzzyMatch', 'notify', 'apiKey', 'aiProvider', 'model', 'customEndpoint', 'customModel', 'profileData', 'profileName', 'resumeName'], res => {
  $('autoFillToggle').checked = res.autoFill ?? false;
  $('fuzzyMatchToggle').checked = res.fuzzyMatch ?? true;
  $('notifyToggle').checked = res.notify ?? true;
  if (res.apiKey) $('apiKeyInput').value = res.apiKey;
  if (res.aiProvider) $('providerSelect').value = res.aiProvider;
  if (res.customEndpoint) $('customEndpointInput').value = res.customEndpoint;
  if (res.customModel) {
    $('customModelInput').value = res.customModel;
  } else if (res.model && (res.aiProvider === 'ollama' || res.aiProvider === 'custom')) {
    $('customModelInput').value = res.model;
  }
  updateProviderUI(res.model);
  if (res.profileName) {
    $('profileFileName').textContent = res.profileName;
    $('profileFileName').classList.remove('muted');
  }
  if (res.resumeName) {
    $('resumeFileName').textContent = res.resumeName;
    $('resumeFileName').classList.remove('muted');
  }
  renderProfilePreview(res.profileData || {});
});

function getSelectedProvider() {
  return $('providerSelect').value || 'anthropic';
}

function getSelectedModel() {
  const provider = getSelectedProvider();
  const config = getProviderConfig(provider);
  if (config.customModel) return $('customModelInput').value.trim();
  return $('modelSelect').value;
}

function updateProviderUI(savedModel) {
  const provider = getSelectedProvider();
  const config = getProviderConfig(provider);

  $('keyHint').textContent = config.keyHint || '';
  $('apiKeyInput').placeholder = config.keyPlaceholder || 'API key';

  $('customEndpointSection').classList.toggle('hidden', !config.customEndpoint);
  $('customModelSection').classList.toggle('hidden', !config.customModel);
  $('modelSelectSection').classList.toggle('hidden', !!config.customModel);

  if (config.customEndpoint && ! $('customEndpointInput').value && config.defaultEndpoint) {
    $('customEndpointInput').value = config.defaultEndpoint;
  }

  if (config.customModel) {
    if (! $('customModelInput').value && config.defaultModel) {
      $('customModelInput').value = config.defaultModel;
    }
    return;
  }

  const select = $('modelSelect');
  select.innerHTML = '';
  config.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    select.appendChild(opt);
  });

  const preferredModel = savedModel || config.defaultModel;
  if (preferredModel && [...select.options].some(o => o.value === preferredModel)) {
    select.value = preferredModel;
  }
}

$('providerSelect').addEventListener('change', () => updateProviderUI());

// ─── Toggle persistence ───────────────────────────────────────────────────────
$('autoFillToggle').addEventListener('change', e => chrome.storage.local.set({ autoFill: e.target.checked }));
$('fuzzyMatchToggle').addEventListener('change', e => chrome.storage.local.set({ fuzzyMatch: e.target.checked }));
$('notifyToggle').addEventListener('change', e => chrome.storage.local.set({ notify: e.target.checked }));

// ─── API Key ─────────────────────────────────────────────────────────────────
$('showKeyBtn').addEventListener('click', () => {
  const inp = $('apiKeyInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('saveKeyBtn').addEventListener('click', () => {
  const provider = getSelectedProvider();
  const config = getProviderConfig(provider);
  const key = $('apiKeyInput').value.trim();
  const model = getSelectedModel();
  const customEndpoint = $('customEndpointInput').value.trim();
  const customModel = $('customModelInput').value.trim();

  if (config.requiresKey && !key) {
    $('keyStatus').textContent = '⚠ API key is required for this provider';
    $('keyStatus').style.color = '#f87171';
    return;
  }
  if (config.customEndpoint && !customEndpoint) {
    $('keyStatus').textContent = '⚠ API endpoint is required';
    $('keyStatus').style.color = '#f87171';
    return;
  }
  if (config.customModel && !customModel) {
    $('keyStatus').textContent = '⚠ Model name is required';
    $('keyStatus').style.color = '#f87171';
    return;
  }

  chrome.storage.local.set({
    apiKey: key,
    aiProvider: provider,
    model: config.customModel ? customModel : model,
    customEndpoint: config.customEndpoint ? customEndpoint : '',
    customModel: config.customModel ? customModel : ''
  }, () => {
    $('keyStatus').textContent = '✓ Saved';
    $('keyStatus').style.color = '#4ade80';
    setTimeout(() => $('keyStatus').textContent = '', 2000);
  });
});

// ─── Profile File Load ────────────────────────────────────────────────────────
$('loadProfileBtn').addEventListener('click', () => $('profileFileInput').click());

$('profileFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  let data = {};

  if (file.name.endsWith('.json')) {
    try { data = JSON.parse(text); } catch { alert('Invalid JSON file.'); return; }
  } else if (file.name.endsWith('.csv')) {
    data = parseCSV(text);
  }

  chrome.storage.local.set({ profileData: data, profileName: file.name }, () => {
    $('profileFileName').textContent = file.name;
    $('profileFileName').classList.remove('muted');
    renderProfilePreview(data);
  });
});

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const result = {};
  for (const line of lines) {
    const commaIdx = line.indexOf(',');
    if (commaIdx === -1) continue;
    const key = line.slice(0, commaIdx).trim().replace(/^["']|["']$/g, '');
    const val = line.slice(commaIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = val;
  }
  return result;
}

function renderProfilePreview(data) {
  const list = $('profileFields');
  list.innerHTML = '';
  
  const entries = Object.entries(data);
  if (entries.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'hint muted';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.padding = '10px 0';
    emptyMsg.id = 'emptyProfileMsg';
    emptyMsg.textContent = 'No fields. Add custom fields below or load a file.';
    list.appendChild(emptyMsg);
  } else {
    entries.forEach(([k, v]) => {
      createFieldRow(k, v);
    });
  }
  
  $('profilePreview').classList.remove('hidden');
}

function createFieldRow(key, value) {
  const list = $('profileFields');
  const emptyMsg = $('emptyProfileMsg');
  if (emptyMsg) emptyMsg.remove();

  const row = document.createElement('div');
  row.className = 'profile-field-item';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'field-key-input';
  keyInput.value = key;
  keyInput.placeholder = 'Key';
  keyInput.title = 'Profile key';

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'field-val-input';
  valInput.value = value;
  valInput.placeholder = 'Value';
  valInput.title = 'Value for autofill';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-field-delete';
  deleteBtn.innerHTML = '×';
  deleteBtn.title = 'Delete field';
  deleteBtn.addEventListener('click', () => {
    row.remove();
    if (list.children.length === 0) {
      renderProfilePreview({});
    }
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(deleteBtn);
  list.appendChild(row);
}

// ─── Profile Editor Event Handlers ───────────────────────────────────────────
// Search filtering
$('profileSearchInput').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  const items = document.querySelectorAll('.profile-field-item');
  items.forEach(item => {
    const key = item.querySelector('.field-key-input').value.toLowerCase();
    const val = item.querySelector('.field-val-input').value.toLowerCase();
    if (key.includes(q) || val.includes(q)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
});

// Add Field
$('addFieldBtn').addEventListener('click', () => {
  const keyInput = $('newFieldKey');
  const valInput = $('newFieldValue');
  const key = keyInput.value.trim();
  const val = valInput.value.trim();

  if (!key) {
    alert('Please enter a field key/name.');
    keyInput.focus();
    return;
  }

  createFieldRow(key, val);
  
  keyInput.value = '';
  valInput.value = '';
  keyInput.focus();

  const container = document.querySelector('.fields-container-scroll');
  container.scrollTop = container.scrollHeight;
});

// Enter key helper on Add Field inputs
$('newFieldKey').addEventListener('keypress', e => {
  if (e.key === 'Enter') $('newFieldValue').focus();
});
$('newFieldValue').addEventListener('keypress', e => {
  if (e.key === 'Enter') $('addFieldBtn').click();
});

// Save Profile changes
$('saveProfileBtn').addEventListener('click', () => {
  const items = document.querySelectorAll('.profile-field-item');
  const newData = {};
  
  items.forEach(item => {
    const key = item.querySelector('.field-key-input').value.trim();
    const val = item.querySelector('.field-val-input').value.trim();
    if (key) {
      newData[key] = val;
    }
  });

  chrome.storage.local.get(['profileName'], res => {
    const currentName = res.profileName || 'Custom Profile';
    const newName = currentName.includes('(Modified)') ? currentName : `${currentName} (Modified)`;
    
    chrome.storage.local.set({ profileData: newData, profileName: newName }, () => {
      $('profileFileName').textContent = newName;
      $('profileFileName').classList.remove('muted');
      
      renderProfilePreview(newData);
      
      showResult('fillResult', '✓ Profile changes saved locally!', 'success');
      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
    });
  });
});

// Clear Profile data
$('clearProfileBtn').addEventListener('click', () => {
  if (!confirm('Are you sure you want to clear all profile data?')) return;
  
  chrome.storage.local.remove(['profileData', 'profileName'], () => {
    $('profileFileName').textContent = 'No file loaded';
    $('profileFileName').classList.add('muted');
    renderProfilePreview({});
    showResult('fillResult', '✓ Profile cleared successfully.', 'success');
    setStatus('success');
    setTimeout(() => setStatus('idle'), 3000);
  });
});

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Fill Now ─────────────────────────────────────────────────────────────────
$('fillNowBtn').addEventListener('click', async () => {
  setStatus('active');
  $('fillNowBtn').disabled = true;

  chrome.storage.local.get(['profileData', 'fuzzyMatch'], res => {
    if (!res.profileData || Object.keys(res.profileData).length === 0) {
      showResult('fillResult', '⚠ No profile data loaded. Load a CSV or JSON file first.', 'error');
      setStatus('error');
      $('fillNowBtn').disabled = false;
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'FILL_FORM',
        profileData: res.profileData,
        fuzzyMatch: res.fuzzyMatch ?? true
      }, response => {
        $('fillNowBtn').disabled = false;
        if (chrome.runtime.lastError) {
          showResult('fillResult', '⚠ Could not reach page. Try refreshing.', 'error');
          setStatus('error');
          return;
        }
        if (response?.filled > 0) {
          showResult('fillResult', `✓ Filled ${response.filled} field(s) successfully!`, 'success');
          setStatus('success');
        } else {
          showResult('fillResult', 'ℹ No matching fields found on this page.', 'error');
          setStatus('idle');
        }
        setTimeout(() => setStatus('idle'), 3000);
      });
    });
  });
});

// ─── Resume Upload ────────────────────────────────────────────────────────────
$('loadResumeBtn').addEventListener('click', () => $('resumeFileInput').click());

$('resumeFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  let text = '';
  if (file.name.endsWith('.pdf')) {
    // For PDF we store the base64 and extract text via AI
    const ab = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
    chrome.storage.local.set({ resumeB64: b64, resumeName: file.name, resumeText: null });
    $('resumeFileName').textContent = file.name + ' (PDF — Anthropic & Gemini)';
  } else {
    text = await file.text();
    chrome.storage.local.set({ resumeText: text, resumeName: file.name, resumeB64: null });
    $('resumeFileName').textContent = file.name;
  }
  $('resumeFileName').classList.remove('muted');
});

// ─── Detect Job Description from Page ────────────────────────────────────────
$('detectJobBtn').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_JOB_DESC' }, response => {
      if (chrome.runtime.lastError || !response?.text) {
        $('jobDescInput').placeholder = 'Could not auto-detect. Paste manually.';
        return;
      }
      $('jobDescInput').value = response.text.slice(0, 3000);
    });
  });
});

// ─── Tailor Resume ────────────────────────────────────────────────────────────
$('tailorBtn').addEventListener('click', async () => {
  const jobDesc = $('jobDescInput').value.trim();
  if (!jobDesc) { alert('Please paste or detect a job description first.'); return; }

  chrome.storage.local.get(['apiKey', 'aiProvider', 'model', 'customEndpoint', 'resumeText', 'resumeB64'], async res => {
    const provider = res.aiProvider || 'anthropic';
    const config = getProviderConfig(provider);
    if (config.requiresKey && !res.apiKey) {
      alert(`Please add your ${config.label} API key in Settings.`);
      return;
    }
    if (!res.resumeText && !res.resumeB64) { alert('Please upload your resume first.'); return; }

    $('tailorBtn').disabled = true;
    $('tailorBtn').textContent = '⏳ Tailoring...';
    setStatus('active');

    try {
      const systemPrompt = `You are a professional resume writer. 
Rewrite the provided resume to be optimally tailored for the given job description.
- Emphasize relevant skills and experience
- Mirror key terms from the job description naturally
- Keep it truthful — only reframe existing content, don't invent experience
- Output clean plain text formatted as a proper resume
- Include: Summary, Skills, Experience, Education sections`;

      const output = await tailorResumeWithAI({
        provider,
        apiKey: res.apiKey,
        model: res.model || config.defaultModel,
        customEndpoint: res.customEndpoint,
        systemPrompt,
        resumeText: res.resumeText,
        resumeB64: res.resumeB64,
        jobDesc
      });

      $('tailoredOutput').value = output;
      $('tailorResult').classList.remove('hidden');
      setStatus('success');
    } catch (err) {
      alert('AI Error: ' + err.message);
      setStatus('error');
    } finally {
      $('tailorBtn').disabled = false;
      $('tailorBtn').textContent = '🤖 Tailor Resume with AI';
      setTimeout(() => setStatus('idle'), 3000);
    }
  });
});

// ─── Copy / Download tailored resume ─────────────────────────────────────────
$('copyResumeBtn').addEventListener('click', () => {
  navigator.clipboard.writeText($('tailoredOutput').value);
  $('copyResumeBtn').textContent = '✓ Copied!';
  setTimeout(() => $('copyResumeBtn').textContent = '📋 Copy', 2000);
});

$('downloadResumeBtn').addEventListener('click', () => {
  const blob = new Blob([$('tailoredOutput').value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'tailored-resume.txt'; a.click();
  URL.revokeObjectURL(url);
});
