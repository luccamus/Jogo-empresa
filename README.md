# LINHA 7 — Controle de Qualidade

Jogo de navegador em HTML/CSS/JavaScript puro, controlado pela mão do
jogador via webcam, usando **MediaPipe Tasks Vision (HandLandmarker)**
para detecção de mão em tempo real.

## Estrutura

```
/
├── index.html      → estrutura das telas (início, jogo, game over)
├── style.css       → tema visual industrial
├── script.js       → lógica do jogo + rastreamento de mão
└── assets/
    ├── images/      → (livre para sprites customizados; hoje o jogo usa emojis)
    └── sounds/       → (livre para .mp3/.wav; hoje os efeitos são sintetizados via Web Audio API)
```

Nenhum arquivo em `assets/` é obrigatório para o jogo funcionar — os
"produtos" usam emojis e os efeitos sonoros são gerados por código
(osciladores), então não há dependência de arquivos binários. As pastas
ficam prontas caso você queira substituir por sprites/sons próprios.

## Por que preciso rodar em um servidor local (não basta abrir o index.html direto)?

Duas exigências técnicas do navegador tornam isso necessário:

1. **`getUserMedia` (acesso à câmera)** só funciona em **contextos
   seguros**: `https://` ou `http://localhost` (e variações como
   `127.0.0.1`). Abrir o arquivo direto como `file:///...` é bloqueado
   pela maioria dos navegadores.
2. **`script.js` usa `import` (módulo ES)**, que a maioria dos
   navegadores também recusa a carregar a partir de `file://` por
   política de CORS.

Por isso é necessário um servidor HTTP simples, mesmo que local.

## Como executar localmente

Escolha uma das opções abaixo (qualquer uma resolve os dois pontos
acima, pois todas servem via `http://localhost`):

### Opção 1 — Python (já vem instalado na maioria dos sistemas)
```bash
cd jogo-linha-producao
python3 -m http.server 8000
```
Acesse: `http://localhost:8000`

### Opção 2 — Node.js
```bash
cd jogo-linha-producao
npx serve .
```
Acesse o endereço mostrado no terminal (geralmente `http://localhost:3000`).

### Opção 3 — Extensão "Live Server" do VS Code
Abra a pasta no VS Code, clique com o botão direito em `index.html` →
"Open with Live Server".

## Permitindo acesso à câmera

1. Ao clicar em **"INICIAR TURNO"**, o navegador vai pedir permissão
   de câmera — clique em **Permitir/Allow**.
2. Se você negou por engano, clique no ícone de cadeado/câmera na
   barra de endereço do navegador e libere a permissão manualmente,
   depois recarregue a página.
3. Certifique-se de que nenhum outro programa (Zoom, Teams, etc.)
   está usando a câmera ao mesmo tempo, o que pode impedir o acesso.
4. Em redes corporativas ou sistemas com política de segurança, pode
   ser necessário aprovar a permissão de câmera do navegador nas
   configurações do sistema operacional.

## Como jogar

- Mostre a palma da mão aberta para a câmera — um círculo amarelo vai
  seguir a posição da sua mão sobre a esteira.
- Quando um produto **defeituoso** (com uma rachadura visível) passar
  sob o círculo, **feche a mão** (gesto de pegar) para retirá-lo.
- Produtos normais devem ser deixados passar — pegá-los por engano
  tira uma vida e zera o combo.
- Deixar um produto defeituoso passar sem pegá-lo zera o combo (mas
  não custa vida).
- A cada nível, a esteira acelera, produtos aparecem com mais
  frequência e a proporção de defeitos diminui.
- O jogo termina quando as 3 vidas acabam.

## Requisitos de navegador

- Navegador moderno com suporte a WebGL/WebAssembly (Chrome, Edge ou
  Firefox recentes recomendados).
- Boa iluminação ajuda bastante a precisão da detecção da mão.
- É necessária conexão com a internet, pois a biblioteca MediaPipe e
  o modelo de detecção de mão são carregados de um CDN (não estão
  embutidos no projeto).

## Notas técnicas rápidas

- A detecção de "mão fechada" (gesto de pegar) é feita comparando a
  distância das pontas dos dedos ao pulso com o tamanho da palma —
  não depende de um modelo de gestos treinado à parte.
- Para evitar múltiplas capturas com um único gesto, o jogo só
  processa uma captura na *transição* de mão aberta → mão fechada.
- Pequenas perdas de rastreamento (mão saindo do quadro por um
  instante) são toleradas por ~15 frames antes de o indicador de
  câmera mostrar "mão perdida", evitando que o cursor pisque a cada
  leve falha de detecção.
