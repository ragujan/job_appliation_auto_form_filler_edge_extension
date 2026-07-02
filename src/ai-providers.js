// ─── AI Provider adapters for resume tailoring ───────────────────────────────

const AI_PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-4-20250514',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'Get a key at console.anthropic.com',
    requiresKey: true,
    supportsPdf: true,
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Recommended)' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Faster)' }
    ]
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    keyPlaceholder: 'sk-...',
    keyHint: 'Get a key at platform.openai.com',
    requiresKey: true,
    supportsPdf: false,
    models: [
      { value: 'gpt-4o', label: 'GPT-4o (Recommended)' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Faster)' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' }
    ]
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    keyPlaceholder: 'AIza...',
    keyHint: 'Get a key at aistudio.google.com',
    requiresKey: true,
    supportsPdf: true,
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Recommended)' },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Fastest & Cheapest)' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
    ]
  },
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4',
    keyPlaceholder: 'sk-or-...',
    keyHint: 'Get a key at openrouter.ai — access many models with one key',
    requiresKey: true,
    supportsPdf: false,
    models: [
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
      { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' }
    ]
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultModel: 'llama3.2',
    defaultEndpoint: 'http://localhost:11434/v1/chat/completions',
    keyPlaceholder: 'Not required',
    keyHint: 'Run Ollama locally — no API key needed',
    requiresKey: false,
    supportsPdf: false,
    customModel: true,
    customEndpoint: true,
    models: []
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    defaultModel: '',
    defaultEndpoint: '',
    keyPlaceholder: 'Optional',
    keyHint: 'Any OpenAI-compatible chat completions endpoint',
    requiresKey: false,
    supportsPdf: false,
    customModel: true,
    customEndpoint: true,
    models: []
  }
};

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || AI_PROVIDERS.anthropic;
}

function buildUserText(resumeText, jobDesc) {
  return `Here is my resume:\n\n${resumeText}\n\n---\n\nTailor it for this job description:\n\n${jobDesc}`;
}

async function parseJsonResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    const message =
      data.error?.message ||
      data.error?.details?.[0]?.message ||
      data.message ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function callAnthropic({ apiKey, model, systemPrompt, resumeText, resumeB64, jobDesc }) {
  let messages;

  if (resumeB64) {
    messages = [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: resumeB64 } },
        { type: 'text', text: `Tailor this resume for the following job description:\n\n${jobDesc}` }
      ]
    }];
  } else {
    messages = [{ role: 'user', content: buildUserText(resumeText, jobDesc) }];
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages
    })
  });

  const data = await parseJsonResponse(response);
  return data.content.find(b => b.type === 'text')?.text || '';
}

async function callOpenAICompatible({ url, apiKey, model, systemPrompt, resumeText, jobDesc, extraHeaders = {} }) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserText(resumeText, jobDesc) }
      ]
    })
  });

  const data = await parseJsonResponse(response);
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenAI(opts) {
  return callOpenAICompatible({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    resumeText: opts.resumeText,
    jobDesc: opts.jobDesc
  });
}

async function callOpenRouter(opts) {
  return callOpenAICompatible({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    resumeText: opts.resumeText,
    jobDesc: opts.jobDesc,
    extraHeaders: {
      'HTTP-Referer': 'https://fillyjobber-extension',
      'X-Title': 'FillyJobber'
    }
  });
}

async function callGemini({ apiKey, model, systemPrompt, resumeText, resumeB64, jobDesc }) {
  const parts = [];

  if (resumeB64) {
    parts.push({ inline_data: { mime_type: 'application/pdf', data: resumeB64 } });
    parts.push({ text: `Tailor this resume for the following job description:\n\n${jobDesc}` });
  } else {
    parts.push({ text: buildUserText(resumeText, jobDesc) });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 2048 }
    })
  });

  const data = await parseJsonResponse(response);
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts?.length) {
    throw new Error('No response from Gemini');
  }
  return candidate.content.parts.map(p => p.text || '').join('');
}

async function tailorResumeWithAI(options) {
  const {
    provider = 'anthropic',
    apiKey,
    model,
    customEndpoint,
    systemPrompt,
    resumeText,
    resumeB64,
    jobDesc
  } = options;

  const config = getProviderConfig(provider);

  if (resumeB64 && !config.supportsPdf) {
    throw new Error(
      `PDF resumes are not supported with ${config.label}. Upload a .txt file, or switch to Anthropic or Gemini.`
    );
  }

  if (config.requiresKey && !apiKey) {
    throw new Error(`Please add your ${config.label} API key in Settings.`);
  }

  if (!model) {
    throw new Error('Please select or enter a model in Settings.');
  }

  const common = { apiKey, model, systemPrompt, resumeText, resumeB64, jobDesc };

  switch (provider) {
    case 'anthropic':
      return callAnthropic(common);
    case 'openai':
      return callOpenAI(common);
    case 'gemini':
      return callGemini(common);
    case 'openrouter':
      return callOpenRouter(common);
    case 'ollama':
      return callOpenAICompatible({
        url: customEndpoint || config.defaultEndpoint,
        apiKey: apiKey || 'ollama',
        model,
        systemPrompt,
        resumeText,
        jobDesc
      });
    case 'custom': {
      if (!customEndpoint) {
        throw new Error('Please enter your custom API endpoint in Settings.');
      }
      return callOpenAICompatible({
        url: customEndpoint,
        apiKey,
        model,
        systemPrompt,
        resumeText,
        jobDesc
      });
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
