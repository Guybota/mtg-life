# 🔥 MTG Life Counter

Contador de vida para Magic: The Gathering — Commander padrão, Duelo 1v1, Livre e Battle Royale (regras homebrew de 6 jogadores incluídas).

## Como testar agora, no browser

Não precisas de instalar nada. Tens duas opções:

**Opção A — mais simples:** dá duplo-clique no ficheiro `index.html` e ele abre diretamente no teu browser (Chrome, Safari, Edge...).

**Opção B — recomendada** (ativa a pesquisa de commanders sem restrições de alguns browsers e prepara o modo offline):
1. Abre um terminal nesta pasta.
2. Corre: `python3 -m http.server 8000` (ou `npx serve .` se tiveres Node).
3. Abre `http://localhost:8000` no browser.

A app funciona em qualquer browser moderno (desktop ou telemóvel) e é responsiva — no telemóvel já se comporta como uma app.

## Como funciona

- **Menu inicial**: escolhe o modo — Commander Padrão (2–8 jogadores, 40 vidas, commander damage), Duelo 1v1, Livre (escolhes nº de jogadores e vida inicial, com a opção de ligar/desligar commander damage), ou Battle Royale (6 jogadores, regras completas que pediste).
- **Escolher commander**: em cada jogador, toca na miniatura para pesquisar o commander na Scryfall (é necessária ligação à internet só para esta pesquisa/imagens). A arte da carta fica automaticamente como fundo do jogador. Se não tiveres internet no momento, há sempre a opção "Imagem manual" para colar uma URL de imagem, ou "Sem imagem". Quem não escolher nenhum commander recebe uma cor de fundo sorteada em vez do cinzento padrão — nunca repetida entre os jogadores que também estejam sem imagem, no mesmo jogo.
- **Tabuleiro de vida**: toca no lado direito de um jogador para somar vida, no lado esquerdo para subtrair. Mantém premido para repetir rapidamente. Os jogadores "de cima" aparecem rodados 180° para facilitar o jogo em mesa (passa-e-joga).
- **Commander damage**: cada jogador tem pequenos ícones dos oponentes — toca num para abrir o contador de dano de commander desse oponente especificamente (chega aos 21 = eliminado automaticamente).
- **Commander Parceiro (Partner)**: no setup (ou a meio do jogo, no ✏️) cada jogador pode escolher um segundo commander parceiro, além do principal. Quando um oponente tem parceiro, aparecem dois ícones de dano separados para ele (um por cada commander, cada um mata aos 21 independentemente) — o ícone do parceiro tem borda roxa para se distinguir.
- **Manter jogador eliminado no jogo**: se uma carta em jogo evita a eliminação a 0 vidas ou 21+ de commander damage (ex: Platinum Angel, Worship), toca no carimbo vermelho "ELIMINADO" do jogador para o manteres no jogo — passa a mostrar um carimbo dourado "🛡️ PROTEGIDO" em vez de eliminado, e continua a jogar normalmente. Assim que essa carta sair do campo, toca no carimbo "PROTEGIDO" para voltares a eliminá-lo.
- **Battle Royale**: mapa de zonas A–F (zona inicial de cada jogador sorteada aleatoriamente), contador de rondas com fecho automático de zona a cada 3ª ronda da mesa, botão de evento aleatório (dado), fluxo de eliminação com atribuição de recompensas (loot), fases Final Circle e Final Duel, e ecrã de campeão no final com estatísticas. Toca no ℹ️ no topo para reveres as regras a qualquer momento.
- **Passar turno**: tanto no Commander/Duelo/Livre como no Battle Royale há um botão de passar turno — toca nele para tocar o som de aviso e passar a vez ao jogador seguinte (salta automaticamente quem já foi eliminado). Vês sempre de quem é a vez e há dois relógios ao vivo: duração do turno atual e duração total do jogo.
- **Terminar jogo e estatísticas**: no Commander/Duelo/Livre há um botão "🏁 Terminar" que pergunta quem venceu e mostra logo a seguir um ecrã com a duração total do jogo e quanto tempo cada jogador demorou nos seus turnos (com médias e % do jogo). No Battle Royale este ecrã aparece automaticamente quando sai um campeão.
- **Perfis de commander**: ao escolher o commander de um jogador (no setup ou a meio do jogo, no ✏️), podes ligar um "perfil" a esse jogador — cria um novo ou escolhe um já existente. Sempre que um jogo termina, as estatísticas desse jogador (vitórias, tempo médio por turno e por jogo, tempo total jogado) ficam guardadas no perfil. Acede a "👤 Perfis guardados" no menu principal para veres as stats agregadas de cada commander ou apagares perfis antigos.
- **Histórico de jogos por perfil**: em cada perfil, toca em "📜" para abrires a lista de todos os jogos registados (data/hora, vitória ou derrota, modo, duração do jogo e dos teus turnos). Podes apagar jogos individuais do histórico (🗑️ em cada linha) — as stats agregadas do perfil são recalculadas automaticamente.
- O jogo fica guardado automaticamente neste browser (mesmo que feches a página, ao voltar aparece "Continuar jogo em curso"); os perfis ficam guardados à parte, mesmo depois de terminares vários jogos.

## Para instalar como "app" no iPhone (mais tarde)

Isto é uma PWA (Progressive Web App): já tem tudo preparado (`manifest.json`, ícones, service worker) para quando quiseres. Quando decidires publicar isto online (por exemplo GitHub Pages, Netlify ou Vercel — todos têm planos gratuitos), basta:
1. Abrir o link no Safari do iPhone.
2. Tocar no botão de partilha (□ com seta para cima).
3. Escolher "Adicionar ao Ecrã Principal".

A app abre depois em ecrã inteiro, com o próprio ícone, como qualquer app instalada — sem precisar de App Store nem de conta de developer Apple. Quando quiseres avançar para isso, ajudo-te com o alojamento.

## Estrutura do projeto

```
index.html          — página principal
css/style.css        — estilos
js/scryfall.js        — integração com a Scryfall API (pesquisa de commanders)
js/profiles.js        — perfis de commander guardados (stats entre jogos)
js/state.js           — motor de estado do jogo (vida, dano, zonas, loot, turnos)
js/app.js             — interface e navegação entre ecrãs
assets/te_toca.mp3    — som tocado ao passar o turno
manifest.json + sw.js + icons/  — ficheiros da PWA (instalação como app)
```
