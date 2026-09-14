import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Lock,
  PencilLine,
  Power,
  RotateCcw,
  Search,
} from "lucide-react";
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
 * A matriz de acesso — os dois eixos, os três níveis e o interruptor da casa,
 * num desenho só.
 *
 * Ela nasceu dentro de Permissões e saiu de lá quando os Perfis passaram a
 * fazer a mesma pergunta sobre outra coisa: **o que isto alcança, módulo a
 * módulo e ambiente a ambiente**. Hoje as duas usam-na de dentro da mesma
 * seção, e o resto é idêntico: a mesma ordem do fechado para o aberto, as
 * mesmas cores, o mesmo `aria-pressed`, a mesma busca valendo para os dois
 * eixos. Duas cópias divergiriam na primeira mudança de qualquer um desses
 * detalhes, e a diferença apareceria como duas telas que decidem a mesma coisa
 * de jeitos diferentes.
 *
 * **Três camadas, e a linha mostra as três.**
 *
 * · **Inativar** é a casa: o módulo sai do ar para todo mundo, nenhum perfil o
 *   devolve e o servidor recusa a escrita dele. É o botão mais à esquerda
 *   porque é o que vence os outros três, e ele só aparece onde a decisão da
 *   casa se toma — a matriz de um perfil. (Era uma seção inteira,
 *   `Módulos Universais`; virou uma coluna, porque quem responde "o que este
 *   perfil vê" é quem descobre que um módulo não deveria estar no ar para
 *   ninguém, e mandá-lo a outra tela para isso era perder a decisão no
 *   caminho.)
 * · **Os três níveis** são o perfil, ou a conta: sem acesso, visualizar, editar.
 * · **A herança** é opcional, e é o que separa os dois usos. Um perfil decide
 *   sozinho: o que não tem linha vale o piso dele. Uma conta decide *sobre* o
 *   perfil — e então cada linha precisa dizer o que é herança e o que é
 *   exceção, e oferecer a volta. É o `herdado` abaixo: ausente, a matriz é a de
 *   um perfil; presente, a de uma conta com perfil.
 *
 * **Arquivar é sobre a lista, e não sobre o acesso.** Uma chave desligada ganha
 * um segundo gesto, discreto, ao lado do vermelho: ela sai desta matriz e vai
 * para a gaveta do fim, com quem a arquivou e quando. Continua fora do ar —
 * arquivar não desliga e não religa nada — e continua inteira no banco, com o
 * histórico de quem a desligou. É o que faz a tela de uma casa que não usa dois
 * terços do produto voltar a ter o tamanho do que ela usa, sem que a saída
 * oferecida para isso seja apagar decisão. Ver `schema/modulo-universal.ts`.
 *
 * O mesmo gesto está em Módulos Universais, que é onde a decisão da casa se lê
 * inteira — com os números do que está fora do ar, o motivo e o histórico. Aqui
 * ele existe pela razão que trouxe o Inativar para esta matriz: quem descobre,
 * revisando um perfil, que um módulo não deveria estar no ar para ninguém
 * decide ali mesmo, sem perder a decisão no caminho até a outra tela.
 *
 * **O piso não é um botão.** `padrao` é o que vale para toda chave que ninguém
 * decidiu — `EDITAR` em quase todo perfil, `VISUALIZAR` num `Leitor` —, e a
 * matriz o usa como linha de base em vez da constante. Sem isso, um `Leitor`
 * apareceria aqui com noventa módulos marcados em `Editar`, que é exatamente o
 * contrário do que ele é.
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

/*
  O catálogo agrupado é montado uma vez, no carregamento do módulo, como o
  próprio `MODULOS`: `modulosPorGrupo()` é pura e a lista não muda enquanto a
  aba estiver aberta.
*/
const SECOES_DO_CATALOGO = modulosPorGrupo();

/**
 * O nome do que mudou, para o histórico.
 *
 * Módulo continua sendo o endereço — é assim que ele aparece no menu e na lista
 * —, ambiente vira o nome por extenso, seção ganha a palavra "Seção" na frente,
 * e o piso do perfil vira a frase que o descreve: `@fechamento-as` ou `*`
 * sozinhos seriam a linha do histórico falando a língua do banco.
 */
export function rotuloDaChave(chave: string): string {
  if (chave === "*") return "Tudo o que não tem decisão própria";
  const ambiente = AMBIENTES.find((a) => chaveDoAmbiente(a.id) === chave);
  if (ambiente) return ambiente.nomeCompleto;
  const secao = SECOES_DO_CATALOGO.find((s) => chaveDaSecao(s.secao) === chave);
  if (secao) return `Seção ${secao.grupo}`;
  return MODULOS.find((m) => m.chave === chave)?.rotulo ?? chave;
}

/**
 * Um número e o que ele conta — o resumo que fica em cima das duas matrizes.
 *
 * Mora aqui, e não em cada aba, pela razão dos botões de nível: as cores são as
 * mesmas dos três níveis, e duas cópias divergiriam na primeira vez que alguém
 * mexesse numa delas.
 */
export function Contagem({
  numero,
  rotulo,
  cor,
}: {
  numero: number;
  rotulo: string;
  cor: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn("text-lg font-bold tabular-nums", cor)}>{numero}</span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
    </span>
  );
}

/** Quantos módulos estão em cada nível, já com o piso do perfil aplicado. */
export function contarPorNivel(
  niveis: Record<string, Nivel>,
  padrao: Nivel = NIVEL_PADRAO,
): Record<Nivel, number> {
  const contagem = { EDITAR: 0, VISUALIZAR: 0, SEM_ACESSO: 0 } as Record<Nivel, number>;
  for (const modulo of MODULOS) contagem[niveis[modulo.chave] ?? padrao] += 1;
  return contagem;
}

/** Uma chave que saiu da lista: o que ela é, quem a arquivou e quando. */
export interface ChaveArquivada {
  chave: string;
  arquivadoEm: string;
  arquivadoPor: string;
}

export interface MatrizDeAcessoProps {
  /** O que vale, chave a chave — já somado, quando há duas camadas. */
  niveis: Record<string, Nivel>;
  /**
   * O piso: o que vale para a chave que ninguém decidiu. `EDITAR` em quase todo
   * perfil; `VISUALIZAR` num `Leitor`.
   */
  padrao?: Nivel;
  /**
   * A camada de baixo, quando existe: o que o perfil dá. Presente, cada linha
   * diz o que é herança e o que é exceção, e oferece a volta.
   */
  herdado?: Record<string, Nivel>;
  /** O piso do perfil herdado — a base das chaves que ele não decide. */
  padraoHerdado?: Nivel;
  /** O nome do perfil herdado — a linha diz de onde vem, não só que vem. */
  nomeDaHeranca?: string | null;
  /**
   * As chaves que a instalação desligou para todo mundo — o botão **Inativar**.
   *
   * Elas chegam aqui já como `SEM_ACESSO` no que vale, e sem esta lista a linha
   * as descreveria errado: "exceção desta conta" sobre uma decisão que não é
   * desta conta e que mexer aqui não desfaz.
   */
  universaisDesligadas?: readonly string[];
  /** As chaves que o servidor recusa desligar — hoje, `/configuracoes`. */
  universaisProtegidas?: readonly string[];
  /**
   * As chaves que a casa **arquivou** — desligadas e fora desta lista.
   *
   * Elas não somem do produto e não somem do banco: somem daqui. Uma instalação
   * que não usa dois terços do produto administrava acesso dentro de uma tela
   * em que quase tudo estava riscado, e as vinte linhas que ela usa de verdade
   * ficavam perdidas entre as quarenta e sete que ninguém vai olhar de novo. A
   * gaveta no fim da matriz guarda todas, com quem arquivou e quando, e
   * devolve qualquer uma com um clique.
   */
  universaisArquivadas?: readonly ChaveArquivada[];
  /**
   * Ligar e desligar para a casa inteira. Ausente, a coluna **Inativar** não
   * aparece — é o caso da matriz de uma conta, onde a decisão da casa não se
   * toma: ela vale para todo mundo, e não caberia numa tela sobre uma pessoa.
   */
  aoInativar?: (chave: string, ligado: boolean) => void;
  /**
   * Arquivar e desarquivar. Ausente, a gaveta e o botão não aparecem — é o caso
   * da matriz de uma conta, onde a decisão da casa não se toma.
   *
   * Só existe sobre chave desligada: o servidor recusa arquivar o que está no
   * ar, e a tela não oferece o gesto onde ele seria recusado.
   */
  aoArquivar?: (chave: string, arquivado: boolean) => void;
  desabilitado: boolean;
  carregando?: boolean;
  aoEscolher: (niveis: Record<string, Nivel>) => void;
}

export function MatrizDeAcesso({
  niveis,
  padrao = NIVEL_PADRAO,
  herdado,
  padraoHerdado = NIVEL_PADRAO,
  nomeDaHeranca,
  universaisDesligadas,
  universaisProtegidas,
  universaisArquivadas,
  aoInativar,
  aoArquivar,
  desabilitado,
  carregando = false,
  aoEscolher,
}: MatrizDeAcessoProps) {
  const [busca, setBusca] = useState("");

  const desligadas = useMemo(
    () => new Set(universaisDesligadas ?? []),
    [universaisDesligadas],
  );
  const protegidas = useMemo(
    () => new Set(universaisProtegidas ?? []),
    [universaisProtegidas],
  );
  const arquivadas = useMemo(
    () => new Map((universaisArquivadas ?? []).map((a) => [a.chave, a] as const)),
    [universaisArquivadas],
  );

  /**
   * A casa desligou este módulo — direto, ou pela seção dele.
   *
   * As duas formas têm de ser lidas juntas: um módulo cuja **seção** a casa
   * desligou não aparece para ninguém, e mostrá-lo como decidível faria a tela
   * oferecer um botão que não muda o que se vê.
   */
  const desligadaNaCasa = (modulo: { chave: string; secao: string }): boolean =>
    desligadas.has(modulo.chave) || desligadas.has(chaveDaSecao(modulo.secao));

  const secoes = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return SECOES_DO_CATALOGO
      /* A seção arquivada sai inteira, com os módulos dela: ela é uma chave só
         (`#<id>`), e foi essa chave que alguém tirou da vista. */
      .filter((secao) => !arquivadas.has(chaveDaSecao(secao.secao)))
      .map((secao) => {
        /*
          O módulo arquivado sai antes da busca, e antes do `total`.

          A ordem importa: `total` é o denominador da frase "a busca está
          escondendo N de M", e um M que contasse os arquivados faria a tela
          prometer módulos que ela não mostra em busca nenhuma. Arquivado não
          está escondido pela busca — está guardado na gaveta.
        */
        const naLista = secao.itens.filter((m) => !arquivadas.has(m.chave));
        return {
          ...secao,
          /** A seção como ela está na lista — a busca não a encolhe. */
          total: naLista.length,
          itens: naLista.filter(
            (m) =>
              termo === "" ||
              m.rotulo.toLowerCase().includes(termo) ||
              m.chave.toLowerCase().includes(termo) ||
              secao.grupo.toLowerCase().includes(termo),
          ),
        };
      })
      .filter((secao) => secao.itens.length > 0);
  }, [arquivadas, busca]);

  /*
    A busca vale para os dois eixos, e por isso os ambientes também são
    filtrados por ela: quem digita "fechamento" está procurando o fechamento, e
    uma lista de ambientes que ignora a busca deixaria oito linhas fixas em cima
    de uma lista que encolheu.
  */
  const ambientesNaTela = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const naLista = AMBIENTES.filter((a) => !arquivadas.has(chaveDoAmbiente(a.id)));
    if (termo === "") return naLista;
    return naLista.filter(
      (a) =>
        a.nomeCompleto.toLowerCase().includes(termo) ||
        a.nome.toLowerCase().includes(termo) ||
        a.id.includes(termo),
    );
  }, [arquivadas, busca]);

  /** O nível da camada de baixo — o do perfil, ou o piso dele. */
  const base = (chave: string): Nivel => herdado?.[chave] ?? padraoHerdado;

  function aplicarEm(chaves: readonly string[], nivel: Nivel) {
    const pedido: Record<string, Nivel> = {};
    for (const chave of chaves) pedido[chave] = nivel;
    aoEscolher(pedido);
  }

  const visiveis = [
    ...ambientesNaTela.map((a) => chaveDoAmbiente(a.id)),
    ...secoes.flatMap((s) => s.itens.map((m) => m.chave)),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!desabilitado &&
          NIVEIS_NA_TELA.map(({ nivel, icone: Icone }) => (
            <Button
              key={nivel}
              variant="outline"
              size="sm"
              onClick={() => aplicarEm(visiveis, nivel)}
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
            data-testid="input-buscar-modulo"
          />
        </span>
      </div>

      {!desabilitado && busca.trim() !== "" && (
        <p className="text-xs text-muted-foreground -mt-2">
          Os três botões acima valem para os {visiveis.length} itens que a busca
          deixou na lista — não para o menu inteiro.
        </p>
      )}

      {!carregando && ambientesNaTela.length > 0 && (
        <div className="rounded-md border">
          <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-4 py-2">
            <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ambientes de trabalho
            </span>
            <span className="text-xs text-muted-foreground">
              {ambientesNaTela.length} de{" "}
              {AMBIENTES.filter((a) => !arquivadas.has(chaveDoAmbiente(a.id))).length}
            </span>
            {!desabilitado && (
              <AplicarAoGrupo
                rotulo="Aplicar aos ambientes"
                aoAplicar={(nivel) =>
                  aplicarEm(
                    ambientesNaTela.map((a) => chaveDoAmbiente(a.id)),
                    nivel,
                  )
                }
              />
            )}
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Onde se trabalha. Um ambiente sem acesso não aparece no seletor do topo
            e nenhuma tela dele abre — inclusive as que estão liberadas na lista de
            módulos abaixo, porque o que vale numa tela é o mais restritivo dos
            dois.
          </p>
          {ambientesNaTela.map((ambiente) => {
            const chave = chaveDoAmbiente(ambiente.id);
            const nivel = niveis[chave] ?? padrao;
            return (
              <Linha
                key={ambiente.id}
                titulo={ambiente.nomeCompleto}
                subtitulo={ambiente.descricao}
                chave={chave}
                nivel={nivel}
                herdadoDe={herdado === undefined ? null : base(chave)}
                nomeDaHeranca={nomeDaHeranca ?? null}
                desligadaNaCasa={desligadas.has(chave)}
                protegida={protegidas.has(chave)}
                desabilitado={desabilitado}
                aoEscolher={(opcao) => aoEscolher({ [chave]: opcao })}
                aoVoltar={() => aoEscolher({ [chave]: base(chave) })}
                aoInativar={aoInativar}
                aoArquivar={aoArquivar}
              />
            );
          })}
        </div>
      )}

      <div className="rounded-md border divide-y">
        {carregando && (
          <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
        )}

        {!carregando &&
          secoes.map((secao) => {
            const chaveDaSua = chaveDaSecao(secao.secao);
            const secaoDesligada = desligadas.has(chaveDaSua);
            const secaoProtegida = protegidas.has(chaveDaSua);
            const escondidos = secao.total - secao.itens.length;
            return (
              <div key={`${secao.ambiente}|${secao.secao}`}>
                <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-4 py-2">
                  <span
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wide",
                      secaoDesligada
                        ? "text-rose-700 line-through"
                        : "text-muted-foreground",
                    )}
                  >
                    {secao.grupo}
                  </span>
                  <Badge variant="outline" className="font-normal text-[0.6875rem]">
                    {secao.ambiente}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {secao.total} módulo(s)
                  </span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {aoInativar !== undefined && !secaoProtegida && (
                      /*
                        A seção é **uma chave** (`#<id>`), e não a soma dos
                        módulos dela: desligá-la vale para o módulo que nascer
                        dentro dela amanhã, e a busca não tem como estreitar o
                        alcance disso nem por acidente. A versão anterior desta
                        decisão gravava as chaves dos itens que existiam naquele
                        instante, e a seção voltava inteira ao menu de quem a
                        tinha desligado no dia em que um módulo novo entrava
                        nela — aconteceu três vezes em quatro dias.
                      */
                      <BotaoInativar
                        chave={chaveDaSua}
                        desligada={secaoDesligada}
                        desabilitado={desabilitado}
                        rotulo={`a seção ${secao.grupo} inteira`}
                        aoAlternar={(ligado) => aoInativar(chaveDaSua, ligado)}
                      />
                    )}
                    {aoArquivar !== undefined &&
                      !secaoProtegida &&
                      secaoDesligada && (
                        <BotaoArquivar
                          chave={chaveDaSua}
                          desabilitado={desabilitado}
                          rotulo={`a seção ${secao.grupo}`}
                          aoArquivar={() => aoArquivar(chaveDaSua, true)}
                        />
                      )}
                    {!desabilitado && !secaoDesligada && (
                      <AplicarAoGrupo
                        rotulo="Aplicar ao grupo"
                        aoAplicar={(nivel) =>
                          aplicarEm(
                            secao.itens.map((m) => m.chave),
                            nivel,
                          )
                        }
                      />
                    )}
                  </span>
                </div>

                {secaoDesligada && (
                  <p className="border-t bg-rose-50/60 px-4 py-2 text-xs text-rose-900">
                    A seção inteira está fora do ar para toda a instalação —
                    inclusive os módulos que entrarem nela depois. As decisões de
                    cada módulo continuam guardadas e voltam a valer quando a
                    seção voltar.
                  </p>
                )}

                {escondidos > 0 && (
                  <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                    A busca está escondendo {escondidos} de {secao.total} módulos
                    desta seção. O botão da seção vale para os {secao.total}.
                  </p>
                )}

                {secao.itens.map((modulo) => {
                  const nivel = niveis[modulo.chave] ?? padrao;
                  return (
                    <Linha
                      key={modulo.chave}
                      titulo={modulo.rotulo}
                      subtitulo={`${modulo.chave} · ${EXPLICACAO_DO_NIVEL[nivel]}`}
                      chave={modulo.chave}
                      nivel={nivel}
                      herdadoDe={herdado === undefined ? null : base(modulo.chave)}
                      nomeDaHeranca={nomeDaHeranca ?? null}
                      desligadaNaCasa={desligadaNaCasa(modulo)}
                      /* Desligada pela seção, e não por si: o gesto que a
                         devolve ao ar é o da seção, e não o desta linha. */
                      desligadaPelaSecao={
                        !desligadas.has(modulo.chave) && secaoDesligada
                      }
                      protegida={protegidas.has(modulo.chave)}
                      desabilitado={desabilitado}
                      aoEscolher={(opcao) => aoEscolher({ [modulo.chave]: opcao })}
                      aoVoltar={() => aoEscolher({ [modulo.chave]: base(modulo.chave) })}
                      aoInativar={aoInativar}
                      aoArquivar={aoArquivar}
                    />
                  );
                })}
              </div>
            );
          })}

        {!carregando && secoes.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">
            Nenhum módulo com esse nome.
          </p>
        )}
      </div>

      {!carregando && aoArquivar !== undefined && arquivadas.size > 0 && (
        <GavetaDeArquivados
          arquivadas={[...arquivadas.values()]}
          desabilitado={desabilitado}
          aoDesarquivar={(chave) => aoArquivar(chave, false)}
        />
      )}
    </>
  );
}

/**
 * A gaveta dos arquivados — o que saiu da lista, e o caminho de volta.
 *
 * Fechada por padrão, e com o número no rótulo: é o que faz a matriz encolher
 * de verdade. Aberta, cada linha diz **o que era**, **quem arquivou** e
 * **quando** — sem isso, "arquivar" seria indistinguível de apagar para quem
 * chegasse depois, que é exatamente a dúvida que este gesto existe para não
 * deixar no ar.
 *
 * Não há botão de esvaziar, e não é esquecimento: não existe apagar nesta
 * camada. Uma chave sai da gaveta de um jeito só — voltando para a lista.
 */
function GavetaDeArquivados({
  arquivadas,
  desabilitado,
  aoDesarquivar,
}: {
  arquivadas: readonly ChaveArquivada[];
  desabilitado: boolean;
  aoDesarquivar: (chave: string) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const emOrdem = [...arquivadas].sort((a, b) =>
    rotuloDaChave(a.chave).localeCompare(rotuloDaChave(b.chave), "pt-BR"),
  );

  return (
    <div className="rounded-md border">
      <button
        type="button"
        aria-expanded={aberta}
        onClick={() => setAberta((antes) => !antes)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50"
        data-testid="gaveta-de-arquivados"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            aberta && "rotate-90",
          )}
        />
        <Archive className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Arquivados
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {emOrdem.length}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Fora da lista e fora do ar — nada foi apagado.
        </span>
      </button>

      {aberta && (
        <div className="divide-y border-t">
          {emOrdem.map((linha) => (
            <div
              key={linha.chave}
              className="flex flex-wrap items-center gap-3 px-4 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-muted-foreground">
                  {rotuloDaChave(linha.chave)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {linha.chave} · arquivado por {linha.arquivadoPor} ·{" "}
                  {new Date(linha.arquivadoEm).toLocaleString("pt-BR")}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={desabilitado}
                title={`Devolver ${rotuloDaChave(linha.chave)} à lista — ele continua fora do ar`}
                onClick={() => aoDesarquivar(linha.chave)}
                data-testid={`desarquivar-${linha.chave}`}
              >
                <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                Desarquivar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Arquivar — a decisão sobre a **lista**, e não sobre o acesso.
 *
 * Discreto de propósito, ao lado do botão vermelho que o precede: ele não muda
 * o menu de ninguém, não tira nada do ar e não apaga linha nenhuma. O que ele
 * faz é tirar da matriz o que a casa já decidiu que não usa, e a frase do
 * `title` diz isso inteiro — quem clica aqui esperando "excluir" precisa
 * descobrir antes, e não depois, que a decisão continua guardada.
 */
function BotaoArquivar({
  chave,
  desabilitado,
  rotulo,
  aoArquivar,
}: {
  chave: string;
  desabilitado: boolean;
  rotulo: string;
  aoArquivar: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-2 text-muted-foreground"
      disabled={desabilitado}
      title={`Arquivar ${rotulo}: sai desta lista e vai para a gaveta de arquivados. Continua fora do ar, nada é apagado, e volta com um clique.`}
      onClick={aoArquivar}
      data-testid={`arquivar-${chave}`}
    >
      <Archive className="mr-1.5 h-3.5 w-3.5" />
      Arquivar
    </Button>
  );
}

/**
 * Os três níveis de uma vez, para um grupo inteiro.
 *
 * É o gesto que existia como "Liberar tudo / Só visualizar / Bloquear tudo" no
 * topo, agora também por seção — porque é assim que um perfil se descreve na
 * prática: um `Leitor` de Frota é "esta seção inteira em visualizar", e não
 * doze cliques idênticos em fila. Vale para os itens da seção que a busca
 * deixou na tela, e a linha acima diz quantos ela escondeu.
 */
function AplicarAoGrupo({
  rotulo,
  aoAplicar,
}: {
  rotulo: string;
  aoAplicar: (nivel: Nivel) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      {NIVEIS_NA_TELA.map(({ nivel, rotulo: nome }) => (
        <Button
          key={nivel}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs font-semibold"
          onClick={() => aoAplicar(nivel)}
        >
          {nome}
        </Button>
      ))}
    </span>
  );
}

/** Uma linha da matriz — o que ela alcança, de onde isso vem, e os gestos. */
function Linha({
  titulo,
  subtitulo,
  chave,
  nivel,
  herdadoDe,
  nomeDaHeranca,
  desligadaNaCasa,
  desligadaPelaSecao = false,
  protegida,
  desabilitado,
  aoEscolher,
  aoVoltar,
  aoInativar,
  aoArquivar,
}: {
  titulo: string;
  subtitulo: string;
  chave: string;
  nivel: Nivel;
  /** O que a camada de baixo dá, ou `null` quando não há camada de baixo. */
  herdadoDe: Nivel | null;
  nomeDaHeranca: string | null;
  desligadaNaCasa: boolean;
  desligadaPelaSecao?: boolean;
  protegida: boolean;
  desabilitado: boolean;
  aoEscolher: (nivel: Nivel) => void;
  aoVoltar: () => void;
  aoInativar?: (chave: string, ligado: boolean) => void;
  aoArquivar?: (chave: string, arquivado: boolean) => void;
}) {
  const excecao = herdadoDe !== null && nivel !== herdadoDe;

  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              desligadaNaCasa && "text-muted-foreground line-through",
            )}
          >
            {titulo}
          </span>
          {protegida && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
              <Lock className="h-2.5 w-2.5" />
              Sempre no ar
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{subtitulo}</span>
        <Procedencia
          nivel={nivel}
          herdado={herdadoDe}
          excecao={excecao}
          nomeDaHeranca={nomeDaHeranca}
          desligadaNaCasa={desligadaNaCasa}
          desligadaPelaSecao={desligadaPelaSecao}
          podeReativar={aoInativar !== undefined}
        />
      </span>

      <span className="flex items-center gap-1.5">
        {aoArquivar !== undefined &&
          !protegida &&
          !desligadaPelaSecao &&
          desligadaNaCasa && (
            /*
              Só sobre chave desligada, e por isso depois do botão de cima: a
              ordem dos dois é a ordem dos gestos — tira-se do ar, e só então se
              tira da lista. Oferecê-lo sobre uma chave no ar seria oferecer o
              gesto que o servidor recusa.
            */
            <BotaoArquivar
              chave={chave}
              desabilitado={desabilitado}
              rotulo={titulo}
              aoArquivar={() => aoArquivar(chave, true)}
            />
          )}
        {aoInativar !== undefined && !protegida && !desligadaPelaSecao && (
          <BotaoInativar
            chave={chave}
            desligada={desligadaNaCasa}
            desabilitado={desabilitado}
            rotulo={titulo}
            aoAlternar={(ligado) => aoInativar(chave, ligado)}
          />
        )}
        <BotoesDeNivel
          chave={chave}
          nivel={nivel}
          desabilitado={desabilitado || desligadaNaCasa}
          aoEscolher={aoEscolher}
        />
        {excecao && (
          <VoltarAoPerfil desabilitado={desabilitado} aoVoltar={aoVoltar} />
        )}
      </span>
    </div>
  );
}

/**
 * Inativar — a decisão da casa, e não a de um perfil.
 *
 * Vermelho e à esquerda dos três níveis, porque é o que vence os três: o que
 * for inativado aqui não aparece no menu de **ninguém** — nem de quem
 * administra —, nenhum perfil o devolve e o portão do servidor recusa a escrita
 * dele. É a diferença entre "esta operação não usa QLP" e "o conferente não
 * mexe em QLP", e as duas frases precisavam de gestos diferentes.
 *
 * Cada clique grava, como os três níveis e pela mesma razão: um rascunho não
 * gravado seria uma tela mostrando um menu que ninguém tem.
 */
function BotaoInativar({
  chave,
  desligada,
  desabilitado,
  rotulo,
  aoAlternar,
}: {
  /** A chave que o clique grava — e o que identifica o botão na suíte. */
  chave: string;
  desligada: boolean;
  desabilitado: boolean;
  rotulo: string;
  aoAlternar: (ligado: boolean) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={desligada}
      disabled={desabilitado}
      className={cn(
        "h-8",
        desligada
          ? "bg-rose-600 text-white border-rose-600 hover:bg-rose-600"
          : "border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800",
      )}
      title={
        desligada
          ? `Devolver ${rotulo} ao ar para toda a instalação`
          : `Tirar ${rotulo} do ar para toda a instalação`
      }
      onClick={() => aoAlternar(desligada)}
      data-testid={`inativar-${chave}`}
    >
      {desligada ? (
        <Power className="w-3.5 h-3.5 mr-1.5" />
      ) : (
        <EyeOff className="w-3.5 h-3.5 mr-1.5" />
      )}
      {desligada ? "Reativar" : "Inativar"}
    </Button>
  );
}

/**
 * De onde vem o que está valendo nesta linha.
 *
 * A camada da casa vence as outras duas, e por isso é dita antes: chamar de
 * "herdado do perfil" uma chave que a instalação inativou mandaria quem lê
 * procurar no lugar errado — e mexer no perfil não devolveria nada.
 */
function Procedencia({
  nivel,
  herdado,
  excecao,
  nomeDaHeranca,
  desligadaNaCasa,
  desligadaPelaSecao,
  podeReativar,
}: {
  nivel: Nivel;
  herdado: Nivel | null;
  excecao: boolean;
  nomeDaHeranca: string | null;
  desligadaNaCasa: boolean;
  desligadaPelaSecao: boolean;
  podeReativar: boolean;
}) {
  if (desligadaPelaSecao) {
    return (
      <span className="block text-xs text-rose-700">
        Fora do ar pela seção · para devolvê-lo ao menu, reative a seção primeiro.
      </span>
    );
  }

  if (desligadaNaCasa) {
    return (
      <span className="block text-xs text-rose-700">
        Inativado para toda a instalação — não aparece para ninguém, e nenhum
        perfil o devolve
        {podeReativar ? "." : " (a decisão se desfaz na aba Por perfil)."}
      </span>
    );
  }

  if (herdado === null) return null;
  const perfil = nomeDaHeranca ?? "perfil";

  if (!excecao) {
    return (
      <span className="block text-xs text-muted-foreground/80">
        {`Herdado de ${perfil}${herdado === "EDITAR" ? ", que alcança tudo aqui" : ""}.`}
      </span>
    );
  }

  return (
    <span className="block text-xs text-amber-700">
      Exceção desta conta — {perfil} dá {rotuloDoNivel(herdado)}.
    </span>
  );
}

function VoltarAoPerfil({
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
      title="Apagar a exceção e voltar a herdar do perfil"
      onClick={aoVoltar}
    >
      <RotateCcw className="w-3.5 h-3.5" />
      <span className="sr-only">Voltar ao perfil</span>
    </Button>
  );
}

/**
 * Os três botões de nível — os mesmos para um módulo, um ambiente e um perfil.
 *
 * A ordem, as cores e o `aria-pressed` têm de ser idênticos em toda parte, e
 * duas cópias divergiriam na primeira mudança de qualquer um deles.
 */
export function BotoesDeNivel({
  chave,
  nivel,
  desabilitado,
  aoEscolher,
}: {
  /** A chave da linha, quando há uma — só serve para identificar os botões. */
  chave?: string;
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
          {...(chave === undefined
            ? {}
            : { "data-testid": `nivel-${opcao}-${chave}` })}
        >
          <Icone className="w-3.5 h-3.5 mr-1.5" />
          {rotulo}
        </Button>
      ))}
    </span>
  );
}
