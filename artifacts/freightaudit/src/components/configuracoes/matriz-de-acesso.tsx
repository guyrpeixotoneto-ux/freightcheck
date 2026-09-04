import { useMemo, useState } from "react";
import { Eye, Layers, Lock, PencilLine, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AMBIENTES } from "@/lib/ambiente";
import {
  EXPLICACAO_DO_NIVEL,
  MODULOS,
  NIVEL_PADRAO,
  chaveDaSecao,
  chaveDoAmbiente,
  modulosPorGrupo,
  type Nivel,
} from "@/lib/permissoes";
import { cn } from "@/lib/utils";

/**
 * A matriz de acesso — os dois eixos, os três níveis, um só desenho.
 *
 * Ela nasceu dentro de Permissões e saiu de lá quando Papéis passou a fazer a
 * mesma pergunta sobre outra coisa: **o que isto alcança, módulo a módulo e
 * ambiente a ambiente**. Lá o sujeito é uma pessoa; aqui, um papel — e o resto
 * é idêntico: a mesma ordem do fechado para o aberto, as mesmas cores, o mesmo
 * `aria-pressed`, a mesma busca valendo para os dois eixos. Duas cópias
 * divergiriam na primeira mudança de qualquer um desses detalhes, e a diferença
 * apareceria como duas telas que decidem a mesma coisa de jeitos diferentes.
 *
 * **A camada de baixo é opcional, e é o que separa os dois usos.** Um papel
 * decide sozinho: o que não tem linha vale o padrão, que concede. Uma conta
 * decide *sobre* o papel dela — e então cada linha precisa dizer o que é
 * herança e o que é exceção, e oferecer a volta à herança. É o `herdado` abaixo:
 * ausente, a tela é a de um papel; presente, a de uma conta com papel.
 */

export const NIVEIS_NA_TELA: Array<{
  nivel: Nivel;
  rotulo: string;
  icone: typeof Eye;
  ativo: string;
}> = [
  {
    nivel: "SEM_ACESSO",
    rotulo: "Sem acesso",
    icone: Lock,
    ativo: "bg-rose-600 text-white border-rose-600 hover:bg-rose-600",
  },
  {
    nivel: "VISUALIZAR",
    rotulo: "Visualizar",
    icone: Eye,
    ativo: "bg-blue-600 text-white border-blue-600 hover:bg-blue-600",
  },
  {
    nivel: "EDITAR",
    rotulo: "Editar",
    icone: PencilLine,
    ativo: "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-600",
  },
];

export function rotuloDoNivel(nivel: string): string {
  return (
    NIVEIS_NA_TELA.find((n) => n.nivel === nivel)?.rotulo.toLowerCase() ?? nivel
  );
}

/**
 * O nome do que mudou, para o histórico.
 *
 * Módulo continua sendo o endereço — é assim que ele aparece no menu e na lista
 * —, e ambiente vira o nome por extenso: `@fechamento-as` sozinho seria a linha
 * do histórico falando a língua do banco.
 */
export function rotuloDaChave(chave: string): string {
  const ambiente = AMBIENTES.find((a) => chaveDoAmbiente(a.id) === chave);
  return ambiente ? ambiente.nomeCompleto : chave;
}

/** Quantos módulos estão em cada nível, já com o padrão aplicado. */
export function contarPorNivel(niveis: Record<string, Nivel>): Record<Nivel, number> {
  const contagem = { EDITAR: 0, VISUALIZAR: 0, SEM_ACESSO: 0 } as Record<Nivel, number>;
  for (const modulo of MODULOS) contagem[niveis[modulo.chave] ?? NIVEL_PADRAO] += 1;
  return contagem;
}

export interface MatrizDeAcessoProps {
  /** O que vale, chave a chave — já somado, quando há duas camadas. */
  niveis: Record<string, Nivel>;
  /**
   * A camada de baixo, quando existe: o que o papel dá. Presente, cada linha
   * diz o que é herança e o que é exceção, e oferece a volta.
   */
  herdado?: Record<string, Nivel>;
  /** O nome do papel herdado — a linha diz de onde vem, não só que vem. */
  nomeDaHeranca?: string | null;
  /**
   * As chaves que a instalação desligou para todo mundo (Configurações →
   * Módulos Universais).
   *
   * Elas chegam aqui já como `SEM_ACESSO` no que vale, e sem esta lista a linha
   * as descreveria errado — "exceção desta conta" sobre uma decisão que não é
   * desta conta e que mexer aqui não desfaz. Com ela, a linha diz de onde a
   * restrição vem e para onde ir mudá-la, e os botões saem do caminho.
   */
  universaisDesligadas?: readonly string[];
  desabilitado: boolean;
  carregando?: boolean;
  aoEscolher: (niveis: Record<string, Nivel>) => void;
}

export function MatrizDeAcesso({
  niveis,
  herdado,
  nomeDaHeranca,
  universaisDesligadas,
  desabilitado,
  carregando = false,
  aoEscolher,
}: MatrizDeAcessoProps) {
  const [busca, setBusca] = useState("");

  const desligadas = useMemo(
    () => new Set(universaisDesligadas ?? []),
    [universaisDesligadas],
  );

  /**
   * A casa desligou este módulo — direto, ou pela seção dele.
   *
   * As duas formas chegam aqui pela mesma lista, e têm de ser lidas juntas: um
   * módulo cuja **seção** a casa desligou não aparece para ninguém, e mostrá-lo
   * nesta tela como decidível faria a Permissões oferecer um botão que não muda
   * o que se vê — e descrever como "exceção desta conta" uma restrição que não é
   * desta conta.
   */
  const desligadaNaCasa = (modulo: { chave: string; secao: string }): boolean =>
    desligadas.has(modulo.chave) || desligadas.has(chaveDaSecao(modulo.secao));

  const secoes = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return modulosPorGrupo()
      .map((secao) => ({
        ...secao,
        itens: secao.itens.filter(
          (m) =>
            termo === "" ||
            m.rotulo.toLowerCase().includes(termo) ||
            m.chave.toLowerCase().includes(termo) ||
            secao.grupo.toLowerCase().includes(termo),
        ),
      }))
      .filter((secao) => secao.itens.length > 0);
  }, [busca]);

  const visiveis = secoes.flatMap((s) => s.itens.map((m) => m.chave));

  /*
    A busca vale para os dois eixos, e por isso os ambientes também são
    filtrados por ela: quem digita "fechamento" está procurando o fechamento, e
    uma lista de ambientes que ignora a busca deixaria oito linhas fixas em cima
    de uma lista que encolheu.
  */
  const ambientesNaTela = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo === "") return AMBIENTES;
    return AMBIENTES.filter(
      (a) =>
        a.nomeCompleto.toLowerCase().includes(termo) ||
        a.nome.toLowerCase().includes(termo) ||
        a.id.includes(termo),
    );
  }, [busca]);

  function aplicarEmTodos(nivel: Nivel) {
    const pedido: Record<string, Nivel> = {};
    for (const chave of visiveis) pedido[chave] = nivel;
    aoEscolher(pedido);
  }

  /** O nível da camada de baixo — o do papel, ou o padrão que concede. */
  const base = (chave: string): Nivel => herdado?.[chave] ?? NIVEL_PADRAO;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!desabilitado &&
          NIVEIS_NA_TELA.map(({ nivel, icone: Icone }) => (
            <Button
              key={nivel}
              variant="outline"
              size="sm"
              onClick={() => aplicarEmTodos(nivel)}
            >
              <Icone className="w-3.5 h-3.5 mr-1.5" />
              {nivel === "EDITAR"
                ? "Liberar tudo"
                : nivel === "VISUALIZAR"
                  ? "Só visualizar"
                  : "Bloquear tudo"}
            </Button>
          ))}
        <span className="relative ml-auto">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar módulo…"
            className="h-9 w-56 pl-8"
          />
        </span>
      </div>

      {!desabilitado && busca.trim() !== "" && (
        <p className="text-xs text-muted-foreground -mt-2">
          Os três botões acima valem para os {visiveis.length} módulos que a busca
          deixou na lista — não para o menu inteiro.
        </p>
      )}

      {!carregando && ambientesNaTela.length > 0 && (
        <div className="rounded-md border">
          <div className="flex items-center gap-2 bg-muted/50 px-4 py-2">
            <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ambientes de trabalho
            </span>
            <span className="text-xs text-muted-foreground">
              {ambientesNaTela.length} de {AMBIENTES.length}
            </span>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Onde se trabalha. Um ambiente sem acesso não aparece no seletor do topo
            e nenhuma tela dele abre — inclusive as que estão liberadas na lista de
            módulos abaixo, porque o que vale numa tela é o mais restritivo dos
            dois.
          </p>
          {ambientesNaTela.map((ambiente) => {
            const chave = chaveDoAmbiente(ambiente.id);
            return (
              <div
                key={ambiente.id}
                className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {ambiente.nomeCompleto}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {ambiente.descricao}
                  </span>
                  <Procedencia
                    nivel={niveis[chave] ?? NIVEL_PADRAO}
                    herdado={herdado === undefined ? null : base(chave)}
                    excecao={
                      herdado !== undefined &&
                      (niveis[chave] ?? NIVEL_PADRAO) !== base(chave)
                    }
                    nomeDaHeranca={nomeDaHeranca ?? null}
                    desligadaNaCasa={desligadas.has(chave)}
                  />
                </span>
                <span className="flex items-center gap-1.5">
                  <BotoesDeNivel
                    nivel={niveis[chave] ?? NIVEL_PADRAO}
                    desabilitado={desabilitado || desligadas.has(chave)}
                    aoEscolher={(opcao) => aoEscolher({ [chave]: opcao })}
                  />
                  {herdado !== undefined &&
                    (niveis[chave] ?? NIVEL_PADRAO) !== base(chave) && (
                      <VoltarAoPapel
                        desabilitado={desabilitado}
                        aoVoltar={() => aoEscolher({ [chave]: base(chave) })}
                      />
                    )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-md border divide-y">
        {carregando && (
          <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
        )}

        {!carregando &&
          secoes.map((secao) => (
            <div key={`${secao.ambiente}|${secao.secao}`}>
              <div className="flex items-center gap-2 bg-muted/50 px-4 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {secao.grupo}
                </span>
                <Badge variant="outline" className="font-normal text-[0.6875rem]">
                  {secao.ambiente}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {secao.itens.length} módulo(s)
                </span>
              </div>
              {secao.itens.map((modulo) => {
                const nivel = niveis[modulo.chave] ?? NIVEL_PADRAO;
                const daBase = base(modulo.chave);
                return (
                  <div
                    key={modulo.chave}
                    className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t first:border-t-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {modulo.rotulo}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {modulo.chave} · {EXPLICACAO_DO_NIVEL[nivel]}
                      </span>
                      <Procedencia
                        nivel={nivel}
                        herdado={herdado === undefined ? null : daBase}
                        excecao={herdado !== undefined && nivel !== daBase}
                        nomeDaHeranca={nomeDaHeranca ?? null}
                        desligadaNaCasa={desligadaNaCasa(modulo)}
                      />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <BotoesDeNivel
                        nivel={nivel}
                        desabilitado={desabilitado || desligadaNaCasa(modulo)}
                        aoEscolher={(opcao) => aoEscolher({ [modulo.chave]: opcao })}
                      />
                      {herdado !== undefined && nivel !== daBase && (
                        <VoltarAoPapel
                          desabilitado={desabilitado}
                          aoVoltar={() => aoEscolher({ [modulo.chave]: daBase })}
                        />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

        {!carregando && secoes.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">
            Nenhum módulo com esse nome.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * De onde vem o que está valendo nesta linha.
 *
 * Só aparece onde há duas camadas — a tela de uma conta. Sem esta frase, uma
 * pessoa restringida pelo papel e uma restringida por exceção seriam idênticas
 * na tela, e desfazer a segunda (que é possível aqui) daria no mesmo trabalho
 * que tentar desfazer a primeira (que se desfaz no papel, e para todo mundo).
 */
function Procedencia({
  nivel,
  herdado,
  excecao,
  nomeDaHeranca,
  desligadaNaCasa = false,
}: {
  nivel: Nivel;
  herdado: Nivel | null;
  excecao: boolean;
  nomeDaHeranca: string | null;
  desligadaNaCasa?: boolean;
}) {
  /*
    A camada da casa vence as outras duas, e por isso ela é dita antes: dizer
    "herdado do papel" sobre uma chave que a instalação desligou mandaria quem
    lê procurar no lugar errado — e mexer no papel não devolveria nada.
  */
  if (desligadaNaCasa) {
    return (
      <span className="block text-xs text-rose-700">
        Desligado para toda a instalação — Configurações › Módulos Universais.
      </span>
    );
  }

  if (herdado === null) return null;
  const papel = nomeDaHeranca ?? "papel";

  if (!excecao) {
    return (
      <span className="block text-xs text-muted-foreground/80">
        {herdado === "EDITAR" && nivel === "EDITAR"
          ? `Sem decisão — herda ${papel}, que alcança tudo aqui.`
          : `Herdado de ${papel}.`}
      </span>
    );
  }

  return (
    <span className="block text-xs text-amber-700">
      Exceção desta conta — {papel} dá {rotuloDoNivel(herdado)}.
    </span>
  );
}

function VoltarAoPapel({
  desabilitado,
  aoVoltar,
}: {
  desabilitado: boolean;
  aoVoltar: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-2 text-muted-foreground"
      disabled={desabilitado}
      title="Apagar a exceção e voltar a herdar do papel"
      onClick={aoVoltar}
    >
      <RotateCcw className="w-3.5 h-3.5" />
      <span className="sr-only">Voltar ao papel</span>
    </Button>
  );
}

/**
 * Os três botões de nível — os mesmos para um módulo, um ambiente e um papel.
 *
 * A ordem, as cores e o `aria-pressed` têm de ser idênticos em toda parte, e
 * duas cópias divergiriam na primeira mudança de qualquer um deles.
 */
export function BotoesDeNivel({
  nivel,
  desabilitado,
  aoEscolher,
}: {
  nivel: Nivel;
  desabilitado: boolean;
  aoEscolher: (nivel: Nivel) => void;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {NIVEIS_NA_TELA.map(({ nivel: opcao, rotulo, icone: Icone, ativo }) => (
        <Button
          key={opcao}
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={nivel === opcao}
          disabled={desabilitado}
          className={cn("h-8", nivel === opcao && ativo)}
          onClick={() => aoEscolher(opcao)}
        >
          <Icone className="w-3.5 h-3.5 mr-1.5" />
          {rotulo}
        </Button>
      ))}
    </span>
  );
}
