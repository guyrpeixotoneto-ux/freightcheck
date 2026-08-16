import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Descobertas } from "@/components/cobertura/descobertas";
import {
  DetalheDaCelulaPainel,
  DetalheDaLacunaPainel,
} from "@/components/cobertura/detalhe";
import { Lacunas } from "@/components/cobertura/lacunas";
import { Matriz } from "@/components/cobertura/matriz";
import { MedicaoIncompleta, Resumo } from "@/components/cobertura/resumo";
import type {
  CelulaDaMatriz,
  Criticidade,
  Lacuna,
  VisaoDaCobertura,
} from "@/components/cobertura/tipos";
import { fetchJson } from "@/lib/api";
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
  const [celula, setCelula] = useState<{ snapshotId: string; entityType: string } | null>(null);
  const [lacuna, setLacuna] = useState<{ snapshotId: string; attributeCode: string } | null>(
    null,
  );
  const [avancados, setAvancados] = useState(false);
  const clienteDeConsultas = useQueryClient();

  const consulta = useQuery({
    queryKey: ["coverage", vigencias, criticidade, equipamento],
    queryFn: () => {
      const query = new URLSearchParams({ vigencias: String(vigencias) });
      if (criticidade !== "TODAS") query.set("criticidade", criticidade);
      if (equipamento !== "TODOS") query.set("equipamento", equipamento);
      return fetchJson<VisaoDaCobertura>(`/coverage?${query}`);
    },
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
        <h1 className="text-3xl font-bold uppercase tracking-tight">Cobertura de dados</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-4xl">
          O que já temos versus o que deveríamos ter, consolidando todas as importações. O que
          entrou está em{" "}
          <a href="/importacoes" className="text-brand hover:underline">
            Importações
          </a>
          ; o que chegou com problema, em Qualidade de dados.
        </p>

        {consulta.isLoading && (
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
            <strong>Nenhuma vigência importada ainda.</strong> Não há cobertura a medir — a
            primeira planilha promovida abre esta tela.{" "}
            <a href="/importacoes" className="text-brand font-semibold hover:underline">
              Enviar a primeira
            </a>
            .
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
              nesta janela, e nenhuma delas traz o equipamento escolhido. Volte o filtro para
              "todos" ou amplie a janela de vigências.
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
              selecionada={celula}
              aoSelecionar={(c: CelulaDaMatriz) => {
                setLacuna(null);
                setCelula(
                  celula?.snapshotId === c.vigencia.snapshotId &&
                    celula.entityType === c.entityType
                    ? null
                    : { snapshotId: c.vigencia.snapshotId, entityType: c.entityType },
                );
              }}
            />

            {celula && (
              <DetalheDaCelulaPainel
                snapshotId={celula.snapshotId}
                entityType={celula.entityType}
                aoFechar={() => {
                  setCelula(null);
                  setLacuna(null);
                }}
                aoAbrirLacuna={(l: Lacuna) =>
                  setLacuna({ snapshotId: l.snapshotId, attributeCode: l.attributeCode })
                }
              />
            )}

            {lacuna && (
              <DetalheDaLacunaPainel
                snapshotId={lacuna.snapshotId}
                attributeCode={lacuna.attributeCode}
                aoFechar={() => setLacuna(null)}
              />
            )}

            {/*
              As lacunas gerais ficam escondidas enquanto uma célula está aberta:
              o painel da célula já traz as dela, e as duas listas ao mesmo tempo
              fariam a mesma lacuna aparecer duas vezes com contagens diferentes
              de contexto.
            */}
            {!celula && (
              <Lacunas
                lacunas={consulta.data.lacunas}
                aoAbrir={(l: Lacuna) =>
                  setLacuna({ snapshotId: l.snapshotId, attributeCode: l.attributeCode })
                }
              />
            )}

            <Descobertas descobertas={consulta.data.descobertas} />
          </>
        )}
      </div>
    </Layout>
  );
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
          Unidade, canal, família, atributo e entidade são investigados pelo drill-down: clique na
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
