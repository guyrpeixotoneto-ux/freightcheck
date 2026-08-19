import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, Building2, Link2, ScrollText } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apresentar } from "@/lib/apresentar-erro";
import { cn } from "@/lib/utils";
import {
  escreverValor,
  lerCadastro,
  listarUnidadesDoCadastro,
  NOME_DO_PREENCHIMENTO,
  type BlocoApurado,
  type CadastroDaUnidade,
  type LinhaApurada,
} from "@/lib/remuneracao";

/**
 * Remuneração — o cadastro da planilha, por unidade.
 *
 * Esta é a aba que abre a pasta de Excel: as quatro alíquotas, o tamanho da
 * frota, quanto vale cada parcela por veículo, quantas vans, quantas rotas
 * noturnas, e as duas proporções que decidem se o documento sai como ISS ou
 * como CT-e. Tudo o mais na planilha puxa daqui, e é por isso que ela é a
 * primeira coisa do Fechamento que valia a pena reproduzir.
 *
 * **Por que a tela mostra as linhas que não têm número.** Porque a planilha as
 * tem, e a pergunta de quem abre é "o cadastro desta unidade está completo?".
 * Hoje, sobre um acervo completo, onze das trinta linhas têm lastro; uma tela
 * que listasse só essas onze responderia "está completo" todos os dias, e
 * estaria calando as outras dezenove. Cada linha sem lastro diz o que falta e
 * onde olhar hoje — o mesmo contrato das telas em preparo, aplicado uma linha
 * de cada vez em vez de uma tela inteira.
 *
 * **Por que cada número apurado carrega a regra junto.** Porque este cadastro
 * mede o que a planilha digita: onde o Excel tem uma célula azul preenchida à
 * mão, aqui há uma razão entre duas colunas do export. Quem confere precisa
 * poder discordar da medição, e para discordar precisa vê-la.
 *
 * A unidade e a vigência moram no endereço, não em estado da tela:
 * compartilhar o link compartilha o cadastro que se estava olhando, e voltar no
 * histórico volta os dois juntos.
 */

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível carregar o cadastro.";
}

/** `abc123` + canal → a chave de um item do seletor, e o par que a URL carrega. */
function chaveDaUnidade(scopeHash: string, canal: string | null): string {
  return `${scopeHash}::${canal ?? ""}`;
}

export default function RemuneracaoCadastro() {
  const busca = useSearch();
  const [, navegar] = useLocation();
  const params = new URLSearchParams(busca);

  const scopeHashPedido = params.get("scopeHash");
  const canalPedido = params.get("canal");
  const vigenciaPedida = params.get("period");

  const unidades = useQuery({
    queryKey: ["remuneracao", "unidades"],
    queryFn: listarUnidadesDoCadastro,
  });

  const cadastro = useQuery({
    queryKey: ["remuneracao", "cadastro", scopeHashPedido, canalPedido, vigenciaPedida],
    queryFn: () =>
      lerCadastro({
        ...(scopeHashPedido ? { scopeHash: scopeHashPedido } : {}),
        ...(canalPedido !== null ? { canal: canalPedido } : {}),
        ...(vigenciaPedida ? { period: vigenciaPedida } : {}),
      }),
  });

  /*
    Trocar de unidade limpa a vigência do endereço. As vigências de uma unidade
    são dela: manter a data ao pular para outra pediria uma quinzena que a nova
    pode não ter, e a resposta seria um 404 no lugar de um cadastro — punindo
    quem só quis trocar de CDD.
  */
  function irParaUnidade(chave: string) {
    const [scopeHash, canal] = chave.split("::");
    /*
      O canal vai sempre no endereço, mesmo vazio. Uma unidade pode ter uma
      série com canal e outra sem, no mesmo `scopeHash`; omitir o parâmetro
      pediria "qualquer canal" e o servidor escolheria o primeiro — e a tela
      abriria numa série que ninguém pediu. `canal=` é o pedido explícito pela
      série sem canal, e é assim que `routes/remuneracao.ts` o lê.
    */
    const query = new URLSearchParams({ scopeHash, canal });
    navegar(`/fechamento/remuneracao?${query}`);
  }

  function irParaVigencia(period: string) {
    const query = new URLSearchParams(busca);
    query.set("period", period);
    navegar(`/fechamento/remuneracao?${query}`);
  }

  const dados = cadastro.data;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-nav-fechamento" />
          <h1 className="text-2xl font-bold tracking-tight">Remuneração</h1>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          O cadastro que abre a planilha de remuneração desta unidade — alíquotas, frota,
          parcelas por veículo e proporção de documentos. Cada linha diz de onde o número
          veio no acervo da Auditoria, ou o que falta para ele existir.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-5xl">
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="unidade"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Unidade
                </label>
                <Select
                  value={
                    dados ? chaveDaUnidade(dados.contexto.scopeHash, dados.contexto.channel) : ""
                  }
                  onValueChange={irParaUnidade}
                  disabled={!unidades.data || unidades.data.length === 0}
                >
                  <SelectTrigger id="unidade">
                    <SelectValue placeholder="Escolha a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades.data?.map((u) => (
                      <SelectItem
                        key={chaveDaUnidade(u.scopeHash, u.canal)}
                        value={chaveDaUnidade(u.scopeHash, u.canal)}
                      >
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="vigencia"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Vigência
                </label>
                <Select
                  value={dados?.effectiveDate ?? ""}
                  onValueChange={irParaVigencia}
                  disabled={!dados}
                >
                  <SelectTrigger id="vigencia">
                    <SelectValue placeholder="Escolha a vigência" />
                  </SelectTrigger>
                  <SelectContent>
                    {dados?.vigencias.map((v) => (
                      <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
                        {v.periodLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground border-t pt-3">
              <Link2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                O cadastro é da <strong>unidade numa vigência</strong>, e não de uma competência:
                ele descreve o que a Ambev contratou, que é o que a Auditoria guarda. É por isso
                que a lista de períodos aqui é de vigências, e não das quinzenas abertas em
                Competências.
              </span>
            </p>
          </CardContent>
        </Card>

        {cadastro.isLoading && (
          <p className="text-sm text-muted-foreground">Montando o cadastro…</p>
        )}

        {cadastro.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(cadastro.error)}</AlertDescription>
          </Alert>
        )}

        {dados && (
          <>
            <Lastro dados={dados} />
            {dados.blocos.map((bloco) => (
              <Bloco key={bloco.titulo} bloco={bloco} />
            ))}
            <Legenda />
          </>
        )}
      </div>
    </Layout>
  );
}

/**
 * O lastro, antes das linhas.
 *
 * Quantas linhas o acervo sustenta e o que a vigência entregou vêm primeiro
 * porque são o que decide como ler o resto: trinta linhas com onze apuradas é
 * um cadastro em construção, e quem abre precisa saber disso antes de olhar o
 * primeiro número — e não depois de rolar até o rodapé.
 */
function Lastro({ dados }: { dados: CadastroDaUnidade }) {
  const { resumo, material, contexto, periodLabel } = dados;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          {contexto.label} · {periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Numero titulo="Linhas do cadastro" valor={resumo.linhas} />
          <Numero titulo="Com lastro" valor={resumo.apuradas} destaque />
          <Numero titulo="Medidas em par" valor={resumo.emConjunto} />
          <Numero titulo="Sem lastro" valor={resumo.semLastro} />
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          Esta vigência entregou{" "}
          <strong>
            {material.cavalos.toLocaleString("pt-BR")}{" "}
            {material.cavalos === 1 ? "cavalo" : "cavalos"}
          </strong>{" "}
          e{" "}
          <strong>
            {material.trechos.toLocaleString("pt-BR")}{" "}
            {material.trechos === 1 ? "trecho" : "trechos"}
          </strong>
          {material.trechosEntregues
            ? "."
            : " — a série de trechos não foi entregue nesta vigência, e é dela que saem as alíquotas e as proporções."}{" "}
          Nenhuma linha abaixo mostra número que esses registros não sustentem.
        </p>
      </CardContent>
    </Card>
  );
}

function Numero({
  titulo,
  valor,
  destaque = false,
}: {
  titulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums mt-0.5",
          destaque && valor > 0 && "text-nav-fechamento",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

function Bloco({ bloco }: { bloco: BlocoApurado }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-wide">{bloco.titulo}</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">{bloco.resumo}</p>
      </CardHeader>
      <CardContent className="p-0">
        <ul>
          {bloco.linhas.map((linha) => (
            <Linha key={linha.chave} linha={linha} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Uma linha do cadastro.
 *
 * Três formas, uma por estado, e a diferença entre elas é deliberadamente
 * visível de longe: a linha apurada tem número à direita; a medida em par tem o
 * par escrito por extenso, sem fingir que a metade é dela; a sem lastro tem
 * travessão e o motivo logo abaixo. Nenhuma das três deixa a coluna da direita
 * vazia e calada — vazio é o que faz quem confere concluir "então é zero".
 */
function Linha({ linha }: { linha: LinhaApurada }) {
  const informado = linha.preenchimento === "INFORMADO";

  return (
    <li className="border-t first:border-t-0 px-6 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            <span
              aria-hidden
              title={NOME_DO_PREENCHIMENTO[linha.preenchimento]}
              className={cn(
                "w-2 h-2 rounded-sm shrink-0",
                informado ? "bg-sky-300" : "bg-muted-foreground/30",
              )}
            />
            {linha.rotulo}
          </p>
        </div>

        <div className="text-right shrink-0">
          {linha.estado === "APURADO" && linha.valor !== null && (
            <span className="text-base font-bold tabular-nums">
              {escreverValor(linha.valor, linha.medida)}
            </span>
          )}
          {linha.estado === "EM_CONJUNTO" && linha.conjunto && (
            <span className="text-sm font-semibold tabular-nums text-muted-foreground">
              {linha.conjunto.rotulo} = {escreverValor(linha.conjunto.valor, linha.conjunto.medida)}
            </span>
          )}
          {linha.estado === "SEM_LASTRO" && (
            <span className="text-base font-bold text-muted-foreground/60" aria-label="sem lastro">
              —
            </span>
          )}
        </div>
      </div>

      {linha.procedencia && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {linha.procedencia.regra}
          {linha.procedencia.colunas.length > 0 && (
            <>
              {" "}
              <span className="whitespace-nowrap">
                {linha.procedencia.colunas.map((coluna) => (
                  <code
                    key={coluna}
                    className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]"
                  >
                    {coluna}
                  </code>
                ))}
              </span>
            </>
          )}
        </p>
      )}

      {linha.conjunto && (
        <p className="mt-1.5 text-xs text-muted-foreground">{linha.conjunto.procedencia.regra}</p>
      )}

      {linha.ausencia && (
        <div className="mt-1.5 space-y-1">
          <p className="text-xs text-muted-foreground">{linha.ausencia.motivo}</p>
          <p className="text-xs text-muted-foreground/80">
            <span className="font-semibold">Destrava:</span> {linha.ausencia.destrava}
          </p>
          {linha.ausencia.hoje && (
            <Link
              href={linha.ausencia.hoje.href}
              className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
            >
              {linha.ausencia.hoje.label}
              <ArrowRight className="w-3 h-3" />
              <span className="font-normal text-muted-foreground">
                {linha.ausencia.hoje.porque}
              </span>
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A legenda da planilha, mantida.
 *
 * Ela existe no Excel e diz o que a cor de cada célula significa. Reproduzi-la
 * aqui não é enfeite: é o que permite ler esta tela ao lado da planilha sem
 * traduzir nada — e é a informação que decide o que este módulo pode aspirar a
 * substituir. Cinza é conta, e conta nós refazemos; azul é decisão, e decisão
 * continua sendo de quem assina.
 */
function Legenda() {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Legenda
        </p>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span aria-hidden className="w-2 h-2 rounded-sm bg-sky-300" />
            Preencher informações — a planilha pede a uma pessoa
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="w-2 h-2 rounded-sm bg-muted-foreground/30" />
            Preenchimento automático — a planilha deriva de outras células
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
