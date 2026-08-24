import type { Documento, Divergencia, Fonte, TipoDeFonte } from "@/lib/fechamento";
import type { EtapaDoRoteiro } from "./roteiro";

/**
 * O ESTADO DE UMA ETAPA — derivado do que já existe, e só disso.
 *
 * **Por que derivar em vez de guardar.** Não há no banco nenhum registro de
 * "esta etapa foi conferida": o que existe são documentos, recusas e
 * divergências. Um estado gravado seria uma segunda verdade capaz de discordar
 * dos arquivos — e um fechamento em que a tela diz "conferido" e os documentos
 * dizem outra coisa é pior do que uma tela sem status nenhum.
 *
 * Enquanto a conferência não for um ato registrado (com autor, desfecho e
 * classificação da diferença), este módulo é a leitura honesta possível: ele
 * afirma sobre **arquivos e divergências**, nunca sobre trabalho humano.
 */

export type EstadoDaEtapa =
  /** Os arquivos chegaram e nenhuma divergência desta etapa está em aberto. */
  | "CONCLUIDA"
  /** Chegaram, e o motor apontou diferença — a etapa segue, mas pede análise. */
  | "DIVERGENCIA"
  /** Falta arquivo que esta etapa espera. */
  | "PENDENTE"
  /** Chegou, e o leitor recusou linhas dele — há dado do arquivo fora da conta. */
  | "COM_RECUSA"
  /** A etapa não recebe arquivo, ou o que ela confere ainda não é calculado. */
  | "NAO_DISPONIVEL";

export interface SituacaoDaEtapa {
  estado: EstadoDaEtapa;
  /** As fontes desta etapa que ainda não chegaram. */
  faltando: Fonte[];
  /** As que chegaram. */
  chegaram: { fonte: Fonte; documento: Documento }[];
  /** Quantas linhas foram recusadas somando os documentos da etapa. */
  linhasRecusadas: number;
  /** As divergências que o motor atribuiu a esta etapa. */
  divergencias: Divergencia[];
  /**
   * A próxima ação, em uma frase — o que fazer agora, não o que aconteceu.
   * `null` quando não há nada a fazer nesta etapa.
   */
  proximaAcao: string | null;
}

/**
 * A que etapa cada tipo de divergência pertence.
 *
 * **Mapeado por tipo, e não pelo texto de `onde`.** `onde` é uma frase para o
 * leitor ("03.08.18 — Desconto Total, abas FF e Van") e muda quando alguém
 * melhora a redação; o tipo é o identificador. Casar por texto faria a
 * divergência trocar de etapa numa mudança de copy.
 *
 * As duas divergências de verba (`VERBA_NAO_FECHA`, `VERBA_SEM_ORIGEM`) caem na
 * conciliação, e não na etapa de uma fonte, porque é isso que elas são: o
 * confronto entre o que o contrato deve e o que foi emitido, que atravessa
 * três relatórios. Atribuí-las ao 03.08.15 sugeriria que o CT-e está errado,
 * quando o que a divergência diz é que os dois lados não se encontram.
 */
const ETAPA_DA_DIVERGENCIA: Record<string, number> = {
  DESCONTO_DE_DISPONIBILIDADE: 3,
  PAGAMENTO_DIVERGE_DO_CTE: 4,
  DESCONTO_FRETE_MINIMO: 5,
  SALDO_ATRAVESSANDO: 5,
  AVISO_DA_CONCILIACAO: 5,
  OPERACAO_NAO_FECHA: 5,
  REQUISICAO_NAO_FATURADA: 7,
  VERBA_NAO_FECHA: 8,
  VERBA_SEM_ORIGEM: 8,
};

/**
 * As divergências de uma etapa.
 *
 * Uma divergência de tipo desconhecido — porque o motor ganhou um tipo novo e
 * este mapa não acompanhou — **não some**: ela cai na conciliação, que é a
 * etapa que olha o fechamento inteiro. Sumir seria o pior desfecho possível
 * para um achado do motor.
 */
export function divergenciasDaEtapa(
  todas: Divergencia[],
  numeroDaEtapa: number,
): Divergencia[] {
  return todas.filter((d) => (ETAPA_DA_DIVERGENCIA[d.tipo] ?? 8) === numeroDaEtapa);
}

/**
 * Uma fonte é esperada nesta quinzena?
 *
 * Usa a mesma distinção do domínio: `quinzenas` é o que a quinzena **cobra**,
 * `quinzenasOpcionais` é o que ela **admite**. Uma casinha opcional vazia não é
 * pendência — dizer que é faria a etapa cobrar alguém por um arquivo que pode
 * não existir.
 */
function esperadaNaQuinzena(fonte: Fonte, quinzena: 1 | 2): boolean {
  return fonte.quinzenas.includes(quinzena);
}

/**
 * O estado de uma etapa, a partir do que a competência tem agora.
 *
 * A ordem de precedência dos estados é deliberada:
 *
 * 1. **Recusa antes de divergência.** Linha recusada é dado do arquivo que não
 *    entrou em conta nenhuma — a divergência calculada sobre o resto pode estar
 *    certa e ainda assim ser sobre um universo incompleto. Quem vê "divergência"
 *    vai conferir números; quem vê "recusa" vai conferir o arquivo, que é o que
 *    o caso pede.
 * 2. **Divergência antes de pendente.** Se o motor já apontou diferença no que
 *    chegou, essa diferença é a informação mais acionável da etapa, mesmo que
 *    ainda falte um arquivo — e o `faltando` continua visível ao lado.
 * 3. **Pendente** quando falta arquivo cobrado.
 * 4. **Concluída** só quando chegou tudo o que se cobra e nada foi apontado.
 *
 * Uma etapa que não recebe arquivo (1 e 8) nunca é "concluída" por aqui: ela é
 * `NAO_DISPONIVEL` ou `DIVERGENCIA`, porque não há arquivo cuja chegada
 * signifique que ela terminou. Dizer "concluída" ali seria afirmar sobre um
 * trabalho que o sistema não observou.
 */
export function situacaoDaEtapa(
  etapa: EtapaDoRoteiro,
  {
    catalogo,
    documentos,
    divergencias,
    quinzena,
  }: {
    catalogo: Fonte[];
    documentos: Map<TipoDeFonte, Documento>;
    divergencias: Divergencia[];
    quinzena: 1 | 2;
  },
): SituacaoDaEtapa {
  const fontes = etapa.fontes
    .map((t) => catalogo.find((f) => f.tipo === t))
    .filter((f): f is Fonte => !!f);

  const chegaram = fontes
    .map((fonte) => ({ fonte, documento: documentos.get(fonte.tipo) }))
    .filter((p): p is { fonte: Fonte; documento: Documento } => !!p.documento);

  const faltando = fontes.filter(
    (f) => !documentos.has(f.tipo) && esperadaNaQuinzena(f, quinzena),
  );

  const linhasRecusadas = chegaram.reduce((s, c) => s + c.documento.recusas.length, 0);
  const minhas = divergenciasDaEtapa(divergencias, etapa.numero);

  const estado: EstadoDaEtapa = (() => {
    if (linhasRecusadas > 0) return "COM_RECUSA";
    if (minhas.length > 0) return "DIVERGENCIA";
    if (faltando.length > 0) return "PENDENTE";
    if (chegaram.length > 0) return "CONCLUIDA";
    return "NAO_DISPONIVEL";
  })();

  return {
    estado,
    faltando,
    chegaram,
    linhasRecusadas,
    divergencias: minhas,
    proximaAcao: proximaAcao(estado, { faltando, linhasRecusadas, quantasDivergencias: minhas.length }),
  };
}

/** O que fazer agora — uma frase, no imperativo, ou `null` se não há ação. */
function proximaAcao(
  estado: EstadoDaEtapa,
  {
    faltando,
    linhasRecusadas,
    quantasDivergencias,
  }: { faltando: Fonte[]; linhasRecusadas: number; quantasDivergencias: number },
): string | null {
  switch (estado) {
    case "COM_RECUSA":
      return `Confira ${linhasRecusadas === 1 ? "a linha recusada" : `as ${linhasRecusadas} linhas recusadas`}: há dado do arquivo fora da conta.`;
    case "DIVERGENCIA":
      return quantasDivergencias === 1
        ? "Analise a diferença apontada — ela não impede seguir para a próxima etapa."
        : `Analise as ${quantasDivergencias} diferenças apontadas — elas não impedem seguir.`;
    case "PENDENTE":
      return faltando.length === 1
        ? `Envie o ${faltando[0]?.rotina}.`
        : `Envie ${faltando.map((f) => f.rotina).join(" e ")}.`;
    case "CONCLUIDA":
    case "NAO_DISPONIVEL":
      return null;
  }
}

/**
 * O resumo de uma etapa fechada — o que o cabeçalho precisa dizer sozinho.
 *
 * **Existe porque colapsar não pode esconder estado.** Com as oito etapas
 * abertas, a situação de cada uma estava escrita no corpo dela; com uma aberta
 * por vez, sete ficam representadas só pelo cabeçalho. Se o cabeçalho disser
 * apenas o nome, fechar a etapa apaga da tela a informação de que ela depende —
 * e quem fecha a quinzena passa a ter de abrir as oito para saber onde está.
 *
 * O selo já dá o estado; esta frase dá o **número**: quantos arquivos chegaram,
 * quantos faltam, quantas linhas foram recusadas. `null` quando não há nada a
 * dizer — etapa sem arquivo e sem achado, onde uma frase vazia seria ruído.
 */
export function resumoDaEtapa(situacao: SituacaoDaEtapa): string | null {
  const partes: string[] = [];

  const total = situacao.chegaram.length + situacao.faltando.length;
  if (total > 0) {
    partes.push(
      situacao.faltando.length === 0
        ? `${situacao.chegaram.length} de ${total} ${total === 1 ? "arquivo" : "arquivos"}`
        : `${situacao.chegaram.length} de ${total}`,
    );
  }

  if (situacao.linhasRecusadas > 0) {
    partes.push(
      situacao.linhasRecusadas === 1
        ? "1 linha recusada"
        : `${situacao.linhasRecusadas} linhas recusadas`,
    );
  }

  if (situacao.divergencias.length > 0) {
    partes.push(
      situacao.divergencias.length === 1
        ? "1 diferença"
        : `${situacao.divergencias.length} diferenças`,
    );
  }

  return partes.length > 0 ? partes.join(" · ") : null;
}

/**
 * A etapa que a tela abre sozinha — a primeira que pede alguma coisa.
 *
 * **Não é "a etapa atual", e a distinção importa.** A trilha não marca nenhuma
 * etapa como a de agora, de propósito: a ordem de trabalho é de quem fecha, não
 * do produto. Mas uma etapa por vez precisa começar em alguma, e abrir sempre a
 * primeira faria a tela pedir um clique antes de mostrar o que interessa.
 *
 * "Pede alguma coisa" é ter arquivo faltando, linha recusada ou diferença
 * apontada — na ordem do roteiro, que é a ordem em que o trabalho acontece.
 * Quando nada pede (tudo conferido, ou nada importado ainda), abre a primeira:
 * é o começo do processo, e não uma afirmação sobre o que falta.
 */
export function primeiraEtapaQuePede(
  situacoes: Map<number, SituacaoDaEtapa>,
  ordem: number[],
): number {
  const pedindo = ordem.find((n) => {
    const s = situacoes.get(n);
    return (
      s !== undefined &&
      (s.estado === "COM_RECUSA" || s.estado === "DIVERGENCIA" || s.estado === "PENDENTE")
    );
  });
  return pedindo ?? ordem[0] ?? 1;
}
