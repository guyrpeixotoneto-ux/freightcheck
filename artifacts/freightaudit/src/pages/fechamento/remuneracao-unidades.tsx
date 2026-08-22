import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, ChevronRight, ScrollText } from "lucide-react";
import { BotaoDeExclusaoDoCadastro } from "@/components/remuneracao/excluir-cadastro";
import { BotaoDeInformarCodigo } from "@/components/remuneracao/informar-codigo";
import { BotaoDeCadastroDaPlanilha } from "@/components/remuneracao/painel-de-cadastro";
import { BotaoDeRegistroDeUnidade } from "@/components/remuneracao/registrar-unidade";
import { VistaDeUmaQuinzena } from "@/components/remuneracao/uma-quinzena";
import { Filtro, TUDO } from "@/components/fechamento/filtro";
import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { apresentar } from "@/lib/apresentar-erro";
import { emDiaCurto, MES_LONGO, periodoDaQuinzena, quinzenaDaData } from "@/lib/calendario";
import { alternarGrupo, alternarUma, grupoEstaAberto } from "@/lib/linhas-abertas";
import { cn } from "@/lib/utils";
import {
  chaveDoCadastro,
  ESTADO_DO_CADASTRO,
  lerCadastro,
  lerSituacaoDasUnidades,
  nomeDaUnidade,
  suficienciaDoCadastro,
  type EstadoDoCadastro,
  type SituacaoDaUnidade,
  type SituacaoDoCadastro,
} from "@/lib/remuneracao";

/**
 * Remuneração — os cadastros por vigência, antes de abrir um deles.
 *
 * **Por que esta tela vem antes.** A do cadastro responde "quais são os
 * parâmetros desta unidade", e é a resposta certa para quem já sabe qual
 * unidade quer olhar. Quem abre Remuneração na virada da quinzena não sabe: a
 * pergunta é *onde está o trabalho* — quais CDDs já têm o cadastro de pé e
 * quais ainda não têm. Sem esta lista, descobrir que um deles entregou a frota
 * e não entregou os trechos custa abri-lo, e com trinta unidades custa abrir
 * trinta telas para achar as duas que faltam.
 *
 * **É a forma de Apurações, porque é a mesma pergunta.** As duas telas são a
 * fila do fechamento vista de cima, e por isso têm a mesma anatomia: os filtros
 * em etiqueta, as linhas reunidas em grupos com o total do grupo escrito no
 * cabeçalho, e a resposta cara de cada linha abrindo **na própria linha**. Lá o
 * grupo é a quinzena e o que abre é a conta; aqui a linha é a quinzena e o que
 * abre é o cadastro (`components/remuneracao/uma-quinzena`) — o mesmo
 * componente da tela de dentro, e não um desenho parecido: duas versões do
 * mesmo cadastro acabariam divergindo, e a daqui seria a que ninguém lembrou de
 * corrigir. O gesto de abrir também é um só, em `lib/linhas-abertas.ts`.
 *
 * **Uma tabela por unidade, e dentro dela o calendário.** Cada unidade é um
 * cartão com a tabela dela — o espaço entre os cartões é o que diz que uma
 * unidade acabou. Dentro, uma faixa por mês; a faixa abre e mostra **as duas
 * quinzenas** dele, que é o grão em que a planilha de remuneração existe. As
 * duas sempre, e é o principal: a metade que ninguém entregou é o trabalho que
 * falta, e enquanto as vigências eram uma lista rasa ela não tinha como
 * aparecer — sem vigência não havia linha, e um julho com uma entrega só ficava
 * com a mesma cara da unidade que entrega uma vez por mês. Ver
 * {@link partirEmQuinzenas} e {@link QuinzenaSemCadastro}.
 *
 * O cadastro é buscado quando a linha abre, e não junto da lista: montar as
 * trinta linhas de uma vigência é o trabalho mais caro deste módulo, e baixar
 * o de toda linha da lista para mostrar um seria pagar a lista inteira para ler
 * uma unidade.
 *
 * **O destaque é sobre as duas metades do cadastro, e não sobre um
 * percentual.** Hoje, sobre um acervo completo, onze das trinta linhas têm
 * lastro — as outras dezenove dependem de decisões de negócio que ninguém
 * registrou, e não de arquivo que alguém deixou de mandar. "37% cadastrado"
 * seria lido como "falta importar alguma coisa" justamente na unidade que
 * entregou tudo o que tinha para entregar. O que de fato separa uma unidade da
 * outra são as duas metades que dependem do que ela mandou: a **frota**, que
 * vem do export de equipamento, e as **alíquotas**, que vêm do de frete. Ver
 * `lib/remuneracao/src/situacao.ts`. É por isso que o cabeçalho do grupo conta
 * cadastros por estado e não soma linhas com lastro: "89 de 900" é o mesmo
 * percentual disfarçado, e diria a mesma coisa errada.
 *
 * **Uma linha por quinzena, dentro do mês, dentro da unidade.** A lista passou
 * por quatro formas, e as duas primeiras erravam coisas diferentes. Foi *uma linha
 * por unidade*, mostrando a vigência mais recente dela, e escondia trabalho
 * feito: quem preencheu a planilha de julho voltava na virada e via "nada
 * informado", porque a única linha da unidade tinha passado a responder por
 * agosto. Foi depois *um grupo por vigência*, com as unidades dentro dele —
 * o que consertou aquilo, e cobrava um acervo largo para valer a pena: num de
 * poucas unidades e muitas vigências, todo grupo tem uma linha só, o cabeçalho
 * do mês repete o que ela diz, e o nome da unidade desce a página uma vez por
 * vigência sem nunca distinguir nada. Foi então *uma tabela só*, com a unidade
 * reunindo as vigências dela num `<tbody>` — ver {@link agruparPorUnidade} —, e
 * com trinta CDDs empilhados numa tabela contínua o fim de um e o começo do
 * outro passaram a se tocar na mesma borda. Agora cada unidade é a **tabela
 * dela**, e dentro há o mês, e dentro do mês as duas quinzenas.
 *
 * **O que sobreviveu às quatro.** Todas as vigências continuam em tela, cada uma
 * na linha dela, e por isso a quinzena preenchida não some quando a seguinte
 * nasce em branco. E quem ficou para trás continua caindo para o fim: os
 * cartões vêm na ordem da vigência mais recente de cada um, então a unidade que
 * parou de entregar em junho fica abaixo das que entregaram em agosto, em vez
 * de parecer em dia por ordem alfabética.
 *
 * **Cada linha responde pela vigência dela, e por nenhuma outra.** O cadastro
 * que abre embaixo, o formulário da planilha e o link para a unidade levam a
 * data da linha: abrir julho e receber agosto seria a mesma troca silenciosa,
 * um clique adiante.
 */

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return (
    aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível carregar as unidades."
  );
}

/**
 * Verde para as duas metades, âmbar para uma, vermelho para nenhuma.
 *
 * Vermelho não é repreensão à unidade: é a cor do que trava o fechamento dela.
 * Uma unidade sem nenhuma linha com lastro não tem cadastro para a apuração
 * puxar, e é a única das quatro situações em que não há o que conferir.
 */
const APARENCIA_DO_ESTADO: Record<EstadoDoCadastro, BadgeProps["variant"]> = {
  FROTA_E_ALIQUOTAS: "success",
  SO_FROTA: "warning",
  SO_ALIQUOTAS: "warning",
  SEM_LASTRO: "destructive",
};

/** Os quatro, na ordem em que o módulo os escreve — do completo ao vazio. */
const ESTADOS: EstadoDoCadastro[] = [
  "FROTA_E_ALIQUOTAS",
  "SO_FROTA",
  "SO_ALIQUOTAS",
  "SEM_LASTRO",
];

/**
 * Como cada estado entra na frase do grupo.
 *
 * Não é o rótulo da marca, e a diferença é gramatical: a marca **nomeia** o
 * estado de uma unidade ("Só a frota") e a frase do grupo **conta** unidades
 * nele ("1 só com a frota"). Reaproveitar o rótulo daria "1 só a frota", que
 * ninguém lê duas vezes de propósito.
 */
const NO_RESUMO: Record<EstadoDoCadastro, string> = {
  FROTA_E_ALIQUOTAS: "com as duas metades",
  SO_FROTA: "só com a frota",
  SO_ALIQUOTAS: "só com as alíquotas",
  SEM_LASTRO: "sem lastro documental",
};

/** Onde cada estado é contado dentro do grupo. */
const CONTADOR: Record<EstadoDoCadastro, keyof ContagemDoGrupo> = {
  FROTA_E_ALIQUOTAS: "frotaEAliquotas",
  SO_FROTA: "soFrota",
  SO_ALIQUOTAS: "soAliquotas",
  SEM_LASTRO: "semLastro",
};

/**
 * "62 cavalos", com espaço **inquebrável** entre o número e o nome.
 *
 * A coluna é estreita e a frase ao lado é longa; com espaço comum o navegador
 * quebra em "62" e "cavalos" em linhas diferentes, e a coluna passa a ser lida
 * como duas informações. As frases maiores continuam quebrando nos outros
 * espaços, que é onde a quebra não atrapalha.
 */
const contar = (n: number, singular: string, plural: string) =>
  `${n.toLocaleString("pt-BR")}\u00A0${n === 1 ? singular : plural}`;

/**
 * O que a coluna da frota diz, e por que ela não diz só "sim" ou "não".
 *
 * As três formas de não ter frota contada são trabalhos diferentes: não veio
 * export de equipamento, veio e não trouxe a coluna que separa ativo de parado,
 * ou veio tudo e está contada. Um traço no lugar das três mandaria conferir a
 * importação nos três casos, e no do meio a importação está lá.
 */
function fraseDaFrota(u: SituacaoDaUnidade): string {
  if (u.cadastro.frota) return contar(u.material.cavalos, "cavalo", "cavalos");
  if (u.material.cavalos === 0) return "não entregou cavalos";
  return `${contar(u.material.cavalos, "cavalo", "cavalos")}, sem a coluna que separa ativo de parado`;
}

/** O mesmo, do lado dos trechos — de onde saem alíquotas, proporções e resumo. */
function fraseDosTrechos(u: SituacaoDaUnidade): string {
  if (u.cadastro.aliquotas) return contar(u.material.trechos, "trecho", "trechos");
  if (!u.material.trechosEntregues) return "não entregou a série de trechos";
  if (u.material.trechos === 0) return "entregou a série de trechos vazia";
  return `${contar(u.material.trechos, "trecho", "trechos")}, sem as colunas em reais`;
}

/**
 * O nome da linha, com a operação ao lado — "CAMAÇARI · EMPURRADA".
 *
 * É o `label` que o servidor manda, remontado a partir de
 * {@link nomeDaUnidade} por um motivo só: a linha órfã cuja unidade saiu do
 * acervo pode chegar rotulada pelo `scope_hash`, e sessenta e quatro caracteres
 * de hexadecimal em negrito no meio da tabela se leem como defeito de tela.
 * Para todas as outras — que são todas, quase sempre — o texto é idêntico ao
 * que veio.
 */
function rotuloDaLinha(u: SituacaoDaUnidade): string {
  const nome = nomeDaUnidade(u);
  return u.channel ? `${nome} · ${u.channel}` : nome;
}

/**
 * A unidade foi cadastrada à mão **e sem código**?
 *
 * A pergunta não é "tem código", e sim "está sem o que a faria encontrar o
 * arquivo". Uma unidade do acervo sempre tem código — é dele que ela nasceu —,
 * e é por isso que a marca só vale para a cadastrada à mão: lá o código pode
 * estar vazio, porque quem cadastrou nem sempre tinha o CNPJ na hora.
 */
function semCodigo(u: SituacaoDaUnidade): boolean {
  if (!u.registradaAMao) return false;
  const unidade = u.scopes.find((s) => s.scopeType === "UNIDADE");
  return (unidade?.code ?? "").trim() === "";
}

/**
 * A identidade de uma linha: o que a distingue de todas as outras.
 *
 * É o que endereça o cadastro no servidor — escopo, canal e vigência —, e não
 * um índice: a lista se reordena a cada filtro, e um índice faria a linha
 * aberta saltar para outro cadastro quando alguém trocasse o recorte. A
 * vigência entra porque a mesma unidade tem uma linha por quinzena, e sem ela
 * abrir julho abriria agosto junto.
 */
export function chaveDaLinha(u: SituacaoDaUnidade): string {
  return `${u.scopeHash}|${u.channel ?? ""}|${u.effectiveDate}`;
}

/** `2026-08-16` → `agosto de 2026`, o título do grupo. */
function mesPorExtenso(data: string): string {
  const indice = Number(data.slice(5, 7)) - 1;
  return indice >= 0 && indice < 12 ? `${MES_LONGO[indice]} de ${data.slice(0, 4)}` : data;
}

/**
 * O endereço do cadastro daquela linha — unidade, canal **e vigência**.
 *
 * O canal vai sempre, mesmo vazio — a mesma razão de `irParaUnidade` na tela do
 * cadastro: uma unidade pode ter uma série com canal e outra sem, no mesmo
 * `scopeHash`, e omitir o parâmetro pediria "qualquer canal", abrindo uma série
 * que ninguém escolheu aqui. A vigência vai pela mesma razão, um grão adiante:
 * sem ela a tela abriria na mais recente da unidade, e quem clicou na linha de
 * julho pediu julho.
 */
function enderecoDaUnidade(u: SituacaoDaUnidade): string {
  const query = new URLSearchParams({
    scopeHash: u.scopeHash,
    canal: u.channel ?? "",
    period: u.effectiveDate,
  });
  return `/fechamento/remuneracao/unidade?${query}`;
}

/** Uma das duas metades de um mês, e as vigências que caíram nela. */
export interface Quinzena {
  /** 1 — do dia 1 ao 15; 2 — do dia 16 ao fim do mês. */
  numero: 1 | 2;
  /**
   * `2026-07-16` — o dia em que ela começa.
   *
   * É onde o cadastro dela nasce quando ainda não existe: o servidor só aceita
   * começo de quinzena, e é esta data que o painel de "Cadastrar planilha"
   * recebe da metade vazia. Sai de `periodoDaQuinzena` — a mesma aritmética de
   * "Cadastrar uma unidade" e de Realizar Fechamento — e não de um `-01`/`-16`
   * montado aqui: uma segunda régua de quinzena divergiria da primeira algum
   * dia, e a planilha apareceria numa vigência que nenhuma outra tela escreve.
   */
  inicio: string;
  /**
   * As vigências desta metade, da mais antiga para a mais recente.
   *
   * Quase sempre uma. **Nenhuma** é o caso que este tipo existe para dizer: a
   * metade do mês que ninguém entregou, e que a lista mostra do mesmo jeito.
   * Mais de uma acontece quando o arquivo traz duas datas dentro da mesma
   * metade — `2026-07-03` e `2026-07-10` —; a lista não esconde a segunda, e
   * ali é o dia que passa a distinguir uma da outra.
   */
  linhas: SituacaoDaUnidade[];
}

/** Um mês de uma unidade, sempre com as duas quinzenas dele. */
export interface Mes {
  /** `2026-07` — o que reúne as duas metades. */
  chave: string;
  /** `julho de 2026` — o que o cabeçalho do mês escreve. */
  titulo: string;
  /** A primeira e a segunda, nesta ordem, existindo elas ou não. */
  quinzenas: [Quinzena, Quinzena];
}

/**
 * As vigências de uma unidade repartidas em meses e, dentro deles, nas duas
 * quinzenas do calendário.
 *
 * **Por que o mês virou um nível.** A planilha de remuneração é quinzenal — a
 * mesma unidade responde por `2026-07-01` e `2026-07-16` —, e enquanto as
 * vigências eram uma lista rasa as duas metades de julho eram duas linhas
 * irmãs, indistinguíveis das de junho a não ser pelo rótulo que o servidor
 * escreveu em cada uma. Com o mês por cima delas, a unidade se lê pelo
 * calendário que ela de fato tem: doze meses, dois lugares em cada um.
 *
 * **As duas metades são ditas sempre, e é a razão principal da função.** A
 * quinzena que ninguém entregou não é ausência de informação: é o trabalho que
 * falta, e é exatamente o que esta tela existe para achar. Na lista rasa ela
 * não tinha como aparecer — sem vigência não havia linha —, e a única pista de
 * que faltava metade de julho era julho ter uma linha só, o que também é a cara
 * da unidade que entrega uma vez por mês. Aqui a metade vazia tem lugar, diz
 * que está vazia e oferece o formulário que a preenche.
 *
 * **É o único lugar do módulo que afirma uma quinzena sobre uma vigência
 * sozinha**, e a diferença com `rotuloDaVigencia` (em
 * `lib/remuneracao/src/vigencia.ts`) é sobre o que se afirma. Lá a pergunta é
 * como **nomear** uma vigência, e chamar o `2026-08-01` de uma unidade mensal
 * de "1ª quinzena" inventaria um grão que os arquivos não têm. Aqui a pergunta
 * é em que casa do calendário ela **cai**, e essa casa existe antes de qualquer
 * arquivo: a régua é `quinzenaDaData`, a mesma do fechamento que vai procurar
 * este cadastro.
 *
 * Os meses vêm do mais recente para o mais antigo, como as linhas vinham — a
 * primeira coisa que se lê de uma unidade é onde ela está. Dentro do mês a
 * ordem é a do calendário, primeira e depois segunda: são duas casas fixas de
 * um mês já nomeado, e invertê-las faria o mês ser lido de trás para frente
 * sem que nada apontasse para trás.
 */
export function partirEmQuinzenas(linhas: readonly SituacaoDaUnidade[]): Mes[] {
  const por = new Map<string, Mes>();

  for (const u of linhas) {
    const chave = u.effectiveDate.slice(0, 7);
    let mes = por.get(chave);
    if (!mes) {
      const ano = Number(chave.slice(0, 4));
      const numeroDoMes = Number(chave.slice(5, 7));
      mes = {
        chave,
        titulo: mesPorExtenso(u.effectiveDate),
        quinzenas: [
          { numero: 1, inicio: periodoDaQuinzena(ano, numeroDoMes, 1).inicio, linhas: [] },
          { numero: 2, inicio: periodoDaQuinzena(ano, numeroDoMes, 2).inicio, linhas: [] },
        ],
      };
      por.set(chave, mes);
    }
    mes.quinzenas[quinzenaDaData(u.effectiveDate) - 1]!.linhas.push(u);
  }

  for (const mes of por.values()) {
    for (const quinzena of mes.quinzenas) {
      quinzena.linhas.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    }
  }

  return [...por.values()].sort((a, b) => b.chave.localeCompare(a.chave));
}

/**
 * O que cada metade do mês diz, com o mês fechado.
 *
 * O mês fechado precisa dizer o suficiente para alguém decidir se abre — senão
 * ele é uma fila de nomes de mês, e achar a quinzena sem lastro custa abrir
 * doze. As três frases são os três casos de {@link Quinzena.linhas}: a metade
 * vazia, a metade com uma vigência (e aí o estado dela, na língua de
 * {@link NO_RESUMO}) e a rara com mais de uma, que só é contada — os estados
 * das duas cabem na linha de cada uma, e não numa frase de cabeçalho.
 */
function fraseDaQuinzena(quinzena: Quinzena): string {
  if (quinzena.linhas.length === 0) return "sem cadastro";
  if (quinzena.linhas.length > 1) {
    return `com ${contar(quinzena.linhas.length, "vigência", "vigências")}`;
  }
  return NO_RESUMO[quinzena.linhas[0]!.cadastro.estado];
}

/** `1ª quinzena com as duas metades · 2ª quinzena sem cadastro`. */
export function resumoDoMes(mes: Mes): string {
  return mes.quinzenas
    .map((quinzena) => `${quinzena.numero}ª quinzena ${fraseDaQuinzena(quinzena)}`)
    .join(" · ");
}

interface ContagemDoGrupo {
  frotaEAliquotas: number;
  soFrota: number;
  soAliquotas: number;
  semLastro: number;
  /** Cadastros com alguma linha digitada da aba de Excel. */
  comPlanilha: number;
  /** Destes, quantos têm alguma linha em que a planilha e o acervo discordam. */
  comDivergencia: number;
  /**
   * Vigências cujo cadastro **não** basta para calcular o devido.
   *
   * É a primeira coisa que o cabeçalho precisa dizer, e a que ele não dizia:
   * contava lastro, que é auditoria, e deixava quem lê deduzir dali se havia
   * contrato. São perguntas diferentes — a unidade sem lastro nenhum pode
   * calcular o mês inteiro, e a que tem metade do acervo pode não calcular
   * nada.
   */
  semDevido: number;
}

/** Uma unidade e as vigências pelas quais ela já respondeu. */
export interface Grupo extends ContagemDoGrupo {
  /** `scopeHash|canal` — o par que diz qual unidade é esta, e o que a reúne. */
  chave: string;
  /** `CAMAÇARI · EMPURRADA` — o nome com a operação ao lado. */
  titulo: string;
  /**
   * A vigência mais recente da unidade — a data crua, e não escrita.
   *
   * Não vai para a tela: a primeira linha do grupo já é ela, e escrevê-la
   * também no cabeçalho seria repetir uma polegada acima o que a linha diz. É
   * daqui que sai a **ordem dos grupos**, que é o que a torna necessária.
   */
  maisRecente: string;
  linhas: SituacaoDaUnidade[];
  /**
   * As mesmas vigências de {@link linhas}, repartidas por mês e quinzena — é
   * o que a tabela da unidade desenha.
   *
   * As duas convivem porque respondem a perguntas diferentes: `linhas` é o
   * conjunto plano, de onde saem as contagens do cabeçalho e a ordem entre as
   * unidades; `meses` é a forma. Derivar as contagens da árvore seria percorrer
   * duas metades vazias por mês para somar o que a lista já tem à mão.
   */
  meses: Mes[];
}

/**
 * Os cadastros reunidos pela unidade que respondeu por eles.
 *
 * **Por que a unidade, e não a vigência.** Foi por vigência, com um grupo por
 * mês e as unidades dentro dele, e a forma era certa para o acervo que a
 * pediu: trinta CDDs entregando na mesma quinzena, e a pergunta da virada —
 * *onde está o trabalho* — respondida abrindo o grupo de cima e lendo trinta
 * linhas. Ela se desfaz quando o acervo tem poucas unidades e muitas
 * vigências, que é o caso hoje: cada grupo passa a ter uma linha só, o
 * cabeçalho do mês repete o que a linha embaixo dele já diz, e o nome da
 * unidade desce a página uma vez por vigência sem nunca distinguir nada.
 *
 * **O que a troca preserva.** A pergunta da virada continua respondida, um
 * grão diferente: as linhas de cada grupo vêm da mais recente para a mais
 * antiga, então a **primeira linha de cada unidade é onde ela está**. E os
 * grupos vêm na ordem da vigência mais recente de cada um, de modo que a
 * unidade que parou de entregar em junho continua caindo para baixo de todas
 * as que entregaram em agosto — em vez de parecer em dia por ordem alfabética.
 *
 * **O que a troca não é.** Não é a volta da forma que esta tela já teve, de uma
 * linha por unidade mostrando a vigência mais recente dela: aquela escondia
 * trabalho feito — quem preencheu a planilha de julho voltava na virada e via
 * "nada informado", porque a única linha da unidade tinha passado a responder
 * por agosto. Aqui **todas** as vigências continuam em tela, cada uma na linha
 * dela; o que mudou foi só quem reúne quem.
 *
 * A ordem é calculada aqui, e não herdada: o servidor manda as unidades do
 * acervo por vigência decrescente e **acrescenta ao fim** as que existem só por
 * planilha ou por cadastro à mão (ver `contextosEProcedencia`). Herdar essa
 * ordem jogaria a unidade cadastrada à mão para o rodapé ainda que a vigência
 * dela fosse a mais recente de todas.
 */
export function agruparPorUnidade(cadastros: SituacaoDaUnidade[]): Grupo[] {
  const por = new Map<string, Grupo>();

  for (const u of cadastros) {
    /*
      A chave é `scopeHash|canal`, e o canal faz parte dela: a mesma unidade
      pode ter uma série EMPURRADA e outra ROTA, e elas são dois cadastros com
      duas frotas — reuni-las num grupo só somaria coisas que ninguém soma.
      É a mesma chave de `chaveDaUnidade`, no servidor, e a mesma de
      `porUnidade`, aqui — as três precisam concordar sobre o que é "a mesma
      unidade", ou a lixeira da linha ofereceria apagar o que o servidor recusa.
    */
    const chave = `${u.scopeHash}|${u.channel ?? ""}`;
    let grupo = por.get(chave);
    if (!grupo) {
      grupo = {
        chave,
        titulo: rotuloDaLinha(u),
        maisRecente: u.effectiveDate,
        linhas: [],
        meses: [],
        frotaEAliquotas: 0,
        soFrota: 0,
        soAliquotas: 0,
        semLastro: 0,
        comPlanilha: 0,
        comDivergencia: 0,
        semDevido: 0,
      };
      por.set(chave, grupo);
    }
    grupo.linhas.push(u);
    if (u.effectiveDate > grupo.maisRecente) grupo.maisRecente = u.effectiveDate;
    /*
      Tudo aqui conta **cadastros** — a linha inteira de uma unidade numa
      vigência —, e nunca as trinta linhas da aba somadas entre eles: uma frase
      que misturasse os dois grãos ("6 vigências · 89 linhas informadas") faria
      os dois números parecerem comparáveis. O que cada cadastro tem por dentro
      está na linha dele.

      A procedência da unidade — cadastrada à mão, planilha órfã, sem código —
      não é contada: no grupo por unidade ela deixou de ser uma contagem e
      voltou a ser o que sempre foi, um fato só, dito uma vez no cabeçalho.
    */
    grupo[CONTADOR[u.cadastro.estado]] += 1;
    if (u.cadastro.informadas > 0) grupo.comPlanilha += 1;
    if (u.cadastro.divergentes > 0) grupo.comDivergencia += 1;
    if (!u.cadastro.suficienteParaCalcular) grupo.semDevido += 1;
  }

  /* Dentro do grupo, da vigência mais recente para a mais antiga: a primeira
     linha é onde a unidade está, que é o que se procura primeiro. */
  for (const grupo of por.values()) {
    grupo.linhas.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    grupo.meses = partirEmQuinzenas(grupo.linhas);
  }

  /*
    Entre os grupos, quem está para trás cai para baixo: primeiro a vigência
    mais recente, decrescente, e só no empate o nome. As unidades em dia empatam
    entre si e se leem em ordem alfabética; a que parou em junho fica sozinha no
    fim, que é onde a forma antiga também a punha e pela mesma razão.
  */
  return [...por.values()].sort(
    (a, b) =>
      b.maisRecente.localeCompare(a.maisRecente) || a.titulo.localeCompare(b.titulo, "pt-BR"),
  );
}

/**
 * O resumo do grupo, na frase que ele merece.
 *
 * Cada número gruda na primeira palavra dele com espaço inquebrável, como em
 * {@link contar}: a frase é longa, o cabeçalho é de uma linha só, e um "1" que
 * termina a linha com "sem lastro" começando a seguinte é um número que perdeu
 * o substantivo.
 *
 * A frase **não diz a vigência mais recente**, embora seja o que o cabeçalho
 * mais parece dever dizer: a primeira linha do grupo já é ela, imediatamente
 * abaixo, e repeti-la aqui seria a mesma duplicação que tirou o mês do lugar
 * de grupo. O que o cabeçalho diz é o que as linhas **não** dizem juntas —
 * quantas são e como se repartem.
 */
export function resumoDoGrupo(grupo: Grupo): string {
  const partes = [contar(grupo.linhas.length, "vigência", "vigências")];

  /* Só os estados que existem no grupo: um "0 sem lastro" ocuparia a frase para
     dizer que não há o que fazer, e é justamente o que não precisa ser dito. */
  for (const estado of ESTADOS) {
    const quantas = grupo[CONTADOR[estado]];
    if (quantas > 0) partes.push(`${quantas} ${NO_RESUMO[estado]}`);
  }

  /*
    A suficiência vem antes da planilha e antes das divergências: é a única
    parte da frase que responde "dá para fechar o mês?".
  */
  if (grupo.semDevido > 0) {
    partes.push(`${grupo.semDevido} sem cadastro suficiente para o devido`);
  }
  if (grupo.comPlanilha > 0) partes.push(`${grupo.comPlanilha} com planilha informada`);
  if (grupo.comDivergencia > 0) {
    partes.push(
      `${grupo.comDivergencia} ${grupo.comDivergencia === 1 ? "diverge" : "divergem"} do acervo`,
    );
  }
  return partes.join(" · ");
}

/** As vigências de um grupo, na ordem em que ele as mostra. */
const idsDoGrupo = (grupo: Grupo) => grupo.linhas.map(chaveDaLinha);

/**
 * O endereço de um mês dentro da tela — a unidade **e** o mês.
 *
 * A unidade entra porque o conjunto de meses abertos é um só para a página
 * inteira: com `2026-07` sozinho, abrir julho de um CDD abriria julho dos
 * trinta. É a mesma razão que põe a vigência em {@link chaveDaLinha}.
 */
const chaveDoMes = (grupo: Grupo, mes: Mes) => `${grupo.chave}|${mes.chave}`;

/** Os meses de um grupo — o que o cabeçalho da unidade abre e fecha junto. */
const mesesDoGrupo = (grupo: Grupo) => grupo.meses.map((mes) => chaveDoMes(grupo, mes));

/**
 * O cadastro de uma unidade **na vigência da linha**, dentro dela.
 *
 * A chave é a mesma da tela do cadastro — {@link chaveDoCadastro} —, e não por
 * economia de nome: quem abre a linha aqui e depois entra na tela de dentro a
 * encontra pronta, e quem volta de lá reabre a linha sem nova ida ao servidor.
 * Com a vigência pedida, como o link da linha também a pede: sem ela o servidor
 * responderia pela mais recente da unidade, e a linha de julho mostraria o
 * cadastro de agosto — a mesma troca silenciosa que esta lista deixou de fazer.
 */
function CadastroDaLinha({ unidade }: { unidade: SituacaoDaUnidade }) {
  const canal = unidade.channel ?? "";
  const dados = useQuery({
    queryKey: chaveDoCadastro(unidade.scopeHash, canal, unidade.effectiveDate),
    queryFn: () =>
      lerCadastro({ scopeHash: unidade.scopeHash, canal, period: unidade.effectiveDate }),
  });

  if (dados.isLoading) {
    return <p className="text-sm text-muted-foreground">Montando o cadastro…</p>;
  }
  if (dados.isError || !dados.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
      </Alert>
    );
  }
  return <VistaDeUmaQuinzena dados={dados.data} />;
}

export default function RemuneracaoUnidades() {
  const busca = useSearch();
  const [, navegar] = useLocation();

  const [vigencia, setVigencia] = useState(TUDO);
  const [nome, setNome] = useState(TUDO);
  const [operacao, setOperacao] = useState(TUDO);
  const [estado, setEstado] = useState(TUDO);
  /* As unidades com o cadastro aberto — ver `lib/linhas-abertas.ts`. */
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(() => new Set());
  /*
    E os meses com as duas quinzenas à vista, que é outro conjunto e não o
    mesmo: abrir julho quer dizer ver as duas metades dele, e abrir uma delas
    quer dizer montar o cadastro daquela quinzena — a consulta cara. Um conjunto
    só faria o primeiro gesto pagar o segundo em toda unidade que se abrisse.

    Os meses nascem fechados. Uma unidade com um ano de vigências tem doze
    meses e vinte e quatro metades, e abri-los todos de saída daria a mesma
    página contínua que a tabela por unidade veio desfazer; o cabeçalho de cada
    mês diz em que estado as duas quinzenas estão — ver `resumoDoMes` —, que é
    o que decide se vale abrir.
  */
  const [mesesAbertos, setMesesAbertos] = useState<ReadonlySet<string>>(() => new Set());

  /*
    O endereço antigo do cadastro era este, com a unidade na query. Quem tiver
    um link desses guardado — num chamado, numa conversa — cai aqui, e a tela
    o encaminha para onde o cadastro passou a morar em vez de ignorar o que ele
    pedia. Sem `scopeHash` não há para onde encaminhar, e a lista é a resposta.

    `replace` para que voltar no histórico saia do cadastro em vez de bater no
    endereço antigo e ser encaminhado de novo.
  */
  const encaminhando = new URLSearchParams(busca).get("scopeHash") !== null;
  useEffect(() => {
    if (encaminhando) navegar(`/fechamento/remuneracao/unidade?${busca}`, { replace: true });
  }, [encaminhando, busca, navegar]);

  /*
    Enquanto encaminha, a lista não é pedida: montar o cadastro de todas as
    unidades é o trabalho mais caro deste módulo, e pagá-lo por uma tela que
    some no quadro seguinte seria pagá-lo à toa.
  */
  const situacao = useQuery({
    queryKey: ["remuneracao", "situacao"],
    queryFn: lerSituacaoDasUnidades,
    enabled: !encaminhando,
  });

  const cadastros = useMemo(() => situacao.data?.cadastros ?? [], [situacao.data]);

  /*
    Os tipos de operação que já existem em alguma unidade — o que o seletor do
    painel oferece antes de deixar digitar um novo.

    Sai da própria lista e não de uma constante, pela mesma razão que
    `parseVigenciaLabel` aceita qualquer canal em vez de `^EMPURRADA_`: o
    vocabulário é da operação do cliente, não nosso. Uma lista fixa com
    EMPURRADA e ROTA acertaria hoje e estaria errada no dia em que um terceiro
    aparecesse — e o campo continua aceitando digitar, que é o que faz o
    terceiro poder aparecer.

    É da lista inteira, e não do recorte: filtrar por EMPURRADA não faz ROTA
    deixar de existir, e o formulário que nasce numa linha filtrada precisa
    oferecer os dois do mesmo jeito.
  */
  const canaisConhecidos = useMemo(
    () => [
      ...new Set(
        cadastros.map((c) => c.channel).filter((c): c is string => c !== null && c !== ""),
      ),
    ],
    [cadastros],
  );

  /*
    Quantas linhas cada unidade tem na lista **inteira**, e quanto foi informado
    somando todas elas. É o que decide se a lixeira de uma linha vazia oferece
    apagar o cadastro da unidade ou não aparece.

    Da lista inteira, e nunca do recorte — a mesma razão dos canais acima:
    filtrar por agosto não faz a planilha de julho deixar de existir, e um botão
    que se baseasse no recorte convidaria a um ato que o servidor recusa, com
    razão, toda vez que alguém filtrasse.
  */
  const porUnidade = useMemo(() => {
    const contagem = new Map<string, { linhas: number; informadas: number }>();
    for (const u of cadastros) {
      const chave = `${u.scopeHash}|${u.channel ?? ""}`;
      const atual = contagem.get(chave) ?? { linhas: 0, informadas: 0 };
      contagem.set(chave, {
        linhas: atual.linhas + 1,
        informadas: atual.informadas + u.cadastro.informadas,
      });
    }
    return contagem;
  }, [cadastros]);

  /**
   * Esta linha é a última que resta de uma unidade cadastrada à mão, e não há
   * nada informado em nenhuma quinzena dela.
   *
   * É a única situação em que apagar o cadastro da unidade não deixa nada para
   * trás — e é por isso que a lixeira só o oferece aqui. O servidor confere de
   * novo; esta conta existe para o botão não convidar ao que seria recusado.
   */
  const ehOUltimoCadastro = (u: SituacaoDaUnidade): boolean => {
    if (!u.registradaAMao) return false;
    const contagem = porUnidade.get(`${u.scopeHash}|${u.channel ?? ""}`);
    return contagem !== undefined && contagem.linhas === 1 && contagem.informadas === 0;
  };

  /*
    As opções de cada filtro são o que existe, e só. Oferecer uma vigência que
    nenhuma unidade tem daria uma lista vazia com cara de erro; oferecer um
    estado que nada alcançou daria a mesma coisa. Um filtro que só oferece
    recortes com resultado nunca leva a tela ao vazio por escolha de quem
    filtra.
  */
  const opcoes = useMemo(() => {
    const vigencias = new Map<string, string>();
    const nomes = new Set<string>();
    const operacoes = new Set<string>();
    const presentes = new Set<EstadoDoCadastro>();
    for (const u of cadastros) {
      vigencias.set(u.effectiveDate.slice(0, 7), mesPorExtenso(u.effectiveDate));
      nomes.add(nomeDaUnidade(u));
      if (u.channel) operacoes.add(u.channel);
      presentes.add(u.cadastro.estado);
    }
    const emOrdem = (s: Set<string>) =>
      [...s].sort((a, b) => a.localeCompare(b, "pt-BR")).map((v) => ({ valor: v, rotulo: v }));
    return {
      /* Da mais recente para a mais antiga, como os grupos. */
      vigencias: [...vigencias]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([valor, rotulo]) => ({ valor, rotulo })),
      nomes: emOrdem(nomes),
      operacoes: emOrdem(operacoes),
      /* Na ordem dos estados, e não na ordem em que apareceram na lista. */
      estados: ESTADOS.filter((e) => presentes.has(e)).map((e) => ({
        valor: e,
        rotulo: ESTADO_DO_CADASTRO[e].rotulo,
      })),
    };
  }, [cadastros]);

  const grupos = useMemo(
    () =>
      agruparPorUnidade(
        cadastros.filter((u) => {
          if (vigencia !== TUDO && u.effectiveDate.slice(0, 7) !== vigencia) return false;
          if (nome !== TUDO && nomeDaUnidade(u) !== nome) return false;
          if (operacao !== TUDO && (u.channel ?? "") !== operacao) return false;
          if (estado !== TUDO && u.cadastro.estado !== estado) return false;
          return true;
        }),
      ),
    [cadastros, vigencia, nome, operacao, estado],
  );

  const abertoNoGrupo = (grupo: Grupo) => grupoEstaAberto(abertas, idsDoGrupo(grupo));

  /**
   * O cabeçalho da unidade abre — ou fecha — **tudo** o que ela tem: os meses
   * e, dentro deles, o cadastro de cada quinzena.
   *
   * Os dois juntos porque um sem o outro não é gesto nenhum. Abrir só os
   * cadastros deixaria trinta consultas de pé embaixo de meses fechados, sem
   * nada em tela; abrir só os meses obrigaria a clicar quinzena por quinzena
   * depois de ter pedido a unidade inteira.
   *
   * Quem decide se está abrindo ou fechando são as vigências, e não os meses: é
   * a mesma pergunta que `alternarGrupo` faz — falta alguma por abrir? —, e
   * respondê-la duas vezes em dois conjuntos deixaria o clique abrir um e
   * fechar o outro no meio-termo em que eles discordassem.
   */
  const alternarUnidade = (grupo: Grupo) => {
    const abrindo = !abertoNoGrupo(grupo);
    const meses = mesesDoGrupo(grupo);
    setAbertas((a) => alternarGrupo(a, idsDoGrupo(grupo)));
    setMesesAbertos((m) => {
      const proximo = new Set(m);
      for (const mes of meses) {
        if (abrindo) proximo.add(mes);
        else proximo.delete(mes);
      }
      return proximo;
    });
  };
  const filtrando = [vigencia, nome, operacao, estado].some((v) => v !== TUDO);

  /**
   * Dá para dizer que uma quinzena está vazia com este recorte?
   *
   * A linha da metade sem cadastro **afirma uma ausência** — "nada nesta
   * quinzena, nem export importado nem planilha digitada" — e oferece criá-la.
   * Filtrar por estado do cadastro é o único recorte que tira uma das duas
   * metades de um mês e deixa a outra: com ele ligado, a frase passaria a ser
   * sobre o recorte, e a linha convidaria a cadastrar o que já está cadastrado.
   *
   * Os outros três não partem mês nenhum, e por isso não desligam nada:
   * vigência recorta por mês inteiro — as duas metades entram ou saem juntas —,
   * e unidade e operação recortam por cartão.
   */
  const podeAfirmarQuinzenaVazia = estado === TUDO;
  const semLastro = situacao.data?.resumo.semLastro ?? 0;

  /*
    Sem tela nenhuma no quadro do encaminhamento. Com a consulta desligada,
    desenhar a lista aqui mostraria "nenhuma unidade entregou vigência ainda"
    por um instante — a frase certa para o acervo vazio, e falsa para quem só
    clicou num link antigo.
  */
  if (encaminhando) return null;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-nav-fechamento" />
            <h1 className="text-2xl font-bold tracking-tight">Remuneração</h1>
          </div>
          {/*
            O botão fica no cabeçalho, e não no fim da lista: quem precisa dele
            é justamente quem não achou a unidade na lista, e procurar embaixo
            de trinta linhas o que fazer quando a sua não está entre elas é a
            forma de não achar.
          */}
          <BotaoDeRegistroDeUnidade />
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          As unidades que o cadastro da planilha de remuneração conhece, cada uma com
          <strong> a tabela dela</strong>: uma faixa por mês, e o mês abre nas{" "}
          <strong>duas quinzenas</strong> — as duas sempre, para que a metade que ninguém
          entregou apareça em vez de faltar em silêncio. Os meses mais recentes vêm
          primeiro, e a unidade que parou de entregar cai para o fim da página; clique numa
          quinzena para abrir o cadastro dela aqui mesmo — alíquotas, frota, parcelas por
          veículo e proporção de documentos. O que o acervo
          ainda não responde, alguém digita da aba de Excel em <strong>Cadastrar planilha</strong>;
          e a unidade cuja aba chegou antes do export entra por <strong>Cadastrar unidade</strong>,
          sem lastro e dizendo que está sem.
        </p>
      </header>

      {/*
        Sem largura máxima, ao contrário da tela do cadastro: lá são três
        colunas de número que se leem melhor juntas, aqui é uma lista de
        unidades com uma frase por metade, e espremê-la em seis colunas quebra
        "62 cavalos" em duas linhas. É a mesma largura de `pages/unidades.tsx`,
        que é a outra lista de unidades do produto.
      */}
      <div className="p-8 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Filtro
            rotulo="Vigência"
            valor={vigencia}
            aoTrocar={setVigencia}
            opcoes={opcoes.vigencias}
            tudo="todas"
          />
          <Filtro
            rotulo="Unidade"
            valor={nome}
            aoTrocar={setNome}
            opcoes={opcoes.nomes}
            tudo="todas"
          />
          {/*
            A operação só aparece onde existe: um acervo em que nenhuma série
            traz canal ofereceria uma etiqueta que abre vazia, e uma etiqueta
            sem opção nenhuma é um controle quebrado.
          */}
          {opcoes.operacoes.length > 0 && (
            <Filtro
              rotulo="Operação"
              valor={operacao}
              aoTrocar={setOperacao}
              opcoes={opcoes.operacoes}
              tudo="todas"
            />
          )}
          <Filtro
            rotulo="Cadastro"
            valor={estado}
            aoTrocar={setEstado}
            opcoes={opcoes.estados}
            tudo="todos"
          />
        </div>

        {situacao.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(situacao.error)}</AlertDescription>
          </Alert>
        )}

        {situacao.isLoading && (
          <p className="text-sm text-muted-foreground">Montando os cadastros…</p>
        )}

        {!situacao.isLoading && !situacao.isError && cadastros.length === 0 && (
          <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground max-w-2xl space-y-3">
            <p>
              Nenhuma unidade ainda. Há dois caminhos, e eles não se substituem: a primeira
              planilha enviada em{" "}
              <Link href="/importacoes" className="text-primary hover:underline">
                Importações
              </Link>{" "}
              traz a unidade com o que o acervo mede, e <strong>Cadastrar unidade</strong>,
              aqui em cima, põe na lista aquela cuja aba de Excel já chegou e cujo export
              ainda não — sem lastro, e dizendo que está sem.
            </p>
          </div>
        )}

        {!situacao.isLoading && cadastros.length > 0 && grupos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum cadastro com esse recorte. Volte um filtro para “todas”.
          </p>
        )}

        {/*
          UMA TABELA POR UNIDADE — e não uma tabela só, com as unidades
          empilhadas dentro dela.

          Enquanto a unidade era um `<tbody>` da mesma tabela, o fim de um grupo
          e o começo do seguinte ficavam colados: a última vigência de uma
          unidade e a faixa com o nome da outra se tocam na mesma borda, e a
          leitura de cima para baixo não tem onde parar. É o custo que a forma
          por vigência não pagava — lá o grupo era o mês, e havia poucos; aqui
          são trinta CDDs, e trinta faixas dentro de uma tabela só viram uma
          página contínua em que a unidade se perde.

          Cada unidade passa a ser um cartão com a tabela dela: o espaço entre
          os cartões é o que diz que uma unidade acabou, e as colunas se repetem
          em cada um porque cada um é uma tabela de verdade — quem rola até a
          décima unidade lê o título das colunas ali, e não vinte linhas acima.

          O cabeçalho da unidade fica **fora** do rolamento horizontal da
          tabela: numa tela estreita as colunas correm para o lado, e o nome do
          CDD correndo junto tiraria da vista justamente o que diz de quem é a
          tabela que se está lendo.
        */}
        {grupos.length > 0 && (
          <div className="space-y-4">
            {grupos.map((grupo) => (
              <section key={grupo.chave} className="rounded-lg border bg-card overflow-hidden">
                <div className="border-b bg-muted/40">
                  <button
                    type="button"
                    onClick={() => alternarUnidade(grupo)}
                    aria-expanded={abertoNoGrupo(grupo)}
                    className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-muted/70"
                  >
                    <ChevronRight
                      className={cn(
                        "w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform",
                        abertoNoGrupo(grupo) && "rotate-90",
                      )}
                      aria-hidden
                    />
                    <span>
                      <span className="font-bold uppercase tracking-wide text-xs">
                        {grupo.titulo}
                      </span>
                      <span className="text-muted-foreground text-xs ml-3">
                        {resumoDoGrupo(grupo)}
                      </span>
                    </span>
                  </button>
                  {/*
                    A procedência da unidade fica **aqui**, e não na linha: ser
                    cadastrada à mão, ter virado planilha órfã ou estar sem
                    código são fatos do par (unidade, canal) — o servidor os
                    calcula por `chaveDaUnidade`, e eles são idênticos em toda
                    vigência dela. Na lista por vigência não havia onde pô-los
                    senão repetidos em cada linha; o cartão da unidade é o lugar
                    que faltava, e eles passam a ser ditos uma vez.

                    Fora do `<button>` que abre o cartão, e não dentro: o painel
                    do código é um botão, e um `<button>` dentro de outro é HTML
                    inválido.
                  */}
                  <MarcasDaUnidade unidade={grupo.linhas[0]!} />
                </div>

                <div className="overflow-x-auto">
                  {/*
                    O nome da unidade nomeia a tabela: ele está no cabeçalho
                    acima, que não é `<caption>` para não rolar com as colunas —
                    e sem o `aria-label` quem lê por leitor de tela encontraria
                    trinta tabelas sem nome nenhum.
                  */}
                  <table className="w-full text-sm border-collapse" aria-label={grupo.titulo}>
                    {/*
                      O título das colunas aparece quando há célula embaixo
                      dele, e não antes.

                      Com os meses fechados a tabela é uma fila de faixas que
                      atravessam a largura toda — nenhuma delas ocupa "Frota"
                      ou "Trechos". Escrever os sete títulos ali seria uma
                      linha de rótulos sobre nada, repetida em cada cartão da
                      página, e a primeira coisa que se lê de uma unidade
                      passaria a ser o cabeçalho de uma tabela vazia.
                    */}
                    {grupo.meses.some((mes) => mesesAbertos.has(chaveDoMes(grupo, mes))) && (
                      <thead>
                        <tr className="border-b text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                          <th className="text-left font-bold px-4 py-3">Vigência</th>
                          <th className="text-left font-bold px-4 py-3">Cadastro</th>
                          <th className="text-left font-bold px-4 py-3">Frota</th>
                          <th className="text-left font-bold px-4 py-3">Trechos</th>
                          <th className="text-right font-bold px-4 py-3">Lastro documental</th>
                          <th className="text-right font-bold px-4 py-3">Informado no cadastro</th>
                          <th className="text-right font-bold px-4 py-3" />
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {grupo.meses.map((mes) => {
                        const chaveDesteMes = chaveDoMes(grupo, mes);
                        const mesAberto = mesesAbertos.has(chaveDesteMes);
                        return (
                          <Fragment key={chaveDesteMes}>
                            {/*
                              O MÊS É UMA FAIXA QUE ABRE, e o que ela abre são as
                              duas quinzenas dele — as duas sempre, tenha a
                              unidade entregado uma, as duas ou nenhuma.

                              Fechado, o mês precisa dizer o bastante para
                              alguém decidir se abre: `resumoDoMes` põe ao lado
                              do nome em que estado está cada metade, e é por
                              isso que a fila de meses de uma unidade não é uma
                              fila de nomes de mês.
                            */}
                            <tr className="border-b bg-muted/20">
                              <th
                                colSpan={7}
                                scope="colgroup"
                                className="p-0 text-left font-normal"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMesesAbertos((m) => alternarUma(m, chaveDesteMes))
                                  }
                                  aria-expanded={mesAberto}
                                  className="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-muted/40"
                                >
                                  <ChevronRight
                                    className={cn(
                                      "w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform",
                                      mesAberto && "rotate-90",
                                    )}
                                    aria-hidden
                                  />
                                  <span>
                                    <span className="font-semibold">{mes.titulo}</span>
                                    <span className="text-muted-foreground text-xs ml-3">
                                      {resumoDoMes(mes)}
                                    </span>
                                  </span>
                                </button>
                              </th>
                            </tr>

                            {mesAberto &&
                              mes.quinzenas.map((quinzena) => (
                                /*
                                  A chave é da **casa do calendário**, e não da
                                  vigência que caiu nela: é o que faz preencher
                                  a segunda quinzena trocar aquela linha no
                                  lugar, em vez de remontar as duas.
                                */
                                <Fragment key={`${chaveDesteMes}|Q${quinzena.numero}`}>
                                  {quinzena.linhas.length === 0 ? (
                                    /*
                                      A metade que ninguém entregou tem linha do
                                      mesmo jeito: ela é o trabalho que falta, e
                                      era justamente o que a lista rasa não tinha
                                      como mostrar — sem vigência não havia linha,
                                      e julho com uma entrega só tinha a mesma
                                      cara da unidade que entrega uma vez por mês.

                                      Só onde o recorte deixa afirmá-lo — ver
                                      `podeAfirmarQuinzenaVazia`.
                                    */
                                    podeAfirmarQuinzenaVazia && (
                                      <QuinzenaSemCadastro
                                        quinzena={quinzena}
                                        unidade={grupo.linhas[0]!}
                                        canaisConhecidos={canaisConhecidos}
                                      />
                                    )
                                  ) : (
                                    quinzena.linhas.map((u) => {
                                      const chave = chaveDaLinha(u);
                                      const aberta = abertas.has(chave);
                                      const alternar = () =>
                                        setAbertas((a) => alternarUma(a, chave));
                                      /*
                                        A linha é a **quinzena**, e o mês dela é a
                                        faixa logo acima: escrever "julho de 2026"
                                        aqui repetiria uma polegada abaixo o que a
                                        faixa acabou de dizer.

                                        O rótulo inteiro — com o mês — ainda é
                                        montado, e vai para o cabeçalho do painel
                                        que abre: lá embaixo o mês já saiu de
                                        vista, e várias linhas ficam abertas ao
                                        mesmo tempo, de propósito.
                                      */
                                      const rotuloDaVigencia = `${quinzena.numero}ª quinzena de ${mes.titulo}`;
                                      /*
                                        O dia só onde ele distingue alguma coisa:
                                        a vigência que não começa no dia da
                                        quinzena, e a metade que recebeu duas.
                                        Embaixo de "1ª quinzena", um "01/07" é a
                                        mesma data escrita duas vezes.
                                      */
                                      const precisaDoDia =
                                        quinzena.linhas.length > 1 ||
                                        u.effectiveDate !== quinzena.inicio;
                                      return (
                                        <Fragment key={chave}>
                                          <tr
                                            onClick={alternar}
                                            className={cn(
                                              "border-b last:border-b-0 cursor-pointer hover:bg-muted/50",
                                              aberta && "bg-muted/40",
                                            )}
                                          >
                                            <td className="px-4 py-3 align-middle">
                                              {/*
                                                O botão repete o clique da linha por causa do
                                                teclado: uma `<tr>` clicável não recebe foco, e sem
                                                ele o cadastro seria inalcançável sem mouse.
                                              */}
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  alternar();
                                                }}
                                                aria-expanded={aberta}
                                                /*
                                                  O recuo é o que põe a quinzena
                                                  **dentro** do mês: sem ele a
                                                  seta da linha nasce na mesma
                                                  coluna da seta da faixa acima,
                                                  e os dois níveis se leem como
                                                  um só.
                                                */
                                                className="flex items-start gap-1.5 pl-4 text-left"
                                              >
                                                <ChevronRight
                                                  className={cn(
                                                    "w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground transition-transform",
                                                    aberta && "rotate-90",
                                                  )}
                                                  aria-hidden
                                                />
                                                <span>
                                                  {/*
                                                    Nem o nome da unidade nem o do
                                                    mês vêm aqui: são o cartão e a
                                                    faixa acima desta linha, e
                                                    repeti-los era o que fazia a
                                                    mesma unidade descer a página
                                                    uma vez por vigência sem nunca
                                                    distinguir nada.
                                                  */}
                                                  <span className="font-semibold">
                                                    {quinzena.numero}ª quinzena
                                                  </span>
                                                  {precisaDoDia && (
                                                    <span className="block text-muted-foreground text-xs mt-0.5">
                                                      {emDiaCurto(u.effectiveDate)}
                                                    </span>
                                                  )}
                                                </span>
                                              </button>
                                            </td>

                                            {/*
                                              A COLUNA `CADASTRO` RESPONDE SE O
                                              CADASTRO CALCULA — e não quanto
                                              dele tem documento.

                                              Ela mostrava o selo de lastro em
                                              vermelho, e uma coluna chamada
                                              Cadastro marcada de vermelho diz a
                                              quem lê que o cadastro não existe.
                                              O do CDD Belém existia, estava
                                              inteiro e produzia devido ao
                                              centavo. O lastro tem coluna
                                              própria, duas adiante.
                                            */}
                                            <td className="px-4 py-3 align-middle">
                                              {(() => {
                                                const suficiencia = suficienciaDoCadastro(u.cadastro);
                                                return (
                                                  <Badge
                                                    variant={suficiencia.variante}
                                                    title={suficiencia.frase}
                                                    className="gap-1.5 whitespace-nowrap px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide"
                                                  >
                                                    <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
                                                    {suficiencia.rotulo}
                                                  </Badge>
                                                );
                                              })()}
                                            </td>

                                            <td className="px-4 py-3 align-middle">
                                              <MetadeDoCadastro tem={u.cadastro.frota} frase={fraseDaFrota(u)} />
                                            </td>
                                            <td className="px-4 py-3 align-middle">
                                              <MetadeDoCadastro
                                                tem={u.cadastro.aliquotas}
                                                frase={fraseDosTrechos(u)}
                                              />
                                            </td>

                                            {/*
                                              Sem barra de proporção ao lado do número, ao
                                              contrário da coluna "conferido" de Apurações, que é
                                              a que ocupa este lugar lá. Lá a razão entre dois
                                              valores é a resposta; aqui "3 de 30" desenhado como
                                              10% seria o percentual que o módulo recusa —
                                              dezenove das trinta linhas dependem de decisão de
                                              negócio, e não de arquivo que falta.
                                            */}
                                            <td className="px-4 py-3 text-right whitespace-nowrap align-middle">
                                              <div className="inline-flex flex-col items-end gap-1">
                                                <span className="tabular-nums">
                                                  {u.cadastro.comLastro} de {u.cadastro.verificaveis}
                                                </span>
                                                <span
                                                  className="text-[0.6875rem] text-muted-foreground"
                                                  title={ESTADO_DO_CADASTRO[u.cadastro.estado].frase}
                                                >
                                                  {ESTADO_DO_CADASTRO[u.cadastro.estado].rotulo.toLowerCase()}
                                                </span>
                                              </div>
                                            </td>

                                            {/*
                                              A planilha informada é coluna própria, e nunca somada
                                              à de lastro: as duas respondem perguntas opostas — uma
                                              diz o que a unidade **entregou**, a outra o que alguém
                                              **digitou**. Somadas, a unidade que não mandou arquivo
                                              nenhum e teve a aba transcrita apareceria em dia, e
                                              quem opera pararia de procurar o arquivo que falta.

                                              A célula é o **lugar de preencher**, e não só a
                                              contagem: sem o botão, esta coluna dizia "nada
                                              informado" e não oferecia nada a quem lesse isso.

                                              O clique é retido aqui porque a linha inteira abre o
                                              cadastro: o formulário sobe num portal que continua
                                              filho desta célula na árvore do React, e sem a
                                              retenção cada tecla dentro dele fecharia — ou abriria
                                              — a linha atrás.
                                            */}
                                            <td
                                              className="px-4 py-3 text-right whitespace-nowrap align-middle"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <div className="inline-flex flex-col items-end gap-1">
                                                {u.cadastro.informadas > 0 && (
                                                  <>
                                                    <span className="tabular-nums">
                                                      {u.cadastro.informadas} de {u.cadastro.linhas}
                                                    </span>
                                                    {/*
                                                      As obrigatórias primeiro, porque são
                                                      elas que decidem se há devido. "29 de
                                                      30" sozinho conta caixas preenchidas e
                                                      não responde nada: a que falta pode ser
                                                      uma opcional (premissa) ou a linha que
                                                      trava o contrato inteiro.
                                                    */}
                                                    <span className="text-[0.6875rem] text-muted-foreground">
                                                      {u.cadastro.obrigatoriasInformadas} de{" "}
                                                      {u.cadastro.obrigatorias} obrigatórias
                                                    </span>
                                                    {u.cadastro.opcionaisAssumidasComoZero > 0 && (
                                                      <span
                                                        className="text-[0.6875rem] text-muted-foreground"
                                                        title={
                                                          "A planilha deixa estas células em branco e as soma como zero — " +
                                                          "é a premissa que o contrato adota, e não uma linha esquecida."
                                                        }
                                                      >
                                                        {u.cadastro.opcionaisAssumidasComoZero}{" "}
                                                        {u.cadastro.opcionaisAssumidasComoZero === 1
                                                          ? "opcional assumida"
                                                          : "opcionais assumidas"}{" "}
                                                        como zero
                                                      </span>
                                                    )}
                                                    <Conferencias cadastro={u.cadastro} />
                                                  </>
                                                )}
                                                <BotaoDeCadastroDaPlanilha
                                                  unidade={u}
                                                  canaisConhecidos={canaisConhecidos}
                                                />
                                              </div>
                                            </td>

                                            <td className="px-4 py-3 text-right align-middle">
                                              <span className="inline-flex items-center gap-3">
                                                <Link
                                                  href={enderecoDaUnidade(u)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                                                >
                                                  abrir cadastro
                                                  <ArrowRight className="w-3 h-3" />
                                                </Link>
                                                {/*
                                                  A lixeira fica no fim da linha, ao lado de abrir
                                                  — e não junto do botão de cadastrar planilha, que
                                                  é o gesto que se repete. Excluir é o gesto que se
                                                  faz uma vez; vizinho do botão que se aperta toda
                                                  quinzena, ele viraria o clique errado de alguém
                                                  com pressa.
                                                */}
                                                <BotaoDeExclusaoDoCadastro
                                                  unidade={u}
                                                  podeExcluirAUnidade={ehOUltimoCadastro(u)}
                                                />
                                              </span>
                                            </td>
                                          </tr>

                                          {aberta && (
                                            <tr className="border-b last:border-b-0 bg-muted/20">
                                              <td colSpan={7} className="px-4 py-4 sm:px-9">
                                                <div className="space-y-3">
                                                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                                                    {/*
                                                      O endereço **inteiro** do cadastro — a
                                                      unidade e a vigência —, e não só a metade
                                                      que o grupo já disse. É o lugar em que a
                                                      repetição vale: várias linhas ficam abertas
                                                      ao mesmo tempo, de propósito, e comparar
                                                      duas unidades quer dizer ler dois painéis
                                                      que estão em grupos diferentes. Um painel
                                                      que dissesse só a vigência mandaria subir a
                                                      página para lembrar de quem ele é.
                                                    */}
                                                    <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                                                      O cadastro · {rotuloDaLinha(u)} · {rotuloDaVigencia}
                                                    </p>
                                                    {/*
                                                      O cadastro abre aqui; o resto da unidade —
                                                      trocar de vigência, comparar duas quinzenas,
                                                      digitar a planilha com as trinta linhas à
                                                      vista — é outra tela, e o caminho para ela
                                                      fica onde a pergunta seguinte aparece.
                                                    */}
                                                    <Link
                                                      href={enderecoDaUnidade(u)}
                                                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                                    >
                                                      Abrir a unidade — vigências, comparação e planilha
                                                      <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                                                    </Link>
                                                  </div>
                                                  <CadastroDaLinha unidade={u} />
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                      </Fragment>
                                    );
                                  })
                                )}
                                </Fragment>
                              ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}

        {filtrando && grupos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Os totais de cada unidade são os das vigências visíveis com este recorte.
          </p>
        )}

        {cadastros.length > 0 && <Notas semLastro={semLastro} />}
      </div>
    </Layout>
  );
}

/**
 * A METADE DO MÊS QUE NINGUÉM ENTREGOU — e por que ela tem linha.
 *
 * Ela não é um cadastro: não há vigência, e por isso não há estado, frota,
 * trechos nem linhas com lastro para escrever. É uma **casa do calendário**, e
 * é o que a torna a linha mais útil da tabela: a planilha de remuneração é
 * quinzenal, toda unidade deve duas por mês, e a que falta é exatamente o que
 * esta tela existe para achar.
 *
 * Na lista rasa ela não tinha como aparecer — sem vigência não havia linha —, e
 * a única pista de que faltava metade de julho era julho ter uma linha só, o
 * que também é a cara da unidade que entrega uma vez por mês. As duas
 * situações liam igual, e a que pedia trabalho era a que ninguém via.
 *
 * **A linha não abre.** As outras abrem o cadastro daquela quinzena, e aqui não
 * há cadastro para montar: uma seta que girasse para revelar o vazio seria um
 * clique que promete e não entrega. O que ela oferece é o gesto que existe —
 * *Cadastrar planilha*, já apontado para esta quinzena, que a cria quando a
 * primeira célula for salva.
 *
 * As três colunas do meio viram uma frase só, e não três traços: um traço em
 * "Frota" e outro em "Trechos" se leem como "o export veio e não trouxe nada",
 * que é uma das situações que a coluna sabe dizer — e é a situação errada.
 *
 * Recebe a `unidade` de uma metade irmã porque o painel precisa do escopo e do
 * canal, e esses são fatos do par (unidade, canal): idênticos em toda vigência
 * dela, e é por isso que qualquer linha do cartão serve.
 */
function QuinzenaSemCadastro({
  quinzena,
  unidade,
  canaisConhecidos,
}: {
  quinzena: Quinzena;
  unidade: SituacaoDaUnidade;
  canaisConhecidos: string[];
}) {
  return (
    <tr className="border-b last:border-b-0">
      {/* `pl-9` = o recuo do mês mais a seta que esta linha não tem: o texto
           nasce alinhado com o das irmãs. */}
      <td className="px-4 py-3 align-middle">
        <span className="block pl-9">
          <span className="font-semibold text-muted-foreground">
            {quinzena.numero}ª quinzena
          </span>
          <span className="block text-muted-foreground text-xs mt-0.5">
            a partir de {emDiaCurto(quinzena.inicio)}
          </span>
        </span>
      </td>

      <td className="px-4 py-3 align-middle">
        {/*
          Fora dos quatro estados, e de propósito: "sem lastro" quer dizer que a
          vigência existe e o acervo não respondeu por ela, e é outra coisa —
          outro trabalho — do que não haver vigência nenhuma.
        */}
        <Badge
          variant="outline"
          title="Nenhuma vigência nesta quinzena: nem export importado, nem planilha digitada."
          className="gap-1.5 whitespace-nowrap px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" aria-hidden />
          Sem cadastro
        </Badge>
      </td>

      <td colSpan={3} className="px-4 py-3 align-middle text-muted-foreground">
        nada nesta quinzena — nem export importado, nem planilha digitada
      </td>

      <td className="px-4 py-3 text-right whitespace-nowrap align-middle">
        <BotaoDeCadastroDaPlanilha
          unidade={unidade}
          canaisConhecidos={canaisConhecidos}
          vigenciaInicial={quinzena.inicio}
          vigenciaNova
        />
      </td>

      <td className="px-4 py-3" />
    </tr>
  );
}

/**
 * O que se sabe da **unidade**, e não de uma vigência dela.
 *
 * As três marcas respondem pelo par (escopo, canal): o servidor as calcula por
 * `chaveDaUnidade` — ver `lib/remuneracao/src/leitura.ts` —, e por isso elas
 * chegam idênticas em todas as linhas da unidade. Enquanto o grupo era a
 * vigência não havia onde dizê-las senão dentro de cada linha, e a unidade com
 * seis vigências dizia seis vezes que tinha sido cadastrada à mão. Aqui elas
 * são ditas uma vez, no cabeçalho de quem elas descrevem.
 *
 * Recebe uma linha qualquer do grupo porque qualquer uma serve — as três são
 * fato da unidade, e é justamente por isso que a repetição era gratuita.
 */
function MarcasDaUnidade({ unidade }: { unidade: SituacaoDaUnidade }) {
  const registrada = unidade.registradaAMao;
  const orfa = unidade.planilhaOrfa;
  const faltaCodigo = semCodigo(unidade);
  if (!registrada && !orfa && !faltaCodigo) return null;

  return (
    <div className="pb-2.5 pr-4 pl-9 space-y-0.5">
      {/*
        A marca é da unidade, e não do cadastro: o estado de cada linha já diz
        se há lastro, e "sem lastro" numa unidade importada quer dizer "o
        arquivo veio e não trouxe o que o cadastro lê" — coisa muito diferente
        de "arquivo nenhum veio". Sem esta linha as duas situações ficam com a
        mesma cara, e a primeira manda procurar um export que ninguém deixou de
        mandar.
      */}
      {registrada && (
        <p className="text-[0.6875rem] text-muted-foreground/80">
          cadastrada à mão — sem export importado
        </p>
      )}

      {/*
        A órfã é o contrário da cadastrada à mão, e por isso a marca é outra: lá
        alguém declarou a unidade e o arquivo ainda não veio; aqui a unidade
        **existiu** — o acervo a perdeu depois que a planilha foi digitada — e o
        que sobrou foram as células.

        A frase diz as duas metades porque as duas importam: o que sumiu (a
        unidade) e o que não sumiu (a planilha). Sem a segunda, quem digitou
        trinta linhas continuaria achando que perdeu o trabalho; sem a primeira,
        iria procurar um cadastro que não existe mais.
      */}
      {orfa && (
        <p className="text-[0.6875rem] text-amber-700">
          a unidade saiu do acervo — a planilha continua aqui, e volta ao lugar quando o
          export dela for reimportado
        </p>
      )}

      {/*
        E, quando ela também está sem código, a saída fica **ao lado do fato**, e
        não numa tela de configuração: sem código o export abre uma segunda
        unidade ao lado desta, e quem descobre isso descobre aqui, olhando a
        lista.

        O clique é contido porque o cabeçalho do grupo abre todas as vigências
        dele: sem o `stopPropagation`, abrir o painel do código abriria junto os
        seis cadastros embaixo dele.
      */}
      {faltaCodigo && (
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/*
            Duas consequências, uma causa — e a segunda custou uma tarde de
            alguém que cadastrou a planilha inteira e não entendeu por que o
            painel do fechamento continuou vazio. O fechamento encontra o
            cadastro **pelo código**, e sem ele não há o que encontrar. Dizer só
            a primeira mandava procurar no lugar errado.
          */}
          <span className="text-[0.6875rem] text-amber-700">
            sem código — o export vai abrir outra ao lado, e o painel do fechamento não
            encontra este cadastro
          </span>
          <BotaoDeInformarCodigo
            scopeHash={unidade.scopeHash}
            nome={nomeDaUnidade(unidade)}
          />
        </p>
      )}
    </div>
  );
}

/**
 * Uma das duas metades: a marca, e o que o acervo entregou por extenso.
 *
 * A marca repete a cor do estado e a frase diz o que aconteceu — porque "não"
 * tem três formas aqui, e as três pedem trabalhos diferentes de quem for
 * resolver.
 */
function MetadeDoCadastro({ tem, frase }: { tem: boolean; frase: string }) {
  return (
    <span className="flex items-start gap-2">
      <span
        aria-hidden
        className={`w-2 h-2 rounded-sm shrink-0 mt-1.5 ${
          tem ? "bg-emerald-500" : "bg-muted-foreground/30"
        }`}
      />
      <span className={tem ? "" : "text-muted-foreground"}>{frase}</span>
    </span>
  );
}

/**
 * AS DUAS CONFERÊNCIAS, QUE NÃO SÃO A MESMA COISA.
 *
 * A tela dizia `N conferem com o acervo` sobre qualquer conferência — e a linha
 * ao lado dizia `0 de 30 com lastro`. As duas não podem ser verdade juntas, e a
 * errada era a primeira: no CDD Belém as duas conferências eram `resumo_iss` e
 * `resumo_ctrc`, calculadas sobre alíquotas **informadas** e confrontadas com o
 * percentual **também informado**. A aba conferindo consigo mesma.
 *
 * A conferência interna não vale menos — é ela que pega o erro de transcrição,
 * porque o total impresso na aba tem de bater com a soma das parcelas
 * digitadas. O que ela não é, é evidência externa; e chamá-la de acervo
 * prometia auditoria onde havia aritmética.
 */
function Conferencias({ cadastro }: { cadastro: SituacaoDoCadastro }) {
  const linha = (
    quantas: number,
    divergentes: number,
    onde: string,
    titulo: string,
  ) => {
    if (quantas === 0) return null;
    return divergentes > 0 ? (
      <Badge variant="destructive" className="text-[0.6875rem]" title={titulo}>
        {divergentes} {divergentes === 1 ? "diverge" : "divergem"} {onde}
      </Badge>
    ) : (
      <span className="text-[0.6875rem] text-muted-foreground" title={titulo}>
        {quantas} {quantas === 1 ? "confere" : "conferem"} {onde}
      </span>
    );
  };

  return (
    <>
      {linha(
        cadastro.conferenciasComAcervo,
        cadastro.divergenciasComAcervo,
        "com o acervo",
        "O número digitado confrontado com o que o export mede. É evidência externa.",
      )}
      {linha(
        cadastro.conferenciasInternas,
        cadastro.divergenciasInternas,
        "dentro da própria aba",
        "Total impresso contra a soma das parcelas digitadas, ou percentual impresso contra " +
          "as alíquotas digitadas. Prova que a transcrição é coerente — não que ela é verdade.",
      )}
    </>
  );
}

/**
 * O que a tabela não cabe dizer em cada linha — por extenso e uma vez só.
 *
 * **Por que embaixo, e não num cartão em cima.** Era um cartão antes da
 * tabela, com quatro contadores grandes e três parágrafos, e ele empurrava a
 * lista para fora da primeira tela: quem abre Remuneração quer ver as unidades,
 * não ler sobre elas. Os contadores viraram a frase de cada grupo — onde valem
 * mais, porque ali respondem por uma vigência —, e o texto ficou aqui, depois
 * do que ele explica.
 *
 * **E por que continua existindo.** Cada parágrafo abaixo fecha uma leitura
 * errada que já aconteceu com o produto na mão: a marca curta que não diz o que
 * o estado quer dizer, a coluna de lastro lida como "falta importar", a
 * planilha informada que parece ter sumido na virada da quinzena, e a unidade
 * sem lastro que parecia não ter saída nenhuma.
 */
function Notas({ semLastro }: { semLastro: number }) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-3">
      <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
        O que cada situação diz
      </p>
      <dl className="space-y-2">
        {ESTADOS.map((estado) => (
          <div key={estado} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
            <dt className="shrink-0 sm:w-40">
              <Badge
                variant={APARENCIA_DO_ESTADO[estado]}
                className="gap-1.5 whitespace-nowrap px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
                {ESTADO_DO_CADASTRO[estado].rotulo}
              </Badge>
            </dt>
            <dd className="text-xs text-muted-foreground">{ESTADO_DO_CADASTRO[estado].frase}</dd>
          </div>
        ))}
      </dl>

      {/*
        AS QUATRO PALAVRAS, SEPARADAS — porque a tela vinha misturando duas
        delas e prometendo uma terceira.

        `0 de 30 com lastro` ao lado de `2 conferem com o acervo` era
        impossível, e as duas frases eram lidas juntas como "este cadastro não
        serve". O cadastro do CDD Belém servia: produzia o devido do mês ao
        centavo, digitado à mão, com zero documentos importados.
      */}
      <div className="text-xs text-muted-foreground border-t pt-3 space-y-2">
        <p>
          <strong>Cadastro</strong> responde se as vinte linhas obrigatórias foram
          informadas — e é só delas que o contrato sai. É a coluna que diz se há devido.
        </p>
        <p>
          <strong>Lastro documental</strong> conta quantas das <strong>onze</strong> linhas
          verificáveis têm documento por trás. Onze, e não trinta: as outras dezenove são
          preço contratado ou conta que o próprio cadastro refaz, e arquivo nenhum as
          confirma — nunca confirmou. Lastro mede auditabilidade, e não prontidão: um
          cadastro sem lastro nenhum calcula o devido igual, e perde só a conferência
          externa.
        </p>
        <p>
          <strong>Informado no cadastro</strong> conta o que alguém digitou, com as
          obrigatórias destacadas. Uma opcional em branco não é falta: a planilha a deixa
          vazia e a soma como zero, e a tela diz a premissa em vez de cobrar a célula.
        </p>
        <p>
          <strong>Conferência</strong> tem duas espécies, e elas nunca se somam:{" "}
          <em>com o acervo</em> confronta o digitado com o que o export mede — evidência
          externa; <em>dentro da própria aba</em> confronta o total impresso com a soma das
          parcelas digitadas — prova que a transcrição é coerente, não que ela é verdade.
        </p>
      </div>

      {/*
        A cadência da planilha é a mesma da vigência, e dizê-lo aqui fecha a
        leitura errada que a coluna sozinha convida — a de que a quinzena
        seguinte, em branco, apagou a anterior. Era pior antes de a lista
        responder por vigência: a unidade tinha uma linha só, e quem preencheu a
        1ª quinzena voltava no dia 16 e via "nada informado" sem nada em tela que
        dissesse onde o que digitou tinha ido parar.
      */}
      <p className="text-xs text-muted-foreground">
        <strong>Planilha informada</strong> conta o outro lado: as linhas que alguém digitou
        da aba de Excel. Ela não entra em "linhas com lastro" — número digitado é lastro da
        planilha, não do acervo — e é justamente por ficarem separadas que a coluna consegue
        dizer quantas linhas os dois respondem e em quantas eles discordam. Ela é da
        vigência da linha: a quinzena nova nasce em branco <strong>ao lado</strong> da
        preenchida, que continua na lista, na vigência dela; e dentro do formulário há{" "}
        <em>copiar de outra vigência</em>, para partir da quinzena passada e corrigir só o
        que mudou.
      </p>

      {/*
        Sem lastro é o único dos quatro estados em que o acervo não responde
        **nada**, e por isso é o único que ganha frase própria: nele a planilha
        informada não é complemento, é a única forma de o cadastro ter número.
        Sem esta linha a tela responde "sem lastro" e cala a saída que existe —
        que foi o que aconteceu no primeiro uso. Conta cadastros, e não
        unidades, porque é por vigência que o export falta: a unidade pode ter
        agosto medido e julho sem nada.
      */}
      {semLastro > 0 && (
        <p className="text-xs text-muted-foreground">
          {semLastro === 1
            ? "O cadastro sem lastro não tem número nenhum vindo do acervo"
            : `Os ${semLastro} cadastros sem lastro não têm número nenhum vindo do acervo`}
          : enquanto o export daquela vigência não chega, o número deles só entra pela{" "}
          <strong>planilha informada</strong> — o botão da coluna abre o formulário, e o que
          entrar por lá fica marcado como informado, com autor e data.
        </p>
      )}
    </div>
  );
}
