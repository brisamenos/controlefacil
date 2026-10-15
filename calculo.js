// src/services/calculo.js — cálculo de valores e geração das parcelas
// Módulo isolado: não acessa banco nem envia nada.
const { hoje, addDias } = require('./util');

const FREQUENCIAS = ['diario', 'semanal', 'quinzenal', 'mensal', 'personalizado'];

function centavos(n) { return Math.round((Number(n) || 0) * 100); }

function erro(msg) { const e = new Error(msg); e.status = 400; return e; }

// Valor principal + percentual → acréscimo e total
function calcularTotais(valorPrincipal, percentual) {
  const principal = centavos(valorPrincipal);
  if (principal <= 0) throw erro('Informe o valor principal.');
  const pct = Number(String(percentual ?? 0).replace(',', '.')) || 0;
  if (pct < 0 || pct > 1000) throw erro('Percentual inválido.');
  const acrescimo = Math.round(principal * pct / 100);
  return { valor_principal: principal / 100, percentual: pct, acrescimo: acrescimo / 100, total: (principal + acrescimo) / 100 };
}

function diasNoMes(ano, mes) { return new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate(); } // mes 0-11
function dataMes(ano, mes, dia) {
  const a = ano + Math.floor(mes / 12), m = ((mes % 12) + 12) % 12;
  const d = Math.min(dia, diasNoMes(a, m));
  return a + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function diaSemana(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }

// Dias da semana em que pode haver cobrança (0 = domingo ... 6 = sábado)
function lerDiasCobranca(entrada) {
  if (Array.isArray(entrada.dias_cobranca)) {
    const dias = [...new Set(entrada.dias_cobranca.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
    if (!dias.length) throw erro('Marque pelo menos um dia da semana para cobrar.');
    return dias;
  }
  return entrada.pular_domingos ? [1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
}

// Gera as datas de vencimento conforme a frequência
function gerarDatas(freq, qtd, cfg, ref) {
  const datas = [];
  if (freq === 'diario') {
    let d = cfg.data_inicial || addDias(ref, 1);
    while (datas.length < qtd) {
      if (cfg.dias_cobranca.includes(diaSemana(d))) datas.push(d);
      d = addDias(d, 1);
    }
  } else if (freq === 'semanal') {
    const alvo = Number(cfg.dia_semana);
    if (!(alvo >= 0 && alvo <= 6)) throw erro('Escolha o dia da semana.');
    let d = cfg.data_inicial || addDias(ref, 1);
    while (diaSemana(d) !== alvo) d = addDias(d, 1);
    for (let i = 0; i < qtd; i++) datas.push(addDias(d, i * 7));
  } else if (freq === 'quinzenal') {
    const d = cfg.data_inicial || addDias(ref, 15);
    for (let i = 0; i < qtd; i++) datas.push(addDias(d, i * 15));
  } else if (freq === 'mensal') {
    const dia = Number(cfg.dia_mes);
    if (!(dia >= 1 && dia <= 31)) throw erro('Informe o dia do vencimento (1 a 31).');
    const base = cfg.data_inicial || addDias(ref, 1);
    let [ano, mes] = base.split('-').map(Number); mes -= 1;
    if (dataMes(ano, mes, dia) < base) mes += 1;
    for (let i = 0; i < qtd; i++) datas.push(dataMes(ano, mes + i, dia));
  } else if (freq === 'personalizado') {
    const n = Math.floor(Number(cfg.intervalo_dias));
    if (!(n >= 1 && n <= 365)) throw erro('Informe o intervalo em dias (1 a 365).');
    const d = cfg.data_inicial || addDias(ref, n);
    for (let i = 0; i < qtd; i++) datas.push(addDias(d, i * n));
  } else {
    throw erro('Frequência inválida.');
  }
  return datas;
}

/**
 * Gera a simulação completa.
 * entrada: { valor_principal, percentual, frequencia, qtd_parcelas?, valor_parcela?,
 *            data_inicial?, dia_semana?, dia_mes?, intervalo_dias?, dias_cobranca? }
 * Informe a quantidade de parcelas OU o valor da parcela: o outro é calculado.
 */
function simular(entrada, ref = hoje()) {
  const tot = calcularTotais(entrada.valor_principal, entrada.percentual);
  const freq = entrada.frequencia;
  if (!FREQUENCIAS.includes(freq)) throw erro('Escolha a frequência de pagamento.');

  const totalC = centavos(tot.total);
  let qtd = Math.floor(Number(entrada.qtd_parcelas) || 0);
  const vParc = centavos(entrada.valor_parcela);
  let base;

  if (qtd > 0) {
    base = Math.floor(totalC / qtd);
  } else if (vParc > 0) {
    if (vParc > totalC) throw erro('O valor da parcela é maior que o total.');
    qtd = Math.ceil(totalC / vParc);
    base = vParc;
  } else {
    throw erro('Informe a quantidade de parcelas ou o valor de cada parcela.');
  }
  if (qtd > 1000) throw erro('Máximo de 1000 parcelas.');

  const cfg = {
    data_inicial: entrada.data_inicial || null,
    dia_semana: entrada.dia_semana, dia_mes: entrada.dia_mes,
    intervalo_dias: entrada.intervalo_dias, dias_cobranca: lerDiasCobranca(entrada),
  };
  const datas = gerarDatas(freq, qtd, cfg, ref);

  const parcelas = datas.map((venc, i) => ({
    numero: i + 1,
    vencimento: venc,
    valor: (i === qtd - 1 ? totalC - base * (qtd - 1) : base) / 100,
  }));

  return { ...tot, frequencia: freq, qtd_parcelas: qtd, valor_parcela: base / 100, config: cfg, parcelas };
}

module.exports = { lerDiasCobranca, simular, calcularTotais, FREQUENCIAS };
