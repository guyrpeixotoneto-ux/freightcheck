# Integrações: a terceira porta

Até agora o FreightCheck tinha duas portas. Uma pessoa com um arquivo na mão,
em Importações; e uma pessoa com sessão aberta, lendo uma tela. A terceira é a
API: um sistema falando com este, sem ninguém olhando na hora.

Este documento é o desenho dela — o que existe hoje, o que ela deliberadamente
não faz, e o que vem depois.

## O que existe hoje

| peça | onde |
| --- | --- |
| o vocabulário (chave, escopo, decisão do portão) | `lib/integrations` |
| as três tabelas | `lib/db/src/schema/integracao.ts`, migration `0082` |
| a gestão (tela e sessão) | `artifacts/api-server/src/routes/integracoes.ts` |
| a porta externa (chave, sem sessão) | `artifacts/api-server/src/routes/v1.ts` |
| o portão que autentica e registra | `artifacts/api-server/src/middlewares/chave-de-integracao.ts` |
| a tela | `artifacts/freightaudit/src/pages/integracoes.tsx` → **Dados & governança → Integrações** |
| a busca ativa (motor, agenda e cofre) | `lib/integrations/src/busca.ts`, `src/cofre.ts`; `artifacts/api-server/src/lib/busca-ativa.ts`, `busca-agendada.ts`, `cofre.ts`; migration `0083` |

As três direções, e o que cada uma quer dizer:

| direção | quem liga | como se autentica |
| --- | --- | --- |
| **entrada** | o sistema de fora | a chave que emitimos (`importacoes:enviar`) |
| **saída** | o sistema de fora | a chave que emitimos (`importacoes:ler`) |
| **busca ativa** | **nós**, numa agenda | a credencial *deles*, guardada no nosso cofre |

## A fronteira: nenhuma chave promove

Um arquivo que chega por API é recebido, lido e conferido, e **para em
PREVIEWED** — exatamente onde para o arquivo que sobe pela tela. A aprovação
continua sendo o clique de uma pessoa em Importações.

Não é excesso de zelo: a separação entre "entrou" e "vale" é o produto inteiro.
O que muda com a API é quem carrega o arquivo, e não quem responde pelo que
passou a valer. Na prática, o ganho é grande e não custa a fronteira — o
Freightec pode empurrar o export às seis da manhã, e quem opera chega com o
resumo pronto para conferir e aprovar, em vez de precisar exportar, baixar e
subir à mão antes de começar.

Por isso não existe escopo `importacoes:promover`, e a ausência dele é
verificada por teste (`lib/integrations/src/__tests__/decisao.test.ts`).

## A credencial

Formato: `fck_<12 hex públicos>_<64 hex secretos>`.

- **O banco não guarda a chave** — só o SHA-256 dela e o prefixo público. Um
  dump deste banco não vira acesso à API, e uma chave perdida não se recupera:
  emite-se outra e revoga-se a anterior.
- **O prefixo localiza a linha**, e é o que a tela mostra e o log registra. É
  possível dizer *qual* chave chamou sem que nada guarde a chave inteira.
- **A comparação é em tempo constante** (`timingSafeEqual` sobre os hashes).
- **A chave vai no cabeçalho**, `Authorization: Bearer …` ou
  `X-FreightCheck-Key: …`. Nunca em query string: endereço entra no log de todo
  proxy do caminho, e credencial em log de terceiro é credencial vazada que
  ninguém sabe que vazou.
- **Várias chaves por integração**, para poder trocar sem parar: emite-se a
  nova, configura-se o outro lado, revoga-se a antiga. Revogar é definitivo.

## Os escopos

O catálogo vive em `lib/integrations/src/escopos.ts`, e a regra dele é uma só:
**só entra escopo que já tem rota**. Um escopo que anuncia o que não existe faz
quem integra escrever o cliente contra um nome que responde 404 no dia da
virada.

| escopo | direção | o que abre |
| --- | --- | --- |
| `importacoes:enviar` | entrada | `POST /api/v1/importacoes` |
| `importacoes:ler` | saída | `GET /api/v1/importacoes`, `GET /api/v1/importacoes/:id` |

`GET /api/v1/ping` não exige escopo: é a chamada que responde "a chave que eu
configurei está certa?" sem arriscar um envio de verdade.

## Como um sistema chama

```bash
# 1. conferir a chave
curl -H "Authorization: Bearer fck_…" https://<servidor>/api/v1/ping

# 2. enviar o export
curl -X POST https://<servidor>/api/v1/importacoes \
     -H "Authorization: Bearer fck_…" \
     -H "Content-Type: application/json" \
     -d '{"filename":"vigencia.xlsx","contentBase64":"UEsDBBQ…","declaredType":"FRETE"}'
# → 202 { "importacaoId": "…", "status": "PENDING", "acompanhe": "/api/v1/importacoes/…" }

# 3. acompanhar até PREVIEWED — e então esperar a aprovação humana
curl -H "Authorization: Bearer fck_…" https://<servidor>/api/v1/importacoes/<id>
```

Respostas de recusa têm sempre a mesma forma do resto da API:
`{ error, code, requestId }`. Os códigos que a porta escreve por conta própria
são `CHAVE_AUSENTE`, `CHAVE_MALFORMADA`, `CHAVE_DESCONHECIDA`,
`CHAVE_REVOGADA`, `INTEGRACAO_DESATIVADA` e `ESCOPO_INSUFICIENTE` — cada um com
uma frase que diz o que consertar, porque quem lê é uma pessoa depurando a
configuração de uma máquina.

Um 409 ao reenviar o mesmo arquivo **não é falha da integração**: é o pipeline
dizendo que aquele conteúdo já entrou (`content_sha256`). Um agendador que
reenvia o export do dia recebe 409 na segunda vez, e está tudo certo.

## O registro

Toda chamada autenticada vira linha em `integracao_chamada` — inclusive a
recusada por escopo, que é justamente a que explica uma integração parada. O
status é lido no `finish` da resposta, e não no retorno da rota: assim o 500 do
contrato de erro e o 404 de caminho inexistente também aparecem.

O que **não** é registrado: a chamada com chave que não foi reconhecida. Ela não
tem dono, atribuí-la a alguém seria inventar, e guardar o que veio no cabeçalho
seria gravar uma credencial de origem desconhecida. Ela é recusada, e aparece no
log do processo com o `requestId`.

## A busca ativa

É a direção em que nós ligamos primeiro: numa agenda, este servidor chama um
endereço https do fornecedor, traz a planilha e a entrega ao mesmo pipeline de
Importações — que **para no preview**, como as outras duas portas. Uma agenda
que promovesse sozinha seria a pior das três: ninguém sequer clicou em "enviar".

O que ela busca é um **arquivo .xlsx** — o mesmo export que hoje alguém baixa e
sobe à mão. Não é limitação de esforço: é a única coisa que dá para prometer
sem inventar, porque um conector que lesse JSON do fornecedor precisaria de um
mapeamento campo a campo do formato **deles**, e esse formato não está escrito
em lugar nenhum aqui. Quando existir, ele entra como leitor novo em
`@workspace/ingest`, e a busca continua a mesma: ela transporta, não interpreta.

### O cofre, e a assimetria que ele resolve

A nossa chave é guardada como **hash** — só precisamos conferi-la. A credencial
do fornecedor precisa ser **apresentada** a cada busca, então tem de voltar ao
valor original: ela é cifrada com AES-256-GCM, e a chave mestra vive fora do
banco, em `INTEGRACOES_CHAVE_MESTRA` (32 bytes; gere com `openssl rand -hex 32`).

Sem a variável não há cofre, e o produto diz isso em voz alta: a tela não
oferece o campo de credencial, o cadastro com segredo é recusado, e a partida
loga alto se houver buscas com credencial já cadastradas. Cifrar com uma chave
escrita no repositório seria pior do que não guardar — pareceria protegido.

GCM e não CBC porque GCM **autentica**: um byte alterado no banco faz a leitura
falhar, em vez de devolver lixo que seria enviado como credencial para um
servidor de fora. A credencial nunca é lida de volta por rota nenhuma; trocar
significa cadastrar de novo.

### A defesa de rede (SSRF), em duas camadas

Um servidor que busca uma URL escolhida por um usuário pode ser usado para
alcançar o que **só ele** alcança: o banco na rede interna, o `localhost`, o
serviço de metadados da nuvem — de onde se sai com as credenciais da própria
instância. As defesas:

1. **no cadastro** (`conferirUrlDaBusca`): só https, sem usuário/senha embutidos
   na URL, e nada que já se saiba ser interno — `localhost`, `10/8`, `172.16/12`,
   `192.168/16`, `127/8`, `169.254/16`, `100.64/10`, IPv6 local, sufixos
   `.internal` e `.localhost`;
2. **na conexão** (`resolverComGuarda`): a conferência é a **própria resolução
   de nome** que o socket usa, passada como `lookup` ao `https.request`. Não há
   uma resolução para conferir e outra para conectar, então não há janela para
   o "DNS rebinding" — um nome público que resolve para `127.0.0.1` morre aqui.

Por isso a busca usa `node:https` em vez do `fetch` global: o `fetch` não deixa
escolher o resolvedor. Redirecionamentos são seguidos **à mão**, no máximo três,
cada salto reconferido do zero — e **a credencial não atravessa salto para outro
host**.

Além disso: teto de 60 segundos, teto de 64 MB aplicado enquanto o corpo chega
(a conexão é destruída ao ser ultrapassado), e a mesma conferência de assinatura
`PK` do upload pela tela — uma página de login em HTML, que é a resposta clássica
de quem perdeu a sessão do outro lado, é recusada com essa frase em vez de
falhar dentro do leitor de planilha.

### A agenda

`proxima_em` é relógio e trava ao mesmo tempo. A varredura roda a cada minuto em
**todas** as instâncias, toma as linhas vencidas com `FOR UPDATE SKIP LOCKED` e
empurra o carimbo dentro da mesma transação — então duas instâncias nunca buscam
a mesma coisa, sem tabela de lock e sem eleição de líder. A chamada em si
acontece fora da transação, porque são até 60 segundos de rede.

O piso do intervalo é de **15 minutos**, no código e no `CHECK` do banco: o
export muda algumas vezes por mês, e buscar de minuto em minuto só transformaria
esta agenda em tráfego contra um sistema de terceiro.

O relógio conta a partir de **agora**, e não do horário previsto: contando do
previsto, uma busca parada seis horas acordaria disparando as vinte e quatro
execuções que "deveria" ter feito, todas trazendo o mesmo arquivo.

### Os quatro desfechos

| resultado | quer dizer |
| --- | --- |
| `OK` | veio arquivo novo; entrou como importação, aguardando aprovação |
| `SEM_NOVIDADE` | o arquivo é igual ao que já tínhamos — o desfecho **normal** de uma agenda que busca mais vezes do que a fonte muda |
| `RECUSADA` | o outro lado respondeu e a resposta não serve: erro HTTP, HTML no lugar da planilha, arquivo grande demais, endereço interno — ou o cofre deste ambiente não abriu a credencial |
| `FALHA` | ninguém do outro lado disse nada: rede, tempo esgotado, defeito nosso |

`SEM_NOVIDADE` tem nome próprio de propósito. Sem ele, uma busca saudável
apareceria vermelha todo dia — e o vermelho deixaria de querer dizer alguma
coisa.

O botão **executar agora** na tela dispara a busca na hora e responde com o
desfecho. É o que separa configurar de adivinhar: sem ele, um endereço errado só
apareceria amanhã de manhã, num histórico que ninguém abriu.

## O que ainda não existe, e por quê

**Saída além de importações.** Expor apuração, alterações e DRE para um BI é
uma decisão de contrato, não de código: cada resposta que sai vira compromisso
com um sistema que ninguém aqui controla. Quando houver o primeiro consumidor
real, o escopo entra no catálogo com a rota junto — nunca antes.

**Limite de frequência.** Não há rate limit, e não é esquecimento: o que existe
atrás desta porta é o envio de planilha, cuja defesa é o `content_sha256`. Um
limitador sem estado compartilhado daria falsa segurança num serviço que escala
horizontalmente. Ele vem junto da primeira rota que precise dele.

**Webhook — nós avisando o outro lado.** Hoje quem enviou pergunta
(`GET /api/v1/importacoes/:id`). Avisar exige fila e reentrega, e a pergunta
resolve enquanto o volume for o de hoje.

**Busca que lê JSON.** A busca ativa traz arquivo. Ler uma API de dados do
fornecedor exige o mapeamento do formato deles para o nosso, e ele entra como
leitor em `@workspace/ingest` quando existir um formato real para mapear — não
como um "conector genérico" que adivinha.

**Aviso quando uma busca começa a falhar.** Hoje a falha fica no histórico da
tela, e quem não abre a tela não fica sabendo. O caminho já existe (`lib/alerta.ts`,
o mesmo do backup) e o gatilho natural é a segunda falha seguida — a primeira é
quase sempre o outro lado reiniciando.

## O ambiente

| variável | para quê |
| --- | --- |
| `INTEGRACOES_CHAVE_MESTRA` | a chave do cofre, 32 bytes (`openssl rand -hex 32`). Sem ela, a entrada e a saída por chave funcionam normalmente; só a busca ativa **com credencial** fica indisponível, e a tela diz isso. |

Trocar a chave mestra invalida as credenciais já guardadas — elas não abrem com
outra chave, por construção. O conserto é cadastrar as buscas de novo, e é por
isso que a troca não é rotina.

## Permissão

O módulo é `/integracoes`, como todo item de menu
(`artifacts/api-server/src/lib/permissoes.ts`). Quem não tem `EDITAR` nele não
cria integração, não emite e não revoga chave — o portão de escrita recusa por
prefixo de API, e a tela some do menu de quem tem `SEM_ACESSO`. Leitura segue a
regra do resto do produto: quem tem sessão lê.
