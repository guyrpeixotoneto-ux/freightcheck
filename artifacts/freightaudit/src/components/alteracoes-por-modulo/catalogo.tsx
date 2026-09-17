import { ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type {
  AreaNoCatalogo,
  CartaoDeModulo,
} from "@workspace/comparison/alteracoes-por-modulo";
import { Superficie } from "@/components/ui/superficie";
import { Button } from "@/components/ui/button";
import { formatBrl, formatNumber } from "@/lib/format";
import {
  corDoValor,
  SUFIXO_DA_PERIODICIDADE,
  rotuloDaPeriodicidade,
} from "@/lib/monitor-custo-fixo";
import { nomeDaCobertura, nomeDoCartao } from "@/lib/alteracoes-por-modulo";
import { cn } from "@/lib/utils";

/**
 * O CATÁLOGO — uma faixa por família de custo, um cartão por módulo.
 *
 * ---------------------------------------------------------------------------
 * O cartão é o mesmo dos Monitores, e é de propósito
 * ---------------------------------------------------------------------------
 * Mesma ordem de campos, mesma régua de cor, mesma frase quando não há dinheiro.
 * Quem lê o cartão do IPVA no Monitor Custo Fixo reconhece o de Pneu aqui sem
 * aprender um segundo vocabulário — e a diferença entre os dois cartões passa a
 * ser só o que as rubricas de fato medem, que é a informação.
 *
 * O que ele tem a mais é o **pé**: a cobertura e o par contra o qual aquele
 * módulo foi apurado. Nos Monitores esse dado é redundante — lá há um par por
 * tela, dito no seletor. Aqui há quatro, e um cartão que os escondesse poria
 * dois números apurados contra vigências diferentes lado a lado como se fossem
 * do mesmo recorte.
 *
 * ---------------------------------------------------------------------------
 * O clique é um só, e leva à auditoria
 * ---------------------------------------------------------------------------
 * Nos Monitores são dois — um filtra a tabela daquela tela, o outro abre a
 * auditoria — porque lá há uma tabela embaixo para filtrar. Aqui não há: esta é
 * a leitura de altitude, e o passo seguinte de quem viu algo se mover é abrir o
 * módulo. Inventar um filtro que não recorta nada seria um botão que promete e
 * não entrega.
 */
export function CatalogoDeAlteracoes({
  areas,
  endereco,
}: {
  areas: readonly AreaNoCatalogo[];
  /** O endereço da auditoria de um cartão, com o par dele — ver `enderecoDoCartao`. */
  endereco: (cartao: CartaoDeModulo) => string;
}) {
  return (
    <div className="flex flex-col gap-6">
      {areas.map((area) => (
        <FaixaDaArea key={area.area} area={area} endereco={endereco} />
      ))}
    </div>
  );
}

function FaixaDaArea({
  area,
  endereco,
}: {
  area: AreaNoCatalogo;
  endereco: (cartao: CartaoDeModulo) => string;
}) {
  const baldes = Object.entries(area.porPeriodicidade);

  return (
    <section className="flex flex-col gap-2" aria-labelledby={`area-${area.area}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col">
          <h2 id={`area-${area.area}`} className="text-sm font-semibold">
            {area.rotulo}
          </h2>
          <p className="text-xs text-muted-foreground">{area.descricao}</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {formatNumber(area.alteracoes, 0)}{" "}
            {area.alteracoes === 1 ? "alteração" : "alterações"} em{" "}
            {formatNumber(area.modulosApurados, 0)}{" "}
            {area.modulosApurados === 1 ? "módulo apurado" : "módulos apurados"}
          </span>
          {/*
            O balde da área é a soma, por periodicidade, do que cada módulo já
            tinha publicado — e continuam sendo baldes: R$/mês e R$/ano não viram
            um total aqui como não viram em lugar nenhum deste produto.
          */}
          {baldes.map(([periodicidade, valor]) => (
            <span key={periodicidade} className="flex items-baseline gap-1">
              <span className="text-muted-foreground">
                {rotuloDaPeriodicidade(periodicidade)}
              </span>
              <span
                className={cn("font-mono font-semibold tabular-nums", corDoValor(valor))}
              >
                {formatBrl(valor)}
                {SUFIXO_DA_PERIODICIDADE[periodicidade] ?? ""}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/*
        A cobertura inteira sem par vira **uma** faixa, e não um cartão vazio por
        módulo. O QLP tem dezesseis assuntos em dois quadros: sem importação, a
        régua honesta de "o módulo ausente não some" produziria trinta e dois
        cartões dizendo a mesma frase, e a família que de fato se moveu ficaria
        embaixo deles. A informação é a mesma — quais módulos ficaram de fora e
        por quê —, dita uma vez.
      */}
      {ausentesPorCobertura(area).map(([cobertura, cartoes]) => (
        <CoberturaSemPar key={cobertura} cartoes={cartoes} />
      ))}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {apurados(area).map((cartao) => (
          <CartaoDoModulo
            key={`${cartao.cobertura}:${cartao.modulo}`}
            cartao={cartao}
            endereco={endereco(cartao)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Os cartões que a faixa desenha um a um — os apurados, e os ausentes avulsos.
 *
 * Um módulo ausente **no meio de uma cobertura que entrou** continua sendo
 * cartão: ali a ausência é dele, e não da importação, e some se a faixa o
 * engolir. O que vira faixa é só a cobertura inteira de fora.
 */
function apurados(area: AreaNoCatalogo): CartaoDeModulo[] {
  const engolidas = new Set(ausentesPorCobertura(area).map(([cobertura]) => cobertura));
  return area.cartoes.filter((c) => !engolidas.has(c.cobertura));
}

/** As coberturas desta área em que **nenhum** módulo entrou, com os cartões delas. */
function ausentesPorCobertura(area: AreaNoCatalogo): [string, CartaoDeModulo[]][] {
  const porCobertura = new Map<string, CartaoDeModulo[]>();
  for (const cartao of area.cartoes) {
    const lista = porCobertura.get(cartao.cobertura);
    if (lista) lista.push(cartao);
    else porCobertura.set(cartao.cobertura, [cartao]);
  }
  return [...porCobertura.entries()].filter(([, cartoes]) =>
    cartoes.every((c) => c.par === null),
  );
}

/**
 * Uma cobertura que não entrou — a frase uma vez, e os módulos que ela cobria.
 *
 * Os nomes ficam porque são a outra metade da resposta: sem eles a faixa diria
 * que falta uma importação sem dizer o que se deixa de ver por causa dela.
 */
function CoberturaSemPar({ cartoes }: { cartoes: readonly CartaoDeModulo[] }) {
  const primeiro = cartoes[0];
  if (!primeiro) return null;
  return (
    <Superficie className="flex flex-col gap-1 px-4 py-3">
      <span className="text-xs font-semibold">
        {nomeDaCobertura(primeiro.cobertura)}
      </span>
      <p className="text-[0.7rem] text-muted-foreground">{primeiro.ausente}</p>
      <p className="text-[0.7rem] text-muted-foreground">
        Sem par, ficam de fora {cartoes.length}{" "}
        {cartoes.length === 1 ? "módulo" : "módulos"}:{" "}
        {cartoes.map(nomeDoCartao).join(", ")}.
      </p>
    </Superficie>
  );
}

export function CartaoDoModulo({
  cartao,
  endereco,
}: {
  cartao: CartaoDeModulo;
  /** O endereço da auditoria, já com o par deste cartão — ver `enderecoDoCartao`. */
  endereco: string;
}) {
  const ausente = cartao.par === null;

  return (
    <Superficie
      className={cn("flex flex-col gap-2 px-4 py-3", ausente && "opacity-70")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{nomeDoCartao(cartao)}</span>
          <span className="text-xs text-muted-foreground">
            {nomeDaCobertura(cartao.cobertura)}
          </span>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href={endereco}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only sm:ml-1 sm:text-xs">
              Abrir auditoria
            </span>
          </Link>
        </Button>
      </div>

      {/*
        O módulo sem par não mostra zeros. Zero é uma medição, e aqui não houve
        nenhuma — o que há é a frase que diz o que falta para haver.
      */}
      {ausente ? (
        <p className="border-t pt-2 text-[0.7rem] text-muted-foreground">
          {cartao.ausente}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Par rotulo="Alterações" valor={formatNumber(cartao.alteracoes, 0)} />
            <Par
              rotulo={cartao.rotuloDaEntidade}
              valor={formatNumber(cartao.entidades, 0)}
            />
            {cartao.ganhos !== null && (
              <Par rotulo="Ganhos" valor={formatNumber(cartao.ganhos, 0)} />
            )}
            {cartao.perdas !== null && (
              <Par rotulo="Perdas" valor={formatNumber(cartao.perdas, 0)} />
            )}
          </dl>

          <ImpactoDoCartao cartao={cartao} />
          <NotasDoCartao cartao={cartao} />
          <ParDoCartao cartao={cartao} />
        </>
      )}
    </Superficie>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="font-mono tabular-nums">{valor}</dd>
    </div>
  );
}

/**
 * O impacto do módulo, uma linha por periodicidade — e a frase quando não há.
 *
 * As duas ausências são duas, e a tela as separa: `semImpacto` é a que o domínio
 * declara permanente (o QLP sem semântica confirmada, o minuto do TMA) e pede
 * explicação; o balde vazio sem ela é deste recorte, e pede outro par.
 */
function ImpactoDoCartao({ cartao }: { cartao: CartaoDeModulo }) {
  const baldes = Object.entries(cartao.porPeriodicidade);

  if (baldes.length === 0) {
    return (
      <p className="border-t pt-2 text-[0.7rem] text-muted-foreground">
        {cartao.semImpacto ??
          "Nenhuma alteração deste módulo virou dinheiro neste recorte."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 border-t pt-2">
      {baldes.map(([periodicidade, valor]) => (
        <div
          key={periodicidade}
          className="flex items-baseline justify-between gap-2 text-xs"
        >
          <span className="text-muted-foreground">
            {rotuloDaPeriodicidade(periodicidade)}
          </span>
          <span
            className={cn("font-mono font-semibold tabular-nums", corDoValor(valor))}
          >
            {formatBrl(valor)}
            {SUFIXO_DA_PERIODICIDADE[periodicidade] ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/** As pendências que só este módulo conhece — o número da tela, a frase do domínio. */
function NotasDoCartao({ cartao }: { cartao: CartaoDeModulo }) {
  if (cartao.notas.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 border-t pt-2 text-[0.7rem] text-muted-foreground">
      {cartao.notas.map((nota) => (
        <li key={nota.frase}>
          {formatNumber(nota.quantidade, 0)} {nota.frase}
        </li>
      ))}
    </ul>
  );
}

/** Contra que par este cartão foi apurado — o pé que os Monitores não precisam ter. */
function ParDoCartao({ cartao }: { cartao: CartaoDeModulo }) {
  if (!cartao.par) return null;
  const de = cartao.par.baseRotulo ?? cartao.par.baseData ?? cartao.par.baseId;
  const para =
    cartao.par.comparadaRotulo ?? cartao.par.comparadaData ?? cartao.par.comparadaId;
  return (
    <p className="border-t pt-2 text-[0.7rem] text-muted-foreground">
      {de} → {para}
    </p>
  );
}
