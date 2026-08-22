import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  APARENCIA,
  numero,
  ORIGEM_DO_ESPERADO,
  percentual,
  type AberturaDoAtributo,
  type CelulaDoAtributo,
  type ColunaDaMatriz,
  type ColunaDoConjunto,
  type LinhaDaMatriz,
  type LinhaDeAtributo,
  type MatrizDeAtributos,
} from "./tipos";

/**
 * A linha da matriz explodida: uma linha por atributo, a mesma coluna por
 * vigência.
 *
 * O degrau que faltava. A matriz diz "Remuneração · Cavalo está em 88,1% em
 * Jun, Jul e Ago"; a célula diz "faltam 17 combinações e 1 crítica em Jun".
 * Nenhuma das duas responde a pergunta seguinte, que é sempre a mesma: **o quê**
 * está faltando, e é o mesmo atributo nos três meses ou três atributos se
 * revezando? Um mesmo campo ausente desde junho é um problema de origem; três
 * campos diferentes em três meses é um problema de processo — e a matriz
 * mostrava os dois exatamente igual.
 *
 * **As linhas nascem dentro da mesma `<table>` da matriz.** Não é detalhe de
 * implementação: é o que faz a coluna de Jul/26 do atributo cair exatamente
 * embaixo da coluna de Jul/26 do conjunto. Um painel à parte, com a sua própria
 * tabela, precisaria repetir os cabeçalhos e ainda assim desalinharia na
 * primeira vigência com rótulo mais comprido.
 *
 * **Ninguém carrega isto sem pedir.** São até 138 atributos por conjunto, e a
 * consulta só sai quando alguém abre a linha — a mesma regra do resto do
 * drill-down desta tela.
 */
export function AtributosDaLinha({
  linha,
  colunas,
  vigencias,
  aoAbrirAtributo,
}: {
  linha: LinhaDaMatriz;
  colunas: ColunaDaMatriz[];
  vigencias: number;
  aoAbrirAtributo: (abertura: AberturaDoAtributo) => void;
}) {
  const [recorte, setRecorte] = useState<"TODOS" | "FALTA" | "CRITICOS">("TODOS");
  const [mostrarTudo, setMostrarTudo] = useState(false);

  const consulta = useQuery({
    queryKey: [
      "coverage",
      "attributes",
      linha.datasetFamily,
      linha.entityType,
      linha.scopeHash,
      linha.canal,
      vigencias,
    ],
    queryFn: () => {
      const query = new URLSearchParams({
        familia: linha.datasetFamily,
        equipamento: linha.entityType,
        escopo: linha.scopeHash,
        vigencias: String(vigencias),
      });
      if (linha.canal) query.set("canal", linha.canal);
      return fetchJson<MatrizDeAtributos>(`/coverage/attributes?${query}`);
    },
    retry: false,
  });

  const colspan = colunas.length + 1;

  if (consulta.isLoading) {
    return (
      <tr className="border-b bg-muted/20">
        <td colSpan={colspan} className="px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            Abrindo os atributos de {linha.rotulo}…
          </span>
        </td>
      </tr>
    );
  }

  if (consulta.isError || !consulta.data) {
    return (
      <tr className="border-b bg-muted/20">
        <td colSpan={colspan} className="px-4 py-3 text-xs text-brand-red">
          Não foi possível abrir os atributos deste conjunto. A matriz acima continua válida.
        </td>
      </tr>
    );
  }

  const { linhas, resumo } = consulta.data;
  /*
    As colunas vêm da resposta, e não da matriz de cima, porque só a resposta
    sabe qual vigência **deste conjunto** cai em cada período — que é o que
    permite abrir a gaveta a partir de uma célula em traço. As chaves são as
    mesmas dos dois lados; o servidor calcula a janela pela mesma regra.
  */
  const colunasDoConjunto = consulta.data.colunas;

  /*
    O filtro é da tela e só esconde linha — ele não recalcula nada. Os números do
    cabeçalho abaixo são sempre os do conjunto inteiro, e não os do recorte
    escolhido: um resumo que encolhesse junto com o filtro faria "3 críticos com
    falta" virar "0" só porque alguém clicou em "só o que falta", e ninguém
    consegue confiar num total que se mexe.
  */
  const filtradas = linhas.filter((l) =>
    recorte === "FALTA"
      ? l.vigenciasComFalta > 0
      : recorte === "CRITICOS"
        ? l.criticidade === "CRITICO"
        : true,
  );
  const TETO = 40;
  const visiveis = mostrarTudo ? filtradas : filtradas.slice(0, TETO);

  return (
    <>
      <tr className="border-b bg-muted/20">
        <td colSpan={colspan} className="px-4 py-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide">
                Atributos de {linha.rotulo} ({numero(resumo.atributos)})
              </h3>
              <p className="text-[0.6875rem] text-muted-foreground mt-0.5 max-w-3xl">
                {numero(resumo.comFalta)} com alguma falta na janela
                {resumo.criticosComFalta > 0 && (
                  <>
                    {" "}
                    · <strong className="text-brand-red">
                      {numero(resumo.criticosComFalta)} deles críticos
                    </strong>
                  </>
                )}
                {resumo.nuncaChegaram > 0 &&
                  ` · ${numero(resumo.nuncaChegaram)} esperados que não chegaram em nenhuma vigência`}
                {resumo.semExpectativa > 0 &&
                  ` · ${numero(resumo.semExpectativa)} chegaram sem ninguém cobrar (a célula tracejada)`}
                . Clique numa célula para abrir o atributo naquela vigência.
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              {(
                [
                  ["TODOS", "Todos"],
                  ["FALTA", "Só o que falta"],
                  ["CRITICOS", "Só críticos"],
                ] as const
              ).map(([chave, rotulo]) => (
                <button
                  key={chave}
                  type="button"
                  onClick={() => {
                    setRecorte(chave);
                    setMostrarTudo(false);
                  }}
                  className={cn(
                    "text-[0.6875rem] px-2 py-1 border transition-colors",
                    recorte === chave
                      ? "bg-brand text-brand-foreground border-brand"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        </td>
      </tr>

      {visiveis.map((atributo) => (
        <tr key={atributo.attributeCode} className="border-b bg-muted/10">
          <th
            scope="row"
            className="px-4 py-1.5 pl-8 text-left font-normal sticky left-0 bg-card z-10 border-r"
          >
            <div className="flex items-baseline gap-1.5">
              {atributo.criticidade === "CRITICO" && (
                <AlertTriangle
                  className="w-3 h-3 text-brand-red shrink-0 self-center"
                  aria-label="Atributo crítico"
                />
              )}
              <span className="text-xs">{atributo.attributeLabel}</span>
            </div>
            <div className="text-[0.625rem] text-muted-foreground flex flex-wrap gap-x-2">
              <code title={atributo.attributeCode}>{atributo.attributeCode}</code>
              {atributo.origem ? (
                /* O nome da origem, e o eixo declaração/inferência ao lado. */
                <span title={atributo.motivo ?? undefined}>
                  {ORIGEM_DO_ESPERADO[atributo.origem]}
                  {!atributo.declarado && " (inferido)"}
                </span>
              ) : (
                <span title="Chegou, e nenhuma origem o cobra. Não é lacuna.">
                  sem expectativa
                </span>
              )}
              {/* Só quem alimenta a DRE tem seção; ver `atributos.ts`. */}
              {atributo.secaoDaDRE && (
                <span className="text-brand">{atributo.secaoDaDRE}</span>
              )}
            </div>
          </th>
          {colunasDoConjunto.map((coluna) => (
            <td key={coluna.chave} className="px-1.5 py-1">
              <CelulaDeAtributo
                atributo={atributo}
                coluna={coluna}
                celula={atributo.celulas[coluna.chave]}
                aoAbrirAtributo={aoAbrirAtributo}
              />
            </td>
          ))}
        </tr>
      ))}

      {filtradas.length === 0 && (
        <tr className="border-b bg-muted/10">
          <td colSpan={colspan} className="px-4 py-3 text-xs text-muted-foreground">
            Nenhum atributo neste recorte.
          </td>
        </tr>
      )}

      {filtradas.length > visiveis.length && (
        <tr className="border-b bg-muted/20">
          <td colSpan={colspan} className="px-4 py-2">
            <button
              type="button"
              onClick={() => setMostrarTudo(true)}
              className="text-xs text-brand hover:underline"
            >
              Mostrar os outros {numero(filtradas.length - visiveis.length)} atributos
            </button>
            <span className="text-[0.6875rem] text-muted-foreground ml-2">
              A lista vem ordenada pelo pior estado — os {TETO} primeiros são os que mais
              pedem atenção.
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Um cruzamento atributo × vigência.
 *
 * **A cor nunca decide sozinha**, pela mesma regra da célula do conjunto: cada
 * uma carrega um texto (a fração de equipamentos com o dado, ou a sigla do
 * estado), um ponto colorido e a frase inteira no `title`. Uma tabela desta
 * densidade lida só por cor é ilegível para quem não distingue verde de
 * vermelho e some numa impressão em preto e branco.
 *
 * **A vigência sem nada a dizer aparece vazia, e não some.** Um atributo que
 * ninguém cobra e que não chegou não vira célula: vira o mesmo traço da matriz
 * de cima. Preencher esse buraco com "0%" contaria uma lacuna que não existe.
 */
function CelulaDeAtributo({
  atributo,
  coluna,
  celula,
  aoAbrirAtributo,
}: {
  atributo: LinhaDeAtributo;
  coluna: ColunaDoConjunto;
  celula: CelulaDoAtributo | undefined;
  aoAbrirAtributo: (abertura: AberturaDoAtributo) => void;
}) {
  const abrir = () =>
    aoAbrirAtributo({
      snapshotId: celula?.snapshotId ?? coluna.snapshotId,
      attributeCode: atributo.attributeCode,
      attributeLabel: atributo.attributeLabel,
      periodo: coluna.periodo,
    });

  /*
    O traço também abre.

    Ele responde uma pergunta — "por que está vazio aqui?" — e a resposta tem
    duas versões que a tela desenha igual: o atributo não foi cobrado e não
    chegou, ou a vigência não trouxe este conjunto. Deixá-lo morto obrigaria a
    adivinhar qual das duas, e é justamente a distinção que a gaveta sabe fazer.
  */
  if (!celula) {
    const semConjunto = coluna.snapshotId === null;
    const descricao = semConjunto
      ? `${atributo.attributeLabel} em ${coluna.periodo}: esta vigência não trouxe este conjunto.`
      : `${atributo.attributeLabel} em ${coluna.periodo}: não chegou, e ninguém o cobrava.`;
    return (
      <button
        type="button"
        onClick={abrir}
        title={descricao}
        aria-label={descricao}
        className="w-full px-1.5 py-1 text-center text-[0.625rem] text-muted-foreground border border-dashed transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-brand"
      >
        —
      </button>
    );
  }

  const aparencia = APARENCIA[celula.estado];
  const texto =
    celula.estado === "PARCIAL"
      ? `${numero(celula.entidadesPresentes)}/${numero(celula.entidadesEsperadas)}`
      : aparencia.sigla;

  return (
    <button
      type="button"
      onClick={abrir}
      title={frase(atributo, celula)}
      aria-label={frase(atributo, celula)}
      className={cn(
        "w-full px-1.5 py-1 border text-center transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-brand",
        aparencia.classe,
        /* Chegou sem ser cobrado: a mesma cor, sem o peso de um estado medido. */
        !celula.esperado && "opacity-60 border-dashed",
      )}
    >
      <span className="inline-flex items-center justify-center gap-1">
        <span className={cn("w-1 h-1 rounded-full shrink-0", aparencia.ponto)} aria-hidden />
        <span className="text-[0.6875rem] font-semibold tabular-nums">{texto}</span>
      </span>
    </button>
  );
}

/** A frase por extenso — o canal que sobrevive à impressão em preto e branco. */
function frase(atributo: LinhaDeAtributo, celula: CelulaDoAtributo): string {
  const onde = `${atributo.attributeLabel} em ${celula.periodo}`;

  if (celula.dispensado) {
    return `${onde}: dispensado por decisão registrada. Não conta como lacuna.`;
  }
  if (!celula.esperado) {
    return (
      `${onde}: chegou para ${numero(celula.entidadesPresentes)} ` +
      `${celula.entidadesPresentes === 1 ? "equipamento" : "equipamentos"} e nenhuma origem o ` +
      `cobra nesta vigência. Não é lacuna${celula.novo ? " — é estreia" : ""}.`
    );
  }
  if (celula.entidadesFaltando === 0) {
    return (
      `${onde}: completo. ${numero(celula.entidadesPresentes)} de ` +
      `${numero(celula.entidadesEsperadas)} com o dado.`
    );
  }
  /*
    A causa da falta, e não um chute sobre ela.

    A frase dizia "a coluna veio no arquivo e não trouxe número para eles"
    sempre que a coluna estava no layout — inclusive quando os faltantes eram
    equipamentos que não vieram na vigência, para os quais não havia coluna
    nenhuma a trazer número. As duas causas somam no mesmo total e têm donos
    diferentes; a célula tem os números para separá-las, e separa.
  */
  const vazias = Math.max(0, celula.entidadesVazias - celula.naoAplicaveis);
  const semVir = Math.max(0, celula.entidadesFaltando - vazias);
  const causa = !celula.noLayout
    ? " — a coluna não veio nesta vigência."
    : vazias > 0 && semVir > 0
      ? ` — ${numero(vazias)} receberam a coluna sem número e ${numero(semVir)} não vieram na vigência.`
      : semVir > 0
        ? " — a coluna veio no arquivo; eles é que não vieram na vigência."
        : " — a coluna veio no arquivo e não trouxe número para eles.";

  return (
    `${onde}: ${percentual(celula.percentual)}. ` +
    `${numero(celula.entidadesFaltando)} de ${numero(celula.entidadesEsperadas)} ` +
    `${celula.entidadesFaltando === 1 ? "equipamento ficou" : "equipamentos ficaram"} sem o dado` +
    causa +
    (celula.criticidade === "CRITICO" ? " Atributo crítico." : "")
  );
}
