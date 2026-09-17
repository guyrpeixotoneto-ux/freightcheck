import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Download, ListChecks, Search, SlidersHorizontal } from "lucide-react";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { VARIAVEIS_DE_FINAME, agruparPorVeiculo } from "@workspace/comparison/finame";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/comparacao/seletor-do-par";
import {
  RecorteDeEquipamento,
  type RecorteDeTipo,
} from "@/components/comparacao/recorte-de-equipamento";
import { CartoesDeFiname } from "@/components/finame/cartoes";
import { SeletorDeFonte } from "@/components/finame/seletor-de-fonte";
import { ConfrontoDeFiname } from "@/components/finame/confronto";
import { EvolucaoDoConfronto } from "@/components/finame/evolucao-do-confronto";
import {
  AlteracoesPorVariavel,
  DistribuicaoPorEstado,
  EvolucaoEntreVigencias,
  TotalPorVigencia,
} from "@/components/finame/graficos";
import { TabelaDeFiname } from "@/components/finame/tabela";
import { DetalheDoVeiculo } from "@/components/finame/detalhe";
import { fetchJson, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import { PainelDaEvolucao } from "@/components/comparacao/evolucao/painel";
import { EVOLUCAO_DO_FINAME } from "@/components/finame/evolucao";
import {
  ABAS_DE_ESTADO,
  contagemPorAba,
  ehModoDeFiname,
  ehRecorteDeTipo,
  enderecoComTroca,
  escreverValor,
  filtrar,
  FILTROS_VAZIOS,
  linhasDoCsv,
  type ModoDeFiname,
  type ComparacaoDeFiname,
  type FiltrosDeFiname,
  type TotaisDeFiname,
} from "@/lib/finame";
import {
  competenciaDaBusca,
  competenciaReconciliada,
  enderecoDaCompetencia,
  enderecoDaFonte,
  fonteDaBusca,
  SEMANTICA_DA_FONTE,
} from "@/lib/fonte-de-finame";
import type { Competencia } from "@workspace/comparison/competencia-de-finame";
import { useCandidatosDoPar } from "@/hooks/use-candidatos-do-par";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { useJustificarNaTabela } from "@/lib/justificar-na-tabela";
import { BarraDoLote } from "@/components/justificativas/barra-do-lote";
import { JustificarEmLoteDialog } from "@/components/justificativas/justificar-em-lote-dialog";
import { alteracoesDoLote, useJustificarEmLote } from "@/lib/justificar-em-lote";
import {
  motivoSemPar,
  parReconciliado,
  rotulosDasVigencias,
  TIPOS_DE_EQUIPAMENTO,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
} from "@workspace/comparison/recorte-de-rubrica";
import { avisoDoParImpossivel, useParNaUrl } from "@/lib/par-de-vigencias";
import { lerRecorte } from "@/lib/recorte";
import { contextoAberto, unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { cn } from "@/lib/utils";

/**
 * AUDITORIA DE FINAME — o que mudou no financiamento entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * A pergunta desta tela, e a razão de ela abrir mostrando só o que mudou
 * ---------------------------------------------------------------------------
 * Quem a abre quer saber **o que se moveu** de uma planilha para a outra. O
 * acervo tem centenas de veículos e catorze variáveis de FINAME; listar as
 * ~4.000 linhas iguais ao lado das que mudaram esconderia o achado dentro da
 * massa. Por isso a tabela abre no recorte das alterações, e "Mostrar veículos
 * sem alteração" é um alternador desligado — quando ligado, o servidor lê as
 * duas vigências inteiras e devolve também as linhas iguais.
 *
 * ---------------------------------------------------------------------------
 * A tabela é **por placa**, e as variáveis moram dentro dela
 * ---------------------------------------------------------------------------
 * A tabela nasceu por variável — uma linha por (veículo × variável) —, e a
 * mesma placa aparecia até catorze vezes, espalhada por várias páginas. Hoje
 * `agruparPorVeiculo` junta as linhas por placa, e clicar abre as alterações
 * daquela placa ali mesmo; a gaveta de detalhe continua a um botão de distância,
 * com o diagnóstico e as variáveis que só existem nela.
 *
 * Três consequências, todas deliberadas:
 *
 * **Filtra primeiro, agrupa depois.** As abas, a busca e os dois seletores
 * continuam sendo sobre a alteração — é nela que moram o estado e a variável —,
 * e a placa entra na lista quando sobra alguma linha dela. Agrupar antes
 * obrigaria cada filtro a decidir o que é "uma placa alterada".
 *
 * **As abas contam alterações; a paginação conta veículos.** Cada uma conta o
 * que de fato mostra: a aba conta o que o filtro dela recorta, e o rodapé conta
 * as linhas que a tabela desenhou.
 *
 * **O CSV continua por variável.** Ele é o arquivo que a auditoria confere linha
 * a linha, e agrupá-lo esconderia justamente a variável que se moveu.
 *
 * **Nenhuma conta mora neste arquivo.** Estado, diferença, variação, impacto e
 * agregados vêm de `@workspace/comparison/finame`, que o servidor importa do
 * mesmo jeito. O que a página faz é escolher o par, filtrar, paginar e exportar
 * — e mesmo o filtro é uma função só, compartilhada com a contagem das abas,
 * para que a aba nunca prometa doze linhas e a tabela mostre nove.
 *
 * **A comparação é sempre do motor.** `/finame/comparacao` reaproveita o change
 * set quando ele existe e manda calcular quando não existe: é o mesmo caminho
 * de Comparar vigências, de modo que as duas telas respondem o mesmo número
 * para o mesmo par. As recusas do motor — escopo diferente, cobertura diferente,
 * canal diferente — chegam com a frase dele.
 *
 * ---------------------------------------------------------------------------
 * E a tela é **de uma unidade por vez**
 * ---------------------------------------------------------------------------
 * `/snapshots` responde pela operação inteira, e dentro dela duas unidades
 * importadas do mesmo arquivo têm o mesmo rótulo e a mesma data: no seletor,
 * duas linhas idênticas. Enquanto esta tela não lia a unidade aberta, o par
 * padrão podia casar uma com a outra — o único par que o motor recusa por
 * construção — e a tela abria num aviso de erro sem ninguém ter escolhido nada.
 *
 * Agora ela lê a unidade aberta — `scopeHash` da URL quando há um, e o contexto
 * que a lateral nomeia quando não há (`contextoAberto`) —, recorta a lista por
 * ela e escolhe o par dentro do recorte (`vigenciasDaUnidade` e `parDePartida`,
 * em `lib/finame.ts`). Aberta CAMAÇARI, o seletor oferece Camaçari e nada mais.
 * É o que a põe em `TELAS_QUE_HONRAM_ESCOPO` (`lib/navegacao-do-escopo.ts`):
 * trocar de unidade na lateral troca o dado desta tela em vez de expulsar quem
 * trocou para Parâmetros. Uma unidade sem duas vigências abre **vazia, dizendo
 * isso** — que é a resposta certa, e não uma falha.
 */
export default function AuditoriaDeFiname() {
  /**
   * O par que o endereço traz, quando traz — o que faz o **Abrir auditoria** do
   * Monitor Custo Fixo chegar aqui no mesmo par que ele estava mostrando.
   *
   * É só o valor inicial: `parReconciliado`, abaixo, continua mandando, e um
   * par que não pertença à unidade aberta é descartado como qualquer outro.
   * Sem os parâmetros no endereço, as duas pontas nascem vazias — o estado que
   * esta tela sempre teve. Ver `useParNaUrl`, em `lib/par-de-vigencias.ts`.
   */
  /*
    As duas pontas moram no endereço — ver `useParNaUrl`.

    Eram `useState`, e o par não sobrevivia a um recarregamento nem cabia num
    link: copiar o endereço depois de comparar junho com setembro mandava o
    outro para o par de partida desta tela. O hook entra no lugar do `useState`
    sem mudar mais nada — o seletor continua recebendo os mesmos dois setters.
  */
  const [base, setBase] = useParNaUrl("base");
  const [comparada, setComparada] = useParNaUrl("comparada");
  const [filtros, setFiltros] = useState<FiltrosDeFiname>(FILTROS_VAZIOS);
  const [comSemAlteracao, setComSemAlteracao] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [aberto, setAberto] = useState<{
    entityLabel: string | null;
    entityType: string;
  } | null>(null);
  /**
   * As abas da tabela — para onde os chips da Evolução rolam a página.
   *
   * Sem isto o clique trocava o filtro de uma tabela que estava fora da tela, e
   * a única coisa que se via mudar era o próprio chip: o painel parecia não
   * fazer nada.
   */
  const abasDaTabela = useRef<HTMLDivElement>(null);

  const vigencias = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<VigenciaEscolhivel[]>("/snapshots"),
  });

  /**
   * A unidade aberta na lateral — e por que esta tela precisa saber dela.
   *
   * Sem isto, trocar de unidade aqui não trocava o dado: trocava de tela.
   * `enderecoDe` (`lib/navegacao-do-escopo.ts`) desvia para Parâmetros toda tela
   * que não sabe ler o recorte, e esta não sabia — *"eu tento mudar de
   * PERNAMBUCO para CAMAÇARI e saio do módulo"*. Estar naquela lista é uma
   * promessa, e o que a cumpre é o recorte abaixo.
   */
  const recorte = lerRecorte(useSearch());

  /**
   * O modo aberto, e o recorte **da evolução** — duas chaves próprias no
   * mesmo endereço.
   *
   * São chaves separadas de `filtros.tipo` de propósito, e é isso que faz a ida
   * e volta não custar nada: entrar na Evolução não toca no recorte da
   * comparação, que continua no estado e volta como estava ao sair. Unidade,
   * canal, `scopeHash` e o par de vigências nem são mencionados aqui — eles
   * vivem na URL e no estado da tela, e a troca de modo passa ao largo deles.
   *
   * Valor adulterado cai no padrão em vez de quebrar: `comparacao` para o modo,
   * que é a tela que sempre existiu, e `TODOS` para o recorte da evolução.
   */
  const busca = useSearch();
  const [, navegar] = useLocation();
  const parametrosDaUrl = useMemo(() => new URLSearchParams(busca), [busca]);
  const modoPedido = parametrosDaUrl.get("modo");
  const modo: ModoDeFiname = ehModoDeFiname(modoPedido) ? modoPedido : "comparacao";
  const recortePedido = parametrosDaUrl.get("recorteEvolucao");
  const recorteDaEvolucao: RecorteDeTipo = ehRecorteDeTipo(recortePedido)
    ? recortePedido
    : "TODOS";
  const anoDaEvolucao = parametrosDaUrl.get("ano");

  const trocarNaUrl = (mudancas: Record<string, string | null>) =>
    navegar(enderecoComTroca(busca, mudancas));

  /**
   * A FONTE ANALISADA — e por que ela é `fonte=` e não `modo=`.
   *
   * `modo` já existe nesta tela, e vale `comparacao | evolucao`. A fonte é um
   * eixo ortogonal a ele — dá para estar na Evolução de qualquer uma das duas —,
   * e empilhar as duas intenções numa chave só tornaria impossível escrever um
   * link que dissesse as duas. Ver `CHAVE_DA_FONTE`, em
   * `@workspace/comparison/fonte-de-finame`, onde a decisão está escrita.
   *
   * Um link sem a chave abre em Remunerado, que é o que esta tela sempre foi.
   */
  const fonte = fonteDaBusca(busca);
  const semantica = SEMANTICA_DA_FONTE[fonte];

  /** A competência que o endereço pede — o eixo temporal da fonte Real. */
  const competenciaPedida = competenciaDaBusca(busca);
  const [competenciasDaFonte, setCompetenciasDaFonte] = useState<Competencia[]>([]);
  const competencia = competenciaReconciliada(competenciaPedida, competenciasDaFonte);

  /**
   * O endereço nunca guarda uma competência que a fonte não tem.
   *
   * É a mesma promessa que `parReconciliado` faz do lado remunerado: o que
   * está na lista fica, e o que não está é substituído pela última válida — na
   * tela **e** na URL. Sem esta reescrita, um link com `competencia=2025-01`
   * mostraria setembro sob um endereço que promete janeiro.
   */
  useEffect(() => {
    if (fonte !== "REAL" || competencia === null) return;
    if (competenciaPedida === competencia) return;
    navegar(enderecoDaCompetencia("/custo-fixo-finame", busca, competencia), { replace: true });
  }, [fonte, competencia, competenciaPedida, busca, navegar]);

  /** O contexto da unidade aberta, que atravessa os dois modos sem ser tocado. */
  const consultaDoContexto = useMemo(() => {
    const q = new URLSearchParams();
    for (const chave of ["scopeHash", "canal", "operacao"]) {
      const valor = parametrosDaUrl.get(chave);
      if (valor !== null && valor !== "") q.set(chave, valor);
    }
    return q;
  }, [parametrosDaUrl]);

  /**
   * Os contextos — de onde saem o **nome** de cada unidade e **qual delas está
   * aberta**.
   *
   * A vigência traz o `scope_hash`, que é um hash: serve para recortar e não
   * para ler. Quem traduz hash em "CAMAÇARI" é a lista de contextos, que a
   * lateral já consulta — daí `useContextosDaCasca`, que divide o mesmo cache e
   * nunca transforma uma falha em painel de erro. Sem ela, os rótulos ficam sem
   * o nome da unidade e a tela volta a listar o acervo: é degradação, não
   * quebra.
   */
  const { contextos, carregando: contextosCarregando } = useContextosDaCasca();
  const nomePorEscopo = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const c of contextos) nomes.set(c.scopeHash, unidadeDe(c));
    return nomes;
  }, [contextos]);

  /**
   * A unidade aberta — **a mesma que a lateral nomeia**, com ou sem `scopeHash`.
   *
   * `recorte.scopeHash` sozinho não responde isto. Sem ele na URL — quem chega
   * por um link nu, ou pelo menu antes de escolher unidade —, a caixa "Unidade
   * atual" continua escrevendo uma unidade: ela cai no primeiro contexto
   * (`contextoAberto`). A tela, lendo só a URL, listava as cinco. É exatamente o
   * desencontro que o cabeçalho de `contextoAberto` descreve, e que custou o
   * mesmo defeito na Cobertura de dados: a lateral escrevendo PERNAMBUCO sobre
   * uma tela que mostrava o acervo inteiro.
   *
   * Com a mesma função dos dois lados, a resposta é uma só: se a lateral diz
   * CAMAÇARI, o seletor oferece as vigências de Camaçari e nada mais.
   */
  const escopoAberto = contextoAberto(contextos, recorte.scopeHash)?.scopeHash ?? null;

  /**
   * Recortar antes de saber qual é a unidade daria a lista errada por um
   * instante — e, pior, um par escolhido nela. Enquanto `/contexts` não
   * responde e a URL não traz unidade, não há lista: nem a de todas, nem a de
   * uma.
   */
  const unidadeResolvida = recorte.scopeHash !== null || !contextosCarregando;

  /**
   * A série aberta — cavalo, carreta, ou as duas.
   *
   * Declarada **antes** da lista de vigências porque é ela que a recorta: na
   * aba Cavalo o seletor do par só oferece vigências que têm cavalo. O
   * mecanismo continua sendo `filtros.tipo`, que a tabela, as abas de estado e
   * o CSV já respeitavam; o que mudou é quem o comanda e o quanto ele alcança.
   */
  const recorteDeTipo = (filtros.tipo === "TODOS" ? "TODOS" : filtros.tipo) as RecorteDeTipo;

  /** As vigências da unidade aberta — a lista que o seletor oferece. */
  /**
   * As vigências que o seletor oferece: as da unidade aberta **que cobrem
   * equipamento**.
   *
   * O segundo filtro não é refinamento: esta tela lê placa, e o acervo entrega
   * o arquivo de trecho como vigência separada (`entity_type_set = TRECHO`).
   * Sem ele a lista oferecia uma ponta que esta tela não sabe ler — e escolhê-la
   * é a recusa do motor em tela ("Coberturas diferentes") ou zero linhas sem
   * explicação, nas duas vezes por um erro que não é de quem clicou.
   */
  /**
   * As vigências de equipamento da unidade — **antes** da aba.
   *
   * Existe separada da lista que o seletor oferece porque três coisas precisam
   * do acervo inteiro da unidade, e não do recorte de uma aba: o rótulo de cada
   * vigência, quais abas habilitar, e nada mais. Recortar antes delas foi o
   * defeito que esta separação conserta — ver `rotulos`, logo abaixo.
   */
  const daUnidadeTodas = useMemo(
    () =>
      unidadeResolvida
        ? vigenciasQueCobrem(
            vigenciasDaUnidade(vigencias.data ?? [], escopoAberto),
            TIPOS_DE_EQUIPAMENTO,
          )
        : [],
    [vigencias.data, escopoAberto, unidadeResolvida],
  );

  /**
   * As datas da unidade — o eixo do ano, na Evolução.
   *
   * Sai de `daUnidadeTodas` (o acervo da unidade, antes da aba) pelo mesmo
   * motivo que os rótulos: quais anos existem é pergunta sobre a unidade, e não
   * sobre o recorte aberto. Recortada pela aba, a lista de anos mudaria ao
   * trocar de equipamento — e um ano sumiria do seletor por ter só carreta.
   */
  const datasDaUnidade = useMemo(
    () => [...new Set(daUnidadeTodas.map((v) => v.effectiveDate))],
    [daUnidadeTodas],
  );

  /**
   * A lista que o seletor do par oferece — a da aba aberta.
   *
   * A aba escolhe a série: Cavalo oferece quem tem cavalo — inclusive as
   * vigências que trazem os dois —, Carreta idem, e "Cavalo + Carreta" o acervo
   * de equipamento inteiro. Quem garante que as duas pontas do par continuam
   * comparáveis dentro da aba é o seletor (`vigenciasCompativeisCom`): a
   * cobertura da vigência ainda tem de bater exatamente, e uma série de cavalo
   * puro não casa com uma de cavalo mais carreta.
   */
  const daUnidade = useMemo(
    () =>
      recorteDeTipo === "TODOS"
        ? daUnidadeTodas
        : vigenciasQueCobrem(daUnidadeTodas, [recorteDeTipo]),
    [daUnidadeTodas, recorteDeTipo],
  );

  /**
   * Quais séries esta unidade tem — o que habilita cada aba.
   *
   * Sai da lista de vigências, e não da comparação: a aba precisa estar certa
   * antes de existir par escolhido. E sai de `daUnidadeTodas`, não de
   * `daUnidade` — este já está recortado pela aba aberta, e a pergunta aqui é
   * sobre o acervo da unidade.
   */
  const disponiveis = useMemo(
    () =>
      ({
        TODOS: true,
        CAVALO: vigenciasQueCobrem(daUnidadeTodas, ["CAVALO"]).length > 0,
        CARRETA: vigenciasQueCobrem(daUnidadeTodas, ["CARRETA"]).length > 0,
      }) as Record<RecorteDeTipo, boolean>,
    [daUnidadeTodas],
  );

  /**
   * O texto de cada opção do seletor, distinto por construção.
   *
   * O arquivo que a Ambev entrega traz as cinco unidades juntas, e uma
   * importação vira cinco vigências de mesmo rótulo e mesma data — medido no
   * `EMPURRADA_Cavalo.xlsx`: seis vigências × cinco unidades = trinta. O
   * seletor mostrava as cinco como a mesma frase, cinco vezes seguidas, e
   * escolher ali era adivinhar. `rotulosDasVigencias` acrescenta a unidade — e
   * só ela, e só onde desempata.
   */
  /*
    Sobre `daUnidadeTodas`, e nunca sobre a lista da aba.

    `rotulosDasVigencias` decide a marca da quinzena olhando as **outras datas
    da lista** que recebe: uma entrega sozinha no mês é "agosto/2026", duas no
    mesmo mês viram "1ª quinzena" e "2ª quinzena". Alimentado com a lista já
    recortada pela aba, o mesmo `snapshot` mudava de nome conforme a aba aberta
    — medido: "agosto/2026 · 1ª quinzena" na lista inteira e "agosto/2026" na
    aba Carreta, quando a outra quinzena do mês não tem carreta. O nome de uma
    vigência não pode depender de onde se está olhando.
  */
  const rotulos = useMemo(
    () => rotulosDasVigencias(daUnidadeTodas, (hash) => nomePorEscopo.get(hash) ?? null),
    [daUnidadeTodas, nomePorEscopo],
  );

  /**
   * O par aberto, mantido dentro da unidade aberta.
   *
   * Quem decide é `parReconciliado`, e a regra dele é uma: **o que está na
   * lista fica**. Ao trocar de unidade, o par anterior deixa de estar nela — e
   * mantê-lo faria a tela responder por Pernambuco sob a palavra CAMAÇARI. Ao
   * abrir sem nenhuma ponta válida, é `parDePartida` quem escolhe, com as duas
   * recusas do motor antecipadas (mesma cobertura, mesmo escopo).
   *
   * O que ele nunca faz é desfazer escolha de quem escolheu. Era o defeito
   * relatado na Auditoria de Km Rodado: com uma ponta só na mão e nenhum par de
   * partida possível, o efeito limpava as duas, e cada clique no seletor era
   * apagado no quadro seguinte.
   *
   * Sem nenhuma ponta escolhida a consulta nem sai: uma unidade com uma
   * vigência só não tem comparação, e pedi-la ao servidor traria a recusa dele
   * para uma tela onde ninguém escolheu nada.
   */
  useEffect(() => {
    if (!vigencias.data || !unidadeResolvida) return;
    const par = parReconciliado(daUnidade, { base, comparada });
    if (par.base !== base) setBase(par.base);
    if (par.comparada !== comparada) setComparada(par.comparada);
  }, [vigencias.data, daUnidade, unidadeResolvida, base, comparada]);

  /**
   * Por que esta lista não dá par — quando não dá.
   *
   * Sai da lista, e não de "as duas pontas estão vazias": o par é escolhido num
   * efeito, que roda **depois** da renderização — ler o estado aqui piscaria a
   * tela vazia por um quadro em toda unidade que tem par.
   */
  const semPar =
    Boolean(vigencias.data) && unidadeResolvida ? motivoSemPar(daUnidade) : null;
  /** Há lista e mesmo assim não há par: a frase da tela vazia é outra. */
  const parImpossivel = semPar ? avisoDoParImpossivel(semPar) : null;
  /**
   * A tela vazia fala enquanto ninguém escolheu o par inteiro.
   *
   * Com as duas pontas escolhidas à mão — o que `parReconciliado` agora
   * preserva —, quem responde é a comparação, ou a recusa do servidor sobre
   * aquele par. Manter a frase no ar ao lado do resultado negaria o que está
   * logo abaixo dela.
   */
  const semParPossivel = semPar !== null && !(base && comparada);

  /**
   * Os números de cada candidata a "De", contra o "Para" aberto.
   *
   * A pergunta, a chave e a cadência moram em `useCandidatosDoPar`, com as
   * outras duas auditorias: a pergunta é a mesma, e telas irmãs respondendo com
   * fôlegos diferentes seria diferença sem motivo. O que esta tela decide é só
   * o que é dela — a rubrica, o "Para" aberto e a unidade do recorte.
   */
  const candidatos = useCandidatosDoPar(
    "finame",
    fonte === "REMUNERADO" ? comparada : "",
    escopoAberto,
  );

  /*
    As duas consultas do remunerado não saem na fonte Real.

    O par continua no estado — `parReconciliado` o mantém, e é o que faz a volta
    para Remunerado cair na mesma comparação de antes —, mas pedir ao servidor a
    comparação entre vigências enquanto a tela mostra o confronto seria trabalho
    jogado fora e, pior, dado de uma fonte carregado sob a outra. A separação
    das fontes vale também para o que **não** se pergunta.
  */
  const comparacao = useQuery({
    queryKey: ["finame", "comparacao", base, comparada, comSemAlteracao],
    enabled: fonte === "REMUNERADO" && Boolean(base && comparada),
    queryFn: () =>
      fetchJson<ComparacaoDeFiname>(
        `/finame/comparacao?base=${base}&comparada=${comparada}` +
          (comSemAlteracao ? "&semAlteracao=true" : ""),
      ),
  });

  const totais = useQuery({
    queryKey: ["finame", "totais", base, comparada],
    enabled: fonte === "REMUNERADO" && Boolean(base && comparada),
    queryFn: () => fetchJson<TotaisDeFiname>(`/finame/totais?base=${base}&comparada=${comparada}`),
  });

  /**
   * As justificativas desta comparação, por `change.id` — a última coluna.
   *
   * É uma segunda consulta, e não um campo da comparação: a justificativa é
   * escrita depois, por um gestor, sobre uma alteração que já existia. Pendurá-la
   * no `/finame/comparacao` faria a tela recalcular a comparação inteira toda vez
   * que alguém justificasse uma linha.
   *
   * `useConsultaResiliente`, que mora dentro do hook, é o que garante que uma
   * falha aqui não vire painel de erro: sem justificativas a tabela continua
   * inteira, com a coluna em branco. A comparação é o dado da tela; a
   * justificativa é o comentário sobre ele.
   */
  const linhas = useMemo(() => comparacao.data?.linhas ?? [], [comparacao.data]);

  const agregados =
    recorteDeTipo === "TODOS"
      ? comparacao.data
      : comparacao.data?.porTipo?.[recorteDeTipo];

  /**
   * Quantos veículos cada recorte tem — o número ao lado de cada aba.
   *
   * Comparados + novos + ausentes: os três estados da frota no par, que é o
   * mesmo universo que o cartão "Veículos comparados" abre. Zero desabilita a
   * aba, porque uma vigência sem carreta não tem tela de carreta para mostrar.
   */
  const contagensDoRecorte = useMemo(() => {
    const quantos = (a: { resumo: { veiculosComparados: number; novosNaVigencia: number; ausentesNaComparada: number } } | undefined) =>
      a ? a.resumo.veiculosComparados + a.resumo.novosNaVigencia + a.resumo.ausentesNaComparada : 0;
    return {
      TODOS: quantos(comparacao.data),
      CAVALO: quantos(comparacao.data?.porTipo?.CAVALO),
      CARRETA: quantos(comparacao.data?.porTipo?.CARRETA),
    } as Record<RecorteDeTipo, number>;
  }, [comparacao.data]);

  /**
   * A evolução decomposta, no recorte aberto — a série já vem por tipo.
   *
   * Mesmo filtro dos totais, e pela mesma razão: o painel escreve os dois lados
   * da mesma identidade, e um recorte que valesse só para metade dela mostraria
   * três parcelas que não somam o total ao lado.
   */
  const evolucaoDoRecorte = useMemo(() => {
    const toda = totais.data?.evolucao ?? [];
    return recorteDeTipo === "TODOS" ? toda : toda.filter((e) => e.entityType === recorteDeTipo);
  }, [totais.data, recorteDeTipo]);

  /** Os totais do gráfico, no recorte aberto — a série já vem por tipo. */
  const totaisDoRecorte = useMemo(() => {
    const todos = totais.data?.totais ?? [];
    return recorteDeTipo === "TODOS"
      ? todos
      : todos.filter((t) => t.entityType === recorteDeTipo);
  }, [totais.data, recorteDeTipo]);
  const filtradas = useMemo(() => filtrar(linhas, filtros), [linhas, filtros]);
  const contagens = useMemo(
    () => contagemPorAba(linhas, { ...filtros, estado: "TODAS" }),
    [linhas, filtros],
  );

  /**
   * As placas — o que a tabela lista desde que deixou de listar variáveis.
   *
   * **Agrupa depois de filtrar, e não antes.** As abas, a busca e os dois
   * seletores continuam sendo sobre a alteração — é ali que moram o estado e a
   * variável —, e a placa entra na lista quando sobra alguma linha dela no
   * recorte. Agrupar primeiro obrigaria cada filtro a decidir o que significa
   * "uma placa alterada", e a aba diria 33 sobre uma tabela de 7 linhas.
   *
   * Por isso a contagem das abas continua em alterações: é o que elas contam. A
   * paginação, essa sim, passou a ser de veículos — é o que a tabela mostra.
   */
  const veiculos = useMemo(() => agruparPorVeiculo(filtradas), [filtradas]);
  const naPagina = useMemo(
    () => veiculos.slice((pagina - 1) * porPagina, pagina * porPagina),
    [veiculos, pagina, porPagina],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, base, comparada, comSemAlteracao]);

  /*
    As duas pontas escritas como quem fala delas — `julho/2026`.

    Saíam do `sourceLabel`: o gráfico dizia `EMPURRADA_2_7_2026` sob o mesmo par
    que o seletor, dois centímetros acima, chamava de `julho/2026`. Duas
    palavras para a mesma vigência na mesma tela, e a do gráfico é a que
    ninguém usa para falar — ninguém abre a tela querendo saber o que mudou no
    `EMPURRADA_2_7_2026`.

    `rotulos` é o mesmo mapa do seletor, de modo que as duas partes da tela não
    podem divergir: a marca da quinzena, o nome da unidade e o desempate saem de
    uma régua só. O `sourceLabel` fica de reserva para a vigência que não
    estiver no mapa.

    Com isto o nome do arquivo deixa de aparecer nesta tela por padrão — e é o
    que se quer: ele não é como a vigência se chama, é o que ela veio. Onde ele
    ainda importa, `rotulosDasVigencias` o traz de volta sozinho, como último
    desempate entre duas linhas que seguiriam indistinguíveis.
  */
  const rotuloBase =
    rotulos.get(base) ??
    vigencias.data?.find((v) => v.id === base)?.sourceLabel ??
    "Vigência Base";
  const rotuloComparada =
    rotulos.get(comparada) ??
    vigencias.data?.find((v) => v.id === comparada)?.sourceLabel ??
    "Vigência Comparada";

  /*
    Justificar sem sair da tabela — o mesmo gancho das outras cinco rubricas.

    A leitura é uma consulta à parte da comparação: pendurá-la no
    `/finame/comparacao` faria a tela recalcular a comparação inteira toda vez
    que alguém justificasse uma linha. E é resiliente por dentro
    (`useConsultaResiliente`), o que garante que uma falha aqui não vire painel
    de erro: sem justificativas a tabela continua inteira, com a coluna em
    branco. A comparação é o dado da tela; a justificativa é o comentário sobre
    ele.
  */
  const justificar = useJustificarNaTabela(
    comparacao.data?.changeSetId,
    `comparação ${rotuloBase} → ${rotuloComparada}`,
  );

  /*
    JUSTIFICAR EM LOTE — a mesma caixa, aplicada a várias alterações de uma vez.

    O universo é `filtradas`, e não `naPagina`: é o recorte inteiro dos filtros
    ativos que o link "Selecionar todos os N resultados" alcança, e é dele que
    sai o N escrito nele. A tabela continua paginada; a seleção, não.

    `filtros` vai inteiro para o hook — é dele que saem o recorte gravado e a
    assinatura que derruba a seleção global quando alguém mexe num filtro. Uma
    lista de campos escolhidos a dedo aqui seria um campo a esquecer amanhã.
  */
  const alteracoesDoRecorte = useMemo(
    () => alteracoesDoLote(filtradas, escreverValor),
    [filtradas],
  );

  const lote = useJustificarEmLote({
    changeSetId: comparacao.data?.changeSetId,
    contexto: `comparação ${rotuloBase} → ${rotuloComparada}`,
    justificadaPor: justificar.justificadaPor,
    alteracoesDoRecorte,
    rubrica: "finame",
    base,
    comparada,
    filtros,
    filtrosVazios: FILTROS_VAZIOS,
    semAlteracao: comSemAlteracao,
  });
  const { justificadaPor } = justificar;

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, justificadaPor));
    salvarArquivo(
      blob,
      `finame-${paraNomeDeArquivo(rotuloBase)}-para-${paraNomeDeArquivo(rotuloComparada)}.csv`,
    );
  }

  return (
    <Layout>
      {/*
        O cabeçalho segue o modo aberto.

        A pastilha e a frase descrevem *a pergunta que a tela responde*, e no
        modo Evolução ela é outra: não é o que mudou entre duas vigências, é
        como cada veículo se moveu ao longo do ano. Deixá-las fixas punha a
        matriz do ano sob a promessa de uma comparação entre duas datas — o
        título de um recorte sobre o número de outro, que é exatamente o que
        esta tela persegue em toda parte.
      */}
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            Auditoria de FINAME
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              {/* O selo segue a fonte **e** o modo: os dois mudam a pergunta, e
                  um selo que ignorasse qualquer um deles poria o número de um
                  recorte sob o título de outro. */}
              {modo === "evolucao"
                ? fonte === "REAL"
                  ? "Remunerado × Realizado por competência"
                  : "Evolução anual"
                : semantica.selo}
            </span>
          </span>
        }
        icone={Banknote}
        descricao={
          <>
            {modo === "evolucao"
              ? fonte === "REAL"
                ? "Como o remunerado e o realizado se moveram, competência a competência, e a distância entre os dois."
                : "Como o financiamento de cada veículo se moveu ao longo do ano, uma coluna por vigência — com o impacto dos movimentos e a variação ponta a ponta lidos separadamente."
              : fonte === "REAL"
                ? "Quanto a Ambev remunerou de FINAME e quanto a operação de fato realizou, placa a placa, dentro da mesma competência."
                : "O que mudou no financiamento de cada veículo entre duas vigências: parcela, juros, amortização, taxa, prazo, carência, entrada e base de compra."}
            {/*
              A linha da fonte — discreta, e logo abaixo da descrição.

              Ela existe porque o seletor, sozinho, diz *qual botão está
              marcado*; esta linha diz **o que aquilo significa**. São duas
              coisas diferentes, e quem chega por um link direto só tem esta.
            */}
            <span className="mt-1 block text-sm text-muted-foreground/80">
              {semantica.linhaDeContexto}
            </span>
          </>
        }
        atualizando={
          modo === "comparacao" && comparacao.isFetching && !comparacao.isLoading
        }
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        {vigencias.error ? (
          <ApiErrorNotice
            error={vigencias.error}
            what="a lista de vigências"
            onTentarDeNovo={() => void vigencias.refetch()}
          />
        ) : (
          <>
            <RecorteDeEquipamento
              valor={recorteDeTipo}
              onValor={(tipo) => {
                /* Escolher um equipamento é sair da Evolução: os três primeiros
                   botões são da comparação, e clicar num deles é pedir a tela
                   deles. O recorte da evolução fica guardado para a volta. */
                setFiltros((f) => ({ ...f, tipo }));
                if (modo !== "comparacao") trocarNaUrl({ modo: null });
              }}
              disponiveis={disponiveis}
              idPrefixo="finame"
              aoLado={
                <SeletorDeFonte
                  valor={fonte}
                  onValor={(nova) => {
                    if (nova === fonte) return;
                    /*
                      Trocar de fonte troca o **eixo temporal inteiro**: o par de
                      vigências e a competência não sobrevivem um ao outro. Quem
                      garante isso é `enderecoDaFonte`, e é ele que impede a URL
                      de guardar uma vigência incompatível com a fonte aberta.
                    */
                    navegar(enderecoDaFonte("/custo-fixo-finame", busca, nova));
                  }}
                />
              }
              abaExtra={{
                rotulo: "Evolução",
                ativa: modo === "evolucao",
                onAbrir: () => trocarNaUrl({ modo: "evolucao" }),
                ...(daUnidadeTodas.length === 0
                  ? {
                      indisponivel:
                        "Esta unidade ainda não tem vigência de equipamento importada — não há ano para acompanhar.",
                    }
                  : {}),
              }}
            />
            {modo === "evolucao" && fonte === "REMUNERADO" && (
              <PainelDaEvolucao
                rubrica={EVOLUCAO_DO_FINAME}
                consulta={consultaDoContexto}
                datas={datasDaUnidade}
                recorte={recorteDaEvolucao}
                onRecorte={(r) => trocarNaUrl({ recorteEvolucao: r === "TODOS" ? null : r })}
                ano={anoDaEvolucao}
                onAno={(a) => trocarNaUrl({ ano: a })}
                disponiveis={disponiveis}
              />
            )}
            {/*
              A evolução da fonte Real é **outra série**, e não a remunerada com
              outro rótulo: ela põe remunerado e realizado lado a lado, mês a
              mês. Mostrar aqui a série remunerada sob o seletor marcado em Real
              seria a contaminação exata que a separação das fontes existe para
              impedir — o dado de uma fonte sob o nome da outra.
            */}
            {modo === "evolucao" && fonte === "REAL" && (
              <EvolucaoDoConfronto consulta={consultaDoContexto} tipo={recorteDeTipo} />
            )}
            {modo === "comparacao" && fonte === "REMUNERADO" && (
            <SeletorDoPar
              vigencias={daUnidade}
              foco={recorteDeTipo === "TODOS" ? null : recorteDeTipo}
              rotulos={rotulos}
              candidatos={candidatos.data}
              carregandoCandidatos={candidatos.isFetching}
              erroDosCandidatos={
                candidatos.error instanceof Error ? candidatos.error.message : null
              }
              base={base}
              comparada={comparada}
              onBase={setBase}
              onComparada={setComparada}
              onInverter={() => {
                setBase(comparada);
                setComparada(base);
              }}
              carregando={comparacao.isFetching}
              idPrefixo="finame"
            />
            )}
          </>
        )}

        {/*
          A unidade sem par não é uma falha, e não deve chegar como uma: é a
          resposta certa para "o que mudou no FINAME de Camaçari?" quando
          Camaçari entregou uma vigência só. Antes desta tela recortar por
          unidade, o mesmo caso abria na recusa do motor — um aviso âmbar
          dizendo que a comparação falhou, sobre uma comparação que nunca
          existiu.
        */}
        {/*
          A fonte Real ocupa o mesmo lugar da comparação entre vigências — um
          seletor, cartões, tabela — e nada dela é o bloco de baixo com outro
          texto: os cartões contam cobertura e resultado, e não estados de
          mudança. Ver `ConfrontoDeFiname`.
        */}
        {modo === "comparacao" && fonte === "REAL" && (
          <ConfrontoDeFiname
            consulta={consultaDoContexto}
            tipo={recorteDeTipo}
            competencia={competencia}
            onCompetencia={(c) =>
              navegar(enderecoDaCompetencia("/custo-fixo-finame", busca, c))
            }
            onCompetenciasCarregadas={setCompetenciasDaFonte}
          />
        )}

        {modo === "comparacao" && fonte === "REMUNERADO" && (
          <>
        {semParPossivel && (
          <EstadoVazio
            icone={Banknote}
            titulo={
              parImpossivel
                ? parImpossivel.titulo
                : "Esta unidade não tem duas vigências para comparar"
            }
            descricao={
              parImpossivel
                ? parImpossivel.descricao
                : escopoAberto
                  ? "A comparação de FINAME precisa de duas vigências da mesma unidade. Escolha outra unidade na lateral ou importe a vigência seguinte."
                  : "O acervo ainda não tem duas vigências da mesma unidade e da mesma cobertura para comparar."
            }
          />
        )}

        {comparacao.isLoading && (
          <div className="flex flex-col gap-4" aria-busy="true">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        )}

        {comparacao.error && (
          <ApiErrorNotice
            error={comparacao.error}
            what="a comparação de FINAME"
            onTentarDeNovo={() => void comparacao.refetch()}
            tentando={comparacao.isFetching}
          />
        )}

        {comparacao.data && (
          <>
            <CartoesDeFiname resumo={(agregados ?? comparacao.data).resumo} />

            {(agregados ?? comparacao.data).resumo.impacto.cobertasPorParcelas > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber((agregados ?? comparacao.data).resumo.impacto.cobertasPorParcelas, 0)}{" "}
                {(agregados ?? comparacao.data).resumo.impacto.cobertasPorParcelas === 1
                  ? "parcela saiu"
                  : "parcelas saíram"}{" "}
                do total por já estarem representadas nas partes — o mesmo dinheiro não é
                contado duas vezes.
              </p>
            )}

            {/*
              O segundo aviso é de outra natureza, e por isso é outra frase: ali,
              dinheiro deste módulo já contado noutra linha **deste** módulo;
              aqui, dinheiro que não é deste módulo. A base de compra e os dois
              tributos da aquisição ficam na tabela porque conferem o
              financiamento, e saem do total porque quem os soma é a Auditoria de
              Impostos — ou ninguém, no caso do valor de nota.
            */}
            {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber((agregados ?? comparacao.data).resumo.impacto.foraDaSoma, 0)}{" "}
                {(agregados ?? comparacao.data).resumo.impacto.foraDaSoma === 1
                  ? "alteração ficou"
                  : "alterações ficaram"}{" "}
                fora do total por serem de outra rubrica — valor de NF é o preço do ativo,
                e ICMS e PIS/COFINS da compra são somados pela Auditoria de Impostos.
              </p>
            )}

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <TotalPorVigencia
                totais={totaisDoRecorte}
                rotuloBase={rotuloBase}
                rotuloComparada={rotuloComparada}
              />
              <AlteracoesPorVariavel
                dados={(agregados ?? comparacao.data).alteracoesPorVariavel}
              />
              <DistribuicaoPorEstado
                dados={(agregados ?? comparacao.data).distribuicaoPorEstado}
              />
            </div>

            {/*
              Cada parcela do painel leva a tabela para o recorte que a sustenta
              — é o que transforma o número em algo que se confere. Escreve os
              três filtros de uma vez, e não só o estado: com a busca de outro
              recorte ainda no ar, o chip mandaria para uma tabela vazia e o
              número pareceria mentira.
            */}
            <EvolucaoEntreVigencias
              evolucao={evolucaoDoRecorte}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
              onRecorte={(r) => {
                setFiltros((f) => ({
                  ...f,
                  busca: "",
                  tipo: r.tipo,
                  estado: r.estado,
                  variavel: r.variavel,
                }));
                abasDaTabela.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />

            <div
              ref={abasDaTabela}
              className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b scroll-mt-4"
            >
              {ABAS_DE_ESTADO.map((aba) => (
                <button
                  key={aba.chave}
                  type="button"
                  role="tab"
                  aria-selected={filtros.estado === aba.chave}
                  onClick={() => setFiltros((f) => ({ ...f, estado: aba.chave }))}
                  className={cn(
                    "border-b-2 py-2 text-sm font-semibold",
                    filtros.estado === aba.chave
                      ? "border-brand text-brand"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {/* Com o alternador ligado a lista deixa de ser só de
                      alterações — chamar 1.589 linhas iguais de "alterações"
                      seria o rótulo contradizendo a própria coluna Status. */}
                  {aba.chave === "TODAS" && comSemAlteracao ? "Todas as linhas" : aba.rotulo} (
                  {formatNumber(contagens[aba.chave] ?? 0, 0)})
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[13rem] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="finame-busca"
                  value={filtros.busca}
                  onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                  placeholder="Buscar placa ou variável…"
                  aria-label="Buscar placa ou variável"
                  className="pl-9"
                />
              </div>

              {/*
                O seletor "Tipo de equipamento" morava aqui e subiu para o topo
                da tela (`RecorteDeEquipamento`). Duas caixas comandando o mesmo
                `filtros.tipo` seriam duas respostas possíveis para "qual
                recorte está aberto" — e a de baixo, por estar entre filtros de
                tabela, sugeriria que o recorte é da tabela, quando ele agora
                governa os cartões e os gráficos também.
              */}
              <Select
                value={filtros.variavel}
                onValueChange={(variavel) => setFiltros((f) => ({ ...f, variavel }))}
              >
                <SelectTrigger className="w-[13rem]" aria-label="Variável de FINAME">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as variáveis</SelectItem>
                  {VARIAVEIS_DE_FINAME.map((v) => (
                    <SelectItem key={v.chave} value={v.chave}>
                      {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label
                htmlFor="finame-sem-alteracao"
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Switch
                  id="finame-sem-alteracao"
                  checked={comSemAlteracao}
                  onCheckedChange={setComSemAlteracao}
                />
                Mostrar veículos sem alteração
              </label>

              {/*
                Justificar em lote — secundário, e imediatamente antes de
                Exportar CSV.

                Ele some com o modo ligado: a barra logo abaixo passa a ser o
                comando, e dois lugares oferecendo entrar no mesmo modo seriam
                dois estados possíveis para uma coisa só. Desligado quando não
                há alteração justificável no recorte — entrar no modo ali
                mostraria uma coluna de caixas todas desabilitadas.
              */}
              {!lote.emLote && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={lote.abrirModo}
                  disabled={alteracoesDoRecorte.length === 0}
                  className="ml-auto gap-2 border-brand/40 text-brand hover:bg-brand/5 hover:text-brand"
                >
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  Justificar em lote
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={exportar}
                disabled={filtradas.length === 0}
                className={cn("gap-2", lote.emLote && "ml-auto")}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>

            {/* A barra entre os filtros e a tabela — e só enquanto o modo
                estiver ligado. Ver `barra-do-lote.tsx`. */}
            {lote.emLote && <BarraDoLote {...lote.propsDaBarra} />}

            {filtradas.length === 0 ? (
              linhas.length === 0 ? (
                <EstadoVazio
                  icone={Banknote}
                  titulo="Nenhuma variável de FINAME mudou entre as duas vigências"
                  descricao={`${formatNumber(
                    comparacao.data.resumo.veiculosComparados,
                    0,
                  )} veículos comparados, e o financiamento de todos eles chegou igual nas duas planilhas.`}
                />
              ) : (
                <EstadoVazio
                  icone={SlidersHorizontal}
                  titulo="Nenhuma linha para este filtro"
                  descricao="O recorte atual não tem nenhuma alteração. Limpe os filtros para ver as demais."
                  acao={
                    <Button type="button" variant="outline" onClick={() => setFiltros(FILTROS_VAZIOS)}>
                      Limpar filtros
                    </Button>
                  }
                />
              )
            ) : (
              <>
                <TabelaDeFiname
                  veiculos={naPagina}
                  justificadaPor={justificadaPor}
                  selecao={lote.emLote ? lote.selecao : undefined}
                  onAbrir={(v) =>
                    setAberto({ entityLabel: v.entityLabel, entityType: v.entityType })
                  }
                  onJustificar={justificar.abrir}
                />
                <Paginacao
                  pagina={pagina}
                  porPagina={porPagina}
                  total={veiculos.length}
                  onPagina={setPagina}
                  onPorPagina={setPorPagina}
                  tamanhos={[50, 100, 300]}
                  unidade="veículos"
                  unidadeSingular="veículo"
                />
              </>
            )}

            {/* O diálogo é o de Chamados, e a vigência vai escrita nele: quem
                justifica a partir daqui escolheu o par no seletor acima, e uma
                caixa que não diz onde grava deixa a decisão sem a metade que a
                torna verificável. */}
            <JustificarDialog {...justificar.propsDoDialogo} />

            <JustificarEmLoteDialog {...lote.propsDoDialogo} />

            <DetalheDoVeiculo
              veiculo={aberto}
              linhas={linhas as LinhaDeFiname[]}
              rotuloBase={rotuloBase}
              rotuloComparada={rotuloComparada}
              onFechar={() => setAberto(null)}
            />
          </>
        )}
          </>
        )}
      </div>
    </Layout>
  );
}
