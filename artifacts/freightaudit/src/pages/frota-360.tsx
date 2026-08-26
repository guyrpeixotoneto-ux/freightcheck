import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  Container,
  DollarSign,
  FileSpreadsheet,
  Handshake,
  Headset,
  Route,
  Search,
  Tractor,
  X,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Layout } from "@/components/layout/layout";
import { AbaBotao } from "@/components/changes/cartoes";
import { AbaPlanilha } from "@/components/changes/aba-planilha";
import { AbaChamados } from "@/components/changes/aba-chamados";
import {
  ImpactoQuinzenas,
  type AberturaDaMatriz,
} from "@/components/changes/impacto-quinzenas";
import { ClienteRecomendacoes } from "@/components/changes/cliente-recomendacoes";
import { CardsDaFrota } from "@/components/frota/cards-da-frota";
import type { JanelaDeVigencias } from "@/components/changes/janela-vigencias";
import type { TicketTotals } from "@/components/changes/ticket-table";
import { fetchJson } from "@/lib/api";
import {
  aoPlural,
  frasesDoEscopo,
  lerPlaca,
  outrasTelas,
  todosOsPlural,
  TELA_DO_EQUIPAMENTO,
  type Equipamento,
  type EscopoDeFrota,
  type NivelDaTela,
} from "@/lib/frota";
import { lerRecorte, paramsDoRecorte } from "@/lib/recorte";
import { cn } from "@/lib/utils";

/**
 * Cavalo 360°, Carreta 360° e Trecho 360° — as mesmas quatro perguntas, sobre
 * uma frota recortada.
 *
 * A tela é uma só, parametrizada pelo tipo, e isso não é economia de código: as
 * três respondem exatamente às mesmas perguntas, e mantê-las como três arquivos
 * garantiria que um dia respondessem de três jeitos. O que muda entre elas é o
 * nome, o ícone e o `entityType` — e nada mais deveria mudar.
 *
 * **O trecho entrou por essa porta, e ele é o teste da afirmação acima.** Ele
 * não é equipamento: é a perna da rota, por onde passa o lado *variável* da
 * remuneração — a que a planilha do time classifica em `trechoEmpurrada`,
 * `kmIda`, `kmVolta`, pedágio e tempo interno de origem e destino, enquanto
 * cavalo e carreta carregam o fixo. As quatro perguntas, porém, são as mesmas
 * palavra por palavra, e por isso ele é um terceiro valor de `equipamento` e
 * não uma quarta tela. O que a chegada dele custou foi trocar os ternários
 * `CAVALO ? … : …` por vocabulário em `lib/frota.ts` — cada um deles era uma
 * frase que ficaria errada aqui.
 *
 * **O que ela acrescenta a Alterações é o escopo, e escopo não é filtro.** Lá,
 * o `entityType` é um recorte de exibição sobre uma comparação anunciada: a
 * lista encolhe, os cartões continuam sendo os da frota, e o painel de filtros
 * escreve o recorte com o × que o desfaz. Aqui ele é o assunto — os cartões, os
 * painéis, as árvores e as somas são todos recontados dentro dele. A distinção
 * está inteira em `lib/frota.ts` e em `lib/comparison/src/escopo.ts`, e é ela
 * que impede a mentira mais fácil de escrever nesta tela: 1.218 chamados no
 * cartão em cima de uma lista de 340.
 *
 * **A placa é o segundo nível, e ela não recorta as quatro abas do mesmo jeito.**
 * Planilha, Chamados e Impacto descem ao ativo inteiras — as três sabem quem é a
 * placa, e a matriz por quinzena passa a ter uma linha só, com o rodapé dela.
 * Cliente desce pela metade, e a metade é a decisão: a placa escolhe **quais
 * parâmetros entram na pauta** — os que se moveram naquele cavalo —, e os
 * números de cada item continuam sendo os da frota. A razão está escrita na
 * própria aba, onde a pergunta seria feita: a recomendação é sobre o
 * *parâmetro*, e "caiu em 41 veículos" é o que sustenta o pedido — o mesmo
 * alcance recortado num ativo diria "caiu em 1", que é a mesma alteração com o
 * argumento desmontado.
 *
 * **A regra central de Alterações continua valendo, e é a razão de ela ter sido
 * repetida aqui:** os números de uma aba nunca somam com os da outra. Recortar
 * a frota não muda nada disso — o impacto da planilha continua sendo uma
 * diferença entre dois estados fechados, e o do chamado a distância entre um
 * pedido e uma resposta, agora ambos sobre um cavalo.
 *
 * ---
 *
 * **Três níveis, e a porta é o primeiro.**
 *
 * 1. **A frota em cards** — um por ativo, com quanto ele custa, o que mudou
 *    nele e o que pedimos por chamado. É onde a tela abre, e a razão está em
 *    `cards-da-frota.tsx`: quem abre uma tela chamada Cavalo 360° quer ver os
 *    cavalos, e "o que mudou em todos eles" é a pergunta de auditoria, não a de
 *    quem chega.
 * 2. **O ativo** (`?placa=`) — as quatro abas recortadas num cavalo. O
 *    parâmetro se chama `placa` também na tela do trecho, onde o que ele
 *    carrega não é placa nenhuma: ele sempre foi a chave de grão da linha, e a
 *    razão de não renomeá-lo está em `lib/frota.ts`, no `lerPlaca`.
 * 3. **A frota inteira** (`?visao=frota`) — as mesmas quatro abas sobre todos
 *    os ativos do tipo. Continua alcançável por um link do nível 1: é a outra
 *    metade do módulo, e é ela que responde ao mês fechado.
 *
 * Os três moram no endereço, e não em estado: um card aberto é um link que se
 * manda, e o botão de voltar significa "o card anterior" — que é o que se
 * espera de uma grade que se navega clicando.
 */

type AbaDaFrota = "planilha" | "chamados" | "impacto" | "cliente";

const ABAS: AbaDaFrota[] = ["planilha", "chamados", "impacto", "cliente"];

const abaValida = (valor: string | null): valor is AbaDaFrota =>
  valor !== null && (ABAS as string[]).includes(valor);

const ICONE: Record<Equipamento, typeof Tractor> = {
  CAVALO: Tractor,
  CARRETA: Container,
  // O trecho é caminho, e não veículo: o ícone precisa dizer isso à distância,
  // senão a terceira entrada do menu vira o terceiro caminhão da fileira.
  TRECHO: Route,
};

/** Um ativo do seletor, como `/frota/ativos` o entrega. */
interface AtivoDaFrota {
  entityId: string;
  plate: string | null;
  chassi: string | null;
  periods: number;
  firstLabel: string;
  lastLabel: string;
  current: boolean;
}

interface FrotaResponse {
  entityType: string;
  equipment: string;
  entityTypes: string[];
  latestLabel: string | null;
  ativos: AtivoDaFrota[];
}

export default function Frota360({ equipamento }: { equipamento: Equipamento }) {
  const search = useSearch();
  const [caminho, navegar] = useLocation();
  const params = new URLSearchParams(search);
  const pedida = params.get("aba");
  const aba: AbaDaFrota = abaValida(pedida) ? pedida : "planilha";
  const placa = lerPlaca(search);
  /*
    Em que nível a tela está.

    A grade é o padrão, e a leitura de frota exige `?visao=frota` escrito — o
    inverso do que era antes desta versão. Escolher uma placa também sai da
    grade, e por isso a presença de `placa` vence: um link para um ativo abre no
    ativo, mesmo que o `visao` tenha ficado para trás no endereço de quem o
    copiou.
  */
  const naFrotaInteira = params.get("visao") === "frota";
  const naGrade = placa === null && !naFrotaInteira;

  const escopo: EscopoDeFrota = { entityType: equipamento, placa };
  const nivel: NivelDaTela = naGrade ? "grade" : placa !== null ? "ativo" : "frota";
  const { titulo, subtitulo } = frasesDoEscopo(escopo, nivel);
  const Icone = ICONE[equipamento];

  /*
    O recorte de unidade e canal atravessa, como atravessa em Alterações: é a
    mesma base, e trocar de unidade na Visão geral não pode deixar de valer
    porque a pergunta agora é por equipamento. A vigência não atravessa as abas
    que leem a série inteira — a regra é a de `paramsDeAlteracoes`, e ela vale
    igual aqui.
  */
  const recorte = lerRecorte(search);

  /**
   * O De/Até, partilhado por Impacto e Cliente.
   *
   * Mora aqui pela mesma razão que mora em Alterações: as duas abas respondem
   * sobre o mesmo período, e perder o recorte ao trocar de aba faria "quanto
   * isso custou" e "o que pedir ao cliente" falarem de meses diferentes com a
   * mesma cara.
   */
  const [janela, setJanela] = useState<JanelaDeVigencias>({});

  /**
   * O parâmetro que a aba Planilha mandou abrir no Impacto.
   *
   * Mesma travessia de Alterações, e pelo mesmo motivo: quem lê uma alteração
   * quer saber se aquilo vinha acontecendo, e a resposta é a matriz de nove
   * colunas. Fica em estado — não no endereço —, porque é o meio de uma frase que
   * começou na aba ao lado; a aba e a placa continuam viajando na barra, que é
   * onde o assunto da tela mora.
   */
  const [travessia, setTravessia] = useState<AberturaDaMatriz | null>(null);

  /**
   * Trocar de aba ou de placa reescreve o endereço.
   *
   * As duas coisas são o assunto da tela, e por isso viajam na barra: quem
   * manda o link do QYW2D78 na aba Impacto manda as duas escolhas junto, e o
   * botão de voltar desfaz a última. O De/Até não vai — ele é o meio de uma
   * pergunta que começa com a série inteira à vista, e é onde quem chega de
   * fora chega.
   */
  const irPara = (proxima: {
    aba?: AbaDaFrota;
    placa?: string | null;
    /** `true` leva às quatro abas da frota; `false` volta à grade de cards. */
    frotaInteira?: boolean;
    /**
     * Só a travessia da Planilha usa isto.
     *
     * Clicar em "Impacto" na fileira é pedir o começo da leitura, e a escolha
     * que veio de outra aba morre ali; chegar pelo nome de um atributo é pedir
     * justamente aquele parâmetro. Trocar de placa também limpa: a escolha era
     * de uma alteração de outro ativo.
     */
    manterTravessia?: boolean;
  }) => {
    if (!proxima.manterTravessia) setTravessia(null);
    const destino = new URLSearchParams();
    const abaFinal = proxima.aba ?? aba;
    const placaFinal = proxima.placa === undefined ? placa : proxima.placa;
    const frotaFinal = proxima.frotaInteira ?? naFrotaInteira;

    if (abaFinal !== "planilha") destino.set("aba", abaFinal);
    if (placaFinal !== null) destino.set("placa", placaFinal);
    // A leitura de frota só se escreve quando não há placa: as duas são níveis
    // diferentes, e um endereço com as duas afirmaria estar nos dois ao mesmo
    // tempo. Escolher uma placa é sair da frota — e o inverso também.
    if (placaFinal === null && frotaFinal) destino.set("visao", "frota");
    // O recorte de unidade e canal sobrevive à troca; a vigência acompanha
    // apenas a aba que a honra, que é a mesma regra de Alterações.
    for (const [chave, valor] of paramsDoRecorte(recorte, {
      comPeriodo: abaFinal === "planilha",
    })) {
      destino.set(chave, valor);
    }
    navegar(destino.toString() ? `${caminho}?${destino}` : caminho);
  };

  // Só a contagem, para a aba dizer o tamanho do assunto antes de ser aberta —
  // e já dentro do escopo, senão ela anunciaria o arquivo inteiro.
  const resumoChamados = useQuery({
    queryKey: ["tickets", "resumo", equipamento, placa],
    queryFn: () => {
      const consulta = new URLSearchParams({
        limit: "1",
        entityType: equipamento,
      });
      if (placa !== null) consulta.set("placa", placa);
      return fetchJson<{ totals: TicketTotals | null }>(`/tickets?${consulta}`);
    },
  });

  return (
    <Layout>
      <div className="border-b bg-card px-8 pt-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Icone className="w-6 h-6 text-primary" />
          {titulo}
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">{subtitulo}</p>

        {/*
          Na grade, o cabeçalho para aqui: o seletor do ativo e as abas
          pertencem a uma leitura que ainda não foi escolhida. Mostrá-los sobre
          os cards ofereceria duas portas para o mesmo lugar — e uma fileira de
          abas sem assunto definido é a que faz alguém clicar em "Planilha"
          esperando o cavalo e receber a frota.
        */}
        {!naGrade && (
          <>
            <div className="mt-4">
              <SeletorDoAtivo
                equipamento={equipamento}
                placa={placa}
                recorte={paramsDoRecorte(recorte, { comPeriodo: false })}
                onEscolher={(proxima) => irPara({ placa: proxima })}
                onVoltarAosCards={() => irPara({ placa: null, frotaInteira: false })}
              />
            </div>

            <nav className="flex items-center gap-1 mt-4" role="tablist">
          <AbaBotao
            active={aba === "planilha"}
            onClick={() => irPara({ aba: "planilha" })}
            icon={<FileSpreadsheet className="w-4 h-4" />}
            label="Planilha"
            hint="o que a Ambev mexeu entre duas vigências"
          />
          <AbaBotao
            active={aba === "chamados"}
            onClick={() => irPara({ aba: "chamados" })}
            icon={<Headset className="w-4 h-4" />}
            label="Chamados"
            hint="o que pedimos e o que voltou aplicado"
            count={resumoChamados.data?.totals?.changes}
          />
          <AbaBotao
            active={aba === "impacto"}
            onClick={() => irPara({ aba: "impacto" })}
            icon={<DollarSign className="w-4 h-4" />}
            label="Impacto"
            hint="quanto custa em cada quinzena"
          />
          <AbaBotao
            active={aba === "cliente"}
            onClick={() => irPara({ aba: "cliente" })}
            icon={<Handshake className="w-4 h-4" />}
            label="Cliente"
              hint="o que propor, o que investigar, e o que não levar"
            />
            </nav>
          </>
        )}
      </div>

      {naGrade && (
        <div className="p-8">
          <CardsDaFrota
            equipamento={equipamento}
            contexto={paramsDoRecorte(recorte, { comPeriodo: false })}
            periodo={recorte.period}
            onAbrir={(proxima) => irPara({ placa: proxima, aba: "planilha" })}
            onVerFrotaInteira={() =>
              irPara({ frotaInteira: true, aba: "planilha" })
            }
            onPeriodo={(period) => {
              const destino = new URLSearchParams(search);
              destino.set("period", period);
              navegar(`${caminho}?${destino}`);
            }}
          />
        </div>
      )}

      {!naGrade && aba === "planilha" && (
        <AbaPlanilha
          escopo={escopo}
          onVerQuinzenas={(alvo) => {
            setTravessia(alvo);
            irPara({ aba: "impacto", manterTravessia: true });
          }}
        />
      )}
      {!naGrade && aba === "chamados" && (
        <AbaChamados escopo={escopo} somenteLeitura />
      )}
      {!naGrade && aba === "impacto" && (
        <div className="p-8">
          <ImpactoQuinzenas
            contexto={paramsDoRecorte(recorte, { comPeriodo: false })}
            escolhaInicial={travessia}
            janela={janela}
            onJanela={setJanela}
            escopo={escopo}
            // A matriz é montada por ativo: trocar de placa é trocar a
            // população, e remontar é mais honesto do que reaproveitar o
            // estado interno de uma tabela que era de outro veículo. O
            // parâmetro da travessia entra na chave pela mesma razão — ele é
            // estado inicial, e um estado inicial só é lido na montagem.
            key={`${placa ?? "frota"}:${travessia?.code ?? ""}`}
          />
        </div>
      )}
      {!naGrade && aba === "cliente" && (
        <div className="p-8">
          <ClienteRecomendacoes
            janela={janela}
            onJanela={setJanela}
            escopo={escopo}
          />
        </div>
      )}
    </Layout>
  );
}

/**
 * A escolha do ativo — o segundo nível da tela.
 *
 * Um `datalist` sobre um campo de texto, e não um `select`: a frota real tem 64
 * cavalos e 80 carretas, e quem procura uma placa a **sabe** — digitar três
 * caracteres é mais rápido do que rolar oitenta linhas. O campo aceita o que
 * não está na lista sem reclamar, e a resposta de cada aba diz o que aplicou;
 * um ativo que este contexto não tem volta à frota inteira, com a aba Impacto
 * escrevendo que voltou.
 *
 * A lista sai de `/frota/ativos`, e não das alterações: uma frota montada a
 * partir do que mudou esconderia justamente o ativo parado — que existe, é
 * remunerado, e é sobre ele que a pergunta "por que este cavalo não mudou?"
 * costuma ser feita.
 *
 * **O rótulo do campo é do tipo, e o parâmetro não.** Em Trecho 360° ele diz
 * "Trecho", porque pedir uma "Placa" numa tela de rotas é pedir um dado que a
 * linha não tem; o endereço continua escrevendo `?placa=`, que é a chave de
 * grão que o pipeline promove a identificador em qualquer aba. O nome de dentro
 * é do mecanismo, o de fora é de quem lê — e é o de fora que precisa ser
 * verdade.
 */
function SeletorDoAtivo({
  equipamento,
  placa,
  recorte,
  onEscolher,
  onVoltarAosCards,
}: {
  equipamento: Equipamento;
  placa: string | null;
  recorte: URLSearchParams;
  onEscolher: (placa: string | null) => void;
  /** A volta para a grade — o nível de onde se chegou aqui. */
  onVoltarAosCards: () => void;
}) {
  const [rascunho, setRascunho] = useState(placa ?? "");
  const tela = TELA_DO_EQUIPAMENTO[equipamento];

  const query = useQuery({
    queryKey: ["frota", "ativos", equipamento, recorte.toString()],
    queryFn: () => {
      const consulta = new URLSearchParams(recorte);
      consulta.set("entityType", equipamento);
      return fetchJson<FrotaResponse>(`/frota/ativos?${consulta}`);
    },
  });

  const ativos = query.data?.ativos ?? [];
  const naFrota = ativos.filter((a) => a.current).length;

  /*
    O equipamento existe neste contexto? Um export que só trouxe carretas abre
    Cavalo 360° com tudo vazio, e sem esta frase a tela se leria como "a frota
    de cavalos acabou". A diferença entre arquivo que não chegou e frota que
    sumiu é a mesma que a aba Impacto protege célula a célula.
  */
  const semEquipamento =
    query.data !== undefined && !query.data.entityTypes.includes(equipamento);

  if (query.error) {
    return (
      <ApiErrorNotice
        error={query.error}
        what={`A frota de ${tela.plural} não pôde ser carregada.`}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Search className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">{tela.identificador}</span>
          <input
            list="frota-360-placas"
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value.toUpperCase())}
            onBlur={() => aplicar(rascunho, placa, onEscolher)}
            onKeyDown={(e) => {
              if (e.key === "Enter") aplicar(rascunho, placa, onEscolher);
              if (e.key === "Escape") setRascunho(placa ?? "");
            }}
            placeholder={todosOsPlural(tela)}
            className="h-9 w-48 rounded-lg border border-input bg-background px-3 font-mono text-sm"
          />
          <datalist id="frota-360-placas">
            {ativos.map((a) =>
              a.plate === null ? null : (
                <option key={a.entityId} value={a.plate}>
                  {a.current
                    ? `${a.periods} vigências`
                    : `saiu da frota em ${a.lastLabel}`}
                </option>
              ),
            )}
          </datalist>
        </label>

        {/*
          A volta é sempre para a grade, e não para a leitura de frota: foi de
          um card que se chegou aqui, e devolver alguém à lista de alterações de
          todos os ativos seria trocar a tela em vez de subir um nível.
        */}
        <button
          onClick={() => {
            setRascunho("");
            onVoltarAosCards();
          }}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          <X className="w-4 h-4" />
          voltar {aoPlural(tela)}
        </button>

        {/*
          As outras telas 360°, a um clique. O conjunto é que é remunerado, e
          quem está conferindo um cavalo costuma querer a carreta em seguida —
          e quem confere os dois costuma querer o trecho que eles rodam, porque
          é lá que mora a outra metade do que se paga.

          Eram um `Link` e um ternário enquanto eram duas telas. O ternário não
          sobrevive à terceira: ele escolheria uma das outras duas e esconderia
          a outra sem dizer.
        */}
        <div className="ml-auto flex items-center gap-3">
          {outrasTelas(equipamento).map((outra) => (
            <Link
              key={outra}
              href={TELA_DO_EQUIPAMENTO[outra].href}
              className={cn(
                "text-sm text-muted-foreground hover:text-foreground",
                "underline-offset-2 hover:underline",
              )}
            >
              ver {TELA_DO_EQUIPAMENTO[outra].plural}
            </Link>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {semEquipamento ? (
          <>
            Nenhuma vigência deste recorte entregou {tela.plural}. A tela está
            vazia porque o arquivo não chegou — não porque a frota sumiu.
          </>
        ) : query.data ? (
          <>
            {naFrota.toLocaleString("pt-BR")} {tela.plural} na vigência{" "}
            {query.data.latestLabel ?? "mais recente"}
            {ativos.length > naFrota && (
              <>
                {" "}
                · {(ativos.length - naFrota).toLocaleString("pt-BR")} que já
                saíram continuam pesquisáveis
              </>
            )}
          </>
        ) : (
          "Lendo a frota…"
        )}
      </p>
    </div>
  );
}

/**
 * O que fazer com o que foi digitado.
 *
 * Vazio é a frota, e não "nada": quem apagou a placa pediu para subir um nível.
 * Igual ao que já estava não navega — sem isto, sair do campo empilharia uma
 * entrada de histórico idêntica à anterior, e o botão de voltar deixaria de
 * significar "a placa anterior".
 */
function aplicar(
  rascunho: string,
  atual: string | null,
  onEscolher: (placa: string | null) => void,
): void {
  const limpo = rascunho.trim().toUpperCase();
  const proxima = limpo === "" ? null : limpo;
  if (proxima !== atual) onEscolher(proxima);
}
