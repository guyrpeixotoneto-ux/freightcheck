import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Descobertas } from "@/components/cobertura/descobertas";
import { DetalheDaCelulaPainel } from "@/components/cobertura/detalhe";
import { GavetaDoAtributo } from "@/components/cobertura/gaveta";
import { Lacunas } from "@/components/cobertura/lacunas";
import { Matriz } from "@/components/cobertura/matriz";
import { MedicaoIncompleta, Resumo } from "@/components/cobertura/resumo";
import type {
  AberturaDoAtributo,
  CelulaDaMatriz,
  Criticidade,
  Lacuna,
  LinhaDaMatriz,
  VisaoDaCobertura,
} from "@/components/cobertura/tipos";
import { fetchJson } from "@/lib/api";
import { escopoDaCobertura, paramsDaCobertura } from "@/lib/cobertura";
import { useContextosDaCasca } from "@/lib/contextos";
import { enderecoDeVisaoGeral } from "@/lib/navegacao-do-escopo";
import { nomeDaUnidade } from "@/lib/recorte";
import { cn } from "@/lib/utils";

/**
 * Cobertura de dados.
 *
 * Esta tela responde uma pergunta e as consequências dela:
 *
 *   > Temos todos os dados necessários para confiar nesta análise?
 *
 * E, quando a resposta é não: o que falta, onde falta, desde quando falta, por
 * que acreditamos que falta, qual análise isso afeta e de qual arquivo o dado
 * veio ou viria.
 *
 * **A tela é de uma unidade — a que a lateral nomeia.** Não era: `/coverage` ia
 * sem recorte e a matriz voltava com o acervo inteiro, cinco unidades uma
 * embaixo da outra, enquanto a caixa "Unidade atual" ao lado escrevia
 * PERNAMBUCO. Os 89,7% eram verdade sobre uma população que a tela não
 * nomeava, e o nome ao lado deles era de outra. O recorte agora sai do endereço
 * e, na falta dele, da mesma `contextoAberto` que a lateral usa (ver
 * `lib/cobertura.ts`); a soma continua existindo e passou a ser pedida por
 * escrito, com `visaoGeral=1`.
 *
 * **A tela não calcula nada.** Uma única chamada a `/coverage` traz resumo,
 * matriz, lacunas e descobertas já medidos e já classificados por
 * `@workspace/coverage`, que é a autoridade do produto sobre cobertura. A
 * versão anterior desta tela fazia o oposto: consultava `/changes/families` uma
 * vez por contexto e somava nomes de parâmetro no navegador, o que a tornava a
 * única definição de cobertura que o FreightCheck tinha — e uma que nenhuma
 * outra superfície, nem o Assistente, conseguia repetir.
 *
 * **Arquivo não é unidade de cobertura; dado é.** Por isso não há aqui tabela
 * de importações. Ela existe, completa, em Importações, que responde outra
 * pergunta: *o que entrou?*. Esta responde *o que já temos versus o que
 * deveríamos ter*, e as duas juntas na mesma tela foi o que fez a versão
 * anterior parecer um inventário do que chegou.
 *
 * **A ordem é resumo → matriz → exceções → detalhe.** Primeiro "está tudo
 * coberto?", depois "onde tem problema?", depois "o que exatamente falta?" e só
 * então "por que acreditamos nisso e de onde veio o dado?". Cada degrau abaixo
 * do segundo só carrega depois de um clique.
 *
 * **Matriz vazia tem duas causas, e a tela precisa saber qual.** `linhas` vazia
 * significava, aqui, "nenhuma vigência importada ainda" — e significava isso
 * mesmo quando a resposta trazia `incompleto` cheio, que é o caso oposto:
 * vigência importada e sem agregado para medir. Foi o que a tela mostrou, com o
 * seletor de unidade ao lado exibindo a vigência de ago/2026 que ela dizia não
 * existir, e mandando enviar a primeira planilha para consertar. `incompleto` é
 * o que separa as duas, e ele nunca mais fica escondido atrás de `linhas`.
 */
export default function Dados() {
  const [vigencias, setVigencias] = useState(6);
  const [criticidade, setCriticidade] = useState<Criticidade | "TODAS">("TODAS");
  const [equipamento, setEquipamento] = useState<string>("TODOS");
  /*
    A célula aberta guarda também a chave da linha dela.

    Ela é o que liga o painel de detalhe de volta à matriz: "ver os atributos
    deste conjunto" precisa dizer **qual** linha explodir, e a linha é
    (família · equipamento · escopo · canal), não a vigência. Derivar isso do
    `snapshotId` obrigaria a tela a reabrir a resposta para descobrir a que
    linha a célula pertencia — informação que ela já tinha na mão no clique.
  */
  const [celula, setCelula] = useState<{
    snapshotId: string;
    entityType: string;
    linhaChave: string;
  } | null>(null);
  /** A linha aberta por dentro — uma de cada vez, pela chave da linha. */
  const [atributosDe, setAtributosDe] = useState<string | null>(null);
  /*
    O atributo aberto na gaveta.

    Um estado só para os três caminhos que chegam nela — a célula da tabela de
    atributos, a lista de lacunas e a lista de lacunas de dentro do painel da
    célula. Três estados dariam três gavetas capazes de abrir ao mesmo tempo,
    sobre a mesma tela, dizendo coisas diferentes.
  */
  const [atributo, setAtributo] = useState<AberturaDoAtributo | null>(null);
  const [avancados, setAvancados] = useState(false);
  const clienteDeConsultas = useQueryClient();

  /*
    De quem é esta tela — ver `lib/cobertura.ts`.

    A medição segue a unidade aberta na lateral, e não o acervo inteiro: o
    endereço manda quando traz `scopeHash`, e quando não traz vale a mesma
    `contextoAberto` que a caixa "Unidade atual" usa para se escrever. Era a
    peça que faltava, e a falta aparecia como contradição: cinco unidades na
    matriz debaixo do nome de uma.
  */
  const search = useSearch();
  const [pathname] = useLocation();
  const { contextos, carregando: carregandoContextos } = useContextosDaCasca();
  const escopo = escopoDaCobertura({
    contextos,
    carregando: carregandoContextos,
    pathname,
    search,
  });
  const unidade = escopo.contexto ? nomeDaUnidade(escopo.contexto) : null;

  const consulta = useQuery({
    /*
      O recorte entra na chave, e antes das opções da tela.

      Sem ele, trocar de unidade devolveria do cache a medição da anterior — a
      chave *é* a identidade da consulta no React Query, e duas populações sob a
      mesma chave são uma só para ele.
    */
    queryKey: [
      "coverage",
      escopo.visaoGeral ? "todas" : (escopo.contexto?.scopeHash ?? null),
      escopo.contexto?.channel ?? null,
      vigencias,
      criticidade,
      equipamento,
    ],
    queryFn: () =>
      fetchJson<VisaoDaCobertura>(
        `/coverage?${paramsDaCobertura(escopo, { vigencias, criticidade, equipamento })}`,
      ),
    /* Medir antes de saber de quem mostraria o acervo e depois se corrigiria. */
    enabled: !escopo.indefinido,
    retry: false,
  });

  /*
    Os equipamentos do filtro saem da própria resposta, e não de uma lista
    escrita aqui. CAVALO e CARRETA são o que a Ambev exporta hoje; o dia em que
    aparecer um terceiro, ele entra no filtro sozinho — que é a mesma razão de
    `entity_type` ser texto no banco e não enum.
  */
  const equipamentos = useMemo(() => {
    const daResposta = consulta.data?.linhas.map((l) => l.entityType) ?? [];
    /*
      O escolhido entra na lista mesmo quando a resposta não o traz. Filtrar por
      um equipamento que a janela não tem devolve zero linhas — e, sem esta
      linha, a opção selecionada sumiria do próprio `select` que a selecionou,
      deixando o campo em branco e sem caminho de volta.
    */
    if (equipamento !== "TODOS") daResposta.push(equipamento);
    return [...new Set(daResposta)].sort();
  }, [consulta.data, equipamento]);

  /*
    Refazer a medição — a única escrita desta tela, e por pedido explícito.

    A rota é `POST` de propósito (ver `/coverage/aggregate/rebuild`): recontar
    dentro do `GET` faria uma tela de consulta escrever no banco sem que ninguém
    pedisse, que é a regra que este módulo já segue para semear o contrato.
  */
  const refazer = useMutation({
    mutationFn: () =>
      fetchJson<{ vigencias: number; linhas: number; rotulos: string[] }>(
        "/coverage/aggregate/rebuild",
        { method: "POST" },
      ),
    onSuccess: () => clienteDeConsultas.invalidateQueries({ queryKey: ["coverage"] }),
  });

  const incompleto = consulta.data?.incompleto ?? [];
  const semMedicao = consulta.data !== undefined && consulta.data.linhas.length === 0;
  /*
    `colunas` é a lista de vigências da janela, e ela não passa pelo filtro de
    equipamento — por isso serve de testemunha: vazia significa que não há
    vigência nenhuma, e é o único caso em que "nenhuma vigência importada" é
    verdade. Com coluna e sem linha, ou a medição sumiu ou o filtro excluiu
    tudo, e nenhuma das duas se resolve importando planilha.
  */
  const semVigencia = (consulta.data?.colunas.length ?? 0) === 0;

  return (
    <Layout>
      <div className="px-10 py-6 max-w-[1600px]">
        <h1 className="text-3xl font-bold uppercase tracking-tight">
          Cobertura de dados
          {escopo.visaoGeral ? " — Todas as unidades" : unidade ? ` — ${unidade}` : ""}
        </h1>
        {/*
          O recorte é dito no cabeçalho, e não deduzido da caixa da lateral.

          Os números desta tela — cobertura geral, lacunas, conjuntos parciais —
          são de uma população, e uma tela que não a nomeia deixa quem lê supor
          qual é. Enquanto a medição era do acervo inteiro, a suposição natural
          era a unidade escrita ao lado, e ela estava errada.
        */}
        <p className="text-sm text-muted-foreground mt-1 max-w-4xl">
          O que já temos versus o que deveríamos ter{" "}
          {escopo.visaoGeral ? (
            <>somando todas as unidades com vigência importada</>
          ) : unidade !== null ? (
            <>
              em <span className="font-semibold text-foreground">{unidade}</span>
              {escopo.contexto?.channel ? ` · ${escopo.contexto.channel}` : ""}
            </>
          ) : (
            <>no acervo inteiro</>
          )}
          . O que entrou está em{" "}
          <Link href="/importacoes" className="text-brand hover:underline">
            Importações
          </Link>
          ; o que chegou com problema, em Qualidade de dados.
          {/*
            A soma é um link, e não um segundo seletor de unidade: quem quer
            outra unidade usa o da lateral, que é o único lugar onde essa
            pergunta é feita (ver `sidebar.tsx`). O caminho de volta é ele
            mesmo — por isso aqui só existe a ida.
          */}
          {!escopo.visaoGeral && contextos.length > 1 && (
            <>
              {" "}
              <Link
                href={enderecoDeVisaoGeral(pathname, search)}
                className="text-brand hover:underline"
              >
                Ver todas as unidades
              </Link>
              .
            </>
          )}
        </p>

        {(consulta.isLoading || escopo.indefinido) && (
          <p className="mt-8 text-sm text-muted-foreground">Medindo a cobertura…</p>
        )}

        {consulta.isError && (
          <ApiErrorNotice error={consulta.error} what="a cobertura de dados" />
        )}

        {/*
          Nada importado — o único caso em que esta frase é verdadeira, e por
          isso ela agora depende de `colunas` e não de `linhas`.
        */}
        {semMedicao && semVigencia && (
          <div className="mt-8 bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
            {/*
              A frase é sobre a população medida, e a população mudou.

              "Nenhuma vigência importada ainda" era afirmação sobre o acervo, e
              continuar dizendo isso numa tela recortada por unidade seria
              anunciar um acervo vazio por causa de uma unidade que ainda não
              entregou planilha — com as outras quatro cheias, a um clique.
            */}
            {unidade !== null && !escopo.visaoGeral ? (
              <>
                <strong>Nenhuma vigência importada em {unidade}.</strong> Não há cobertura a
                medir nesta unidade.{" "}
                {contextos.length > 1 && (
                  <>
                    <Link
                      href={enderecoDeVisaoGeral(pathname, search)}
                      className="text-brand font-semibold hover:underline"
                    >
                      Ver todas as unidades
                    </Link>{" "}
                    ou{" "}
                  </>
                )}
                <Link href="/importacoes" className="text-brand font-semibold hover:underline">
                  enviar a planilha dela
                </Link>
                .
              </>
            ) : (
              <>
                <strong>Nenhuma vigência importada ainda.</strong> Não há cobertura a medir — a
                primeira planilha promovida abre esta tela.{" "}
                <Link href="/importacoes" className="text-brand font-semibold hover:underline">
                  Enviar a primeira
                </Link>
                .
              </>
            )}
          </div>
        )}

        {/*
          Há vigência, e o filtro não deixou nada dela de pé.

          Os filtros vêm junto, e não só a explicação: eles moram dentro do
          ramo da matriz, então dizer "volte o filtro para todos" sem trazê-los
          apontaria para um controle que a tela não está mostrando.
        */}
        {semMedicao && !semVigencia && incompleto.length === 0 && (
          <>
            <div className="mt-8 bg-card border border-l-[6px] border-l-border px-6 py-4 text-sm">
              <strong>Nenhuma vigência atende a este filtro.</strong> Há{" "}
              {consulta.data!.colunas.length === 1
                ? "uma vigência importada"
                : `${consulta.data!.colunas.length} vigências importadas`}{" "}
              nesta janela{unidade !== null && !escopo.visaoGeral ? ` em ${unidade}` : ""}, e
              nenhuma delas traz o equipamento escolhido. Volte o filtro para "todos" ou amplie
              a janela de vigências.
            </div>

            <Filtros
              vigencias={vigencias}
              setVigencias={setVigencias}
              criticidade={criticidade}
              setCriticidade={setCriticidade}
              equipamento={equipamento}
              setEquipamento={setEquipamento}
              equipamentos={equipamentos}
              avancados={avancados}
              setAvancados={setAvancados}
            />
          </>
        )}

        {semMedicao && incompleto.length > 0 && (
          <MedicaoIncompleta
            incompleto={incompleto}
            tudo
            aoRefazer={() => refazer.mutate()}
            refazendo={refazer.isPending}
            erro={refazer.error ? refazer.error.message : null}
            desfecho={refazer.data ?? null}
          />
        )}

        {consulta.data && consulta.data.linhas.length > 0 && (
          <>
            <Resumo resumo={consulta.data.resumo} />
            <MedicaoIncompleta
              incompleto={incompleto}
              aoRefazer={() => refazer.mutate()}
              refazendo={refazer.isPending}
              erro={refazer.error ? refazer.error.message : null}
              desfecho={refazer.data ?? null}
            />

            <Filtros
              vigencias={vigencias}
              setVigencias={setVigencias}
              criticidade={criticidade}
              setCriticidade={setCriticidade}
              equipamento={equipamento}
              setEquipamento={setEquipamento}
              equipamentos={equipamentos}
              avancados={avancados}
              setAvancados={setAvancados}
            />

            <Matriz
              colunas={consulta.data.colunas}
              linhas={consulta.data.linhas}
              vigencias={vigencias}
              selecionada={celula}
              aoSelecionar={(c: CelulaDaMatriz) => {
                setAtributo(null);
                setCelula(
                  celula?.snapshotId === c.vigencia.snapshotId &&
                    celula.entityType === c.entityType
                    ? null
                    : {
                        snapshotId: c.vigencia.snapshotId,
                        entityType: c.entityType,
                        linhaChave: `${c.datasetFamily}|${c.entityType}|${c.scopeHash}|${c.canal}`,
                      },
                );
              }}
              expandida={atributosDe}
              aoExpandir={(l: LinhaDaMatriz) =>
                setAtributosDe(atributosDe === l.chave ? null : l.chave)
              }
              aoAbrirAtributo={setAtributo}
            />

            {celula && (
              <DetalheDaCelulaPainel
                snapshotId={celula.snapshotId}
                entityType={celula.entityType}
                atributosAbertos={atributosDe === celula.linhaChave}
                aoVerAtributos={() => {
                  const chave = celula.linhaChave;
                  setAtributosDe(atributosDe === chave ? null : chave);
                  /*
                    A matriz fica acima do painel, e explodir uma linha que ficou
                    fora da tela é o mesmo que não explodir nada. O `scroll` é o
                    que faz o botão parecer ter feito alguma coisa.
                  */
                  if (atributosDe !== chave) {
                    document
                      .getElementById("matriz-de-cobertura")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                aoFechar={() => {
                  setCelula(null);
                  setAtributo(null);
                }}
                aoAbrirLacuna={(l: Lacuna) => setAtributo(aberturaDe(l))}
              />
            )}

            {/*
              As lacunas gerais ficam escondidas enquanto uma célula está aberta:
              o painel da célula já traz as dela, e as duas listas ao mesmo tempo
              fariam a mesma lacuna aparecer duas vezes com contagens diferentes
              de contexto.
            */}
            {!celula && (
              <Lacunas lacunas={consulta.data.lacunas} aoAbrir={(l: Lacuna) => setAtributo(aberturaDe(l))} />
            )}

            <Descobertas descobertas={consulta.data.descobertas} />

            <GavetaDoAtributo abertura={atributo} aoFechar={() => setAtributo(null)} />
          </>
        )}
      </div>
    </Layout>
  );
}

/**
 * Uma lacuna, na forma que a gaveta abre.
 *
 * Só identidade: a gaveta pede os números ao servidor, e é isso que faz o
 * painel aberto pela lista de lacunas e o painel aberto pela célula da tabela
 * mostrarem a mesma medida. Passar aqui os números que a lacuna já traz seria
 * mais rápido e criaria a chance de a gaveta discordar de si mesma conforme o
 * caminho por onde foi aberta.
 */
function aberturaDe(lacuna: Lacuna): AberturaDoAtributo {
  return {
    snapshotId: lacuna.snapshotId,
    attributeCode: lacuna.attributeCode,
    attributeLabel: lacuna.attributeLabel,
    periodo: lacuna.periodo,
  };
}

/**
 * Os filtros: três à vista, o resto atrás de um clique.
 *
 * A tela precisa permitir investigar por vigência, família, equipamento,
 * entidade, atributo, escopo, origem, estado e criticidade — e mostrar as nove
 * caixas de uma vez transformaria a primeira dobra numa parede de controles.
 * Ficam à vista os três que mudam a leitura de quase todo mundo; os demais
 * chegam pelo drill-down, que é onde a pergunta específica nasce.
 */
function Filtros({
  vigencias,
  setVigencias,
  criticidade,
  setCriticidade,
  equipamento,
  setEquipamento,
  equipamentos,
  avancados,
  setAvancados,
}: {
  vigencias: number;
  setVigencias: (n: number) => void;
  criticidade: Criticidade | "TODAS";
  setCriticidade: (c: Criticidade | "TODAS") => void;
  equipamento: string;
  setEquipamento: (e: string) => void;
  equipamentos: string[];
  avancados: boolean;
  setAvancados: (v: boolean) => void;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-3">
      <Campo rotulo="Vigências">
        <select
          className="border bg-card px-2 py-1 text-sm"
          value={vigencias}
          onChange={(e) => setVigencias(Number(e.target.value))}
        >
          {[3, 6, 12, 24].map((n) => (
            <option key={n} value={n}>
              últimas {n}
            </option>
          ))}
        </select>
      </Campo>

      <Campo rotulo="Equipamento">
        <select
          className="border bg-card px-2 py-1 text-sm"
          value={equipamento}
          onChange={(e) => setEquipamento(e.target.value)}
        >
          <option value="TODOS">todos</option>
          {equipamentos.map((t) => (
            <option key={t} value={t}>
              {t.toLowerCase()}
            </option>
          ))}
        </select>
      </Campo>

      <Campo rotulo="Criticidade das lacunas">
        <select
          className="border bg-card px-2 py-1 text-sm"
          value={criticidade}
          onChange={(e) => setCriticidade(e.target.value as Criticidade | "TODAS")}
        >
          <option value="TODAS">todas</option>
          <option value="CRITICO">só críticas</option>
          <option value="RELEVANTE">críticas e relevantes</option>
        </select>
      </Campo>

      <button
        type="button"
        onClick={() => setAvancados(!avancados)}
        className="text-xs text-muted-foreground hover:text-foreground underline"
        aria-expanded={avancados}
      >
        {avancados ? "Ocultar filtros avançados" : "Filtros avançados"}
      </button>

      {avancados && (
        <p className={cn("basis-full text-xs text-muted-foreground max-w-4xl")}>
          Unidade e canal não são filtros desta fileira: eles vêm do seletor da lateral, que é o
          único lugar do produto onde essa pergunta é feita — e a soma de todas está no link do
          cabeçalho. Família, atributo e entidade são investigados pelo drill-down: clique na
          célula da matriz para descer ao conjunto, e na lacuna para chegar às placas. É onde a
          pergunta específica nasce, e onde ela tem contexto para ser respondida — um filtro de
          atributo aqui em cima exigiria escolher entre 138 nomes antes de saber qual procurar.
        </p>
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </span>
      {children}
    </label>
  );
}
