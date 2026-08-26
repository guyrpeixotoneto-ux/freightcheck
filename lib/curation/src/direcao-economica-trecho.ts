import type { Database } from "@workspace/db";
import { descreverFalhaDoBanco, type FalhaDoBanco } from "@workspace/db/falha-do-banco";
import { definirDirecaoEconomica, type DirecaoEconomica } from "./direcao-economica";

/**
 * Primeira rodada de curadoria da direção econômica de TRECHO.
 *
 * Por que existe: `attribute.economic_direction` nasceu vazia (migration
 * `0026_direcao_economica`, "quem preenche é a curadoria") e, até esta rodada,
 * nenhum atributo `trecho.*` tinha sido curado — só `cavalo.*`/`carreta.*`
 * tinham entradas equivalentes (em `lib/knowledge/src/economia.ts`, um catálogo
 * paralelo em código, não neste banco). Sem direção, o Radar de Trechos não
 * tem como saber se um trecho piorou ou melhorou: o impacto em R$ hoje é só
 * `numericAfter - numericBefore`, sem ajuste de sinal (ver `lib/comparison/src/impact.ts`).
 *
 * Como foi decidida: pelo dicionário de negócio (`docs/DICIONARIO-TABELA-DE-FRETE.md`
 * e o bloco `TRECHO` de `catalogo-declarado.ts`), usando `secaoDaDRE` como o
 * sinal primário — "Receita bruta"/"Subtotal e margem" sobe é bom,
 * "(−) Custo variável"/"(−) Deduções" sobe é ruim, "Cadastral" é neutro — mas
 * só quando o atributo é de fato um valor monetário (R$) direto. Não houve
 * acesso ao banco real deste ambiente para medir materialidade por volume de
 * dado (sem `DATABASE_URL` configurada); a lista foi priorizada pelo
 * dicionário, não por frequência de uso medida.
 *
 * Por que muitos atributos ficam `DEPENDS_ON_FORMULA` em vez de receber uma
 * direção: `secaoDaDRE = "(−) Custo variável"` não decide o sinal de um
 * PARÂMETRO (fator, tempo, km, quantidade, vida útil) — só decide o sinal de um
 * MONTANTE. `trecho.diesel_consumo_km_l` está rotulado "Custo variável /
 * Combustível", mas subir é bom (mais km por litro, menos custo) — o oposto do
 * que a seção sugeriria por atalho. Documento interno que descreve esse mesmo
 * risco: `docs/PROPOSTA-ASSISTENTE-AGENTE.md` §8.2. Por isso só os montantes
 * em R$ inequívocos (nome contendo `reais_km`, `reais_viagem`, `frete_`, ou a
 * própria linha de receita/dedução) recebem HIGHER_IS_BETTER/HIGHER_IS_WORSE
 * aqui; fatores, quantidades, tempos e insumos ficam DEPENDS_ON_FORMULA —
 * "revisado, e a resposta é 'depende da fórmula'" —, deliberadamente diferente
 * de `NULL` ("ninguém revisou ainda").
 */
export interface DirecaoEconomicaTrechoEntrada {
  code: string;
  direcao: DirecaoEconomica;
  efeito: string;
}

// ---------------------------------------------------------------------------
// HIGHER_IS_BETTER — receita e margem: subir é favorável à transportadora.
// ---------------------------------------------------------------------------
const RECEITA_E_MARGEM: DirecaoEconomicaTrechoEntrada[] = [
  {
    code: "trecho.frete_liquido",
    direcao: "HIGHER_IS_BETTER",
    efeito: "É a receita líquida do trecho (o que sobra para cobrir custo e margem); subir é favorável.",
  },
  {
    code: "trecho.frete_ctrc",
    direcao: "HIGHER_IS_BETTER",
    efeito: "Receita bruta faturada no CT-e do trecho; subir é favorável.",
  },
  {
    code: "trecho.frete_com_cprb",
    direcao: "HIGHER_IS_BETTER",
    efeito: "Receita bruta usada como base de CPRB; subir é favorável (é faturamento, não o tributo).",
  },
  {
    code: "trecho.frete_p_tms",
    direcao: "HIGHER_IS_BETTER",
    efeito: "Receita bruta de frete carregada no TMS; subir é favorável.",
  },
  {
    code: "trecho.frete_reais_km_lucro_variavel",
    direcao: "HIGHER_IS_BETTER",
    efeito: "Margem que o contrato embute no preço por km (não é custo); subir é favorável.",
  },
  {
    code: "trecho.frete_reais_viagem_lucro_variavel",
    direcao: "HIGHER_IS_BETTER",
    efeito: "A mesma margem variável, expressa por viagem; subir é favorável.",
  },
  {
    code: "trecho.lucro_variavel_reais_km",
    direcao: "HIGHER_IS_BETTER",
    efeito: "Parâmetro que alimenta a margem variável do trecho; subir é favorável.",
  },
];

// ---------------------------------------------------------------------------
// HIGHER_IS_WORSE — custos e deduções monetárias diretas: subir é desfavorável.
// ---------------------------------------------------------------------------
const CUSTOS_E_DEDUCOES: DirecaoEconomicaTrechoEntrada[] = [
  { code: "trecho.frete_reais_km_pedagio", direcao: "HIGHER_IS_WORSE", efeito: "Custo de pedágio por km embutido no preço; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_pedagio", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de pedágio, por viagem; subir é desfavorável." },
  { code: "trecho.pedagio", direcao: "HIGHER_IS_WORSE", efeito: "Cálculo do custo de pedágio do trecho (R$); subir é desfavorável." },
  { code: "trecho.pedagio_por_eixo_ida_volta", direcao: "HIGHER_IS_WORSE", efeito: "Custo de pedágio por eixo, ida e volta (R$); subir é desfavorável." },
  { code: "trecho.pedagio_reais_km", direcao: "HIGHER_IS_WORSE", efeito: "Parâmetro de pedágio em R$/km; subir é desfavorável." },
  { code: "trecho.frete_reais_km_diesel", direcao: "HIGHER_IS_WORSE", efeito: "Custo de diesel por km embutido no preço; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_diesel", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de diesel, por viagem; subir é desfavorável." },
  { code: "trecho.diesel_consumo_diesel_reais_km", direcao: "HIGHER_IS_WORSE", efeito: "Custo de diesel por km rodado (R$); subir é desfavorável." },
  { code: "trecho.frete_reais_km_pneu", direcao: "HIGHER_IS_WORSE", efeito: "Custo de pneu por km embutido no preço; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_pneus", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de pneus, por viagem; subir é desfavorável." },
  { code: "trecho.pneu_custo_pneus_camaras_reais_km", direcao: "HIGHER_IS_WORSE", efeito: "Custo de pneus/câmaras por km (R$); subir é desfavorável." },
  { code: "trecho.frete_reais_km_manutencao_cavalo", direcao: "HIGHER_IS_WORSE", efeito: "Custo de manutenção do cavalo por km; subir é desfavorável." },
  { code: "trecho.frete_reais_km_manutencao_carreta", direcao: "HIGHER_IS_WORSE", efeito: "Custo de manutenção da carreta por km; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_manutencao_cavalo", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de manutenção do cavalo, por viagem; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_manutencao_carreta", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de manutenção da carreta, por viagem; subir é desfavorável." },
  { code: "trecho.manutencao_cavalo", direcao: "HIGHER_IS_WORSE", efeito: "Parâmetro de manutenção do cavalo (R$); subir é desfavorável." },
  { code: "trecho.manutencao_implemento_reaiskm", direcao: "HIGHER_IS_WORSE", efeito: "Parâmetro de manutenção do implemento (R$/km); subir é desfavorável." },
  { code: "trecho.frete_reais_km_seguro", direcao: "HIGHER_IS_WORSE", efeito: "Custo de seguro de carga por km; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_seguro", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de seguro de carga, por viagem; subir é desfavorável." },
  { code: "trecho.seguro", direcao: "HIGHER_IS_WORSE", efeito: "Seguro de carga sobre o valor transportado (R$); subir é desfavorável." },
  { code: "trecho.seguro_reaiskm", direcao: "HIGHER_IS_WORSE", efeito: "Parâmetro de seguro de carga (R$/km); subir é desfavorável." },
  { code: "trecho.frete_reais_km_salario_variavel", direcao: "HIGHER_IS_WORSE", efeito: "Custo de pessoal variável por km embutido no preço; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_salario_variavel", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de pessoal variável, por viagem; subir é desfavorável." },
  { code: "trecho.premio_produtividade_salario_variavel", direcao: "HIGHER_IS_WORSE", efeito: "Prêmio de produtividade pago ao motorista (R$), custo de pessoal; subir é desfavorável." },
  { code: "trecho.premio_produtividade_salario_variavel_reais_km", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo prêmio de produtividade, em R$/km; subir é desfavorável." },
  { code: "trecho.custo_da_diaria", direcao: "HIGHER_IS_WORSE", efeito: "Custo de pessoal pago quando há pernoite fora da base; subir é desfavorável." },
  { code: "trecho.custo_do_tr", direcao: "HIGHER_IS_WORSE", efeito: "Custo do ticket-refeição reconhecido no ciclo; subir é desfavorável." },
  { code: "trecho.frete_pis_cofins", direcao: "HIGHER_IS_WORSE", efeito: "Dedução de PIS/COFINS sobre a prestação; subir reduz o frete líquido, é desfavorável." },
  { code: "trecho.impostos_icms_iss", direcao: "HIGHER_IS_WORSE", efeito: "Dedução de ICMS/ISS sobre a prestação; subir reduz o frete líquido, é desfavorável." },
  { code: "trecho.frete_reais_km_lavagem", direcao: "HIGHER_IS_WORSE", efeito: "Custo de lavagem/higienização por km; subir é desfavorável." },
  { code: "trecho.frete_reais_viagem_lavagem", direcao: "HIGHER_IS_WORSE", efeito: "Mesmo custo de lavagem, por viagem; subir é desfavorável." },
  { code: "trecho.lavagem_reais_km", direcao: "HIGHER_IS_WORSE", efeito: "Parâmetro de lavagem (R$/km); subir é desfavorável." },
];

// ---------------------------------------------------------------------------
// NEUTRAL — cadastro, identificação e regime fiscal aplicável: não medem
// saúde econômica, e não devem mover o veredito do trecho.
// ---------------------------------------------------------------------------
const CADASTRAIS: DirecaoEconomicaTrechoEntrada[] = [
  "trecho.vigencia",
  "trecho.unidade_cnpj",
  "trecho.unidade_nome",
  "trecho.unidade_sap",
  "trecho.unidade_tms",
  "trecho.unidade_promax_unb",
  "trecho.unidade_regional",
  "trecho.operador_cnpj",
  "trecho.operador_nome",
  "trecho.operador_sap",
  "trecho.operador_tms",
  "trecho.operador_promax",
  "trecho.organizacao_de_compras",
  "trecho.prazo_pagamento",
  "trecho.destino",
  "trecho.destino_sap",
  "trecho.destino_tms",
  "trecho.origem",
  "trecho.origem_sap",
  "trecho.origem_tms",
  "trecho.chave_trecho",
  "trecho.cnpj_ida",
  "trecho.cnpj_volta",
  "trecho.faturamento_destino_obrigatorio",
  "trecho.frota_no_municipio",
  "trecho.observacao",
  "trecho.regiao_empurrada",
  "trecho.id",
  "trecho.icms_iss",
].map((code) => ({
  code,
  direcao: "NEUTRAL" as const,
  efeito: "Cadastro, identificação ou regime fiscal aplicável — não mede grandeza econômica do trecho.",
}));

// ---------------------------------------------------------------------------
// DEPENDS_ON_FORMULA — direcionadores operacionais, parâmetros e insumos.
// Revisado, e a resposta é "depende de que conta usa este atributo": não é a
// mesma coisa que NULL ("ninguém revisou ainda").
// ---------------------------------------------------------------------------
const DIRECIONADORES_E_INSUMOS: DirecaoEconomicaTrechoEntrada[] = [
  "trecho.capacidade",
  "trecho.f_mov",
  "trecho.carga_horaria_motorista_puxada_mensal",
  "trecho.carga_horaria_por_trajeto_minuto",
  "trecho.carga_horaria_por_trajeto_minuto_lucro",
  "trecho.carga_horario_trajeto_dia",
  "trecho.carga_horario_trajeto_mes",
  "trecho.consumo_diesel_ajustado",
  "trecho.diesel_consumo_km_l",
  "trecho.dias_mes",
  "trecho.fator_motorista_ajustado",
  "trecho.fator_motorista_indicado",
  "trecho.grade_carregamento",
  "trecho.km_ida",
  "trecho.km_rodado",
  "trecho.km_rodado_mes_por_equipe",
  "trecho.km_rodado_mes_por_equipe_lucro",
  "trecho.km_volta",
  "trecho.percentual_icms_iss",
  "trecho.percentual_perda_descartavel",
  "trecho.percentual_perda_km",
  "trecho.percentual_perda_regiao",
  "trecho.pneu_quantidade_de_pneus",
  "trecho.pneu_valor_de_venda_da_carcaca",
  "trecho.pneu_valor_medio_da_recapagem",
  "trecho.pneu_valor_medio_pneus",
  "trecho.pneu_vidautil_pneu",
  "trecho.vidautil_ajustada_pneu",
  "trecho.premio_produtividade_fator_motorista",
  "trecho.premio_produtividade_km_rodado",
  "trecho.previsao_viagens",
  "trecho.tempo_interno_destino",
  "trecho.tempo_interno_destino_lucro",
  "trecho.tempo_interno_origem",
  "trecho.tempo_interno_origem_lucro",
  "trecho.tempo_refeicao_minuto",
  "trecho.tempo_trajeto_fabrica_cd_minuto",
  "trecho.trecho_com_diaria",
  "trecho.trecho_com_vr",
  "trecho.turno_empurrada",
  "trecho.turnos_fabrica",
  "trecho.velocidade_media_km_h",
].map((code) => ({
  code,
  direcao: "DEPENDS_ON_FORMULA" as const,
  efeito:
    "Direcionador, parâmetro ou insumo — não é um montante em R$ com sinal próprio; o efeito depende de qual custo ou receita ele alimenta.",
}));

export const DIRECAO_ECONOMICA_TRECHO: DirecaoEconomicaTrechoEntrada[] = [
  ...RECEITA_E_MARGEM,
  ...CUSTOS_E_DEDUCOES,
  ...CADASTRAIS,
  ...DIRECIONADORES_E_INSUMOS,
];

export interface AplicarDirecaoEconomicaTrechoResumo {
  gravadas: number;
  jaEstavam: number;
  falhas: { code: string; erro: string }[];
  /**
   * A falha estrutural que fez a rodada parar, quando ela parou.
   *
   * Presente = o banco recusou por um motivo que vale para toda linha
   * (schema atrasado, conexão, timeout), e insistir só repetiria o erro.
   */
  interrompidaPor?: { code: string; falha: FalhaDoBanco };
  /** Atributos que nem chegaram a ser tentados por causa da interrupção. */
  naoTentadas: number;
}

/**
 * Aplica a rodada acima, uma vez por `code`, de forma idempotente
 * (`definirDirecaoEconomica` já resolve "já estava" sem regravar).
 *
 * **Duas falhas diferentes, dois comportamentos.** Uma falha *do atributo* —
 * um código que não existe mais no dicionário — não interrompe os demais: ela
 * é coletada e reportada, porque parar no meio deixaria a curadoria
 * parcialmente aplicada sem que ninguém percebesse, e porque a próxima linha
 * tem chance real de dar certo.
 *
 * Uma falha *do banco* interrompe. Em 26/08/2026 esta função tentou 110 vezes
 * contra um banco que recusou a primeira consulta inteira, e devolveu 110
 * cópias do mesmo envelope sem causa — uma saída longa que não permitia
 * decidir nada. Quando `descreverFalhaDoBanco` diz que a causa é estrutural,
 * a 2ª tentativa não pode informar nada que a 1ª não tenha informado: a
 * rodada para, guarda a causa real (SQLSTATE ou código de rede) e diz quantas
 * ficaram sem tentativa.
 */
export async function aplicarDirecaoEconomicaTrecho(
  db: Database,
  actor: string,
  reason = "Curadoria inicial de direção econômica de TRECHO — Radar de Trechos.",
): Promise<AplicarDirecaoEconomicaTrechoResumo> {
  const resumo: AplicarDirecaoEconomicaTrechoResumo = {
    gravadas: 0,
    jaEstavam: 0,
    falhas: [],
    naoTentadas: 0,
  };

  for (const [indice, entrada] of DIRECAO_ECONOMICA_TRECHO.entries()) {
    try {
      const r = await definirDirecaoEconomica(db, {
        code: entrada.code,
        direcao: entrada.direcao,
        efeito: entrada.efeito,
        actor,
        reason,
      });
      if (r.desfecho === "GRAVADA") resumo.gravadas++;
      else resumo.jaEstavam++;
    } catch (err) {
      const falha = descreverFalhaDoBanco(err);
      if (falha.estrutural) {
        resumo.interrompidaPor = { code: entrada.code, falha };
        resumo.naoTentadas = DIRECAO_ECONOMICA_TRECHO.length - indice - 1;
        return resumo;
      }
      resumo.falhas.push({ code: entrada.code, erro: falha.mensagem });
    }
  }

  return resumo;
}
