import { centavos, lerNumero, type Canal, type Recusa } from "../dominio";
import { diaDeTextoBR, type Dia } from "../periodo";
import { VERBAS, verbaDe, verbaDesconhecida, type Verba } from "../verbas";
import { lerTextoDeRelatorio } from "./formato";

/**
 * O 03.08.20 — o demonstrativo de pagamento da quinzena.
 *
 * É o documento que a Ambev e a transportadora assinam ("declaramos estar de
 * acordo com os valores acima"), e é a **única das seis fontes que abre a
 * parcela fixa verba a verba**. Sem ele, o fixo entrava na conta só pelo que o
 * CT-e dizia e ninguém o conferia: na quinzena de referência isso eram
 * R$ 654.310,24 de R$ 1.473.432,61 emitidos — 44% do dinheiro sustentado por
 * nada além do próprio documento fiscal que se queria conferir.
 *
 * **O que ele traz que nenhuma outra fonte tem.** Cada verba aparece com o
 * valor limpo (`S/Imposto`) e com a divisão do faturamento em duas naturezas de
 * documento — `NF-ISS` e `CTRC-ICMS` —, cujos percentuais o próprio cabeçalho
 * declara (2,38% / 97,62% na Rota; 0% / 100% no AS). É a coluna **CTRC-ICMS**
 * que vira CT-e, e é por isso que ela é a que se compara ao 03.08.15. Conferido
 * contra um fechamento real (CDD Belém, 16–31/07/2026), o CTRC-ICMS bate ao
 * centavo nas seis verbas fixas e nas quatro complementares; as cinco variáveis
 * divergem, e essa divergência é achado, não erro de leitura — o demonstrativo
 * é tirado numa data e o CT-e carrega saldo de quinzenas anteriores.
 *
 * **Ele declara o próprio período, e é o único que declara.** `Periodo:
 * 16/07/2026 a 31/07/2026` no cabeçalho de toda página. As outras fontes
 * trazem data de emissão, de aprovação ou o rótulo da quinzena — nenhuma diz,
 * em letra, a que período pertence. Por isso é aqui que a competência aberta no
 * mês errado é pega na porta (ver `recusarPagamentoDeOutroPeriodo` em
 * `persistencia.ts`), e não uma quinzena inteira depois.
 *
 * **Largura fixa, e por isso lido por rótulo e não por coluna.** Ao contrário
 * do 03.02.59.02 — onde a posição do número *é* o dado —, aqui cada linha traz
 * as seis colunas sempre na mesma ordem, e o que distingue uma linha da outra é
 * o rótulo. Ler por rótulo sobrevive a um alinhamento que mude de versão; ler
 * por coluna, não.
 *
 * **E é essa escolha que faz o mesmo leitor servir ao arquivo delimitado.** Um
 * `.csv` deste relatório traz as mesmas colunas na mesma ordem, separadas por
 * um caractere em vez de por espaço; remontar a linha juntando os campos com
 * dois espaços (ver `lerTextoDeRelatorio`, em `formato.ts`) devolve exatamente
 * a linha que as expressões abaixo já sabiam ler. Não há uma segunda gramática
 * aqui, e é de propósito: duas gramáticas para o mesmo relatório divergiriam
 * na primeira verba nova.
 */

/** Em que bloco do relatório a verba apareceu. */
export type BlocoDoPagamento = "FRETE" | "OUTROS_CUSTOS";

/** Uma verba do demonstrativo, com as seis colunas que o relatório abre. */
export interface ItemDePagamento {
  /** A linha física do arquivo — a ponta da trilha até a célula de origem. */
  linha: number;
  canal: Canal;
  bloco: BlocoDoPagamento;
  verba: Verba;
  /** O nome como o arquivo o escreve, para a divergência poder citá-lo. */
  nomeNoArquivo: string;
  /** O valor limpo — a moeda em que o SRTrans trabalha. */
  semImposto: number;
  /** A parte que sai como nota fiscal de serviço (ISS). */
  nfIss: number;
  /** A parte que sai como CT-e (ICMS). **É esta que vira o 03.08.15.** */
  ctrcIcms: number;
  /** `NF-ISS + CTRC-ICMS` — o que a Ambev diz que vai faturar na verba. */
  valorFaturado: number;
  vlcNfIss: number;
  vlcCtrcIcms: number;
}

/** O que o relatório desconta, e de qual verba ele já subtraiu. */
export type TipoDeDescontoDoPagamento =
  | "DEVOLUCAO"
  | "DISPONIBILIDADE_CUSTO_FIXO"
  | "DISPONIBILIDADE_EQUIPE"
  | "DISPONIBILIDADE_INDIRETO"
  | "DISPONIBILIDADE_FATOR_AJUDANTE"
  | "FRETE_MINIMO";

/**
 * Um desconto do demonstrativo.
 *
 * Todos vêm com a frase "Desconto Liquido ja subtraido da VBZ …" ao lado, e a
 * frase é o dado mais importante da linha: ela diz que o valor **já está fora**
 * da verba correspondente. Somá-lo de novo ao conferir seria descontar duas
 * vezes — o erro que a planilha comete quando alguém empilha os quadros dela.
 * Por isso o `rotulo` é preservado inteiro, e não resumido.
 */
export interface DescontoDoPagamento {
  linha: number;
  canal: Canal;
  tipo: TipoDeDescontoDoPagamento;
  /** O rótulo inteiro, como veio — inclusive a frase de qual VBZ saiu. */
  rotulo: string;
  valor: number;
  /** Só a devolução tem base e percentual. Nas outras é `null`, nunca zero. */
  base: number | null;
  percentual: number | null;
  /**
   * As VBZs de que este desconto **já foi subtraído**, lidas do próprio rótulo.
   *
   * Lista vazia quando o rótulo não nomeia nenhuma — é o caso do frete mínimo,
   * que diz "das VBZs de custo Fixo coluna ICMS" sem dizer quais. Vazia é
   * diferente de "de nenhuma": o desconto saiu de alguma verba, e é o arquivo
   * que não conta de qual. Ver {@link vbzsCitadasNoRotulo}.
   */
  vbzDeOrigem: number[];
}

export interface Pagamento {
  /** O período que o próprio relatório declara. */
  periodo: { inicio: Dia | null; fim: Dia | null };
  unidade: { codigo: string; nome: string } | null;
  transportadora: { codigo: string; nome: string } | null;
  itens: ItemDePagamento[];
  descontos: DescontoDoPagamento[];
  /** O `Total Remuneração` que o próprio relatório fecha, por canal. */
  totais: { canal: Canal; total: number }[];
  /**
   * As linhas que **pareciam verba** e não foram aceitas, com o texto original.
   *
   * Este leitor era o único, junto com o da conciliação, a não devolver recusa
   * nenhuma — e a consequência apareceu em produção: um 03.08.20 gravou catorze
   * descontos e nenhuma verba, e não havia como saber por quê sem pedir o
   * arquivo de volta. O sistema não guarda o arquivo (ver `receberDocumento`),
   * então a recusa **é** a evidência: `Recusa.original` existe exatamente para
   * que a decisão possa ser revista sem reabrir o que não está guardado.
   *
   * Só entra aqui o que tem forma de verba — `NN - Nome` seguido de valores.
   * Recusar toda linha não reconhecida encheria o registro com cabeçalho,
   * rodapé e linha em branco, e a evidência se perderia no ruído.
   */
  recusas: Recusa[];
}

/*
  Uma verba: dois ou três dígitos, hífen, nome, e as seis colunas. O nome é
  não-guloso e termina no primeiro vão de dois espaços, o que faz
  `09 - Rota - Outras Despesas` chegar inteiro apesar do segundo hífen.
*/
const RE_ITEM =
  /^\s*(\d{1,3})\s*-\s*(.+?)\s{2,}(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s*$/;
const RE_PERIODO = /Periodo:\s*(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/i;
const RE_TRANSPORTADORA = /^Transportadora\s+(\d+)\s+(.+?)\s*$/i;
const RE_UNIDADE = /^Entregas para\s+(\S+)\s*-\s*(.+?)\s*$/i;
const RE_TOTAL = /^total remuneracao\s+(-?[\d.]+,\d{2})\s*$/;
const RE_VALOR = /-?[\d.]+,\d{2}/g;
/**
 * Uma linha que **começa** como verba: `NN - Nome` seguido de alguma coisa.
 *
 * Mais frouxo que {@link RE_ITEM} de propósito: serve para reconhecer o que o
 * relatório quis dizer, e não o que o leitor aceita. A diferença entre os dois
 * é exatamente a recusa que vale a pena registrar.
 */
const RE_PARECE_VERBA = /^\s*\d{1,3}\s*-\s*.{3,}?\s{2,}.+$/;

/** Sem acento e em minúsculas: o Promax alterna as duas grafias entre versões. */
function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function numero(bruto: string | undefined): number {
  return centavos(lerNumero(bruto ?? "") ?? 0);
}

/**
 * O último número da linha.
 *
 * Os blocos de desconto trazem um valor só, mas o rótulo deles cita VBZs
 * (`ja subtraido da VBZ 01`) e percentuais — pegar o primeiro número da linha
 * devolveria o código da verba no lugar do dinheiro.
 */
function ultimoValor(texto: string): number | null {
  const achados = texto.match(RE_VALOR);
  return achados && achados.length > 0 ? numero(achados[achados.length - 1]) : null;
}

/*
  As VBZs que a frase do desconto nomeia. `VBZ 01`, `VBZs 01 e 02`, `da VBZ's`
  — o Promax alterna as três grafias, e o que interessa é sempre o número.
*/
const RE_VBZ_NUMERADA = /\bvbz'?s?\.?\s*(?:n[ºo]\.?\s*)?(\d{1,3})\b/gi;

/**
 * De quais VBZs o desconto já foi subtraído, segundo o próprio rótulo.
 *
 * A frase "Desconto Liquido ja subtraido da VBZ 01 - Frota Fixa Ativa" é o
 * dado mais caro da linha: é ela que impede o erro de descontar duas vezes, e
 * é ela que diz **em qual quadro da planilha** o desconto pousa. Ler o número
 * dali é ler o arquivo; deduzi-lo do tipo do desconto seria decidir por ele.
 *
 * Duas grafias convivem no mesmo relatório. A da disponibilidade traz o
 * código (`da VBZ 01 - Frota Fixa Ativa`); a da devolução traz só o nome
 * (`da VBZ Frota Fixa Ativa`). Quando não há número, o nome é resolvido contra
 * o catálogo **do mesmo canal** — sem isso, `Frota Fixa Ativa` seria a 01 da
 * Rota e a 20 do AS ao mesmo tempo.
 *
 * Devolve lista vazia quando o rótulo não nomeia nenhuma, que é o caso do
 * frete mínimo (`das VBZs de custo Fixo coluna ICMS`). Vazia não é "de
 * nenhuma": é o arquivo não dizendo de qual.
 */
export function vbzsCitadasNoRotulo(rotulo: string, canal: Canal): number[] {
  const achadas = new Set<number>();
  for (const encontro of rotulo.matchAll(RE_VBZ_NUMERADA)) {
    achadas.add(Number(encontro[1]));
  }
  if (achadas.size === 0) {
    const texto = chave(rotulo);
    for (const verba of VERBAS) {
      if (verba.canal !== canal) continue;
      if (texto.includes(`vbz ${chave(verba.nome)}`)) achadas.add(verba.vbz);
    }
  }
  return [...achadas].sort((a, b) => a - b);
}

/**
 * A recusa de uma linha que **tem valor, está num bloco de desconto, e não foi
 * reconhecida** por nenhum dos rótulos daquele bloco.
 *
 * **Por que isto é uma recusa e não um `continue`.** Até aqui essas linhas
 * eram descartadas em silêncio: um desconto novo criado pela Ambev — ou um
 * rótulo que ela renomeasse — sumia do fechamento sem deixar rastro nenhum, e
 * o total do relatório passava a não fechar com a soma das verbas sem que
 * ninguém pudesse dizer por quê. Descartar calado é justamente o que este
 * módulo recusa fazer em todos os outros pontos (ver a recusa das linhas com
 * cara de verba, logo acima): dinheiro que o relatório traz e o sistema não
 * entende precisa aparecer como pergunta, não como ausência.
 *
 * A recusa não interrompe a leitura — o resto do arquivo entra normalmente, e
 * `recusas` é a evidência que sobra, já que o fechamento não guarda o texto
 * original.
 */
function descontoNaoReconhecido(linha: number, bloco: string, original: string): Recusa {
  return {
    linha,
    motivo:
      `Linha com valor dentro do bloco "${bloco}" cujo rótulo não é nenhum dos ` +
      `descontos conhecidos desse bloco. Pode ser um desconto novo, ou um que a ` +
      `Ambev renomeou — nos dois casos ele não entrou na conta, e precisa ser ` +
      `conferido antes de fechar.`,
    original,
  };
}

/** Os quatro descontos de disponibilidade, pelo nome com que o relatório os abre. */
const DISPONIBILIDADE: { marca: string; tipo: TipoDeDescontoDoPagamento }[] = [
  { marca: "desconto ff - custo fixo", tipo: "DISPONIBILIDADE_CUSTO_FIXO" },
  { marca: "desconto ff - equipe entrega", tipo: "DISPONIBILIDADE_EQUIPE" },
  { marca: "desconto ff - custo indireto", tipo: "DISPONIBILIDADE_INDIRETO" },
  { marca: "desconto ff - fator ajudante", tipo: "DISPONIBILIDADE_FATOR_AJUDANTE" },
];

/**
 * Lê o 03.08.20.
 *
 * Recebe bytes e não texto porque a codificação e o formato são decididos aqui
 * dentro, pela mesma razão do leitor de requisições: quem chama não deveria
 * precisar saber nem em que codificação nem em que formato uma fonte chegou.
 */
export function lerPagamento(arquivo: Buffer | ArrayBuffer | string): Pagamento {
  const { linhas: fisicas, linhaFisica } = lerTextoDeRelatorio(arquivo);

  const itens: ItemDePagamento[] = [];
  const descontos: DescontoDoPagamento[] = [];
  const recusas: Recusa[] = [];
  const totais: { canal: Canal; total: number }[] = [];
  let periodo: { inicio: Dia | null; fim: Dia | null } = { inicio: null, fim: null };
  let unidade: Pagamento["unidade"] = null;
  let transportadora: Pagamento["transportadora"] = null;

  /*
    O canal e o bloco vêm de linhas soltas — `ROTA`, depois `FRETE` — e valem
    até a próxima. É por isso que o leitor é uma máquina de estado e não um
    `map` sobre as linhas: a mesma linha `09 - …` significa coisas diferentes
    conforme o que veio antes dela.
  */
  let canal: Canal | null = null;
  let bloco: string | null = null;
  /* A devolução ocupa três linhas seguidas e só fecha na última. */
  let devolucao: { base: number | null; percentual: number | null } = {
    base: null,
    percentual: null,
  };

  for (let i = 0; i < fisicas.length; i += 1) {
    const bruta = fisicas[i] ?? "";
    const numeroDaLinha = linhaFisica[i] ?? i + 1;
    const limpa = bruta.trim();
    if (limpa === "" || /^-+$/.test(limpa)) continue;

    if (!periodo.inicio) {
      const achado = RE_PERIODO.exec(bruta);
      if (achado) {
        periodo = { inicio: diaDeTextoBR(achado[1]), fim: diaDeTextoBR(achado[2]) };
        continue;
      }
    }
    if (!transportadora) {
      const achado = RE_TRANSPORTADORA.exec(limpa);
      if (achado) {
        transportadora = { codigo: achado[1], nome: achado[2].trim() };
        continue;
      }
    }
    if (!unidade) {
      const achado = RE_UNIDADE.exec(limpa);
      if (achado) {
        unidade = { codigo: achado[1], nome: achado[2].trim() };
        continue;
      }
    }

    const rotulo = chave(limpa);

    if (rotulo === "rota" || rotulo === "as") {
      canal = rotulo === "rota" ? "ROTA" : "AS";
      bloco = null;
      continue;
    }
    if (rotulo === "frete" || rotulo === "outros custos") {
      bloco = rotulo === "frete" ? "FRETE" : "OUTROS_CUSTOS";
      continue;
    }
    /*
      O título do bloco e a sua linha de valor começam com as mesmas palavras
      — `DESCONTO DEVOLUCAO` e `Desconto Devolucao   15.763,61`. O que os
      separa é o número: o título está sozinho na linha.
    */
    if (rotulo === "desconto devolucao") {
      bloco = "DEVOLUCAO";
      devolucao = { base: null, percentual: null };
      continue;
    }
    if (rotulo === "desconto disponibilidade") {
      bloco = "DISPONIBILIDADE";
      continue;
    }
    /*
      A devolução espalha a frase de origem numa linha própria, começada por
      asterisco — as outras a trazem entre parênteses, junto do valor. Ela é o
      que diz de qual verba o desconto saiu, e sem ela a devolução seria o único
      desconto do relatório sem origem declarada. A linha é anexada ao rótulo do
      desconto que acabou de ser lido, e não guardada à parte, porque é a mesma
      afirmação partida em duas linhas pela largura do papel.
    */
    if (rotulo.startsWith("*desconto liquido devolucao")) {
      const anterior = descontos[descontos.length - 1];
      if (anterior && anterior.tipo === "DEVOLUCAO") {
        anterior.rotulo = `${anterior.rotulo} ${limpa}`;
        anterior.vbzDeOrigem = vbzsCitadasNoRotulo(anterior.rotulo, anterior.canal);
      }
      continue;
    }
    if (rotulo === "desconto frete minimo") {
      bloco = "FRETE_MINIMO";
      continue;
    }

    const total = RE_TOTAL.exec(rotulo);
    if (total && canal) {
      totais.push({ canal, total: numero(total[1]) });
      continue;
    }

    if (!canal) continue;

    const item = RE_ITEM.exec(bruta);
    if (item && (bloco === "FRETE" || bloco === "OUTROS_CUSTOS")) {
      const vbz = Number(item[1]);
      const nomeNoArquivo = item[2].trim();
      const doCatalogo = verbaDe(vbz);
      /*
        O catálogo é a autoridade sobre o canal quando conhece a VBZ; a seção
        do relatório é a autoridade quando não conhece. Discordarem é erro de
        leitura nosso ou VBZ remanejada pela Ambev — nos dois casos, entrar
        calado seria pior do que a linha aparecer sob a seção em que veio.
      */
      itens.push({
        linha: numeroDaLinha,
        canal: doCatalogo?.canal ?? canal,
        bloco,
        verba: doCatalogo ?? verbaDesconhecida(vbz, canal, nomeNoArquivo),
        nomeNoArquivo,
        semImposto: numero(item[3]),
        nfIss: numero(item[4]),
        ctrcIcms: numero(item[5]),
        valorFaturado: numero(item[6]),
        vlcNfIss: numero(item[7]),
        vlcCtrcIcms: numero(item[8]),
      });
      continue;
    }

    /*
      A linha tem cara de verba e não entrou. Aqui é o único lugar em que dá
      para dizer **por que**, e é o que se guarda: sem o arquivo original — que
      o fechamento não persiste —, esta recusa é a evidência.

      Duas causas, e elas pedem coisas opostas de quem for consertar. Ou o
      layout tem outro número de colunas (o export mudou, e o leitor é que
      precisa mudar), ou a linha está fora de uma seção `FRETE`/`OUTROS CUSTOS`
      (o arquivo veio recortado, e é ele que precisa vir inteiro).
    */
    if (RE_PARECE_VERBA.test(bruta)) {
      const quantos = (bruta.match(RE_VALOR) ?? []).length;
      recusas.push({
        linha: numeroDaLinha,
        motivo:
          quantos !== 6
            ? `Linha de verba com ${quantos} coluna(s) de valor; o 03.08.20 traz 6 ` +
              `(sem imposto, NF/ISS, CTRC/ICMS, faturado, VLC NF/ISS, VLC CTRC/ICMS).`
            : bloco === null
              ? "Linha de verba fora de uma seção `FRETE` ou `OUTROS CUSTOS` — o arquivo " +
                "parece ter vindo sem os cabeçalhos de seção."
              : `Linha de verba dentro da seção "${bloco}", que não recebe verba.`,
        original: bruta,
      });
      continue;
    }

    const valor = ultimoValor(limpa);
    if (valor === null) continue;

    if (bloco === "DEVOLUCAO") {
      if (rotulo.startsWith("valor s/imposto")) {
        devolucao.base = valor;
      } else if (rotulo.startsWith("%")) {
        devolucao.percentual = valor;
      } else if (rotulo.startsWith("desconto devolucao")) {
        descontos.push({
          linha: numeroDaLinha,
          canal,
          tipo: "DEVOLUCAO",
          rotulo: limpa,
          valor,
          base: devolucao.base,
          percentual: devolucao.percentual,
          vbzDeOrigem: vbzsCitadasNoRotulo(limpa, canal),
        });
      } else {
        recusas.push(descontoNaoReconhecido(numeroDaLinha, "DESCONTO DEVOLUCAO", bruta));
      }
      continue;
    }

    if (bloco === "DISPONIBILIDADE") {
      const qual = DISPONIBILIDADE.find((d) => rotulo.startsWith(d.marca));
      if (qual) {
        descontos.push({
          linha: numeroDaLinha,
          canal,
          tipo: qual.tipo,
          rotulo: limpa,
          valor,
          base: null,
          percentual: null,
          vbzDeOrigem: vbzsCitadasNoRotulo(limpa, canal),
        });
      } else {
        recusas.push(descontoNaoReconhecido(numeroDaLinha, "DESCONTO DISPONIBILIDADE", bruta));
      }
      continue;
    }

    if (bloco === "FRETE_MINIMO") {
      if (rotulo.startsWith("desconto frete minimo")) {
        descontos.push({
          linha: numeroDaLinha,
          canal,
          tipo: "FRETE_MINIMO",
          rotulo: limpa,
          valor,
          base: null,
          percentual: null,
          vbzDeOrigem: vbzsCitadasNoRotulo(limpa, canal),
        });
      } else {
        recusas.push(descontoNaoReconhecido(numeroDaLinha, "DESCONTO FRETE MINIMO", bruta));
      }
      continue;
    }
  }

  return { periodo, unidade, transportadora, itens, descontos, totais, recusas };
}

/**
 * O que o demonstrativo diz que vira CT-e, somado por verba.
 *
 * A verba pode aparecer duas vezes no mesmo canal — a VBZ 07 (Freteiro) vem no
 * bloco de frete **e** no de outros custos, porque parte dela nasce da operação
 * e parte de requisição aprovada. Somar as duas é o que torna a comparação com
 * o 03.08.15 legítima: lá a verba é uma linha só.
 */
export function ctrcPorVerba(pagamento: Pagamento): Map<number, number> {
  const soma = new Map<number, number>();
  for (const item of pagamento.itens) {
    soma.set(item.verba.vbz, centavos((soma.get(item.verba.vbz) ?? 0) + item.ctrcIcms));
  }
  return soma;
}
