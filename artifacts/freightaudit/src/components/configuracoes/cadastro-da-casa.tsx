import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Briefcase, IdCard, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apresentar } from "@/lib/apresentar-erro";
import { useAuth } from "@/lib/auth";
import {
  CHAVE_DOS_CARGOS,
  CHAVE_DOS_DEPARTAMENTOS,
  CHAVE_DOS_NEGOCIOS,
  caminhoDoDepartamento,
  criarCargo,
  criarDepartamento,
  criarNegocio,
  editarCargo,
  editarDepartamento,
  editarNegocio,
  excluirCargo,
  excluirDepartamento,
  excluirNegocio,
  useCargos,
  useDepartamentos,
  useNegocios,
} from "@/lib/cadastro";

/**
 * O CADASTRO DA CASA — Cargos, Negócio e Departamento.
 *
 * As três seções eram páginas de "em preparo" (`pages/telas-em-preparo.ts`) que
 * diziam o que faltava para elas existirem. Faltava o cadastro: as três coisas
 * como **coisa nomeada com identidade própria**, e não como o texto que a
 * planilha trouxe. Ver `lib/db/src/schema/cadastro.ts`.
 *
 * **As três telas são o mesmo componente, e isso é uma decisão sobre hoje.** O
 * que cada uma faz hoje é idêntico — nome entra, nome sai, com um vínculo
 * opcional —, e escrever três telas quase iguais seria três lugares para
 * corrigir a mesma coisa. Quando cargo ganhar faixa salarial vigente e negócio
 * ganhar a regra que vale nele, elas se separam; a linha que as separa é o
 * `vinculo` daqui, e ela existe justamente para a separação ser um recorte, e
 * não uma reescrita.
 *
 * **O que estas telas continuam não sabendo, e dizem.** Cargo não sabe quanto
 * custa: a faixa salarial vigente não é cadastrada aqui, e a tela escreve isso
 * em vez de mostrar uma coluna de custo vazia. Negócio não passa a existir para
 * o motor de fechamento — Rota, Empurrada, AS e Apoio continuam escritos no
 * código. Departamento não reclassifica o rateio administrativo, que continua
 * chegando classificado pela planilha de origem. Dizer isso na tela é a mesma
 * regra da página de em preparo que estas seções substituem: **um número (ou uma
 * capacidade) sem lastro é pior do que nenhum, porque é usado.**
 */

/* =========================================================================
 * A casca — o que as três seções têm em comum
 * ====================================================================== */

/** Uma linha da lista, já traduzida pelo painel que a monta. */
interface LinhaDoCadastro {
  id: string;
  nome: string;
  /** A segunda coluna: o caminho na hierarquia, a lotação, ou nada. */
  detalhe: ReactNode;
  /** O que depende desta linha, em uma frase. Vazio quando nada depende. */
  dependencias: string;
  criadoPor: string | null;
}

function CascaDoCadastro({
  titulo,
  icone,
  explicacao,
  ressalva,
  rotuloDoBotao,
  linhas,
  carregando,
  erro,
  vazio,
  formulario,
  aoCriar,
  aoEditar,
  aoExcluir,
  excluindo,
}: {
  titulo: string;
  icone: ReactNode;
  explicacao: ReactNode;
  /** O que esta tela **não** faz. Nunca é opcional: ver o bloco de cima. */
  ressalva: ReactNode;
  rotuloDoBotao: string;
  linhas: LinhaDoCadastro[];
  carregando: boolean;
  erro: Error | null;
  vazio: string;
  /** O formulário aberto, montado pelo painel — `null` quando fechado. */
  formulario: ReactNode;
  aoCriar: () => void;
  aoEditar: (linha: LinhaDoCadastro) => void;
  aoExcluir: (linha: LinhaDoCadastro) => void;
  excluindo: string | null;
}) {
  const { user } = useAuth();
  const podeMexer = user?.role === "ADMIN";

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            {icone}
            {titulo}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{explicacao}</p>
        </div>
        {/*
          O botão só para quem pode. Renderizá-lo para o operador e deixar o
          servidor recusar daria um clique que sempre falha — a mesma escolha
          que a seção de Usuários já faz com o cartão de criar conta.
        */}
        {podeMexer && (
          <Button size="sm" onClick={aoCriar}>
            <Plus className="w-4 h-4 mr-1" />
            {rotuloDoBotao}
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {erro !== null && (
          <ApiErrorNotice error={erro} what={`A lista de ${titulo.toLowerCase()} não pôde ser carregada.`} />
        )}

        {formulario}

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {!carregando && linhas.length === 0 && erro === null && (
          <p className="text-sm text-muted-foreground">{vazio}</p>
        )}

        {linhas.length > 0 && (
          <div className="divide-y rounded-lg border">
            {linhas.map((linha) => (
              <div
                key={linha.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{linha.nome}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {linha.detalhe}
                  </p>
                </div>
                {linha.dependencias !== "" && (
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                    {linha.dependencias}
                  </span>
                )}
                {podeMexer && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Editar ${linha.nome}`}
                      onClick={() => aoEditar(linha)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label={`Excluir ${linha.nome}`}
                      disabled={excluindo === linha.id}
                      onClick={() => aoExcluir(linha)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground border-t pt-3">{ressalva}</p>
      </CardContent>
    </Card>
  );
}

/** O aviso de recusa do formulário, com a frase que o servidor mandou. */
function RecusaDoFormulario({ erro, reserva }: { erro: Error | null; reserva: string }) {
  if (erro === null) return null;
  const aviso = apresentar(erro);
  return (
    <Alert variant="destructive">
      <AlertDescription className="text-xs">
        {aviso.principal ?? aviso.mensagemCrua ?? reserva}
      </AlertDescription>
    </Alert>
  );
}

/**
 * O valor que o `Select` usa para "nenhum".
 *
 * Não é a string vazia porque o `Select` do Radix a reserva para "nada
 * selecionado" e recusa um item com esse valor. O sentinela é traduzido de
 * volta para `null` na hora de mandar — o servidor nunca vê esta palavra.
 */
const SEM_VINCULO = "__sem_vinculo__";

/* =========================================================================
 * Cargos
 * ====================================================================== */

export function PainelDeCargos() {
  const cliente = useQueryClient();
  const cargos = useCargos();
  const departamentos = useDepartamentos();

  const [aberto, setAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [departamentoId, setDepartamentoId] = useState<string>(SEM_VINCULO);

  const invalidar = () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: CHAVE_DOS_CARGOS }),
      /* A lista de contas agrupa por cargo: renomear um cargo muda o que ela
         mostra, e deixá-la em cache exibiria o nome antigo até um F5. */
      cliente.invalidateQueries({ queryKey: ["users"] }),
    ]);

  const fechar = () => {
    setAberto(false);
    setEmEdicao(null);
    setNome("");
    setDepartamentoId(SEM_VINCULO);
  };

  const criar = useMutation({
    mutationFn: criarCargo,
    onSuccess: async () => {
      await invalidar();
      fechar();
    },
  });
  const editar = useMutation({
    mutationFn: (p: { id: string; nome: string; departamentoId: string | null }) =>
      editarCargo(p.id, { nome: p.nome, departamentoId: p.departamentoId }),
    onSuccess: async () => {
      await invalidar();
      fechar();
    },
  });
  const excluir = useMutation({
    mutationFn: excluirCargo,
    onSuccess: () => invalidar(),
  });

  const lista = cargos.data ?? [];
  const arvore = departamentos.data ?? [];

  const linhas: LinhaDoCadastro[] = lista.map((c) => ({
    id: c.id,
    nome: c.nome,
    detalhe:
      c.departamentoId === null
        ? "Sem departamento"
        : caminhoDoDepartamento(arvore, c.departamentoId).join(" › "),
    dependencias:
      c.contas === 0 ? "" : `${c.contas} pessoa${c.contas === 1 ? "" : "s"}`,
    criadoPor: c.criadoPor,
  }));

  return (
    <div className="space-y-4">
      <CascaDoCadastro
        titulo="Cargos"
        icone={<IdCard className="w-4 h-4 text-primary" />}
        rotuloDoBotao="Criar cargo"
        explicacao={
          <>
            Os cargos do quadro, cada um com uma identidade só. Duas grafias do
            mesmo nome — <code>Analista ADM</code> e <code>analista adm</code> —
            são recusadas como repetição, que é o que impede o mesmo cargo de
            virar dois para o motor. {lista.length} cadastrado
            {lista.length === 1 ? "" : "s"}.
          </>
        }
        ressalva={
          <>
            Esta tela ainda não sabe quanto cada cargo custa: a faixa salarial
            vigente não é cadastrada aqui, e mostrar uma coluna de custo sem ela
            seria mostrar um número sem lastro. O quadro por unidade e cargo que
            a importação lê continua em <strong>QLP Administrativo</strong>,
            vigência a vigência, com a célula de origem de cada valor.
          </>
        }
        linhas={linhas}
        carregando={cargos.isPending}
        erro={cargos.error}
        vazio="Nenhum cargo cadastrado. O primeiro nasce aqui, digitado por alguém — nunca de uma planilha."
        excluindo={excluir.isPending ? excluir.variables ?? null : null}
        aoCriar={() => {
          criar.reset();
          editar.reset();
          setEmEdicao(null);
          setNome("");
          setDepartamentoId(SEM_VINCULO);
          setAberto(true);
        }}
        aoEditar={(linha) => {
          const cargo = lista.find((c) => c.id === linha.id);
          criar.reset();
          editar.reset();
          setEmEdicao(linha.id);
          setNome(cargo?.nome ?? "");
          setDepartamentoId(cargo?.departamentoId ?? SEM_VINCULO);
          setAberto(true);
        }}
        aoExcluir={(linha) => excluir.mutate(linha.id)}
        formulario={
          aberto ? (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">
                {emEdicao === null ? "Criar cargo" : "Editar cargo"}
              </p>
              <RecusaDoFormulario
                erro={emEdicao === null ? criar.error : editar.error}
                reserva="Não foi possível salvar o cargo."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cargo-nome">Nome do cargo</Label>
                  <Input
                    id="cargo-nome"
                    value={nome}
                    placeholder="Analista Administrativo"
                    onChange={(e) => setNome(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cargo-departamento">Departamento (opcional)</Label>
                  <Select value={departamentoId} onValueChange={setDepartamentoId}>
                    <SelectTrigger id="cargo-departamento">
                      <SelectValue placeholder="Sem departamento" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_VINCULO}>Sem departamento</SelectItem>
                      {arvore.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {caminhoDoDepartamento(arvore, d.id).join(" › ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                O departamento é opcional de propósito: o cargo existe antes de
                alguém decidir onde ele fica, e exigir a estrutura inteira antes
                do primeiro cargo é o que faz gente voltar a digitar na planilha.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={fechar}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={criar.isPending || editar.isPending}
                  onClick={() => {
                    const vinculo =
                      departamentoId === SEM_VINCULO ? null : departamentoId;
                    if (emEdicao === null) {
                      criar.mutate({ nome, departamentoId: vinculo });
                    } else {
                      editar.mutate({ id: emEdicao, nome, departamentoId: vinculo });
                    }
                  }}
                >
                  {emEdicao === null
                    ? criar.isPending
                      ? "Criando…"
                      : "Criar cargo"
                    : editar.isPending
                      ? "Salvando…"
                      : "Salvar alterações"}
                </Button>
              </div>
            </div>
          ) : null
        }
      />
      <RecusaDaExclusao erro={excluir.error} />
    </div>
  );
}

/**
 * A recusa da exclusão, fora do formulário.
 *
 * Ela não cabe no formulário porque não veio dele: quem clicou na lixeira de
 * uma linha não tem formulário aberto, e pôr a frase lá dentro a esconderia
 * atrás de um clique. "Três pessoas estão lotadas neste cargo" precisa aparecer
 * onde a pessoa está olhando.
 */
function RecusaDaExclusao({ erro }: { erro: Error | null }) {
  if (erro === null) return null;
  const aviso = apresentar(erro);
  return (
    <Alert variant="destructive">
      <AlertDescription className="text-xs">
        {aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível excluir."}
      </AlertDescription>
    </Alert>
  );
}

/* =========================================================================
 * Departamentos
 * ====================================================================== */

export function PainelDeDepartamentos() {
  const cliente = useQueryClient();
  const departamentos = useDepartamentos();

  const [aberto, setAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [paiId, setPaiId] = useState<string>(SEM_VINCULO);

  const invalidar = () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: CHAVE_DOS_DEPARTAMENTOS }),
      /* Cargos mostram o caminho do departamento: mudá-lo muda aquela lista. */
      cliente.invalidateQueries({ queryKey: CHAVE_DOS_CARGOS }),
    ]);

  const fechar = () => {
    setAberto(false);
    setEmEdicao(null);
    setNome("");
    setPaiId(SEM_VINCULO);
  };

  const criar = useMutation({
    mutationFn: criarDepartamento,
    onSuccess: async () => {
      await invalidar();
      fechar();
    },
  });
  const editar = useMutation({
    mutationFn: (p: { id: string; nome: string; paiId: string | null }) =>
      editarDepartamento(p.id, { nome: p.nome, paiId: p.paiId }),
    onSuccess: async () => {
      await invalidar();
      fechar();
    },
  });
  const excluir = useMutation({
    mutationFn: excluirDepartamento,
    onSuccess: () => invalidar(),
  });

  const arvore = departamentos.data ?? [];

  const linhas: LinhaDoCadastro[] = arvore.map((d) => {
    const caminho = caminhoDoDepartamento(arvore, d.id);
    const dependencias = [
      d.filhos > 0 ? `${d.filhos} dentro dele` : "",
      d.cargos > 0 ? `${d.cargos} cargo${d.cargos === 1 ? "" : "s"}` : "",
    ].filter((t) => t !== "");
    return {
      id: d.id,
      nome: d.nome,
      detalhe: caminho.length > 1 ? caminho.slice(0, -1).join(" › ") : "Raiz",
      dependencias: dependencias.join(" · "),
      criadoPor: d.criadoPor,
    };
  });

  return (
    <div className="space-y-4">
      <CascaDoCadastro
        titulo="Departamentos"
        icone={<Network className="w-4 h-4 text-primary" />}
        rotuloDoBotao="Criar departamento"
        explicacao={
          <>
            A divisão interna da operação, com hierarquia: um departamento pode
            ficar dentro de outro, e é isso que responde por quem responde por
            quem. {arvore.length} cadastrado{arvore.length === 1 ? "" : "s"}.
          </>
        }
        ressalva={
          <>
            O rateio administrativo continua chegando classificado pela planilha
            de origem: esta estrutura ainda não reclassifica gasto nenhum, e a
            DRE continua somando por rubrica. O vínculo entre departamento e
            classe de custo é o que falta para a pergunta mudar de "o que se
            gastou" para "quem responde pelo gasto".
          </>
        }
        linhas={linhas}
        carregando={departamentos.isPending}
        erro={departamentos.error}
        vazio="Nenhum departamento cadastrado. Comece pelos de cima — os de dentro escolhem um pai."
        excluindo={excluir.isPending ? excluir.variables ?? null : null}
        aoCriar={() => {
          criar.reset();
          editar.reset();
          setEmEdicao(null);
          setNome("");
          setPaiId(SEM_VINCULO);
          setAberto(true);
        }}
        aoEditar={(linha) => {
          const dep = arvore.find((d) => d.id === linha.id);
          criar.reset();
          editar.reset();
          setEmEdicao(linha.id);
          setNome(dep?.nome ?? "");
          setPaiId(dep?.paiId ?? SEM_VINCULO);
          setAberto(true);
        }}
        aoExcluir={(linha) => excluir.mutate(linha.id)}
        formulario={
          aberto ? (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">
                {emEdicao === null ? "Criar departamento" : "Editar departamento"}
              </p>
              <RecusaDoFormulario
                erro={emEdicao === null ? criar.error : editar.error}
                reserva="Não foi possível salvar o departamento."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="departamento-nome">Nome do departamento</Label>
                  <Input
                    id="departamento-nome"
                    value={nome}
                    placeholder="Controladoria"
                    onChange={(e) => setNome(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="departamento-pai">Dentro de (opcional)</Label>
                  <Select value={paiId} onValueChange={setPaiId}>
                    <SelectTrigger id="departamento-pai">
                      <SelectValue placeholder="Na raiz" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_VINCULO}>Na raiz</SelectItem>
                      {arvore
                        /* O próprio departamento fica fora da lista: escolher a
                           si mesmo como pai é o círculo mais curto que existe,
                           e a tela não deve nem oferecer. */
                        .filter((d) => d.id !== emEdicao)
                        .map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {caminhoDoDepartamento(arvore, d.id).join(" › ")}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={fechar}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={criar.isPending || editar.isPending}
                  onClick={() => {
                    const pai = paiId === SEM_VINCULO ? null : paiId;
                    if (emEdicao === null) criar.mutate({ nome, paiId: pai });
                    else editar.mutate({ id: emEdicao, nome, paiId: pai });
                  }}
                >
                  {emEdicao === null
                    ? criar.isPending
                      ? "Criando…"
                      : "Criar departamento"
                    : editar.isPending
                      ? "Salvando…"
                      : "Salvar alterações"}
                </Button>
              </div>
            </div>
          ) : null
        }
      />
      <RecusaDaExclusao erro={excluir.error} />
    </div>
  );
}

/* =========================================================================
 * Negócios
 * ====================================================================== */

export function PainelDeNegocios() {
  const cliente = useQueryClient();
  const negocios = useNegocios();

  const [aberto, setAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<string | null>(null);
  const [nome, setNome] = useState("");

  const invalidar = () => cliente.invalidateQueries({ queryKey: CHAVE_DOS_NEGOCIOS });

  const fechar = () => {
    setAberto(false);
    setEmEdicao(null);
    setNome("");
  };

  const criar = useMutation({
    mutationFn: criarNegocio,
    onSuccess: async () => {
      await invalidar();
      fechar();
    },
  });
  const editar = useMutation({
    mutationFn: (p: { id: string; nome: string }) => editarNegocio(p.id, { nome: p.nome }),
    onSuccess: async () => {
      await invalidar();
      fechar();
    },
  });
  const excluir = useMutation({
    mutationFn: excluirNegocio,
    onSuccess: () => invalidar(),
  });

  const lista = negocios.data ?? [];
  const linhas: LinhaDoCadastro[] = lista.map((n) => ({
    id: n.id,
    nome: n.nome,
    detalhe: n.criadoPor === null ? "Cadastrado" : `Cadastrado por ${n.criadoPor}`,
    dependencias: "",
    criadoPor: n.criadoPor,
  }));

  return (
    <div className="space-y-4">
      <CascaDoCadastro
        titulo="Negócios"
        icone={<Briefcase className="w-4 h-4 text-primary" />}
        rotuloDoBotao="Criar negócio"
        explicacao={
          <>
            Os negócios que a operação atende, como cadastro — com autor e data.{" "}
            {lista.length} cadastrado{lista.length === 1 ? "" : "s"}.
          </>
        }
        ressalva={
          <>
            Cadastrar um negócio aqui <strong>não</strong> o faz existir para o
            motor de fechamento: Rota, Empurrada, AS e Apoio são bases escritas
            no código, e criar uma quinta continua sendo um deploy. O que esta
            tela dá é o nome com dono e data; a regra de custo e de remuneração
            de cada negócio ainda vive nas vigências importadas.
          </>
        }
        linhas={linhas}
        carregando={negocios.isPending}
        erro={negocios.error}
        vazio="Nenhum negócio cadastrado."
        excluindo={excluir.isPending ? excluir.variables ?? null : null}
        aoCriar={() => {
          criar.reset();
          editar.reset();
          setEmEdicao(null);
          setNome("");
          setAberto(true);
        }}
        aoEditar={(linha) => {
          criar.reset();
          editar.reset();
          setEmEdicao(linha.id);
          setNome(lista.find((n) => n.id === linha.id)?.nome ?? "");
          setAberto(true);
        }}
        aoExcluir={(linha) => excluir.mutate(linha.id)}
        formulario={
          aberto ? (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">
                {emEdicao === null ? "Criar negócio" : "Editar negócio"}
              </p>
              <RecusaDoFormulario
                erro={emEdicao === null ? criar.error : editar.error}
                reserva="Não foi possível salvar o negócio."
              />
              <div className="space-y-1.5 max-w-sm">
                <Label htmlFor="negocio-nome">Nome do negócio</Label>
                <Input
                  id="negocio-nome"
                  value={nome}
                  placeholder="Rota"
                  onChange={(e) => setNome(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={fechar}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={criar.isPending || editar.isPending}
                  onClick={() =>
                    emEdicao === null
                      ? criar.mutate({ nome })
                      : editar.mutate({ id: emEdicao, nome })
                  }
                >
                  {emEdicao === null
                    ? criar.isPending
                      ? "Criando…"
                      : "Criar negócio"
                    : editar.isPending
                      ? "Salvando…"
                      : "Salvar alterações"}
                </Button>
              </div>
            </div>
          ) : null
        }
      />
      <RecusaDaExclusao erro={excluir.error} />
    </div>
  );
}
