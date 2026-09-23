// Provedor "manual": não envia sozinho. O lembrete fica na lista e o
// administrador toca em "Enviar" para abrir o WhatsApp com o texto pronto.
module.exports = {
  automatico: false,
  async enviar() { return { ok: false, manual: true }; },
};
