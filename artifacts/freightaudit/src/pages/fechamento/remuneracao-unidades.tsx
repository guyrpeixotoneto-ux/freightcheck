import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, ChevronRight, ScrollText } from "lucide-react";
import { BotaoDeInformarCodigo } from "@/components/remuneracao/informar-codigo";
import { BotaoDeCadastroDaPlanilha } from "@/components/remuneracao/painel-de-cadastro";
import { BotaoDeRegistroDeUnidade } from "@/components/remuneracao/registrar-unidade";
import { VistaDeUmaQuinzena } from "@/components/remuneracao/uma-quinzena";
import { Filtro, TUDO } from "@/components/fechamento/filtro";
import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { apresentar } from "@/lib/apresentar-erro";
import { emDiaCurto, MES_LONGO } from "@/lib/calendario";
import { alternarGrupo, alternarUma, grupoEstaAberto } from "@/lib/linhas-abertas";
import { cn } from "@/lib/utils";
import {
  chaveDoCadastro,
  ESTADO_DO_CADASTRO,
  lerCadastro,
  lerSituacaoDasUnidades,
  type EstadoDoCadastro,
  type SituacaoDaUnidade,
} from "@/lib/remuneracao";

/**
 * Remuneração — as unidades, antes do cadastro de uma delas.
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
 * em etiqueta, as linhas reunidas por período com o total do grupo escrito no
 * cabeçalho, e a resposta cara de cada linha abrindo **na própria linha**. Lá o
 * grupo é a quinzena e o que abre é a conta; aqui o grupo é a vigência e o que
 * abre é o cadastro (`components/remuneracao/uma-quinzena`) — o mesmo
 * componente da tela de dentro, e não um desenho parecido: duas versões do
 * mesmo cadastro acabariam divergindo, e a daqui seria a que ninguém lembrou de
 * corrigir. O gesto de abrir também é um só, em `lib/linhas-abertas.ts`.
 *
 * O cadastro é buscado quando a linha abre, e não junto da lista: montar as
 * trinta linhas de uma unidade é o trabalho mais caro deste módulo, e baixar
 * trinta cadastros para mostrar um seria pagar a lista inteira para ler uma
 * unidade.
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
 * unidades por estado e não soma linhas com lastro: "89 de 900" é o mesmo
 * percentual disfarçado, e diria a mesma coisa errada.
 *
 * **A situação é sempre da vigência mais recente da unidade**, e é ela que
 * decide em que grupo a linha cai. Uma lista que respondesse por uma quinzena
 * fixa faria a unidade que parou de entregar em junho parecer em dia; agrupada
 * assim, ela aparece — sozinha, num grupo de junho, abaixo de todo mundo.
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
  SEM_LASTRO: "sem lastro",
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

/** O nome do CDD, sem o canal — "CAMAÇARI" de "CAMAÇARI · EMPURRADA". */
function nomeDaUnidade(u: SituacaoDaUnidade): string {
  return u.unidade ?? u.label.split(" · ")[0] ?? u.label;
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
 * A identidade de uma linha: o par que a distingue de todas as outras.
 *
 * É o mesmo par que endereça a unidade no servidor — escopo e canal —, e não um
 * índice: a lista se reordena a cada filtro, e um índice faria a linha aberta
 * saltar para outra unidade quando alguém trocasse o recorte.
 */
export function chaveDaLinha(u: SituacaoDaUnidade): string {
  return `${u.scopeHash}|${u.channel ?? ""}`;
}

/** `2026-08-16` → `agosto de 2026`, o título do grupo. */
function mesPorExtenso(data: string): string {
  const indice = Number(data.slice(5, 7)) - 1;
  return indice >= 0 && indice < 12 ? `${MES_LONGO[indice]} de ${data.slice(0, 4)}` : data;
}

/**
 * `2026-08-16` → `agosto/2026` — a forma que o servidor dá ao **mês inteiro**.
 *
 * Serve para uma pergunta só: o rótulo desta vigência diz mais do que o grupo já
 * disse? A unidade que entrega uma vez por mês tem `periodLabel` igual a este
 * texto, e repeti-lo na linha seria escrever "agosto" embaixo de "agosto". A que
 * entrega quinzenalmente tem "2ª quinzena de agosto de 2026", e aí a linha
 * precisa dizer qual das duas respondeu — ver `rotuloDaVigencia`, em
 * `lib/remuneracao/src/vigencia.ts`.
 */
function mesDaVigencia(data: string): string {
  const indice = Number(data.slice(5, 7)) - 1;
  return indice >= 0 && indice < 12 ? `${MES_LONGO[indice]}/${data.slice(0, 4)}` : data;
}

/**
 * O endereço do cadastro daquela unidade.
 *
 * O canal vai sempre, mesmo vazio — a mesma razão de `irParaUnidade` na tela do
 * cadastro: uma unidade pode ter uma série com canal e outra sem, no mesmo
 * `scopeHash`, e omitir o parâmetro pediria "qualquer canal", abrindo uma série
 * que ninguém escolheu aqui.
 */
function enderecoDaUnidade(u: SituacaoDaUnidade): string {
  const query = new URLSearchParams({ scopeHash: u.scopeHash, canal: u.channel ?? "" });
  return `/fechamento/remuneracao/unidade?${query}`;
}

interface ContagemDoGrupo {
  frotaEAliquotas: number;
  soFrota: number;
  soAliquotas: number;
  semLastro: number;
  /** Unidades com alguma linha digitada da aba de Excel. */
  comPlanilha: number;
  /** Destas, quantas têm alguma linha em que a planilha e o acervo discordam. */
  comDivergencia: number;
  /** Unidades que entraram por cadastro, e não por arquivo. */
  registradas: number;
}

/** Um mês de vigência e as unidades cuja última entrega caiu nele. */
export interface Grupo extends ContagemDoGrupo {
  /** `2026-08` — o mês, que é o que reúne as unidades. */
  chave: string;
  titulo: string;
  /** Os dias de vigência que existem no grupo, já escritos: `01/08`, `16/08`. */
  dias: string[];
  linhas: SituacaoDaUnidade[];
}

/**
 * As unidades reunidas pelo mês da vigência mais recente de cada uma.
 *
 * **Por que o mês, e não a data exata.** Duas unidades que entregaram no dia 1º
 * e no dia 16 de agosto estão as duas em dia, e separá-las em dois grupos
 * esconderia a única coisa que o agrupamento existe para mostrar — quem ficou
 * para trás. O mês é o grão em que "atrasada" quer dizer alguma coisa. Os dias
 * que existem dentro do grupo continuam escritos no cabeçalho dele, e a linha
 * cuja vigência é mais específica que o mês a escreve por extenso.
 *
 * **A ordem é do mês mais recente para o mais antigo, e é calculada aqui.** Ao
 * contrário de Apurações, a lista não chega ordenada por data: o servidor manda
 * as unidades do acervo por vigência decrescente e **acrescenta ao fim** as que
 * existem só por planilha ou por cadastro à mão (ver `contextosEProcedencia`).
 * Herdar essa ordem colocaria a unidade cadastrada à mão num grupo próprio no
 * rodapé, ainda que a vigência dela fosse a mais recente de todas.
 *
 * Dentro do grupo, por nome — pela mesma razão: a ordem que vem do banco é a do
 * `scope_hash`, que não quer dizer nada para quem lê.
 */
export function agruparPorVigencia(unidades: SituacaoDaUnidade[]): Grupo[] {
  const por = new Map<string, Grupo>();
  const dias = new Map<string, Set<string>>();

  for (const u of unidades) {
    const chave = u.effectiveDate.slice(0, 7);
    let grupo = por.get(chave);
    if (!grupo) {
      grupo = {
        chave,
        titulo: mesPorExtenso(u.effectiveDate),
        dias: [],
        linhas: [],
        frotaEAliquotas: 0,
        soFrota: 0,
        soAliquotas: 0,
        semLastro: 0,
        comPlanilha: 0,
        comDivergencia: 0,
        registradas: 0,
      };
      por.set(chave, grupo);
      dias.set(chave, new Set());
    }
    grupo.linhas.push(u);
    dias.get(chave)!.add(u.effectiveDate);
    /*
      Tudo aqui conta **unidades**, e nunca linhas de cadastro somadas entre
      elas: a lista é de unidades, e uma frase que misturasse os dois grãos
      ("2 unidades · 89 linhas informadas") faria os dois números parecerem
      comparáveis. O que cada unidade tem por dentro está na linha dela.
    */
    grupo[CONTADOR[u.cadastro.estado]] += 1;
    if (u.cadastro.informadas > 0) grupo.comPlanilha += 1;
    if (u.cadastro.divergentes > 0) grupo.comDivergencia += 1;
    if (u.registradaAMao) grupo.registradas += 1;
  }

  for (const grupo of por.values()) {
    grupo.dias = [...dias.get(grupo.chave)!].sort().map(emDiaCurto);
    grupo.linhas.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }
  return [...por.values()].sort((a, b) => b.chave.localeCompare(a.chave));
}

/**
 * O resumo do grupo, na frase que ele merece.
 *
 * Cada número gruda na primeira palavra dele com espaço inquebrável, como em
 * {@link contar}: a frase é longa, o cabeçalho é de uma linha só, e um "1" que
 * termina a linha com "sem lastro" começando a seguinte é um número que perdeu
 * o substantivo.
 */
export function resumoDoGrupo(grupo: Grupo): string {
  const partes = [contar(grupo.linhas.length, "unidade", "unidades")];

  /* Só os estados que existem no grupo: um "0 sem lastro" ocuparia a frase para
     dizer que não há o que fazer, e é justamente o que não precisa ser dito. */
  for (const estado of ESTADOS) {
    const quantas = grupo[CONTADOR[estado]];
    if (quantas > 0) partes.push(`${quantas}\u00A0${NO_RESUMO[estado]}`);
  }

  if (grupo.comPlanilha > 0) partes.push(`${grupo.comPlanilha}\u00A0com planilha informada`);
  if (grupo.comDivergencia > 0) {
    partes.push(
      `${grupo.comDivergencia}\u00A0${grupo.comDivergencia === 1 ? "diverge" : "divergem"} do acervo`,
    );
  }
  if (grupo.registradas > 0) {
    partes.push(contar(grupo.registradas, "cadastrada à mão", "cadastradas à mão"));
  }
  return partes.join(" · ");
}

/** As unidades de um grupo, na ordem em que ele as mostra. */
const idsDoGrupo = (grupo: Grupo) => grupo.linhas.map(chaveDaLinha);

/**
 * O cadastro de uma unidade, dentro da linha dela.
 *
 * A chave é a mesma da tela do cadastro — {@link chaveDoCadastro} —, e não por
 * economia de nome: quem abre a linha aqui e depois entra na tela de dentro a
 * encontra pronta, e quem volta de lá reabre a linha sem nova ida ao servidor.
 * Sem vigência pedida, como o link da linha também não a pede: a resposta é
 * sempre a vigência mais recente, que é por quem esta lista responde.
 */
function CadastroDaLinha({ unidade }: { unidade: SituacaoDaUnidade }) {
  const canal = unidade.channel ?? "";
  const dados = useQuery({
    queryKey: chaveDoCadastro(unidade.scopeHash, canal, null),
    queryFn: () => lerCadastro({ scopeHash: unidade.scopeHash, canal }),
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

  const unidades = useMemo(() => situacao.data?.unidades ?? [], [situacao.data]);

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
      ...new Set(unidades.map((u) => u.channel).filter((c): c is string => c !== null && c !== "")),
    ],
    [unidades],
  );

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
    for (const u of unidades) {
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
  }, [unidades]);

  const grupos = useMemo(
    () =>
      agruparPorVigencia(
        unidades.filter((u) => {
          if (vigencia !== TUDO && u.effectiveDate.slice(0, 7) !== vigencia) return false;
          if (nome !== TUDO && nomeDaUnidade(u) !== nome) return false;
          if (operacao !== TUDO && (u.channel ?? "") !== operacao) return false;
          if (estado !== TUDO && u.cadastro.estado !== estado) return false;
          return true;
        }),
      ),
    [unidades, vigencia, nome, operacao, estado],
  );

  const abertoNoGrupo = (grupo: Grupo) => grupoEstaAberto(abertas, idsDoGrupo(grupo));
  const filtrando = [vigencia, nome, operacao, estado].some((v) => v !== TUDO);
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
          As unidades que o cadastro da planilha de remuneração conhece, e o que ele alcança
          em cada uma hoje. Clique numa unidade para abrir o cadastro dela aqui mesmo —
          alíquotas, frota, parcelas por veículo e proporção de documentos. O que o acervo
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

        {!situacao.isLoading && !situacao.isError && unidades.length === 0 && (
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

        {!situacao.isLoading && unidades.length > 0 && grupos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma unidade com esse recorte. Volte um filtro para “todas”.
          </p>
        )}

        {grupos.length > 0 && (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-bold px-4 py-3">Unidade</th>
                  <th className="text-left font-bold px-4 py-3">Cadastro</th>
                  <th className="text-left font-bold px-4 py-3">Frota</th>
                  <th className="text-left font-bold px-4 py-3">Trechos</th>
                  <th className="text-right font-bold px-4 py-3">Linhas com lastro</th>
                  <th className="text-right font-bold px-4 py-3">Planilha informada</th>
                  <th className="text-right font-bold px-4 py-3" />
                </tr>
              </thead>
              {grupos.map((grupo) => (
                <tbody key={grupo.chave}>
                  <tr className="border-b bg-muted/40">
                    <th colSpan={7} scope="colgroup" className="p-0 text-left font-normal">
                      <button
                        type="button"
                        onClick={() => setAbertas((a) => alternarGrupo(a, idsDoGrupo(grupo)))}
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
                            {grupo.dias.join(" e ")} · {resumoDoGrupo(grupo)}
                          </span>
                        </span>
                      </button>
                    </th>
                  </tr>
                  {grupo.linhas.map((u) => {
                    const chave = chaveDaLinha(u);
                    const aberta = abertas.has(chave);
                    const alternar = () => setAbertas((a) => alternarUma(a, chave));
                    /* O rótulo da vigência só quando ele diz mais que o mês do
                       grupo — ver `mesDaVigencia`. */
                    const vigenciaDaLinha =
                      u.periodLabel === mesDaVigencia(u.effectiveDate) ? null : u.periodLabel;
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
                              className="flex items-start gap-1.5 text-left"
                            >
                              <ChevronRight
                                className={cn(
                                  "w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground transition-transform",
                                  aberta && "rotate-90",
                                )}
                                aria-hidden
                              />
                              <span>
                                <span className="font-semibold">{u.label}</span>
                                <span className="block text-muted-foreground text-xs mt-0.5">
                                  {u.registradaAMao
                                    ? contar(
                                        u.vigencias,
                                        "vigência cadastrada",
                                        "vigências cadastradas",
                                      )
                                    : contar(u.vigencias, "vigência no acervo", "vigências no acervo")}
                                  {vigenciaDaLinha && ` · ${vigenciaDaLinha}`}
                                </span>
                                {/*
                                  A marca é da unidade, e não do cadastro: o
                                  estado ao lado já diz que não há lastro, e
                                  "sem lastro" numa unidade importada quer dizer
                                  "o arquivo veio e não trouxe o que o cadastro
                                  lê" — coisa muito diferente de "arquivo nenhum
                                  veio". Sem esta linha as duas situações ficam
                                  com a mesma cara, e a primeira manda procurar
                                  um export que ninguém deixou de mandar.
                                */}
                                {u.registradaAMao && (
                                  <span className="block text-[0.6875rem] text-muted-foreground/80 mt-0.5">
                                    cadastrada à mão — sem export importado
                                  </span>
                                )}
                              </span>
                            </button>

                            {/*
                              E, quando ela também está sem código, a saída fica
                              **ao lado do fato**, e não numa tela de
                              configuração: sem código o export abre uma segunda
                              unidade ao lado desta, e quem descobre isso
                              descobre aqui, olhando a linha.

                              Fora do botão que abre a linha, e com o clique
                              contido: um `<button>` dentro de outro é HTML
                              inválido, e sem o `stopPropagation` abrir o painel
                              do código também abriria o cadastro embaixo dele.
                            */}
                            {semCodigo(u) && (
                              <p
                                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/*
                                  Duas consequências, uma causa — e a segunda
                                  custou uma tarde de alguém que cadastrou a
                                  planilha inteira e não entendeu por que o
                                  painel do fechamento continuou vazio. O
                                  fechamento encontra o cadastro **pelo
                                  código**, e sem ele não há o que encontrar.
                                  Dizer só a primeira mandava procurar no lugar
                                  errado.
                                */}
                                <span className="text-[0.6875rem] text-amber-700">
                                  sem código — o export vai abrir outra ao lado, e o
                                  painel do fechamento não encontra este cadastro
                                </span>
                                <BotaoDeInformarCodigo
                                  scopeHash={u.scopeHash}
                                  nome={nomeDaUnidade(u)}
                                />
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-3 align-middle">
                            <Badge
                              variant={APARENCIA_DO_ESTADO[u.cadastro.estado]}
                              title={ESTADO_DO_CADASTRO[u.cadastro.estado].frase}
                              className="gap-1.5 whitespace-nowrap px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
                              {ESTADO_DO_CADASTRO[u.cadastro.estado].rotulo}
                            </Badge>
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
                          <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap align-middle">
                            {u.cadastro.comLastro} de {u.cadastro.linhas}
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
                                  {u.cadastro.divergentes > 0 ? (
                                    <Badge variant="destructive" className="text-[0.6875rem]">
                                      {u.cadastro.divergentes}{" "}
                                      {u.cadastro.divergentes === 1
                                        ? "diverge do acervo"
                                        : "divergem do acervo"}
                                    </Badge>
                                  ) : (
                                    u.cadastro.conferidas > 0 && (
                                      <span className="text-[0.6875rem] text-muted-foreground">
                                        {u.cadastro.conferidas}{" "}
                                        {u.cadastro.conferidas === 1
                                          ? "confere com o acervo"
                                          : "conferem com o acervo"}
                                      </span>
                                    )
                                  )}
                                </>
                              )}
                              <BotaoDeCadastroDaPlanilha
                                unidade={u}
                                canaisConhecidos={canaisConhecidos}
                              />
                            </div>
                          </td>

                          <td className="px-4 py-3 text-right align-middle">
                            <Link
                              href={enderecoDaUnidade(u)}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              abrir cadastro
                              <ArrowRight className="w-3 h-3" />
                            </Link>
                          </td>
                        </tr>

                        {aberta && (
                          <tr className="border-b last:border-b-0 bg-muted/20">
                            <td colSpan={7} className="px-4 py-4 sm:px-9">
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-baseline justify-between gap-3">
                                  <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                                    O cadastro da vigência · {u.label}
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
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}

        {filtrando && grupos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Os totais de cada vigência são os das unidades visíveis com este recorte.
          </p>
        )}

        {unidades.length > 0 && <Notas semLastro={semLastro} />}
      </div>
    </Layout>
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

      <p className="text-xs text-muted-foreground border-t pt-3">
        <strong>Linhas com lastro</strong> conta as trinta linhas da aba, e não as duas
        metades: dezenove delas dependem de decisões de negócio que ainda não foram
        registradas, e não de arquivo que alguém deixou de mandar — abrir o cadastro de uma
        unidade diz, linha a linha, qual é o caso de cada uma.
      </p>

      {/*
        A cadência da planilha é a mesma da vigência, e dizê-lo aqui evita a
        leitura errada que a coluna sozinha convida: quem preencheu a 1ª quinzena
        e voltar no dia 16 vai ver "nada informado" — não porque o que digitou
        sumiu, mas porque a linha passou a responder pela quinzena seguinte, que
        ainda está em branco. Sem esta frase, a conclusão natural é que o
        cadastro se perdeu.
      */}
      <p className="text-xs text-muted-foreground">
        <strong>Planilha informada</strong> conta o outro lado: as linhas que alguém digitou
        da aba de Excel. Ela não entra em "linhas com lastro" — número digitado é lastro da
        planilha, não do acervo — e é justamente por ficarem separadas que a coluna consegue
        dizer quantas linhas os dois respondem e em quantas eles discordam. Ela segue a mesma
        vigência da linha: a quinzena seguinte começa em branco sem apagar a anterior, e
        dentro do formulário há <em>copiar de outra vigência</em>, para partir da quinzena
        passada e corrigir só o que mudou.
      </p>

      {/*
        Sem lastro é o único dos quatro estados em que o acervo não responde
        **nada**, e por isso é o único que ganha frase própria: nele a planilha
        informada não é complemento, é a única forma de o cadastro ter número.
        Sem esta linha a tela responde "sem lastro" e cala a saída que existe —
        que foi o que aconteceu no primeiro uso.
      */}
      {semLastro > 0 && (
        <p className="text-xs text-muted-foreground">
          {semLastro === 1
            ? "A unidade sem lastro não tem número nenhum vindo do acervo"
            : `As ${semLastro} unidades sem lastro não têm número nenhum vindo do acervo`}
          : enquanto o export não chega, o cadastro delas só ganha número pela{" "}
          <strong>planilha informada</strong> — o botão da coluna abre o formulário, e o que
          entrar por lá fica marcado como informado, com autor e data.
        </p>
      )}
    </div>
  );
}
