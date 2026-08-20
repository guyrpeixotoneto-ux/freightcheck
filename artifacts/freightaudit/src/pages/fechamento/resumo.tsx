import { Fragment, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { FileSpreadsheet, ArrowRight } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apresentar } from "@/lib/apresentar-erro";
import { formatBrl } from "@/lib/format";
import { MES_LONGO } from "@/lib/fechamento-gerencial";
import {
  lerResumoDoMes,
  listarPartes,
  rotuloDoTipo,
  TIPO_NAO_INFORMADO,
  TIPOS_PARA_LER,
  type CanalDoResumo,
  type PainelComparado,
  type ResumoDoMes,
  type TresColunas,
} from "@/lib/fechamento";
import {
  PainelDaPlanilhaTabela,
  type ColunaDoPainel,
} from "@/components/fechamento/painel-da-planilha";
import { cn } from "@/lib/utils";

/**
 * O RESUMO GERAL — o mês do fechamento numa página, no formato em que ele é
 * discutido.
 *
 * A apuração tem grão de quinzena, que é o grão certo para apurar. O documento
 * que a transportadora leva para a mesa tem grão de **mês**: a aba `Resumo
 * Geral` da planilha põe 1ª quinzena, 2ª quinzena e TOTAL lado a lado, e é
 * olhando para as três colunas que alguém decide se o mês fecha. Esta tela é
 * essa aba.
 *
 * **Três posições e não três telas.** `1ª quinzena`, `2ª quinzena` e
 * `Consolidado` são recortes do mesmo dado, buscado uma vez. Nas duas primeiras
 * a pergunta é de conferência — emitido contra apurado, verba a verba —; no
 * consolidado é de fechamento — as três colunas da planilha e o total do mês.
 * Separá-las em rotas diferentes faria trocar de recorte custar uma ida ao
 * servidor, e é justamente entre eles que se fica indo e voltando.
 *
 * **Duas abas, e não uma escolha entre dois rótulos.** `Verbas` mostra o
 * recorte com que o sistema apura — a VBZ, que os arquivos sustentam uma a uma.
 * `Planilha` mostra o recorte com que a Ambev e a transportadora conversam —
 * `Custo fixo padronizado`, `Custo variável (agregado)`, `Desconto de
 * devolução`. Não dá para escolher um: as linhas do primeiro quadro da planilha
 * são um rateio por tipo de frota que o 03.08.20 não faz, e escrevê-las sobre
 * as verbas daria cara de conferido ao que não foi; mas conferir só por verba
 * obriga quem discute o mês a casar de cabeça com o `.xlsb` aberto ao lado. As
 * duas abas fecham no mesmo `Total remuneração (03.08.20)`, e é isso que faz
 * delas duas vistas e não duas contas. A tradução entre elas mora em
 * `de-para.ts`, em `@workspace/fechamento`, que diz o que casa verba a verba, o
 * que só casa em conjunto e o que continua sem casar — com o motivo escrito em
 * cada caso.
 *
 * **Por que o fecho compara com o 03.08.20 e não com o `TOTAL GERAL UNIDADE`.**
 * Aquela coluna é a reconstrução da própria planilha, feita com um fator de
 * conversão digitado (1,366960) que não sai de arquivo nenhum. O que esta tela
 * põe lado a lado são os dois números que têm documento: o que foi **emitido**
 * em CT-e e o que o demonstrativo **assinado** diz. A diferença entre eles é a
 * mesma linha que a planilha chama de `DIFERENÇA - TOTAL GERAL`.
 *
 * **Tudo vive na URL** — unidade, transportadora, ano, mês e o recorte —, para
 * que o endereço colado numa mensagem abra exatamente o que quem colou estava
 * vendo. É a mesma decisão do ano na Visão Gerencial.
 */

type Recorte = "1" | "2" | "consolidado";
type Aba = "verbas" | "planilha";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível carregar o resumo.";
}

/** `null` é ausência e aparece como traço — nunca como `R$ 0,00`. */
function dinheiro(valor: number | null): string {
  return valor === null ? "—" : formatBrl(valor);
}

const ANOS = [0, 1, 2].map((n) => new Date().getFullYear() - n);

export default function ResumoGeral() {
  const busca = useSearch();
  const [, navegar] = useLocation();
  const parametros = useMemo(() => new URLSearchParams(busca), [busca]);

  const unidade = parametros.get("unidade") ?? "";
  const transportadora = parametros.get("transportadora") ?? "";
  /*
    Desde a `0046` o fechamento é de uma **operação**, e não da unidade: a mesma
    CAMAÇARI tem EMPURRADA e ROTA na mesma quinzena, com contas separadas. Sem
    este recorte as duas cairiam nas mesmas duas colunas do resumo e o mês
    somaria duas operações num total só.
  */
  const tipoDeOperacao = parametros.get("tipoDeOperacao") ?? "";
  const ano = Number(parametros.get("ano") ?? ANOS[0]);
  const mes = Number(parametros.get("mes") ?? new Date().getMonth() + 1);
  const recorte = (parametros.get("ver") ?? "consolidado") as Recorte;
  const aba = (parametros.get("aba") ?? "verbas") as Aba;

  const trocar = (campo: string, valor: string) => {
    const proximos = new URLSearchParams(parametros);
    proximos.set(campo, valor);
    navegar(`/fechamento/resumo?${proximos.toString()}`);
  };

  const partes = useQuery({ queryKey: ["fechamento", "partes"], queryFn: listarPartes });
  const escolhido = unidade !== "" && transportadora !== "" && tipoDeOperacao !== "";
  const resumo = useQuery({
    queryKey: ["fechamento", "resumo", unidade, transportadora, tipoDeOperacao, ano, mes],
    queryFn: () => lerResumoDoMes({ unidade, transportadora, tipoDeOperacao, ano, mes }),
    enabled: escolhido,
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Resumo geral</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          O mês de um fechamento nas três colunas em que ele é discutido: a 1ª
          quinzena, a 2ª e o total. Cada linha é uma verba, e cada número tem o
          arquivo de onde saiu.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-6xl">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              Qual fechamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unidade">Unidade (CDD)</Label>
                <Select value={unidade} onValueChange={(v) => trocar("unidade", v)}>
                  <SelectTrigger id="unidade">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {(partes.data?.unidades ?? []).map((p) => (
                      <SelectItem key={p.codigo} value={p.codigo}>
                        {p.nome ? `${p.codigo} — ${p.nome}` : p.codigo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/*
                O tipo vem logo depois da unidade porque é com ela que ele forma
                a operação: "CAMAÇARI · EMPURRADA" é uma coisa e "CAMAÇARI ·
                ROTA" é outra, com contas separadas desde a `0046`.

                A lista é a de **ler** (`TIPOS_PARA_LER`), e não a de abrir: ela
                tem o `NAO_INFORMADO` do backfill. Quem abre não pode escolhê-lo
                — seria dizer "não sei" num campo obrigatório —, mas todo
                fechamento anterior à `0046` o carrega, e um seletor sem ele
                deixa o acervo inteiro sem endereço nesta tela: a unidade certa,
                a transportadora certa, o mês certo, e mesmo assim nada. Foi o
                que aconteceu no dia em que o campo chegou aqui.
              */}
              <div className="space-y-1.5">
                <Label htmlFor="tipo-de-operacao">Tipo</Label>
                <Select
                  value={tipoDeOperacao}
                  onValueChange={(v) => trocar("tipoDeOperacao", v)}
                >
                  <SelectTrigger id="tipo-de-operacao">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_PARA_LER.map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="transportadora">Transportadora</Label>
                <Select
                  value={transportadora}
                  onValueChange={(v) => trocar("transportadora", v)}
                >
                  <SelectTrigger id="transportadora">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {(partes.data?.transportadoras ?? []).map((p) => (
                      <SelectItem key={p.codigo} value={p.codigo}>
                        {p.nome ? `${p.codigo} — ${p.nome}` : p.codigo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mes">Mês</Label>
                <Select value={String(mes)} onValueChange={(v) => trocar("mes", v)}>
                  <SelectTrigger id="mes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MES_LONGO.map((nome, i) => (
                      <SelectItem key={nome} value={String(i + 1)}>
                        {nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ano">Ano</Label>
                <Select value={String(ano)} onValueChange={(v) => trocar("ano", v)}>
                  <SelectTrigger id="ano">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANOS.map((a) => (
                      <SelectItem key={a} value={String(a)}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {!escolhido && (
          <p className="text-sm text-muted-foreground">
            Escolha a unidade e a transportadora acima. O resumo é de um
            fechamento — a trinca unidade, transportadora e período —, e não de
            um mês do calendário: dois CDDs no mesmo mês são dois resumos.
          </p>
        )}

        {resumo.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(resumo.error)}</AlertDescription>
          </Alert>
        )}
        {escolhido && resumo.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando o mês…</p>
        )}

        {resumo.data && (
          <Corpo
            resumo={resumo.data}
            tipoDeOperacao={tipoDeOperacao}
            recorte={recorte}
            aba={aba}
            trocar={trocar}
          />
        )}
      </div>
    </Layout>
  );
}

/**
 * A quinzena existe? — a pergunta que o `find` não responde.
 *
 * `lerResumoDoMes` devolve **sempre** as duas quinzenas, "existam elas ou não":
 * a que não foi aberta vem com tudo nulo. Quem procurasse a quinzena com um
 * `find` acharia esse esqueleto e o leria como uma competência de verdade — que
 * é o que a tela fazia, chamando de "importada, ainda não apurada" o mês em que
 * nada tinha sido aberto. É `competenciaId` que separa os dois: ele só existe
 * quando existe uma competência no banco.
 */
export function quinzenaExiste(q: { competenciaId: string | null } | undefined): boolean {
  return q?.competenciaId != null;
}

/**
 * Por que o mês está sem números — e as duas respostas pedem gestos diferentes.
 *
 * `SEM_COMPETENCIA` é "não há fechamento nenhum aqui": ou ninguém abriu, ou o
 * que existe está sob outro Tipo. Quem lê precisa abrir a quinzena, ou trocar o
 * seletor. `SEM_APURACAO` é "o fechamento existe e os arquivos entraram, mas a
 * conta não rodou": aí o gesto é apurar. Dizer a segunda frase no primeiro caso
 * manda procurar uma apuração que não tem onde acontecer.
 */
export type MotivoDoVazio = "SEM_COMPETENCIA" | "SEM_APURACAO";

export function motivoDoVazio(
  quinzenas: { competenciaId: string | null }[],
): MotivoDoVazio {
  return quinzenas.some(quinzenaExiste) ? "SEM_APURACAO" : "SEM_COMPETENCIA";
}

function Corpo({
  resumo,
  tipoDeOperacao,
  recorte,
  aba,
  trocar,
}: {
  resumo: ResumoDoMes;
  tipoDeOperacao: string;
  recorte: Recorte;
  aba: Aba;
  trocar: (campo: string, valor: string) => void;
}) {
  const vazio = resumo.canais.length === 0;
  const motivo = motivoDoVazio(resumo.quinzenas);
  const daQuinzena = (n: 1 | 2) => {
    const q = resumo.quinzenas.find((x) => x.quinzena === n);
    return quinzenaExiste(q) ? q : undefined;
  };

  return (
    <div className="space-y-6">
      {/*
        Dois seletores, e não um: o da esquerda escolhe em que linguagem se lê
        o mês — a do sistema ou a da planilha — e o da direita, que pedaço do
        mês. São perguntas independentes, e juntá-las num seletor só faria seis
        posições para dizer o que duas e três dizem.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <Seletor
          valor={aba}
          opcoes={[
            ["verbas", "Verbas"],
            ["planilha", "Planilha"],
          ]}
          onTrocar={(v) => trocar("aba", v)}
        />
        <Seletor
          valor={recorte}
          opcoes={[
            ["1", "1ª quinzena"],
            ["2", "2ª quinzena"],
            ["consolidado", "Consolidado"],
          ]}
          onTrocar={(v) => trocar("ver", v)}
        />
      </div>

      {/* O que existe de cada quinzena, dito antes dos números. */}
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {([1, 2] as const).map((n) => {
          const q = daQuinzena(n);
          return (
            <li key={n}>
              <span className="font-semibold">{n}ª quinzena:</span>{" "}
              {!q ? (
                "competência não aberta"
              ) : !q.apurada ? (
                "importada, ainda não apurada"
              ) : (
                <>
                  apurada
                  {/*
                    "sem verba do 03.08.20", e não "sem o 03.08.20": o que este
                    resumo mede é a verba gravada, e ela falta tanto quando o
                    arquivo não chegou quanto quando o que chegou não trouxe
                    verba. Afirmar a ausência do arquivo era negar, daqui, um
                    03.08.20 que a competência lista com nome e data — e mandar
                    reenviar um arquivo que já está lá.
                  */}
                  {!q.temDemonstrativo && " · sem verba do 03.08.20"}
                  {q.competenciaId && (
                    <>
                      {" · "}
                      <Link
                        href={`/fechamento/competencias/${q.competenciaId}`}
                        className="inline-flex items-center gap-1 underline hover:text-foreground"
                      >
                        abrir <ArrowRight className="w-3 h-3" />
                      </Link>
                    </>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {vazio && (
        <Alert>
          <AlertDescription>
            {/*
              O fechamento é nomeado inteiro — as três partes da chave e o mês —,
              e o Tipo entre elas: desde a `0046` ele é o eixo que decide se o
              que se procura está aqui ou numa segunda operação da mesma unidade.
              Sem ele na frase, "não tem nada" parecia ser sobre o mês.
            */}
            {motivo === "SEM_COMPETENCIA" ? (
              <>
                Nenhum fechamento aberto em {MES_LONGO[resumo.mes - 1]} de{" "}
                {resumo.ano} para {resumo.unidade.nome ?? resumo.unidade.codigo} ·{" "}
                {resumo.transportadora.nome ?? resumo.transportadora.codigo} ·{" "}
                {rotuloDoTipo(tipoDeOperacao)}.{" "}
                {tipoDeOperacao === TIPO_NAO_INFORMADO ? (
                  <>
                    Abra a quinzena em{" "}
                    <Link href="/fechamento/competencias" className="text-primary hover:underline">
                      Importações
                    </Link>{" "}
                    e envie os relatórios.
                  </>
                ) : (
                  <>
                    {/*
                      A dica que faltava. Quem abriu a quinzena antes de o campo
                      Tipo existir não tem como saber que o backfill a carimbou
                      de "Não informado" — do lado de cá o mês simplesmente
                      sumiu. Vale como primeira hipótese porque é a única causa
                      que não depende de erro de quem lê.
                    */}
                    Se este mês já existia antes de o campo <strong>Tipo</strong>{" "}
                    aparecer, ele está em{" "}
                    <button
                      type="button"
                      onClick={() => trocar("tipoDeOperacao", TIPO_NAO_INFORMADO)}
                      className="text-primary font-medium hover:underline"
                    >
                      Não informado
                    </button>
                    : a migration que criou o campo não adivinhou de qual operação
                    cada fechamento antigo era. Se não é o caso, abra a quinzena
                    em{" "}
                    <Link href="/fechamento/competencias" className="text-primary hover:underline">
                      Importações
                    </Link>
                    .
                  </>
                )}
              </>
            ) : (
              <>
                O fechamento de {MES_LONGO[resumo.mes - 1]} de {resumo.ano} para{" "}
                {resumo.unidade.nome ?? resumo.unidade.codigo} ·{" "}
                {resumo.transportadora.nome ?? resumo.transportadora.codigo} ·{" "}
                {rotuloDoTipo(tipoDeOperacao)} está aberto, e nenhuma quinzena
                foi apurada ainda — é a apuração que produz as verbas que este
                resumo soma. Rode-a em{" "}
                <Link href="/fechamento/competencias" className="text-primary hover:underline">
                  Importações
                </Link>{" "}
                — o resumo se enche sozinho.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {resumo.canais.map((canal) =>
        aba === "planilha" ? (
          <PainelDoCanal key={canal.canal} canal={canal} recorte={recorte} />
        ) : (
          <TabelaDoCanal key={canal.canal} canal={canal} recorte={recorte} />
        ),
      )}
    </div>
  );
}

function Seletor<T extends string>({
  valor,
  opcoes,
  onTrocar,
}: {
  valor: T;
  opcoes: readonly (readonly [T, string])[];
  onTrocar: (valor: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-1">
      {opcoes.map(([v, rotulo]) => (
        <button
          key={v}
          type="button"
          onClick={() => onTrocar(v)}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            valor === v
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * As colunas que um recorte pede — as mesmas nas duas abas.
 *
 * No consolidado são as três da planilha; numa quinzena é só a dela, porque
 * repetir a coluna vazia da outra sugeriria que ela deveria estar preenchida.
 */
function colunasDoRecorte(recorte: Recorte): ColunaDoPainel[] {
  if (recorte === "consolidado") {
    return [
      { rotulo: "1ª quinzena", de: (v) => v.primeira },
      { rotulo: "2ª quinzena", de: (v) => v.segunda },
      { rotulo: "Total", de: (v) => v.total },
    ];
  }
  return recorte === "1"
    ? [{ rotulo: "1ª quinzena", de: (v) => v.primeira }]
    : [{ rotulo: "2ª quinzena", de: (v) => v.segunda }];
}

function PainelDoCanal({ canal, recorte }: { canal: CanalDoResumo; recorte: Recorte }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{canal.canal}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {canal.comparado ? (
          /*
            Havendo cadastro, o painel é a comparação: o que o contrato deve
            contra o que o demonstrativo diz. Sem cadastro, cai para o painel
            antigo — que é uma releitura do 03.08.20 e concorda consigo mesmo.
          */
          <PainelComparadoTabela painel={canal.comparado} recorte={recorte} />
        ) : canal.painel ? (
          <PainelDaPlanilhaTabela painel={canal.painel} colunas={colunasDoRecorte(recorte)} />
        ) : canal.semPainel === "SEM_DEMONSTRATIVO" ? (
          /*
            O painel deste canal está transcrito e mesmo assim não tem número:
            o que falta é o arquivo. Dizer "não foi transcrito" aqui mandava
            procurar no código quem só precisava importar um relatório.
          */
          <p className="text-sm text-muted-foreground">
            O painel do {canal.canal} está escrito aqui, e as linhas dele saem do{" "}
            <strong>03.08.20</strong> — e nenhuma das duas quinzenas tem verba dele.
            Ou o demonstrativo não foi importado, ou o que foi importado não trouxe
            verba nenhuma; abra a quinzena para ver qual dos dois, com o arquivo
            nomeado. Enquanto a verba não vier, as verbas do {canal.canal} continuam
            apuradas e conferidas na aba Verbas.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            O painel do {canal.canal} existe na planilha e ainda não foi transcrito
            aqui — os rótulos dele não foram capturados, e escrevê-los por
            analogia com os da Rota inventaria a metade que falta. As verbas do{" "}
            {canal.canal} continuam apuradas e conferidas na aba Verbas; o que
            falta é a tradução para as linhas da planilha.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * O painel nas três leituras — devido, demonstrado e a diferença.
 *
 * É a tela que a inversão do motor tornou possível. Antes, a coluna do painel
 * era uma tradução do 03.08.20: ela concordava com o demonstrativo por
 * construção, e uma conferência que não pode discordar não confere nada. Agora
 * `devido` sai do contrato — cadastro e diário — e `demonstrado` sai do
 * relatório. A diferença entre duas fontes independentes é a conversa que
 * acontece na mesa.
 *
 * **A linha que só tem um dos lados continua na tabela.** Falta de cadastro e
 * falta de 03.08.20 são estados diferentes, os dois normais no meio do mês, e
 * esconder a linha faria o painel parecer completo quando não está.
 */
function PainelComparadoTabela({
  painel,
  recorte,
}: {
  painel: PainelComparado;
  recorte: Recorte;
}) {
  /* No consolidado a coluna é o total do mês; numa quinzena, a dela. */
  const coluna = (v: TresColunas) =>
    recorte === "consolidado" ? v.total : recorte === "1" ? v.primeira : v.segunda;

  const doCadastro =
    recorte === "2" ? painel.cadastro.segunda : painel.cadastro.primeira;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">Devido</strong> — do contrato e do diário
        </span>
        <span>
          <strong className="text-foreground">Demonstrado</strong> — do 03.08.20
        </span>
        {doCadastro && <span>cadastro vigente desde {doCadastro.vigenteDe}</span>}
      </div>

      {painel.quadros.map((quadro) => (
        <div key={quadro.quadro}>
          <p className="text-xs font-semibold text-muted-foreground mb-1">{quadro.titulo}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium">Linha</th>
                <th className="py-2 text-right font-medium min-w-32">Devido</th>
                <th className="py-2 text-right font-medium min-w-32">Demonstrado</th>
                <th className="py-2 text-right font-medium min-w-32">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {quadro.linhas.map((linha) => {
                const diferenca = coluna(linha.diferenca);
                return (
                  <tr key={linha.chave} className="border-b last:border-0 align-top">
                    <td className="py-2">
                      <span title={linha.memoria.primeira ?? linha.memoria.segunda ?? undefined}>
                        {linha.rotulo}
                      </span>
                      {linha.falta && (
                        <span className="block text-xs text-muted-foreground">
                          falta {linha.falta}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {dinheiro(coluna(linha.devido))}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {dinheiro(coluna(linha.demonstrado))}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-mono tabular-nums",
                        /* Zero não merece destaque; é o estado esperado. */
                        diferenca !== null && Math.abs(diferenca) >= 0.005 && "font-semibold",
                      )}
                    >
                      {dinheiro(diferenca)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-b font-semibold">
                <td className="py-2 text-right pr-4 text-xs text-muted-foreground">Total</td>
                {[quadro.devido, quadro.demonstrado, quadro.diferenca].map((v, i) => (
                  <td key={i} className="py-2 text-right font-mono tabular-nums">
                    {dinheiro(coluna(v))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      {painel.pendencias.length > 0 && (
        <Alert>
          <AlertDescription className="text-xs">
            O devido está incompleto: falta {painel.pendencias.join(", ")}. As linhas que
            dependem disso ficam vazias em vez de somar zero.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function TabelaDoCanal({ canal, recorte }: { canal: CanalDoResumo; recorte: Recorte }) {
  const consolidado = recorte === "consolidado";
  /* No recorte de uma quinzena, a coluna dela é a única que se lê. */
  const coluna = (v: TresColunas) =>
    consolidado ? v.total : recorte === "1" ? v.primeira : v.segunda;

  const cabecalho = consolidado
    ? ["1ª quinzena", "2ª quinzena", "Total"]
    : ["Emitido", "Apurado", "Diferença"];

  const celulas = (emitido: TresColunas, apurado: TresColunas) => {
    if (consolidado) {
      return [emitido.primeira, emitido.segunda, emitido.total];
    }
    const e = coluna(emitido);
    const a = coluna(apurado);
    return [e, a, e === null || a === null ? null : Number((e - a).toFixed(2))];
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{canal.canal}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 text-left font-medium">Verba</th>
              {cabecalho.map((c) => (
                <th key={c} className="py-2 text-right font-medium min-w-32">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {canal.blocos.map((bloco) => (
              <Fragment key={bloco.natureza}>
                <tr className="border-b bg-muted/40">
                  <td colSpan={4} className="py-1.5 text-xs font-semibold">
                    {bloco.titulo}
                  </td>
                </tr>
                {bloco.linhas.map((linha) => (
                  <tr key={`${bloco.natureza}-${linha.vbz}`} className="border-b last:border-0">
                    <td className="py-2">
                      <span className="font-mono text-xs text-muted-foreground mr-2">
                        {linha.vbz}
                      </span>
                      {linha.nome}
                    </td>
                    {celulas(linha.emitido, linha.apurado).map((valor, i) => (
                      <td key={i} className="py-2 text-right font-mono tabular-nums">
                        {dinheiro(valor)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-b font-semibold">
                  <td className="py-2 text-right pr-4 text-xs text-muted-foreground">
                    Subtotal
                  </td>
                  {celulas(bloco.emitido, bloco.apurado).map((valor, i) => (
                    <td key={i} className="py-2 text-right font-mono tabular-nums">
                      {dinheiro(valor)}
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>

        {canal.descontos.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-muted-foreground">
              Descontos do 03.08.20
            </p>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              Sem imposto, e <strong>já subtraídos</strong> das verbas acima — o
              próprio relatório o diz, linha a linha. Estão aqui para conferir
              contra a planilha, não para somar de novo.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {canal.descontos.map((d) => (
                  <tr key={d.tipo} className="border-b last:border-0">
                    <td className="py-1.5 text-muted-foreground">{d.nome}</td>
                    {(consolidado
                      ? [d.valores.primeira, d.valores.segunda, d.valores.total]
                      : [coluna(d.valores), null, null]
                    ).map((valor, i) => (
                      <td
                        key={i}
                        className={cn(
                          "py-1.5 text-right font-mono tabular-nums min-w-32",
                          !consolidado && i > 0 && "invisible",
                        )}
                      >
                        {dinheiro(valor)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* O fecho: as três últimas linhas do RESUMO GERAL da planilha. */}
        <table className="w-full text-sm mt-6 border-t-2">
          <tbody>
            {(
              [
                ["Emitido em CT-e (03.08.15)", canal.emitido, false],
                ["Conferido pela apuração", canal.conferido, false],
                ["Sem fonte que confira", canal.semFonte, false],
                ["Total remuneração (03.08.20)", canal.demonstrativo, false],
                ["Diferença — emitido menos demonstrativo", canal.diferenca, true],
              ] as const
            ).map(([rotulo, valores, destaque]) => (
              <tr key={rotulo} className={cn("border-b last:border-0", destaque && "font-bold")}>
                <td className="py-2">{rotulo}</td>
                {(consolidado
                  ? [valores.primeira, valores.segunda, valores.total]
                  : [coluna(valores), null, null]
                ).map((valor, i) => (
                  <td
                    key={i}
                    className={cn(
                      "py-2 text-right font-mono tabular-nums min-w-32",
                      !consolidado && i > 0 && "invisible",
                    )}
                  >
                    {dinheiro(valor)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {canal.demonstrativo.total === null && (
          <p className="text-xs text-muted-foreground mt-3">
            A linha do demonstrativo está vazia porque o 03.08.20 não foi
            importado neste mês. Sem ele a parcela fixa entra na conta pelo que o
            CT-e diz, e ninguém a confere.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
