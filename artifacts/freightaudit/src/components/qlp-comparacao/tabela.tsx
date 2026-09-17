import { useId } from "react";
import {
  CelulaDeJustificativa,
  COLUNA_DE_JUSTIFICATIVA,
  type AbrirJustificativa,
} from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  UNIDADE_DA_MEDIDA,
  corDaDiferenca,
  escreverCargo,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
  pedacosEnfatizados,
  type GrupoDeVariavel,
  type LinhaDeQlpComparado,
} from "@/lib/qlp-comparacao";

/**
 * A comparação do quadro — **um cartão por variável**, cargos dentro.
 *
 * É a mesma tabela das seis auditorias de rubrica, com a coluna do ativo
 * trocada — onde elas escrevem placa, esta escreve **cargo** — e com a coluna da
 * variável promovida a cabeçalho de cartão. O que isso muda:
 *
 * **A unidade passa a ser constante dentro do cartão.** A tabela plana punha
 * `DINHEIRO`, `QUANTIDADE`, `PERCENTUAL` e `FATOR` na mesma coluna Diferença, e
 * ordenar +R$ 908,58 ao lado de +2 profissionais é coincidência de sinal, não
 * ranking. É o mesmo motivo de `corDaDiferenca` só pintar dinheiro: a régua não
 * vale para a coluna inteira. Num cartão de uma variável só, De, Para e
 * Diferença comparam igual com igual, e a unidade se diz uma vez no alto.
 *
 * **O que se repetia por linha sobe para o cabeçalho**: o rótulo da variável, a
 * unidade e o aviso do subtotal, que era um ⓘ por linha e agora é uma frase dita
 * uma vez. A coluna Variável sai do corpo, e a largura dela volta para Cargo e
 * Classificação.
 *
 * **A ordem dos cartões não é escolhida aqui** — ver `agruparPorVariavel`.
 * Dentro do cartão a ordem é a que chegou, por diferença.
 *
 * O que **não** muda: o selo de estado tem texto e não só cor, a coluna de
 * justificativa é a mesma das outras seis (mesmo componente, mesmo `change.id`,
 * mesmo POST), e o cargo entra legível no diálogo, não pela chave.
 */
export function CartoesDaComparacaoDeQlp({
  grupos,
  rotulos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  grupos: GrupoDeVariavel[];
  rotulos: Record<string, string>;
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  /** Abrir a gaveta do cargo desta linha. */
  onAbrir: (cargo: string) => void;
  /** Sem ele a coluna é só de leitura — ver `CelulaDeJustificativa`. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <div className="flex flex-col gap-4">
      {grupos.map((grupo) => (
        <CartaoDaVariavel
          key={grupo.variavel}
          grupo={grupo}
          rotulos={rotulos}
          {...(justificadaPor ? { justificadaPor } : {})}
          onAbrir={onAbrir}
          {...(onJustificar ? { onJustificar } : {})}
        />
      ))}
    </div>
  );
}

/**
 * As colunas do corpo, na ordem. A da variável não está aqui: é o cabeçalho.
 *
 * A largura é declarada, e não medida — e é o que faz os cartões serem uma
 * tabela só. Cada cartão tem o seu `<table>`, e uma tabela que se dimensiona
 * pelo conteúdo dá a cada um uma grade diferente: com cinco cartões empilhados,
 * "Diferença" cai num lugar no primeiro e em outro no quinto, e a coluna deixa
 * de se ler de cima a baixo. Com `table-fixed` e estas larguras, a grade é a
 * mesma em todos, tenham eles cinco linhas ou uma.
 */
const COLUNAS: { titulo: string; direita: boolean; largura: string }[] = [
  { titulo: "Cargo", direita: false, largura: "20%" },
  { titulo: "Classificação", direita: false, largura: "18%" },
  { titulo: "De", direita: true, largura: "11%" },
  { titulo: "Para", direita: true, largura: "11%" },
  { titulo: "Diferença", direita: true, largura: "11%" },
  { titulo: "Variação %", direita: true, largura: "9%" },
  { titulo: "Status", direita: false, largura: "11%" },
  { titulo: COLUNA_DE_JUSTIFICATIVA, direita: false, largura: "9%" },
];

function CartaoDaVariavel({
  grupo,
  rotulos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  grupo: GrupoDeVariavel;
  rotulos: Record<string, string>;
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (cargo: string) => void;
  onJustificar?: AbrirJustificativa;
}) {
  const idDoTitulo = useId();
  /*
    Dentro de um cartão, uma linha é um cargo: a chave da comparação é cargo e
    variável, e a variável aqui é uma só. Contar "alterações" seria quase certo,
    e errado com "Mostrar o que não mudou" ligado, que traz linhas iguais.
  */
  const cargos = grupo.linhas.length;
  return (
    <section className="superficie overflow-hidden" aria-labelledby={idDoTitulo}>
      <header className="border-b border-superficie-borda px-4 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h3 id={idDoTitulo} className="text-base font-semibold tracking-tight">
            {grupo.rotulo}
          </h3>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.04em] text-muted-foreground">
            {UNIDADE_DA_MEDIDA[grupo.medida]}
          </span>
          {grupo.foraDaSoma && (
            <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.04em] text-brand">
              Subtotal
            </span>
          )}
          <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
            {cargos} {cargos === 1 ? "cargo" : "cargos"}
          </span>
        </div>
        {grupo.foraDaSoma && (
          <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {pedacosEnfatizados(grupo.foraDaSoma).map((pedaco, i) =>
              pedaco.forte ? (
                <strong key={i} className="font-semibold">
                  {pedaco.texto}
                </strong>
              ) : (
                <span key={i}>{pedaco.texto}</span>
              ),
            )}
          </p>
        )}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
          <caption className="sr-only">
            As alterações de {grupo.rotulo} entre as duas vigências, por cargo.
          </caption>
          <colgroup>
            {COLUNAS.map((coluna) => (
              <col key={coluna.titulo} style={{ width: coluna.largura }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-superficie-borda bg-muted/40">
              {COLUNAS.map((coluna) => (
                <th
                  key={coluna.titulo}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
                    coluna.direita ? "text-right" : "text-left",
                  )}
                >
                  {coluna.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grupo.linhas.map((linha, indice) => (
              <LinhaDoCargo
                key={`${linha.entityLabel}-${linha.id ?? indice}`}
                linha={linha}
                rotulos={rotulos}
                {...(justificadaPor ? { justificadaPor } : {})}
                onAbrir={onAbrir}
                {...(onJustificar ? { onJustificar } : {})}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LinhaDoCargo({
  linha,
  rotulos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  linha: LinhaDeQlpComparado;
  rotulos: Record<string, string>;
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (cargo: string) => void;
  onJustificar?: AbrirJustificativa;
}) {
  const { unidade, cargo, classificacao, outros } = escreverCargo(
    linha.entityLabel,
    rotulos,
    linha.entityType,
  );
  return (
    <tr
      className="cursor-pointer border-b border-superficie-borda last:border-b-0 hover:bg-muted/40"
      onClick={() => linha.entityLabel && onAbrir(linha.entityLabel)}
      tabIndex={0}
      role="button"
      aria-label={`Abrir as variáveis de ${cargo}`}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && linha.entityLabel) {
          e.preventDefault();
          onAbrir(linha.entityLabel);
        }
      }}
    >
      <td className="px-3 py-2">
        <div className="font-medium">{cargo}</div>
        {unidade && (
          <div className="font-mono text-[0.7rem] text-muted-foreground">{unidade}</div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {classificacao ?? "—"}
        {outros.map((campo) => (
          <div key={campo.rotulo} className="text-[0.7rem]">
            {campo.rotulo}: {campo.valor}
          </div>
        ))}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {escreverValor(linha.base, linha.medida)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {escreverValor(linha.comparada, linha.medida)}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums font-medium",
          corDaDiferenca(linha.diferenca, linha.medida),
        )}
      >
        {escreverDiferenca(linha.diferenca, linha.medida)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {escreverVariacao(linha.variacao)}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
            SELO_DO_ESTADO[linha.estado],
          )}
        >
          {ROTULO_DO_ESTADO[linha.estado]}
        </span>
        {linha.motivo && (
          <p className="mt-1 max-w-xs text-[0.7rem] text-muted-foreground">{linha.motivo}</p>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {/*
          O cargo entra legível no diálogo, e não pela chave.

          `entityLabel` é o que a caixa de justificar escreve no topo, e o motor
          grava ali a chave normalizada (`07526557001505CARGOMANOBRISTA…`). Quem
          vai explicar uma alteração precisa ler de que cargo ela é; o que
          identifica a gravação é o `change.id`, que não muda com isto.
        */}
        <CelulaDeJustificativa
          linha={{ ...linha, entityLabel: unidade ? `${unidade} · ${cargo}` : cargo }}
          justificativa={linha.id === null ? undefined : justificadaPor?.get(linha.id)}
          {...(onJustificar ? { onJustificar } : {})}
        />
      </td>
    </tr>
  );
}
