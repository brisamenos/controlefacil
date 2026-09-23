// Provedor "webhook": envia para uma API externa (ex.: Evolution API, Z-API,
// API oficial via intermediário). Faz POST JSON { telefone, mensagem }.
module.exports = {
  automatico: true,
  async enviar({ telefone, mensagem, config }) {
    const url = String(config.whatsapp_webhook_url || '').trim();
    if (!/^https?:\/\//.test(url)) return { ok: false, erro: 'URL do provedor não configurada' };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (config.whatsapp_webhook_token) headers.Authorization = 'Bearer ' + config.whatsapp_webhook_token;
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ telefone, mensagem }), signal: ctrl.signal });
      if (!res.ok) return { ok: false, erro: 'Provedor respondeu ' + res.status };
      return { ok: true };
    } finally { clearTimeout(t); }
  },
};
