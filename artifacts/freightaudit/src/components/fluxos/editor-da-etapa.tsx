import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ListaEditavel, type ColunaDaLista } from "@/components/fluxos/lista-editavel";
import { escritas, fraseDoErro, type Catalogo, type Etapa } from "@/lib/fluxos";
import {
  cargosDoDepartamento,
  SEM_VINCULO,
  VINCULOS_DA_ETAPA,
  type OpcoesDeResponsavel,
} from "@/lib/fluxos-analise";
import { useOpcoesDeResponsavel } from "@/lib/responsaveis";

/**
 * O EDITOR DA ETAPA — três abas, e por que não são dez campos numa página só.
 *
 * O que uma etapa guarda é muito: identidade, texto livre, cinco listas de
 * material, indicadores e ações. Tudo isso numa única coluna produz um
 * formulário de rolagem infinita em que ninguém acha nada; num assistente de
 * vários passos, produz cliques para editar uma palavra.
 *
 * As três abas separam pelo que a pessoa veio fazer:
 *
 * - **Etapa** — quem é, quem faz, o que acontece, o que manda. É a aba que abre.
 * - **Detalhes** — as cinco listas: sistemas, documentos, responsáveis, falhas,
 *   gargalos. São todas a mesma forma, e por isso a mesma `ListaEditavel`.
 * - **Consultas** — indicadores e as ações que navegam no FreightCheck.
 *
 * ---------------------------------------------------------------------------
 * A gravação: uma chamada de identidade, e uma por lista tocada
 * ---------------------------------------------------------------------------
 *
 * O contrato do servidor é explícito por lista (ver `routes/fluxos.ts`), e o
 * editor respeita isso salvando **só o que mudou**: quem só corrigiu o nome não
 * regrava sete listas. As listas são enviadas inteiras — é o contrato de
 * substituição —, e a ordem de envio é a ordem em que estão na tela, que é o que
 * faz arrastar não ser necessário para reordenar: remover e adicionar de novo
 * basta.
 *
 * Se uma das chamadas falhar, a frase do servidor aparece no rodapé e o diálogo
 * **não fecha** — o que estava digitado continua lá. Fechar em cima de um erro
 * perderia o trabalho e deixaria a etapa meio gravada sem que ninguém soubesse.
 */

interface LinhaDeItem extends Record<string, unknown> {
  nome: string;
  descricao: string;
  link: string;
  obrigatorio: boolean;
  /**
   * Os vínculos de cadastro da linha — só a espécie `RESPONSAVEL` os edita, e
   * todas as espécies os **carregam**.
   *
   * Carregar sem editar não é sobra: a rota da lista é substituição, então uma
   * linha que voltasse ao servidor sem os `id`s desligaria o departamento e o
   * cargo que alguém escolheu no painel — pelo simples ato de abrir o editor e
   * salvar. É a mesma razão de `observacoesPreservadas` existir logo abaixo.
   *
   * Guardam `SEM_VINCULO` quando não há vínculo, e não `""`, porque é o valor
   * que o `Select` mostra na opção "Sem departamento" (ver a constante).
   */
  departamentoId: string;
  cargoId: string;
  pessoaId: string;
}

interface LinhaDeIndicador extends Record<string, unknown> {
  nome: string;
  descricao: string;
  unidade: string;
  sentido: string;
  origem: string;
}

interface LinhaDeAcao extends Record<string, unknown> {
  titulo: string;
  descricao: string;
  rota: string;
}

/** `SEM_VINCULO` e `""` são a mesma coisa na ida: nenhum vínculo. */
function idDoVinculo(valor: string): string | null {
  return valor === "" || valor === SEM_VINCULO ? null : valor;
}

function temVinculo(linha: LinhaDeItem): boolean {
  return (
    idDoVinculo(linha.departamentoId) !== null ||
    idDoVinculo(linha.cargoId) !== null ||
    idDoVinculo(linha.pessoaId) !== null
  );
}

/**
 * As colunas de vínculo da lista de responsáveis — as mesmas três do painel.
 *
 * Só a espécie `RESPONSAVEL` as recebe, e só quando a casa tem cadastro: numa
 * casa que ainda não cadastrou departamento nenhum a lista continua sendo nome
 * e descrição, como sempre foi.
 */
function colunasDoResponsavel(
  opcoes: OpcoesDeResponsavel | undefined,
): ColunaDaLista<LinhaDeItem>[] {
  if (!opcoes) return [];
  return VINCULOS_DA_ETAPA.flatMap(({ campo, rotulo, fonte }) => {
    const lista = opcoes[fonte];
    if (lista.length === 0) return [];
    const vazio = { valor: SEM_VINCULO, rotulo: `Sem ${rotulo.toLowerCase()}` };
    const comoOpcao = (o: { id: string; nome: string }) => ({ valor: o.id, rotulo: o.nome });
    return [
      {
        campo,
        rotulo,
        tipo: "escolha" as const,
        /*
          O cargo é o único que se estreita, e por linha: escolhido o
          departamento naquela linha, a lista passa a ser a dele e a dos
          departamentos abaixo. As exceções — cargo sem lotação e o cargo já
          escolhido — estão em `cargosDoDepartamento`.
        */
        opcoes:
          campo === "cargoId"
            ? (linha: LinhaDeItem) => [
                vazio,
                ...cargosDoDepartamento(
                  opcoes,
                  idDoVinculo(linha.departamentoId),
                  idDoVinculo(linha.cargoId),
                ).map(comoOpcao),
              ]
            : [vazio, ...lista.map(comoOpcao)],
      },
    ];
  });
}

function linhasDaEspecie(etapa: Etapa | null, especie: string): LinhaDeItem[] {
  return (etapa?.itens ?? [])
    .filter((i) => i.especie === especie)
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => ({
      nome: i.nome,
      descricao: i.descricao ?? "",
      link: i.link ?? "",
      obrigatorio: i.obrigatorio === true,
      departamentoId: i.departamentoId ?? SEM_VINCULO,
      cargoId: i.cargoId ?? SEM_VINCULO,
      pessoaId: i.pessoaId ?? SEM_VINCULO,
    }));
}

export function EditorDaEtapa({
  aberto,
  etapa,
  fluxoId,
  empresaId,
  catalogo,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  /** `null` cria uma etapa nova; preenchido, edita a existente. */
  etapa: Etapa | null;
  fluxoId: string;
  empresaId: string | null;
  catalogo: Catalogo | undefined;
  aoFechar: () => void;
  /** Recebe a etapa gravada — quem chamou pode ligá-la a outra, por exemplo. */
  aoSalvar: (etapa: Etapa) => void;
}) {
  const especies = catalogo?.especiesDeItem ?? [];

  const [nome, setNome] = useState(etapa?.nome ?? "");
  const [tipo, setTipo] = useState(etapa?.tipo ?? "PROCESSO");
  const [status, setStatus] = useState(etapa?.status ?? "ATIVO");
  const [area, setArea] = useState(etapa?.area ?? "");
  const [responsavel, setResponsavel] = useState(etapa?.responsavel ?? "");
  /*
    Os três vínculos de cadastro da etapa. Entram no estado mesmo quando a casa
    não tem cadastro e os selects não aparecem, pela razão de sempre neste
    formulário: a rota é substituição, e não mandá-los de volta faria salvar o
    editor desligar o departamento escolhido no painel.
  */
  const [departamentoId, setDepartamentoId] = useState(etapa?.departamentoId ?? "");
  const [cargoId, setCargoId] = useState(etapa?.cargoId ?? "");
  const [pessoaId, setPessoaId] = useState(etapa?.pessoaId ?? "");
  const opcoesDeResponsavel = useOpcoesDeResponsavel();
  const [sistemaPrincipal, setSistemaPrincipal] = useState(etapa?.sistemaPrincipal ?? "");
  const [descricao, setDescricao] = useState(etapa?.descricao ?? "");
  const [objetivo, setObjetivo] = useState(etapa?.objetivo ?? "");
  const [regras, setRegras] = useState(etapa?.regras ?? "");
  const [informacoesConsultadas, setInformacoesConsultadas] = useState(
    etapa?.informacoesConsultadas ?? "",
  );
  const [falhas, setFalhas] = useState(etapa?.falhas ?? "");
  const [gargalos, setGargalos] = useState(etapa?.gargalos ?? "");
  const [informacoes, setInformacoes] = useState(etapa?.informacoes ?? "");
  /*
    O texto de antes do recorte em três não tem campo na tela — e mesmo assim
    entra no estado. A rota da etapa é substituição: sem ele no corpo, salvar o
    formulário apagaria o original que a migration `0072` preservou.
  */
  const [observacoesPreservadas] = useState(etapa?.observacoes ?? "");
  const [chave, setChave] = useState(etapa?.chaveMonitoramento ?? "");

  const [porEspecie, setPorEspecie] = useState<Record<string, LinhaDeItem[]>>(() =>
    Object.fromEntries(especies.map((e) => [e.valor, linhasDaEspecie(etapa, e.valor)])),
  );
  const [indicadores, setIndicadores] = useState<LinhaDeIndicador[]>(
    () =>
      (etapa?.indicadores ?? []).map((i) => ({
        nome: i.nome,
        descricao: i.descricao ?? "",
        unidade: i.unidade ?? "",
        sentido: i.sentido,
        origem: i.origem ?? "",
      })),
  );
  const [acoes, setAcoes] = useState<LinhaDeAcao[]>(() =>
    (etapa?.acoes ?? []).map((a) => ({
      titulo: a.titulo,
      descricao: a.descricao ?? "",
      rota: a.rota,
    })),
  );

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo = {
        nome,
        tipo,
        status,
        area,
        responsavel,
        departamentoId,
        cargoId,
        pessoaId,
        sistemaPrincipal,
        descricao,
        objetivo,
        regras,
        informacoesConsultadas,
        falhas,
        gargalos,
        informacoes,
        observacoes: observacoesPreservadas,
        chaveMonitoramento: chave,
        /* A posição é preservada: quem edita o texto não move o cartão. */
        ...(etapa ? { ordem: etapa.ordem, posX: etapa.posX, posY: etapa.posY } : {}),
      };

      const gravada = etapa
        ? await escritas.atualizarEtapa(empresaId, fluxoId, etapa.id, corpo)
        : await escritas.criarEtapa(empresaId, fluxoId, corpo);

      /*
        As listas vão **em série**, e não em paralelo. Em paralelo, o servidor
        recusaria uma delas e as outras entrariam mesmo assim — e a etapa
        ficaria com metade do que a pessoa digitou, sem que a mensagem de erro
        dissesse qual metade. Em série, a primeira recusa para tudo o que vem
        depois, e o que já entrou é sempre um prefixo do que estava na tela.
      */
      for (const especie of especies) {
        const linhas = porEspecie[especie.valor] ?? [];
        await escritas.salvarItens(
          empresaId,
          fluxoId,
          gravada.id,
          especie.valor,
          linhas
            /*
              Uma linha vale pelo nome **ou** por um vínculo escolhido: quem
              seleciona "Faturamento" na lista de responsáveis não digita nada,
              e descartá-la aqui faria o campo parecer não funcionar. Quem põe o
              nome nesse caso é o servidor, com o do cadastro.
            */
            .filter((l) => l.nome.trim() !== "" || temVinculo(l))
            .map((l, ordem) => ({
              nome: l.nome,
              descricao: l.descricao,
              ordem,
              ...(especie.usaLink ? { link: l.link } : {}),
              ...(especie.usaObrigatorio ? { obrigatorio: l.obrigatorio } : {}),
              departamentoId: idDoVinculo(l.departamentoId),
              cargoId: idDoVinculo(l.cargoId),
              pessoaId: idDoVinculo(l.pessoaId),
            })),
        );
      }

      await escritas.salvarIndicadores(
        empresaId,
        fluxoId,
        gravada.id,
        indicadores
          .filter((i) => i.nome.trim() !== "")
          .map((i, ordem) => ({ ...i, ordem })),
      );

      await escritas.salvarAcoes(
        empresaId,
        fluxoId,
        gravada.id,
        acoes.filter((a) => a.titulo.trim() !== "").map((a, ordem) => ({ ...a, ordem })),
      );

      return gravada;
    },
    onSuccess: (gravada) => {
      aoSalvar(gravada);
      aoFechar();
    },
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{etapa ? "Editar etapa" : "Nova etapa"}</DialogTitle>
          <DialogDescription>
            O cartão do fluxograma mostra nome, tipo e responsável. Todo o resto aparece no painel
            lateral quando alguém clica na etapa.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="etapa">
          <TabsList>
            <TabsTrigger value="etapa">Etapa</TabsTrigger>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="consultas">Consultas</TabsTrigger>
          </TabsList>

          <TabsContent value="etapa" className="space-y-4 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="etapa-nome">Nome da etapa</Label>
                <Input
                  id="etapa-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Autorização SEFAZ"
                />
              </div>

              <div>
                <Label htmlFor="etapa-tipo">Tipo</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger id="etapa-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(catalogo?.tiposDeEtapa ?? []).map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="etapa-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as Etapa["status"])}>
                  <SelectTrigger id="etapa-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(catalogo?.statusDaEtapa ?? []).map((s) => (
                      <SelectItem key={s.valor} value={s.valor}>
                        {s.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/*
                COM CADASTRO NA CASA, ÁREA E RESPONSÁVEL VIRAM ESCOLHA.

                Departamento, cargo e pessoa saem do cadastro (ver a `0079`), e
                `area` e `responsavel` passam a ser a projeção deles, feita no
                servidor — é o que impede `Faturamento`, `FATURAMENTO` e `Fat.`
                de virarem três raias no fluxograma. Os dois campos de texto
                continuam existindo e continuam indo no corpo: eles são o que
                vale numa casa que ainda não cadastrou nada, e é essa casa que vê
                os `Input` abaixo.
              */}
              {opcoesDeResponsavel ? (
                VINCULOS_DA_ETAPA.map(({ campo, rotulo, fonte }) => {
                  const todas = opcoesDeResponsavel[fonte];
                  if (todas.length === 0) return null;
                  /* O cargo se estreita pelo departamento escolhido acima. */
                  const lista =
                    campo === "cargoId"
                      ? cargosDoDepartamento(opcoesDeResponsavel, departamentoId, cargoId)
                      : todas;
                  const valor =
                    campo === "departamentoId"
                      ? departamentoId
                      : campo === "cargoId"
                        ? cargoId
                        : pessoaId;
                  const trocar =
                    campo === "departamentoId"
                      ? setDepartamentoId
                      : campo === "cargoId"
                        ? setCargoId
                        : setPessoaId;
                  return (
                    <div key={campo}>
                      <Label htmlFor={`etapa-${campo}`}>{rotulo}</Label>
                      <Select
                        value={valor === "" ? SEM_VINCULO : valor}
                        onValueChange={(v) => trocar(v === SEM_VINCULO ? "" : v)}
                      >
                        <SelectTrigger id={`etapa-${campo}`}>
                          <SelectValue placeholder={`Sem ${rotulo.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_VINCULO}>{`Sem ${rotulo.toLowerCase()}`}</SelectItem>
                          {lista.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })
              ) : (
                <>
                  <div>
                    <Label htmlFor="etapa-area">Área</Label>
                    <Input
                      id="etapa-area"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder="Faturamento"
                    />
                  </div>

                  <div>
                    <Label htmlFor="etapa-responsavel">Responsável</Label>
                    <Input
                      id="etapa-responsavel"
                      value={responsavel}
                      onChange={(e) => setResponsavel(e.target.value)}
                      placeholder="Analista de faturamento"
                    />
                  </div>
                </>
              )}

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-sistema">Sistema principal</Label>
                <Input
                  id="etapa-sistema"
                  value={sistemaPrincipal}
                  onChange={(e) => setSistemaPrincipal(e.target.value)}
                  placeholder="ERP"
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-descricao">O que acontece aqui</Label>
                <Textarea
                  id="etapa-descricao"
                  rows={3}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-objetivo">Objetivo da etapa</Label>
                <Textarea
                  id="etapa-objetivo"
                  rows={2}
                  value={objetivo}
                  onChange={(e) => setObjetivo(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-regras">Regras de negócio</Label>
                <Textarea
                  id="etapa-regras"
                  rows={3}
                  value={regras}
                  onChange={(e) => setRegras(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-informacoes">Dados</Label>
                <Textarea
                  id="etapa-informacoes"
                  rows={3}
                  value={informacoesConsultadas}
                  onChange={(e) => setInformacoesConsultadas(e.target.value)}
                  placeholder="Tabela de frete mínimo no SAP, relatório de tarifas do mês, e-mail de aprovação do cliente"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Onde quem executa a etapa vai olhar para conseguir fazê-la — relatório, tela,
                  planilha, e-mail. O que a etapa exige como entregável continua na aba Detalhes,
                  em Documentos.
                </p>
              </div>

              {/*
                TRÊS CAMPOS, E NÃO UM DE OBSERVAÇÕES.

                Era um textarea só, e ele era o depósito da etapa: o erro que
                acontece, a fila que atrasa e a instrução de quem executa
                cabiam todos ali. Separados, os três se somam pelo processo
                inteiro — "quais são as principais falhas", "onde estão os
                maiores gargalos", "quais etapas concentram mais problemas" só
                têm resposta se forem campos diferentes.

                O texto que já estava escrito não se perde: a migration `0072`
                copiou `observacoes` para Informações e guardou o original.
              */}
              <div className="sm:col-span-2">
                <Label htmlFor="etapa-falhas">Falhas</Label>
                <Textarea
                  id="etapa-falhas"
                  rows={3}
                  value={falhas}
                  onChange={(e) => setFalhas(e.target.value)}
                  placeholder="Tarifa lançada sem tabela, retrabalho de recálculo manual, emissão em duplicidade"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  O que dá errado aqui: erros, retrabalhos, desvios, problemas recorrentes. As
                  falhas que se contam uma a uma continuam na aba Detalhes, em Falhas possíveis.
                </p>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-gargalos">Gargalos</Label>
                <Textarea
                  id="etapa-gargalos"
                  rows={3}
                  value={gargalos}
                  onChange={(e) => setGargalos(e.target.value)}
                  placeholder="Espera o retorno da Operação por e-mail, fila de conferência no fim do mês, uma pessoa só habilitada"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  O que trava ou atrasa mesmo quando nada dá errado: esperas, filas, dependências,
                  limitação de capacidade.
                </p>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-informacoes-etapa">Observações</Label>
                <Textarea
                  id="etapa-informacoes-etapa"
                  rows={3}
                  value={informacoes}
                  onChange={(e) => setInformacoes(e.target.value)}
                  placeholder="Contexto, particularidades e instruções complementares para entender ou executar a etapa"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  O que é preciso saber. Diferente de "Dados", que é onde a pessoa vai olhar.
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="detalhes" className="space-y-6 pt-4">
            {especies.map((especie) => (
              <ListaEditavel
                key={especie.valor}
                titulo={especie.titulo}
                descricao={especie.descricao}
                itens={porEspecie[especie.valor] ?? []}
                aoMudar={(linhas) =>
                  setPorEspecie((atual) => ({ ...atual, [especie.valor]: linhas }))
                }
                linhaNova={() => ({
                  nome: "",
                  descricao: "",
                  link: "",
                  obrigatorio: false,
                  departamentoId: SEM_VINCULO,
                  cargoId: SEM_VINCULO,
                  pessoaId: SEM_VINCULO,
                })}
                rotuloDeAdicionar={`Adicionar ${especie.rotulo.toLowerCase()}`}
                colunas={[
                  /* O departamento vem antes do nome: é ele que estreita o resto. */
                  ...(especie.valor === "RESPONSAVEL"
                    ? colunasDoResponsavel(opcoesDeResponsavel)
                    : []),
                  { campo: "nome", rotulo: "Nome", peso: 2 },
                  { campo: "descricao", rotulo: "Descrição", peso: 3 },
                  ...(especie.usaLink
                    ? [
                        {
                          campo: "link" as const,
                          rotulo: "Link",
                          peso: 2,
                          placeholder: "https://",
                        },
                      ]
                    : []),
                  ...(especie.usaObrigatorio
                    ? [
                        {
                          campo: "obrigatorio" as const,
                          rotulo: "Obrigatório",
                          tipo: "booleano" as const,
                        },
                      ]
                    : []),
                ]}
              />
            ))}
          </TabsContent>

          <TabsContent value="consultas" className="space-y-6 pt-4">
            <ListaEditavel
              titulo="Indicadores"
              descricao="Cadastrados agora, calculados quando o Modo Monitoramento existir."
              itens={indicadores}
              aoMudar={setIndicadores}
              linhaNova={() => ({
                nome: "",
                descricao: "",
                unidade: "",
                sentido: "NEUTRO",
                origem: "",
              })}
              rotuloDeAdicionar="Adicionar indicador"
              colunas={[
                { campo: "nome", rotulo: "Nome", peso: 3 },
                { campo: "unidade", rotulo: "Unidade", peso: 1, placeholder: "%" },
                {
                  campo: "sentido",
                  rotulo: "Sentido",
                  tipo: "escolha",
                  opcoes: (catalogo?.sentidosDoIndicador ?? []).map((s) => ({
                    valor: s.valor,
                    rotulo: s.rotulo,
                  })),
                },
                { campo: "origem", rotulo: "Fonte prevista", peso: 3 },
              ]}
            />

            <ListaEditavel
              titulo="Consultar no FreightCheck"
              descricao="Botões que levam a uma tela deste produto. A rota é um caminho interno, como /alteracoes."
              itens={acoes}
              aoMudar={setAcoes}
              linhaNova={() => ({ titulo: "", descricao: "", rota: "" })}
              rotuloDeAdicionar="Adicionar consulta"
              colunas={[
                { campo: "titulo", rotulo: "Título", peso: 2 },
                { campo: "rota", rotulo: "Rota", peso: 2, placeholder: "/alteracoes" },
                { campo: "descricao", rotulo: "Descrição", peso: 3 },
              ]}
            />

            <div>
              <Label htmlFor="etapa-chave">Chave de monitoramento</Label>
              <Input
                id="etapa-chave"
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                placeholder="cte.autorizacao_sefaz"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Opcional. Um nome estável pelo qual o Modo Monitoramento vai poder ligar dados
                reais a esta etapa. Hoje nada o lê.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {salvar.isError && (
          <Alert variant="destructive">
            <AlertDescription>{fraseDoErro(salvar.error)}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || nome.trim() === ""}
          >
            {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {etapa ? "Salvar etapa" : "Criar etapa"}
          </Button>
        </DialogFooter>
    </Dialog>
  );
}
