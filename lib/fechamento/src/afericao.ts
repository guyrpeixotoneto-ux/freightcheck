import { centavos, type Canal } from "./dominio";
import { FONTE_DO_DEMONSTRATIVO, procedenciaDoMotor } from "./matriz";
import type { CanalDoResumo, ResumoDoMes, TresColunas } from "./resumo";

/**
 * A AFERIÇÃO — dois números sobre o próprio fechamento, e nenhum deles opinião.
 *
 * **A pergunta que ela responde.** Quem abre esta tela quer saber, antes de
 * discutir qualquer linha, *o quanto dá para confiar neste mês*. A resposta
 * honesta são duas perguntas separadas, e confundi-las é o que faz um painel
 * parecer mais firme do que é:
 *
 * 1. **Precisão** — do dinheiro que o sistema conseguiu conferir, quanto bate?
 *    É a medida da conta.
 * 2. **Lastro** — do dinheiro que o fechamento move, quanto tem contrapartida
 *    num documento que **não** o produziu? É a medida da evidência.
 *
 * As duas caminham em direções opostas com frequência, e é por isso que são
 * duas. Um fechamento pode ter precisão de 100% com lastro baixíssimo — basta
 * conferir tudo contra o arquivo de onde os números saíram, que é uma
 * conferência que concorda consigo mesma. E pode ter lastro alto e precisão
 * ruim, que é o caso interessante: as fontes existem, são independentes, e
 * discordam.
 *
 * **Nenhum dos dois é escrito à mão.** Não há tabela de notas, não há peso
 * arbitrado, não há percentual digitado em lugar nenhum. Precisão é
 * `1 − não explicado ÷ conferido`; lastro é `com lastro cruzado ÷ movimentado`.
 * As duas saem das mesmas parcelas que a tela mostra, e mudam sozinhas quando o
 * fechamento muda. Um número de confiança que precisasse ser atualizado à mão
 * envelheceria em silêncio e seria pior que nenhum.
 *
 * **O que a aferição não mede, e diz que não mede.** Ela olha uma competência.
 * Não sabe se a regra que fechou em julho fecha em agosto, não sabe se o
 * cadastro digitado corresponde ao contrato assinado, e não sabe o que
 * nenhuma das seis fontes traz. Esses limites saem em {@link Afericao.limites},
 * por extenso, e alguns deles com o valor em dinheiro ao lado — porque um
 * limite com cifra é auditável e um limite genérico é decoração.
 */

/** De que qualidade é a evidência por trás de uma parcela do fechamento. */
export type ClasseDeLastro =
  /**
   * Os dois lados existem, saem de **documentos diferentes**, e a linha fecha.
   *
   * É a evidência mais forte que este produto sabe produzir: o devido sai de um
   * arquivo (o 03.08.12.09, o 03.08.18, o 2Art, o cadastro) e o demonstrado sai
   * do 03.08.20. Dois documentos que ninguém escreveu olhando o outro chegando
   * ao mesmo centavo é uma afirmação sobre a operação, não sobre a leitura.
   */
  | "CRUZADO"
  /**
   * Idem, mas a conferência é do **grupo**, não da linha.
   *
   * As cinco linhas do custo fixo dividem um número só do 03.08.20 — ele não
   * parte a frota por tipo, e o contrato parte. A soma das cinco confere; a
   * partição entre elas não é conferida por nada. Contar isto como lastro é
   * certo (há documento independente atrás do dinheiro) e contá-lo como igual a
   * `CRUZADO` seria exagero: por isso a classe é própria e o detalhamento a
   * separa.
   */
  | "CRUZADO_EM_CONJUNTO"
  /**
   * Os dois lados saem do **mesmo arquivo**.
   *
   * A devolução e o complementar negativo são lidos do 03.08.20 para montar a
   * base do devido, e lidos do 03.08.20 outra vez para montar o demonstrado.
   * Fecharem em R$ 0,00 prova que a conversão de moeda e de sinal está certa —
   * e não prova mais nada. Chamar isso de conferido inflaria o número com a
   * evidência mais fraca que existe.
   */
  | "MESMA_FONTE"
  /**
   * Devido em dinheiro, e nada do outro lado.
   *
   * Não é imprecisão: é ausência. O `DVS` da Rota vale R$ 635.168,85 no mês e o
   * 03.08.20 não tem linha que lhe corresponda. Entra no fechamento sem
   * corroboração nenhuma.
   */
  | "SEM_CONTRAPARTIDA";

/** Uma parcela do fechamento, com o lastro dela classificado. */
export interface ParcelaAferida {
  chave: string;
  nome: string;
  /**
   * O dinheiro que a parcela move, **em módulo**.
   *
   * Em módulo porque um desconto de R$ 125.271,68 é tanto dinheiro quanto uma
   * parcela de R$ 125.271,68, e uma medida de cobertura que os deixasse se
   * cancelar diria que um fechamento com desconto igual à parcela não move
   * nada. O que se está medindo é quanto do fechamento tem evidência, não
   * quanto ele paga no fim.
   */
  valor: TresColunas;
  classe: ClasseDeLastro;
  /**
   * Quanto de {@link valor} tem contrapartida em documento independente.
   *
   * Igual a `valor` na parcela inteiramente cruzada, zero na que não tem
   * contrapartida — e **entre os dois** na parcela que só é coberta em parte.
   * Hoje há uma: o `DVS`, que vale R$ 635.168,85 no mês e cujo lastro é o
   * conjunto do quadro do variável, que cobre R$ 608.614,35 dele. Os
   * R$ 26.554,50 restantes — a recarga, a noturna e as vans — não são cobertos
   * por nada, e arredondar a parcela para "coberta" ou "descoberta" perderia
   * exatamente a informação que interessa.
   */
  comLastro: TresColunas;
  /** O relatório ou cadastro que produziu o devido, como o catálogo o nomeia. */
  fonteDoDevido: string | null;
  /** A diferença que ninguém explicou, em módulo. Zero quando a parcela fecha. */
  naoExplicado: TresColunas;
  /** O que esta parcela é — a frase que a barra lateral mostra. */
  porque: string;
}

/** Um limite do que a aferição mediu, nomeado — com cifra quando tem cifra. */
export interface LimiteDaAfericao {
  titulo: string;
  texto: string;
  /** O dinheiro que o limite alcança. `null` no limite que não é de dinheiro. */
  valor: TresColunas | null;
}

export interface Afericao {
  canal: Canal;
  /** Tudo o que o fechamento move, em módulo — o denominador do lastro. */
  movimentado: TresColunas;
  /** O que tem contrapartida do outro lado — o denominador da precisão. */
  comContrapartida: TresColunas;
  /** O que tem contrapartida num documento que não produziu o devido. */
  comLastroCruzado: TresColunas;
  /** A soma das diferenças sem causa — o numerador do que falta à precisão. */
  naoExplicado: TresColunas;
  /**
   * `1 − naoExplicado ÷ comContrapartida`, entre 0 e 1.
   *
   * `null` quando não há nada conferido: um canal sem painel transcrito não tem
   * precisão ruim, tem precisão **indefinida**, e mostrar 0% ali seria afirmar
   * que a conta está errada quando ninguém a conferiu.
   */
  precisao: TresColunas;
  /** `comLastroCruzado ÷ movimentado`, entre 0 e 1. `null` sem nada movimentado. */
  lastro: TresColunas;
  parcelas: ParcelaAferida[];
  limites: LimiteDaAfericao[];
}

const VAZIO: TresColunas = { primeira: null, segunda: null, total: null };
const COLUNAS = ["primeira", "segunda", "total"] as const;
type Coluna = (typeof COLUNAS)[number];

/** Soma coluna a coluna, tratando `null` como "esta quinzena não tem". */
function acumular(a: TresColunas, b: TresColunas): TresColunas {
  const soma = (x: number | null, y: number | null) =>
    x === null && y === null ? null : centavos((x ?? 0) + (y ?? 0));
  return {
    primeira: soma(a.primeira, b.primeira),
    segunda: soma(a.segunda, b.segunda),
    total: soma(a.total, b.total),
  };
}

/** O módulo de cada coluna. `null` continua `null` — ausência não vira zero. */
function emModulo(v: TresColunas): TresColunas {
  const abs = (x: number | null) => (x === null ? null : Math.abs(x));
  return { primeira: abs(v.primeira), segunda: abs(v.segunda), total: abs(v.total) };
}

/**
 * `1 − parte ÷ todo`, coluna a coluna.
 *
 * `null` quando o todo é nulo ou zero — e é a distinção que importa: razão de
 * denominador zero não é 0% nem 100%, é uma pergunta que não foi feita.
 */
function razaoInversa(parte: TresColunas, todo: TresColunas): TresColunas {
  const uma = (p: number | null, t: number | null) =>
    t === null || t === 0 ? null : Math.max(0, Math.min(1, 1 - (p ?? 0) / t));
  return {
    primeira: uma(parte.primeira, todo.primeira),
    segunda: uma(parte.segunda, todo.segunda),
    total: uma(parte.total, todo.total),
  };
}

/** `parte ÷ todo`, coluna a coluna, com a mesma disciplina do denominador nulo. */
function razao(parte: TresColunas, todo: TresColunas): TresColunas {
  const uma = (p: number | null, t: number | null) =>
    t === null || t === 0 ? null : Math.max(0, Math.min(1, (p ?? 0) / t));
  return {
    primeira: uma(parte.primeira, todo.primeira),
    segunda: uma(parte.segunda, todo.segunda),
    total: uma(parte.total, todo.total),
  };
}

/** O valor de uma coluna, ou zero — para somar quando a ausência não é o assunto. */
const ou0 = (v: TresColunas, c: Coluna) => v[c] ?? 0;

/** A soma das colunas de uma lista, com `null` onde nenhuma parcela tinha valor. */
function somar(valores: TresColunas[]): TresColunas {
  if (valores.length === 0) return VAZIO;
  return valores.reduce(acumular, VAZIO);
}

/**
 * Afere um canal do resumo.
 *
 * **O canal sem painel não é aferido com nota zero — ele é aferido como não
 * conferido.** São coisas diferentes e a tela precisa distingui-las: o AS tem
 * verba do 03.08.20 e não tem de-para transcrito, então o dinheiro dele é
 * movimentado e não é conferido por nada. Precisão fica `null` (ninguém errou
 * uma conta que ninguém fez) e lastro fica 0 (não há documento cruzado atrás
 * daquele dinheiro), com o motivo escrito nos limites.
 */
export function aferir(canal: CanalDoResumo): Afericao {
  const parcelas: ParcelaAferida[] = [];
  const limites: LimiteDaAfericao[] = [];

  if (!canal.comparado) {
    const movimentado = emModulo(canal.emitido);
    const zero = { primeira: 0, segunda: 0, total: 0 };
    limites.push(
      canal.semPainel === "CANAL_SEM_CATALOGO"
        ? {
            titulo: `O painel do ${canal.canal} não foi transcrito`,
            texto:
              `Os rótulos do quadro do ${canal.canal} na planilha nunca foram capturados, e ` +
              "escrevê-los por analogia com os da Rota inventaria a metade que falta. Sem " +
              "de-para não há demonstrado, e sem demonstrado não há o que subtrair: todo o " +
              "dinheiro deste canal entra no fechamento sem conferência. É trabalho nosso, " +
              "não de quem importa.",
            valor: movimentado,
          }
        : {
            titulo: "Sem devido para comparar",
            texto:
              "Não há cadastro vigente que produza o devido deste canal, e comparar o " +
              "03.08.20 com a releitura dele mesmo seria uma conferência que concorda " +
              "consigo mesma. O dinheiro aparece; a conferência, não.",
            valor: movimentado,
          },
    );
    return {
      canal: canal.canal,
      movimentado,
      comContrapartida: VAZIO,
      comLastroCruzado: zero,
      naoExplicado: VAZIO,
      precisao: VAZIO,
      lastro: razao(zero, movimentado),
      parcelas: [],
      limites,
    };
  }

  const painel = canal.comparado;

  /*
    Os quadros que **pagam** e os que **abrem**. A separação é do motor
    (`QuadroDoMapa.detalha`), não desta função: o quadro do variável não soma
    dinheiro novo, ele abre o `DVS` que o quadro do fixo já paga. Aferir os
    quatro somaria o mesmo dinheiro duas vezes, e a planilha repete duas linhas
    de desconto no quadro aberto, o que somaria uma terceira.
  */
  const queAbrem = painel.quadros.filter((q) => q.detalha !== null);
  const quePagam = painel.quadros.filter((q) => q.detalha === null);

  /** O lastro que um quadro aberto oferece à linha que ele detalha. */
  const lastroDoDetalhe = (chaveDaLinha: string, quadroDaLinha: string) => {
    const aberto = queAbrem.find(
      (q) => q.detalha!.chave === chaveDaLinha && q.detalha!.quadro === quadroDaLinha,
    );
    if (!aberto) return null;
    /*
      Só os conjuntos e as parcelas próprias do quadro aberto — os descontos
      dele são as mesmas linhas do quadro de cima, repetidas pela planilha, e
      contá-las aqui seria contar de novo o desconto que já está no pagador.
    */
    const cobertura = somar([
      ...aberto.conjuntos.map((c) => emModulo(c.devido)),
      ...aberto.linhas
        .filter((l) => !l.conjunto && l.papel === "PARCELA")
        .map((l) => emModulo(l.devido)),
    ]);
    const naoExplicado = somar([
      ...aberto.conjuntos.filter((c) => c.auditar).map((c) => emModulo(c.diferenca)),
      ...aberto.linhas
        .filter((l) => !l.conjunto && l.papel === "PARCELA" && l.auditar)
        .map((l) => emModulo(l.diferenca)),
    ]);
    return { quadro: aberto, cobertura, naoExplicado };
  };

  for (const quadro of quePagam) {
    for (const conjunto of quadro.conjuntos) {
      const membros = quadro.linhas.filter((l) => l.conjunto?.chave === conjunto.chave);
      const fontes = [
        ...new Set(
          membros
            .map((l) => procedenciaDoMotor(quadro.quadro, l.chave)?.fonteOperacional)
            .filter((f): f is string => Boolean(f)),
        ),
      ];
      /*
        Se **alguma** das fontes do grupo for o próprio 03.08.20, o grupo inteiro
        deixa de ser cruzado. Um grupo é tão independente quanto o membro menos
        independente dele: bastaria uma parcela vinda do demonstrativo para a
        soma passar a se conferir em parte contra si mesma.
      */
      const cruzado = fontes.length > 0 && !fontes.includes(FONTE_DO_DEMONSTRATIVO);
      const valor = emModulo(conjunto.devido);
      parcelas.push({
        chave: conjunto.chave,
        nome: conjunto.nome,
        valor,
        classe: cruzado ? "CRUZADO_EM_CONJUNTO" : "MESMA_FONTE",
        comLastro: cruzado ? valor : { primeira: 0, segunda: 0, total: 0 },
        fonteDoDevido: fontes.join(" + ") || null,
        naoExplicado: conjunto.auditar ? emModulo(conjunto.diferenca) : VAZIO,
        porque:
          `${membros.length} linhas dividem um número só do 03.08.20 — ele não parte este ` +
          "quadro como o contrato parte. A soma delas confere; a partição entre elas, não.",
      });
    }

    for (const linha of quadro.linhas) {
      if (linha.conjunto) continue;
      const valor = emModulo(linha.devido);
      /* Linha sem devido em coluna nenhuma não move dinheiro e não é aferida. */
      if (COLUNAS.every((c) => (valor[c] ?? 0) === 0)) continue;

      const procedencia = procedenciaDoMotor(quadro.quadro, linha.chave);
      const detalhe = lastroDoDetalhe(linha.chave, quadro.quadro);
      const temDemonstrado = COLUNAS.some((c) => linha.demonstrado[c] !== null);
      const daPropriaFonte = procedencia?.fonteOperacional === FONTE_DO_DEMONSTRATIVO;

      /*
        A linha sem demonstrado próprio ainda pode ter lastro: se um quadro a
        abre, é o conjunto **dele** que a corrobora. É o caso do `DVS`.
      */
      if (!temDemonstrado && detalhe) {
        const descoberto = COLUNAS.reduce(
          (fora, c) => Math.max(fora, ou0(valor, c) - ou0(detalhe.cobertura, c)),
          0,
        );
        parcelas.push({
          chave: linha.chave,
          nome: linha.nome,
          valor,
          classe: "CRUZADO_EM_CONJUNTO",
          comLastro: detalhe.cobertura,
          fonteDoDevido: procedencia?.fonteOperacional ?? null,
          naoExplicado: detalhe.naoExplicado,
          porque:
            `O 03.08.20 não traz linha própria para ela. O lastro é o quadro "` +
            `${detalhe.quadro.titulo}", que a abre por dentro` +
            (descoberto > 0.005
              ? ` — e cobre parte dela: o resto entra no fechamento sem contrapartida.`
              : `.`),
        });
        continue;
      }

      const classe: ClasseDeLastro = !temDemonstrado
        ? "SEM_CONTRAPARTIDA"
        : daPropriaFonte
          ? "MESMA_FONTE"
          : "CRUZADO";

      parcelas.push({
        chave: linha.chave,
        nome: linha.nome,
        valor,
        classe,
        comLastro: classe === "CRUZADO" ? valor : { primeira: 0, segunda: 0, total: 0 },
        fonteDoDevido: procedencia?.fonteOperacional ?? null,
        naoExplicado: linha.auditar ? emModulo(linha.diferenca) : VAZIO,
        porque:
          classe === "SEM_CONTRAPARTIDA"
            ? "O contrato produz este valor e o 03.08.20 não traz linha que lhe corresponda."
            : classe === "MESMA_FONTE"
              ? "O devido e o demonstrado saem do mesmo 03.08.20 — fechar prova a leitura e a " +
                "conversão de moeda, e não a operação."
              : `O devido sai de ${procedencia?.fonteOperacional ?? "outra fonte"} e o ` +
                "demonstrado do 03.08.20. Dois documentos independentes.",
      });
    }
  }

  const daClasse = (...classes: ClasseDeLastro[]) =>
    parcelas.filter((p) => classes.includes(p.classe));

  const movimentado = somar(parcelas.map((p) => p.valor));
  const comLastroCruzado = somar(parcelas.map((p) => p.comLastro));
  const naoExplicado = somar(parcelas.map((p) => p.naoExplicado));
  /*
    O denominador da precisão é o que tem contra o que ser medido — o lastro
    cruzado mais o que fecha contra a própria fonte. O dinheiro sem contrapartida
    fica de fora: não há subtração que o meça, e pô-lo aqui faria a precisão cair
    por uma ausência, confundindo as duas perguntas que esta aferição separa.
  */
  const comContrapartida = acumular(
    comLastroCruzado,
    somar(daClasse("MESMA_FONTE").map((p) => p.valor)),
  );

  /* ---- os limites, com cifra onde há cifra ------------------------------ */
  const soConjunto = somar(daClasse("CRUZADO_EM_CONJUNTO").map((p) => p.comLastro));
  if (COLUNAS.some((c) => (soConjunto[c] ?? 0) > 0)) {
    limites.push({
      titulo: "Conferido em conjunto, não linha a linha",
      texto:
        "O 03.08.20 traz este dinheiro somado para várias linhas de uma vez, e a partição " +
        "entre elas vem do contrato. A soma confere; qual fatia é de qual linha não é " +
        "conferida por nada — e não será enquanto o relatório não partir o número.",
      valor: soConjunto,
    });
  }

  const mesmaFonte = somar(daClasse("MESMA_FONTE").map((p) => p.valor));
  if (COLUNAS.some((c) => (mesmaFonte[c] ?? 0) > 0)) {
    limites.push({
      titulo: "Conferido contra a própria fonte",
      texto:
        "O devido destas linhas é lido do 03.08.20 e o demonstrado também. Elas fecharem em " +
        "R$ 0,00 prova que a leitura e a conversão de moeda estão certas, e não diz nada " +
        "sobre a operação. Entram na precisão, e não no lastro.",
      valor: mesmaFonte,
    });
  }

  /*
    O descoberto é a sobra: o que a parcela move menos o que tem lastro, fora o
    que se confere contra a própria fonte. Sai por subtração e não por uma lista
    à parte, para não haver duas contagens do mesmo dinheiro.
  */
  const descoberto = {
    primeira: centavos(ou0(movimentado, "primeira") - ou0(comContrapartida, "primeira")),
    segunda: centavos(ou0(movimentado, "segunda") - ou0(comContrapartida, "segunda")),
    total: centavos(ou0(movimentado, "total") - ou0(comContrapartida, "total")),
  };
  if (COLUNAS.some((c) => (descoberto[c] ?? 0) > 0.005)) {
    limites.push({
      titulo: "Sem contrapartida em documento nenhum",
      texto:
        "O contrato manda pagar e nenhuma das seis fontes corrobora. Não é diferença — é " +
        "ausência, e por isso não aparece na precisão: não há subtração que a meça. Aparece " +
        "no lastro, que é onde a ausência de evidência deve pesar.",
      valor: descoberto,
    });
  }

  /*
    O limite que não tem cifra, e é o mais importante dos dois números.

    Ele é fixo porque a afirmação é sobre o **método**, não sobre este mês: uma
    competência não corrobora uma regra, por melhor que os números dela fechem.
    Escrevê-lo aqui, e não deixá-lo para a documentação, é o que impede a tela
    de sugerir que 99% de precisão em julho seja uma previsão sobre agosto.
  */
  limites.push({
    titulo: "Uma competência não prova uma regra",
    texto:
      "Estes dois números medem o mês que está na tela. Eles não dizem se a regra que fechou " +
      "aqui fecha no mês seguinte, e nenhuma leitura de um mês só poderia dizer — a segunda " +
      "competência é o único teste disso. Enquanto ela não vier, precisão alta é notícia boa " +
      "sobre este fechamento e não é garantia sobre o próximo.",
    valor: null,
  });

  return {
    canal: canal.canal,
    movimentado,
    comContrapartida,
    comLastroCruzado,
    naoExplicado,
    precisao: razaoInversa(naoExplicado, comContrapartida),
    lastro: razao(comLastroCruzado, movimentado),
    parcelas,
    limites,
  };
}

/** O que cada classe de lastro se chama na tela, e em que ordem ela aparece. */
export const CLASSES_DE_LASTRO: { classe: ClasseDeLastro; rotulo: string; conta: boolean }[] = [
  { classe: "CRUZADO", rotulo: "Cruzado — dois documentos independentes", conta: true },
  { classe: "CRUZADO_EM_CONJUNTO", rotulo: "Cruzado, mas só em conjunto", conta: true },
  { classe: "MESMA_FONTE", rotulo: "Conferido contra a própria fonte", conta: false },
  { classe: "SEM_CONTRAPARTIDA", rotulo: "Sem contrapartida", conta: false },
];

/** O total por classe, para a barra lateral não somar nada no navegador. */
export function porClasse(
  afericao: Afericao,
): {
  classe: ClasseDeLastro;
  rotulo: string;
  conta: boolean;
  valor: TresColunas;
  comLastro: TresColunas;
  parcelas: number;
}[] {
  return CLASSES_DE_LASTRO.map(({ classe, rotulo, conta }) => {
    const dela = afericao.parcelas.filter((p) => p.classe === classe);
    return {
      classe,
      rotulo,
      conta,
      valor: somar(dela.map((p) => p.valor)),
      /* Quanto da classe de fato tem lastro — igual a `valor` exceto no `DVS`. */
      comLastro: somar(dela.map((p) => p.comLastro)),
      parcelas: dela.length,
    };
  }).filter((c) => c.parcelas > 0);
}

/* `ou0` fica exportado para o teste poder somar as colunas sem repetir a regra. */
export { ou0 as valorDaColuna };

/**
 * Enxerta a aferição de cada canal num resumo já montado.
 *
 * **Chamada pela rota, e não por `lerResumoDoMes`** — a mesma escolha de
 * `resumoComReferencia`, e pelo mesmo motivo: mantém `persistencia.ts` sem
 * saber que a aferição existe, e mantém a aferição como uma leitura *sobre* o
 * resumo, nunca uma entrada dele. Um percentual que pudesse influenciar o
 * cálculo deixaria de ser medida e viraria parâmetro.
 *
 * É pura e idempotente: aferir duas vezes dá o mesmo resultado, porque ela só
 * lê. Nenhum campo de `devido`, `demonstrado` ou `diferenca` é tocado.
 */
export function resumoAferido(resumo: ResumoDoMes): ResumoDoMes {
  return {
    ...resumo,
    canais: resumo.canais.map((canal) => ({ ...canal, afericao: aferir(canal) })),
  };
}
