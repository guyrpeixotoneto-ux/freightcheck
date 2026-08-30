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

## O que ainda não existe, e por quê

**Busca ativa — nós chamando o fornecedor numa agenda.** É a terceira direção
do assunto (as outras duas, entrada e saída, já estão de pé), e ela exige três
coisas que esta leva não tem: um lugar para guardar a credencial *do outro
lado* (cofre, e não esta tabela, que guarda hash de chave nossa), um agendador
com registro de execução, e um mapeamento do formato deles para o nosso. É a
próxima leva natural, e o desenho dela cabe nas mesmas três tabelas mais uma de
agenda.

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

## Permissão

O módulo é `/integracoes`, como todo item de menu
(`artifacts/api-server/src/lib/permissoes.ts`). Quem não tem `EDITAR` nele não
cria integração, não emite e não revoga chave — o portão de escrita recusa por
prefixo de API, e a tela some do menu de quem tem `SEM_ACESSO`. Leitura segue a
regra do resto do produto: quem tem sessão lê.
