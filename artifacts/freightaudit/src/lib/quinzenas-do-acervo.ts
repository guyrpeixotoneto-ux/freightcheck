import {
  hojeEm,
  periodoDaQuinzena,
  quinzenaDaData,
  type PeriodoDaQuinzena,
} from "@/lib/calendario";

/**
 * AS QUINZENAS DE UMA UNIDADE — o que entrou, e o que não entrou.
 *
 * Importações responde *o que chegou*: uma lista de arquivos, cada um com o que
 * produziu. Isso deixa uma pergunta inteira sem tela: **o que não chegou.** A
 * quinzena que ninguém enviou não tem cartão, não tem linha, não tem nada — ela
 * não aparece como falta, ela simplesmente não aparece. Foi assim que a
 * pergunta chegou: "clico em Cavalo e vejo só as importações das quinzenas de
 * Cavalo" — e a metade que falta é exatamente a quinzena de Cavalo que não tem
 * importação nenhuma.
 *
 * A Cobertura de dados também não pega: a matriz dela é conjunto × vigência, e
 * as colunas são as vigências **que existem**. Uma quinzena sem importação não
 * é uma coluna vermelha lá; é uma coluna que não está lá. As duas telas são
 * cegas para o mesmo buraco, e é ele que este módulo enxerga.
 *
 * ---------------------------------------------------------------------------
 * De onde saem as linhas — e por que nenhuma é expectativa inventada
 * ---------------------------------------------------------------------------
 * Das duas únicas coisas que se pode afirmar sem inventar:
 *
 * 1. **o calendário**, que é fato: a quinzena existe quer alguém tenha mandado
 *    planilha ou não, e a régua dela é a mesma do Fechamento
 *    (`lib/calendario.ts`) — 1 a 15, 16 ao fim do mês;
 * 2. **as vigências que de fato entraram**, que é registro.
 *
 * O que este módulo **não** faz é dizer que uma quinzena *deveria* ter sido
 * enviada. Ele diz que ela existe no calendário e que nada entrou nela — e
 * essas duas afirmações, juntas, são a pergunta que quem opera precisa ver. A
 * diferença não é retórica: no Fechamento a competência é **aberta por
 * alguém**, e cada fonte declara em que quinzena é esperada (`fontesParaEnviar`,
 * em `lib/fechamento.ts`), de modo que "PENDENTE" lá é uma expectativa gravada.
 * Aqui não existe registro nenhum dizendo "esta unidade entrega quinzenalmente",
 * e escrever "pendente" seria inventá-lo.
 *
 * ---------------------------------------------------------------------------
 * A janela, e por que uma importação nunca some dela
 * ---------------------------------------------------------------------------
 * A janela do calendário vai até a quinzena corrente e tem {@link JANELA}
 * quinzenas — seis meses, que é o que se lê sem rolar. Mas toda quinzena **com
 * importação** entra na lista mesmo fora dela, inclusive as mais antigas e as
 * de data futura (que existem: uma vigência de teste, um rótulo de ano errado).
 * Esconder uma importação que existe para caber numa janela seria a tela
 * mentindo por estética — e esta é a tela onde isso menos pode acontecer.
 */

/** Seis meses. Cabe na altura de uma tela; o resto está no histórico abaixo. */
export const JANELA = 12;

/** O pedaço de uma importação de que este módulo depende. */
export interface RunComVigencias {
  importRunId: string;
  declaredType: string | null;
  vigencias: { label: string; effectiveDate: string; tipos: string[] }[];
}

/** O que uma importação trouxe para uma quinzena, na linha dela. */
export interface EnvioDaQuinzena<T extends RunComVigencias> {
  run: T;
  /** O rótulo da vigência que esta importação gravou nesta quinzena. */
  label: string;
}

/** Uma quinzena do calendário, com o que entrou em cada tipo. */
export interface LinhaDaQuinzena<T extends RunComVigencias> {
  periodo: PeriodoDaQuinzena;
  /** `CAVALO` → as importações que trouxeram cavalo nesta quinzena. */
  porTipo: Map<string, EnvioDaQuinzena<T>[]>;
  /** A quinzena ainda está correndo — o que falta nela pode não ser falta. */
  emCurso: boolean;
}

/**
 * Os tipos que uma importação trouxe para **uma** vigência.
 *
 * A declaração manda, e depois o medido — a mesma ordem de
 * `tiposVindosDoArquivo` (`pages/importacoes.tsx`), de propósito: é ela que
 * decide em que aba a importação aparece, e se as duas divergissem a aba
 * `Cavalo 3` mostraria um número de linhas diferente do que ela conta. A
 * divergência entre declaração e conteúdo não escapa por aqui — a importação já
 * recusa o arquivo cujo conteúdo não bate com o tipo declarado.
 */
export function tiposDaVigencia(
  run: RunComVigencias,
  vigencia: { tipos: string[] },
): string[] {
  return run.declaredType !== null ? [run.declaredType] : vigencia.tipos;
}

/**
 * As quinzenas de um acervo já recortado, da mais recente para a mais antiga.
 *
 * `runs` chega recortado pela unidade e pelo acervo — esta função não sabe
 * recortar nada, e é de propósito: quem recorta é a tela, com as mesmas regras
 * que recortam as abas e as contagens delas. Uma segunda régua de recorte aqui
 * poria a lista de quinzenas e as abas falando de populações diferentes.
 *
 * `hoje` entra por parâmetro para o teste poder fixar o dia; a tela passa
 * `hojeEm()`, como as outras.
 */
export function quinzenasDoAcervo<T extends RunComVigencias>(
  runs: T[],
  hoje: string = hojeEm(),
): LinhaDaQuinzena<T>[] {
  const linhas = new Map<string, LinhaDaQuinzena<T>>();

  const abrir = (periodo: PeriodoDaQuinzena): LinhaDaQuinzena<T> => {
    const existente = linhas.get(periodo.chave);
    if (existente !== undefined) return existente;
    const nova: LinhaDaQuinzena<T> = {
      periodo,
      porTipo: new Map(),
      emCurso: periodo.inicio <= hoje && hoje <= periodo.fim,
    };
    linhas.set(periodo.chave, nova);
    return nova;
  };

  // A janela do calendário: a quinzena corrente e as onze anteriores.
  const corrente = periodoDe(hoje);
  for (let passo = 0; passo < JANELA; passo += 1) {
    abrir(recuar(corrente, passo));
  }

  // E o que entrou — que nunca fica de fora, mesmo fora da janela.
  for (const run of runs) {
    for (const vigencia of run.vigencias) {
      const linha = abrir(periodoDe(vigencia.effectiveDate));
      for (const tipo of tiposDaVigencia(run, vigencia)) {
        const envios = linha.porTipo.get(tipo) ?? [];
        /*
          O consolidado grava uma vigência por unidade, as duas com o mesmo
          rótulo e a mesma data: sem isto, a mesma importação apareceria duas
          vezes na linha da quinzena, dizendo "dois envios" onde houve um.
        */
        if (!envios.some((e) => e.run.importRunId === run.importRunId)) {
          envios.push({ run, label: vigencia.label });
        }
        linha.porTipo.set(tipo, envios);
      }
    }
  }

  return [...linhas.values()].sort((a, b) =>
    b.periodo.inicio.localeCompare(a.periodo.inicio),
  );
}

/** Em que quinzena do calendário uma data cai. */
function periodoDe(data: string): PeriodoDaQuinzena {
  return periodoDaQuinzena(
    Number(data.slice(0, 4)),
    Number(data.slice(5, 7)),
    quinzenaDaData(data),
  );
}

/** A quinzena `passos` antes desta — 1 volta para a 2ª do mês anterior. */
function recuar(periodo: PeriodoDaQuinzena, passos: number): PeriodoDaQuinzena {
  // Em meias-quinzenas desde o ano 0: a conta que faz dezembro→janeiro sozinha.
  const indice = periodo.ano * 24 + (periodo.mes - 1) * 2 + (periodo.quinzena - 1) - passos;
  const ano = Math.floor(indice / 24);
  const resto = indice - ano * 24;
  return periodoDaQuinzena(ano, Math.floor(resto / 2) + 1, resto % 2 === 0 ? 1 : 2);
}

/**
 * AS QUATRO SITUAÇÕES DE UMA QUINZENA, num tipo — o vocabulário da grade.
 *
 * A forma é a das Visões Gerenciais da Auditoria e do Fechamento, de propósito:
 * quem lê as três não deve ter de reaprender o que uma casa do calendário diz.
 * O que muda é o significado de cada uma, e isso não pode ser partilhado — lá a
 * casa cheia é a competência encerrada ou a vigência comparada; aqui é a
 * planilha que entrou.
 *
 * **Só uma é alarme, e a distinção é o cuidado desta tela.** `SEM_ENVIO` é a
 * quinzena terminada de um tipo que esta unidade **entrega** e em que nada
 * entrou — a única em que há motivo para alguém olhar. `NUNCA_ENTREGUE` é a
 * outra ausência, a do tipo que a unidade nunca entregou: pode ser que a
 * operação não o tenha, pode ser que ninguém nunca tenha mandado, e o produto
 * não registra qual das duas. Pintar as duas igual seria gritar sobre o que não
 * se sabe.
 */
export type SituacaoDaQuinzena =
  /** Uma planilha daquele tipo entrou nesta quinzena. */
  | "ENTROU"
  /** A quinzena terminou, a unidade entrega este tipo, e nada entrou. */
  | "SEM_ENVIO"
  /** A quinzena ainda está correndo — o que falta nela pode não ser falta. */
  | "EM_CURSO"
  /** Esta unidade nunca entregou este tipo. Ausência, e não falta. */
  | "NUNCA_ENTREGUE";

export const NOME_DA_SITUACAO: Record<SituacaoDaQuinzena, string> = {
  ENTROU: "Entrou",
  SEM_ENVIO: "Sem envio",
  EM_CURSO: "Em curso",
  NUNCA_ENTREGUE: "Nunca entregue",
};

export const EXPLICACAO_DA_SITUACAO: Record<SituacaoDaQuinzena, string> = {
  ENTROU: "Uma planilha deste tipo entrou nesta quinzena e virou vigência.",
  SEM_ENVIO:
    "A quinzena terminou e nada deste tipo entrou nela — e esta unidade entrega este tipo nas outras.",
  EM_CURSO: "A quinzena ainda está correndo; o que não entrou pode ainda entrar.",
  NUNCA_ENTREGUE:
    "Nada deste tipo entrou nesta unidade, em quinzena nenhuma. O produto não sabe se ela deveria entregá-lo.",
};

/**
 * Em que situação está uma quinzena, para um tipo.
 *
 * A ordem das perguntas é o desenho: o envio manda sobre tudo (uma quinzena em
 * curso que já recebeu planilha está cheia, não correndo), e "nunca entregue" é
 * a última — ela descreve a coluna inteira, e só vale dizer quando aquela
 * quinzena não tem nada para dizer por si.
 */
export function situacaoDaQuinzena<T extends RunComVigencias>(
  linha: LinhaDaQuinzena<T>,
  tipo: string,
  jaEntrou: boolean,
): SituacaoDaQuinzena {
  if ((linha.porTipo.get(tipo) ?? []).length > 0) return "ENTROU";
  if (linha.emCurso) return "EM_CURSO";
  return jaEntrou ? "SEM_ENVIO" : "NUNCA_ENTREGUE";
}

/**
 * Esta unidade já entregou este tipo alguma vez?
 *
 * **É a diferença entre duas ausências que parecem a mesma.** Uma quinzena de
 * Cavalo vazia numa unidade que manda Cavalo todo mês é uma falta, e vale um
 * alarme. Uma coluna inteira de Trecho vazia numa unidade que nunca entregou
 * Trecho **não é falta nenhuma que se possa afirmar**: pode ser que a operação
 * não tenha trecho, pode ser que ninguém nunca tenha mandado, e o produto não
 * registra qual das duas. Pintar as duas de amarelo é gritar sobre o que não se
 * sabe — o tipo de alarme que ensina a ignorar o alarme.
 *
 * Então o amarelo fica para a primeira, e a segunda é dita em cinza, em
 * palavras: nada deste tipo entrou aqui. Continua sendo informação, e continua
 * sem afirmar expectativa.
 */
export function tipoJaEntrou<T extends RunComVigencias>(
  linhas: LinhaDaQuinzena<T>[],
  tipo: string,
): boolean {
  return linhas.some((linha) => (linha.porTipo.get(tipo) ?? []).length > 0);
}

/** Quantas quinzenas da janela estão sem envio de um tipo — o que o selo conta. */
export function semEnvio<T extends RunComVigencias>(
  linhas: LinhaDaQuinzena<T>[],
  tipo: string,
): LinhaDaQuinzena<T>[] {
  /*
    A quinzena em curso fica de fora da conta. Ela não está faltando: ela ainda
    está acontecendo, e contá-la como buraco faria o selo nascer com uma falta
    permanente que nunca é culpa de ninguém — o tipo de alarme que ensina a
    ignorar o alarme.
  */
  return linhas.filter(
    (linha) => !linha.emCurso && (linha.porTipo.get(tipo) ?? []).length === 0,
  );
}
