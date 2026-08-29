# O desvio de `/api/*` — o que foi provado, e o que falta provar fora daqui

A tela da Visão Geral mostra, em produção, o aviso `DESVIADA`: *"o pedido não
chegou ao FreightCheck: alguma camada entre o seu navegador e a aplicação o
desviou para outro endereço"*. Este documento registra o que a investigação
estabeleceu, com que evidência, e o que só pode ser resolvido fora deste
repositório.

## 1. O que a tela está afirmando, e por que a afirmação é forte

`artifacts/freightaudit/src/lib/api.ts` faz toda chamada com
`redirect: "manual"`. Com isso, um 3xx não é seguido: o navegador devolve uma
resposta opaca (`type: "opaqueredirect"`, `status: 0`) e
`lib/transporte.ts` a classifica como `DESVIADA`. **Só se chega a esse estado
tendo havido resposta, e sendo ela um redirect.** Não é interpretação de
`Failed to fetch`; é um 3xx observado.

O que transforma isso em acusação a uma camada intermediária é uma segunda
propriedade: **esta API não redireciona em rota nenhuma**. Ela deixou de ser
uma frase em comentário e passou a ser teste
(`artifacts/api-server/src/__tests__/nenhum-desvio-em-api.test.ts`), com duas
réguas — o comportamento do servidor real e o texto-fonte, que não pode conter
`res.redirect`, `res.location` nem `Location` escrito à mão.

## 2. A cadeia, medida

Servidor real, sem sessão e com o banco fora do ar — o pior caso, e o único em
que um servidor convencional mandaria alguém para uma tela de login:

```
GET /api/healthz                      → 200  application/json   X-FreightCheck-API: 1
GET /api/readyz                       → 503  application/json   X-FreightCheck-API: 1
GET /api/build                        → 200  application/json   X-FreightCheck-API: 1
GET /api/contexts                     → 401  application/json   X-FreightCheck-API: 1
GET /api/changes/families/overview…   → 401  application/json   X-FreightCheck-API: 1
GET /api/changes/families             → 401  application/json   X-FreightCheck-API: 1
GET /api/balance                      → 401  application/json   X-FreightCheck-API: 1
GET /api/imports                      → 401  application/json   X-FreightCheck-API: 1
GET /api/rota-que-nao-existe          → 401  application/json   X-FreightCheck-API: 1
```

Nenhum 3xx, nenhum `Location`, tudo JSON. Sessão inválida responde
`401 {"code":"UNAUTHENTICATED"}` — nunca um desvio para outra origem.

Do lado do cliente, a arquitetura é de **mesma origem** e isso também virou
régua (`mesma-origem-e-carimbo.test.ts`): `getApiUrl` devolve sempre caminho
relativo sob `/api`, e não existe neste repositório nenhuma `VITE_API_URL`,
`API_BASE_URL` ou endereço absoluto num `fetch`. O roteador da plataforma serve
o bundle em `/` e encaminha `/api/*` para o processo do `api-server` — é o que
os dois `.replit-artifact/artifact.toml` declaram.

**Conclusão:** o 3xx observado em produção não sai deste código, e não sai do
endereço que este código monta.

## 3. O carimbo — como não voltar a ficar cego

`middlewares/carimbo-da-api.ts` escreve `X-FreightCheck-API: 1` e
`X-Request-Id` em **toda** resposta que sai do Express, no primeiro middleware
da pilha. A recíproca é o valor: resposta sem o carimbo não passou por lá.

Isso troca uma inferência por um fato. Antes, "chegou ao Express?" era deduzido
do formato do corpo — não é JSON, logo não é nossa. A regra acerta na maioria e
erra nos casos caros: um 502 de corpo vazio do roteador e um 204 legítimo da API
têm o mesmo corpo. Agora o navegador grava `chegouAoServidor` (`true`, `false`
ou `undefined` quando não houve resposta para carimbar), junto com o
`requestId`, a origem HTTP, a duração e o estado, em `__freightcheck_falhas`.

## 4. O que ainda precisa ser provado — e como

A investigação **não** conseguiu medir produção: o ambiente em que ela rodou tem
saída de rede restrita e recusa `freightcheck.com.br` no proxy
(`x-deny-reason: host_not_allowed`, tanto em 80 quanto no CONNECT de 443). A
cadeia HTTP pública, portanto, não está medida aqui, e nada neste documento
afirma tê-la medido.

O instrumento para medi-la está no repositório:

```
node scripts/prova-do-desvio.mjs https://freightcheck.com.br
node scripts/prova-do-desvio.mjs https://freightcheck.com.br --cookie "…"
```

Ele repete as chamadas da Visão Geral sem seguir redirect, imprime de cada salto
status, `Location`, `Content-Type`, `Server`, nomes dos cookies e o carimbo, e
segue a cadeia até o destino final — que é justamente o que o navegador esconde.
`node scripts/doctor.mjs https://freightcheck.com.br` faz a versão curta (e não
mente mais: até esta correção ele imprimia `ok` para um 3xx em `/api`).

O que a saída decide:

| Observado | Quem respondeu | Onde corrigir |
| --- | --- | --- |
| 3xx sem carimbo, `Location` para outra origem | camada antes da API | publicação |
| 3xx com carimbo | a API — seria defeito nosso | este repositório (e o teste estaria vermelho) |
| 200/4xx com carimbo | a API | este repositório |
| 200 sem carimbo | cache, proxy ou build antigo | publicação |

## 5. O que olhar na plataforma, se o desvio se confirmar

Em ordem de probabilidade, dado o desenho publicado (Replit, autoscale,
`router = "application"`, domínio próprio apontando para um balanceador do GCP):

1. **Proteção de acesso do deployment.** É a explicação que casa com todos os
   sintomas, inclusive a intermitência: a camada de autenticação da plataforma
   fica na frente do roteador, devolve 3xx para o portal quando a sessão *dela*
   expira, e essa sessão é renovada ao abrir o endereço principal — que é
   exatamente o que a tela recomenda e o que se observa funcionar. Uma navegação
   de página segue o redirect e volta; uma chamada de API não pode segui-lo, e
   morre como desvio opaco. Conferir se o deployment está publicado como
   público.
2. **O endereço pelo qual o produto está sendo aberto.** Um `*.replit.dev` (o
   preview do ambiente) tem essa camada por natureza; o deployment publicado no
   domínio próprio, não. Se o link em uso for o de preview, o desvio é esperado
   e a correção é usar o domínio publicado.
3. **Regras de domínio.** `www` versus ápice, redirect canônico, HTTP→HTTPS: se
   alguma delas aplicar-se também a `/api/*`, uma chamada XHR bate no redirect
   antes de chegar ao roteador de caminhos.

Nenhuma das três se corrige no React, e nenhuma delas deve ser contornada aqui:
não há workaround honesto para um 3xx que acontece antes da aplicação existir.
