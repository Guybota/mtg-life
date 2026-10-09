/* ===========================================================
   i18n.js — língua da interface (segue a língua do sistema)
   Português se o sistema/browser estiver em português; inglês em
   qualquer outro caso. A chave de cada texto é a própria frase em
   português, por isso o código continua legível e qualquer texto sem
   tradução cai automaticamente para o português.
   Uso: MTG.i18n.t("Começar jogo") · t("Ronda {n}", { n: 3 })
   =========================================================== */
(function (global) {
  const preferred = (navigator.languages && navigator.languages[0]) || navigator.language || "pt";
  const lang = /^pt\b/i.test(preferred) ? "pt" : "en";

  // Textos longos com HTML, identificados por chave (sem frase PT como chave).
  const PT_BLOCKS = {
    "__br_rules__": `
      <div><strong>Vida:</strong> todos começam com 30. Sem commander damage. A 0 estás eliminado — tudo o que controlas sai do jogo.</div>
      <div><strong>Combate:</strong> podes atacar qualquer jogador na tua zona ou zona adjacente. Se 2 jogadores atacarem o mesmo alvo e ele morrer, ambos escolhem recompensa.</div>
      <div><strong>Loot:</strong> ao eliminar alguém, escolhe 1 recompensa (só uma vez por recompensa por jogo): 3 Treasure, compra 3 cartas, ganha 10 vidas, ficha 6/6, recupera carta do cemitério, ou 1 carta grátis este turno.</div>
      <div><strong>Mapa:</strong> zonas A–F em linha. Move-te para uma zona adjacente no início do teu turno, ou fica.</div>
      <div><strong>Círculo:</strong> a cada 3ª ronda da mesa (todos jogam 3 vezes), fecha a zona mais distante do centro (ordem: A, F, B, E, C, D). Quem estiver lá perde 5 vidas no início do seu turno. A zona inicial de cada jogador é sorteada aleatoriamente.</div>
      <div><strong>Evento aleatório:</strong> 1 dado por ronda — Blood Moon (-3 todos), Supply Drop (+1 treasure todos), Frenzy (+2/+0), Blackout (máx 1 compra), Healing Zone (+5 todos), Air Drop (jogador com menos vida compra 5).</div>
      <div><strong>Final Circle</strong> (restam 3): sem ganhar vidas, todos atacam todos, +2 Treasure no início do turno, criaturas com haste.</div>
      <div><strong>Final Duel</strong> (restam 2): +10 vidas, desviram tudo, compram 3, criam 3 Treasure — até à morte. O campeão escolhe o próximo evento aleatório.</div>`,
  };

  const EN = {
    "__br_rules__": `
      <div><strong>Life:</strong> everyone starts at 30. No commander damage. At 0 you're out — everything you control leaves the game.</div>
      <div><strong>Combat:</strong> you can attack any player in your zone or an adjacent zone. If 2 players attack the same target and it dies, both pick a reward.</div>
      <div><strong>Loot:</strong> when you eliminate someone, pick 1 reward (each reward only once per game): 3 Treasure, draw 3 cards, gain 10 life, a 6/6 token, return a card from your graveyard, or 1 free spell this turn.</div>
      <div><strong>Map:</strong> zones A–F in a line. Move to an adjacent zone at the start of your turn, or stay.</div>
      <div><strong>Circle:</strong> every 3rd table round (everyone has played 3 times), the zone furthest from the centre closes (order: A, F, B, E, C, D). Anyone there loses 5 life at the start of their turn. Each player's starting zone is random.</div>
      <div><strong>Random event:</strong> 1 die per round — Blood Moon (-3 everyone), Supply Drop (+1 treasure everyone), Frenzy (+2/+0), Blackout (max 1 draw), Healing Zone (+5 everyone), Air Drop (lowest life draws 5).</div>
      <div><strong>Final Circle</strong> (3 left): no life gain, everyone attacks everyone, +2 Treasure at the start of each turn, creatures have haste.</div>
      <div><strong>Final Duel</strong> (2 left): +10 life, untap everything, draw 3, create 3 Treasure — to the death. The champion picks the next random event.</div>`,

    // geral / modos
    "Jogo": "Game",
    "Duelo 1v1": "1v1 Duel",
    "Livre": "Free",
    "Padrão": "Standard",
    "Equipas": "Teams",
    "Commander Padrão": "Standard Commander",
    "Commander • Battle Royale • Livre": "Commander • Battle Royale • Free",
    "Continuar jogo em curso": "Resume current game",
    "2–8 jogadores · 40 vidas · Commander damage": "2–8 players · 40 life · Commander damage",
    "2 jogadores · 40 vidas · Commander damage": "2 players · 40 life · Commander damage",
    "Escolhe nº de jogadores e vida inicial": "Choose number of players and starting life",
    "6 jogadores · zonas · loot · último vivo": "6 players · zones · loot · last one standing",
    "Escolhe nº de equipas e jogadores por equipa · vida partilhada": "Choose number of teams and players per team · shared life",
    "As imagens dos commanders são obtidas automaticamente da Scryfall API (é necessária ligação à internet só para a pesquisa).": "Commander images are fetched automatically from the Scryfall API (an internet connection is only needed for searching).",
    "Perfis guardados": "Saved profiles",
    "Já existe um jogo em curso. Começar um novo jogo vai substituí-lo. Continuar?": "There's already a game in progress. Starting a new one will replace it. Continue?",

    // chips / relógios
    "Vez: {name}": "Turn: {name}",
    "Ronda {n}": "Round {n}",
    "Turno {time}": "Turn {time}",
    "Total {time}": "Total {time}",
    "Pausado": "Paused",
    "Contar tempo e turnos": "Track time and turns",
    "Desliga para jogar só com a vida — sem relógios, rondas nem passar turno.": "Turn off to play with life totals only — no clocks, rounds or passing turns.",
    "Sem perfil": "No profile",

    // commander picker
    "Escolher commander": "Choose commander",
    "Escolher commander parceiro": "Choose partner commander",
    "Nome do commander (ex: Atraxa, Krenko...)": "Commander name (e.g. Atraxa, Krenko...)",
    "Imagem manual": "Manual image",
    "Sem imagem": "No image",
    "Nome do commander": "Commander name",
    "URL da imagem (https://...)": "Image URL (https://...)",
    "Usar esta imagem": "Use this image",
    "Cancelar": "Cancel",
    "A pesquisar na Scryfall…": "Searching Scryfall…",
    "Sem resultados para esse nome.": "No results for that name.",
    "Escolher arte/versão alternativa": "Choose alternate art/printing",
    "Sem ligação à Scryfall. Tenta a imagem manual abaixo.": "Can't reach Scryfall. Try the manual image below.",
    "Indica uma URL de imagem válida.": "Enter a valid image URL.",
    "Escolher arte — {name}": "Choose art — {name}",
    "A carregar edições…": "Loading printings…",
    "Não há outras edições/artes disponíveis para esta carta.": "No other printings/art available for this card.",
    "Arte de {artist}": "Art by {artist}",
    "Não foi possível carregar as edições/artes. Tenta novamente.": "Couldn't load printings/art. Please try again.",

    // perfis (picker)
    "Perfil do jogador": "Player profile",
    "Os perfis guardam as estatísticas deste commander entre jogos (vitórias, tempo médio por turno/jogo, etc).": "Profiles keep this commander's stats across games (wins, average time per turn/game, etc).",
    "Criar novo perfil": "Create new profile",
    "Remover perfil": "Remove profile",
    "Nome do perfil": "Profile name",
    "Criar e ligar": "Create and link",
    "Ainda não tens perfis guardados.": "You don't have any saved profiles yet.",
    "{g} jogos · {w} vitórias": "{g} games · {w} wins",
    "Escolhe primeiro um commander para este jogador.": "Choose a commander for this player first.",

    // setup
    "Jogadores": "Players",
    "Vida inicial": "Starting life",
    "Começar jogo": "Start game",
    "Commander parceiro": "Partner commander",
    "Jogador {n}": "Player {n}",
    "Equipa {n}": "Team {n}",
    "Sem commander escolhido": "No commander chosen",
    "Jogadores/equipa": "Players/team",
    "Vida inicial (por equipa)": "Starting life (per team)",
    "Vida partilhada por equipa (estilo Two-Headed Giant): a equipa toda soma/perde vida em conjunto. Os turnos alternam entre equipas.": "Shared life per team (Two-Headed Giant style): the whole team gains/loses life together. Turns alternate between teams.",
    "6 jogadores · 30 vidas cada · zona inicial sorteada aleatoriamente · sem commander damage. Consulta as regras completas no ecrã de jogo (ícone de informação).": "6 players · 30 life each · random starting zone · no commander damage. See the full rules on the game screen (info icon).",
    "Começar Battle Royale": "Start Battle Royale",

    // tabuleiro
    "Sair de ecrã inteiro": "Exit full screen",
    "Ecrã inteiro": "Full screen",
    "Reiniciar": "Restart",
    "Retomar": "Resume",
    "Pausar": "Pause",
    "Histórico de vida": "Life history",
    "Trocar posições": "Swap seats",
    "Terminar": "End",
    "A jogar": "Playing",
    "Passar turno": "Pass turn",
    "Voltar ao menu? O jogo atual fica guardado e podes continuar mais tarde.": "Back to the menu? The current game is saved and you can resume it later.",
    "Voltar ao menu? O jogo fica guardado.": "Back to the menu? The game is saved.",
    "Reiniciar vidas, commander damage e os relógios de turno/jogo de todos os jogadores?": "Reset life, commander damage and the turn/game clocks for all players?",
    "Reiniciar vidas e commander damage de todos os jogadores?": "Reset life and commander damage for all players?",
    "Reiniciar vidas de todas as equipas e os relógios de turno/jogo?": "Reset all teams' life and the turn/game clocks?",
    "Reiniciar vidas de todas as equipas?": "Reset all teams' life?",

    // terminar jogo
    "Terminar jogo": "End game",
    "Quem venceu esta partida? (fica registado nos perfis ligados)": "Who won this game? (recorded in linked profiles)",
    "Que equipa venceu esta partida? (fica registado nos perfis ligados de todos os jogadores dessa equipa)": "Which team won this game? (recorded in the linked profiles of every player on that team)",
    " (eliminado)": " (eliminated)",
    " (eliminada)": " (eliminated)",
    "Sem vencedor / não contar": "No winner / don't record",
    "Confirmar": "Confirm",

    // commander tax / damage
    "Cada vez que conjuras o commander da zona de comando, o custo sobe {2}. Toca em \"+\" de cada vez que o conjurares.": "Each time you cast your commander from the command zone it costs {2} more. Tap \"+\" every time you cast it.",
    "Fechar": "Close",
    "PARCEIRO": "PARTNER",
    "Sem commander": "No commander",

    // quem começa
    "Quem começa?": "Who goes first?",
    "Escolhe manualmente ou roda os dados — ganha quem tirar o valor mais alto (empates voltam a rolar).": "Pick manually or roll the dice — highest roll goes first (ties roll again).",
    "Rolar dados por todos": "Roll for everyone",
    "Empate — a rodar de novo só entre quem empatou...": "Tie — rolling again between tied players...",

    // eliminação / proteção
    "Toca se uma carta evita a eliminação": "Tap if a card prevents the elimination",
    "ELIMINADO": "ELIMINATED",
    "ELIMINADA": "ELIMINATED",
    "Toca se a carta de proteção saiu do campo": "Tap if the protecting card left the battlefield",
    "PROTEGIDO": "PROTECTED",
    "Toca para reverter": "Tap to undo",
    "Jogador eliminado": "Player eliminated",
    "Jogador protegido": "Player protected",
    "{name} está eliminado (0 ou menos vidas, ou 21+ de commander damage). Se tens em jogo uma carta que evita a eliminação (ex: Platinum Angel, Worship...), podes mantê-lo no jogo.": "{name} is eliminated (0 or less life, or 21+ commander damage). If a card in play prevents losing (e.g. Platinum Angel, Worship...), you can keep them in the game.",
    "{name} está a ser mantido no jogo apesar de já ter sofrido a eliminação, graças a uma carta de proteção. Assim que essa carta sair do campo, volta a eliminá-lo aqui.": "{name} is being kept in the game despite being eliminated, thanks to a protecting card. As soon as that card leaves the battlefield, eliminate them again here.",
    "Manter no jogo": "Keep in game",
    "A carta saiu — eliminar agora": "The card left — eliminate now",

    // editar jogador
    "Editar jogador": "Edit player",
    "Nome": "Name",
    "Alterar Commander": "Change commander",
    "Alterar Parceiro": "Change partner",
    "Adicionar commander parceiro": "Add partner commander",
    "Perfil": "Profile",
    "Reviver jogador": "Revive player",
    "Marcar como eliminado": "Mark as eliminated",
    "Guardar": "Save",

    // battle royale
    "Zonas fechadas: {n}/5": "Closed zones: {n}/5",
    "FINAL CIRCLE — não podes ganhar vidas · todos atacam todos · criaturas com haste · +2 Treasure no início de cada turno": "FINAL CIRCLE — no life gain · everyone attacks everyone · creatures have haste · +2 Treasure at the start of each turn",
    "Restam 2 jogadores!": "2 players left!",
    "Iniciar Duelo Final": "Start Final Duel",
    "FINAL DUEL em curso — até à morte!": "FINAL DUEL in progress — to the death!",
    "Rolar evento": "Roll event",
    "Próximo turno": "Next turn",
    "Regras": "Rules",
    "Fase normal": "Normal phase",
    "Preparar duelo": "Prepare duel",
    "Terminado": "Finished",
    "Eliminado": "Eliminated",
    "Zona atual": "Current zone",
    "Eliminar": "Eliminate",
    "Eliminar {name} do jogo?": "Eliminate {name} from the game?",
    "Continuar": "Continue",
    "{name} foi eliminado!": "{name} was eliminated!",
    "Quem participou no abate? (se dois jogadores atacaram o mesmo alvo, escolhe ambos — os dois recebem recompensa)": "Who took part in the kill? (if two players attacked the same target, pick both — both get a reward)",
    "Ninguém escolhe recompensa": "Nobody picks a reward",
    "Recompensa para {name}": "Reward for {name}",
    "Não escolher recompensa": "Skip reward",
    "Regras — Battle Royale": "Rules — Battle Royale",
    "Entendido": "Got it",
    "Campeão do Battle Royale": "Battle Royale champion",
    "Novo Battle Royale": "New Battle Royale",
    // eventos / loot / registo (state.js)
    "Cada jogador perde 3 vidas.": "Each player loses 3 life.",
    "Cada jogador cria 1 Treasure.": "Each player creates 1 Treasure.",
    "Todas as criaturas ganham +2/+0 até ao teu próximo turno.": "All creatures get +2/+0 until your next turn.",
    "Ninguém pode comprar mais de 1 carta neste turno.": "No one can draw more than 1 card this turn.",
    "Cada jogador ganha 5 vidas.": "Each player gains 5 life.",
    "O jogador com menos vidas compra 5 cartas.": "The player with the lowest life draws 5 cards.",
    "Cria 3 Treasure": "Create 3 Treasure",
    "Compra 3 cartas": "Draw 3 cards",
    "Ganha 10 vidas": "Gain 10 life",
    "Ficha 6/6": "6/6 token",
    "Recupera carta do cemitério": "Return a card from graveyard",
    "Carta grátis este turno": "Free spell this turn",
    "Battle Royale iniciado. Boa sorte, tributos.": "Battle Royale started. Good luck, tributes.",
    "FINAL CIRCLE — restam 3 jogadores! Não se pode ganhar vidas. Todos podem atacar todos. Criaturas com haste.": "FINAL CIRCLE — 3 players left! No life gain. Everyone can attack everyone. Creatures have haste.",
    "Restam 2 jogadores — prepara o FINAL DUEL!": "2 players left — get ready for the FINAL DUEL!",
    "{name} é o CAMPEÃO DO BATTLE ROYALE!": "{name} is the BATTLE ROYALE CHAMPION!",
    "Jogo terminado.": "Game over.",
    "{name} foi eliminado! (tudo o que controlava sai do jogo)": "{name} was eliminated! (everything they controlled leaves the game)",
    "{name} escolheu recompensa: {reward}": "{name} chose a reward: {reward}",
    "{name} está numa zona fechada e perde 5 vidas!": "{name} is in a closed zone and loses 5 life!",
    "THE ZONE IS CLOSING — a zona {zone} está agora FECHADA!": "THE ZONE IS CLOSING — zone {zone} is now CLOSED!",
    "Rolou {roll} — {title}: {desc}": "Rolled {roll} — {title}: {desc}",
    "FINAL DUEL! Ambos ganham 10 vidas, desviram permanentes, compram 3 cartas e criam 3 Treasure.": "FINAL DUEL! Both gain 10 life, untap permanents, draw 3 cards and create 3 Treasure.",
    "Novo perfil": "New profile",

    // vitória / resultado
    "Vitória": "Victory",
    "Derrota": "Defeat",
    "Toca para continuar": "Tap to continue",
    "Vencedor": "Winner",
    "Em jogo no fim": "Still in at the end",
    "eliminado": "eliminated",
    "{turn} em turno · {n} turno(s) · média {avg}/turno · {pct}% do jogo": "{turn} on turn · {n} turn(s) · avg {avg}/turn · {pct}% of game",
    "Duração total do jogo": "Total game time",
    "Resultado": "Results",

    // trocar posições / histórico
    "Usa as setas para mudar a posição de cada jogador no tabuleiro — não afeta a ordem dos turnos.": "Use the arrows to move each player around the board — this doesn't change the turn order.",
    "Usa as setas para mudar a posição de cada equipa no tabuleiro — não afeta a ordem dos turnos.": "Use the arrows to move each team around the board — this doesn't change the turn order.",
    "Concluído": "Done",
    "Ainda não há alterações de vida registadas neste jogo.": "No life changes recorded in this game yet.",
    "Turno de {name}": "{name}'s turn",

    // ecrã de perfis
    "Perfis": "Profiles",
    "Exportar": "Export",
    "Importar": "Import",
    "Ainda não tens perfis guardados. Cria um ao escolher o commander de um jogador, no ecrã de setup de um jogo.": "You don't have any saved profiles yet. Create one when choosing a player's commander on a game's setup screen.",
    "Não foi possível ler este ficheiro. Confirma que é um ficheiro exportado por esta app.": "Couldn't read this file. Make sure it's a file exported by this app.",
    "Não foram encontrados perfis válidos neste ficheiro.": "No valid profiles found in this file.",
    "1 perfil importado com sucesso.": "1 profile imported successfully.",
    "{n} perfis importados com sucesso.": "{n} profiles imported successfully.",
    "{n} jogo(s)": "{n} game(s)",
    "{n} vitória(s)": "{n} win(s)",
    "Média/turno: {time}": "Avg/turn: {time}",
    "Média/jogo: {time}": "Avg/game: {time}",
    "Total jogado: {time}": "Total played: {time}",
    "Turnos totais: {n}": "Total turns: {n}",
    "Ver histórico": "View history",
    "Apagar perfil": "Delete profile",
    "Apagar o perfil \"{name}\"? Esta ação não pode ser desfeita.": "Delete the profile \"{name}\"? This can't be undone.",
    "Histórico — {name}": "History — {name}",
    "Ainda não há jogos registados para este perfil.": "No games recorded for this profile yet.",
    "Jogo sem contagem de tempo/turnos": "Game without time/turn tracking",
    "Jogo: {game} · Nos teus turnos: {turns} ({n} turno(s))": "Game: {game} · On your turns: {turns} ({n} turn(s))",
    "Apagar este jogo": "Delete this game",
    "Apagar este jogo do histórico? As stats do perfil serão atualizadas.": "Delete this game from the history? The profile stats will be updated.",

    // estatísticas e gráficos dos perfis
    "{w} de {g} vitórias": "{w} of {g} wins",
    "Jogos registados": "Games recorded",
    "Melhor taxa de vitórias": "Best win rate",
    "Taxa de vitórias por perfil": "Win rate by profile",
    "Jogos": "Games",
    "Vitórias": "Wins",
    "Derrotas": "Losses",
    "Média por jogo": "Avg per game",
    "Média por turno": "Avg per turn",
    "Forma recente": "Recent form",
    "Últimos {n} jogos, do mais antigo para o mais recente": "Last {n} games, oldest to newest",
    "V": "W",
    "D": "L",
    "Jogo {n}": "Game {n}",
    "Evolução da taxa de vitórias": "Win rate over time",
    "Percentagem de vitórias acumulada, jogo a jogo": "Cumulative win percentage, game by game",
    "Resultados por modo": "Results by mode",
    "Duração dos jogos": "Game length",
    "Últimos {n} jogos com tempo contado, em minutos": "Last {n} timed games, in minutes",
    "Histórico de jogos": "Game history",
    "Ainda sem jogos": "No games yet",
    // setup refinado
    "Outra": "Other",
    "Último jogo": "Last game",
    "Lugares": "Seats",
    "Confrontos diretos": "Head to head",
    "Jogos em que estiveram os dois à mesa: vitórias deste perfil – vitórias do adversário": "Games with both at the table: this profile's wins – opponent's wins",
    "vs {name}": "vs {name}",
    "Este perfil ganhou": "This profile won",
    "Adversário ganhou": "Opponent won",
    "Sequência atual": "Current streak",
    "Melhor": "Best",
    "1 vitória": "1 win",
    "{n} vitórias seguidas": "{n} wins in a row",
    "1 derrota": "1 loss",
    "{n} derrotas seguidas": "{n} losses in a row",
    "Procurar perfil, commander ou jogador": "Search profile, commander or player",
    "Procurar perfis": "Search profiles",
    "Ordenar": "Sort",
    "Mais recentes": "Most recent",
    "% vitórias": "Win %",
    "Mais jogos": "Most games",
    "Nenhum perfil corresponde à pesquisa.": "No profile matches your search.",
    "Desfazer": "Undo",
    "Perfil \"{name}\" apagado": "Profile \"{name}\" deleted",
    "Jogo apagado do histórico": "Game removed from history",
    "Editar perfil": "Edit profile",
    "Trocar commander": "Change commander",
    "Outra arte": "Other art",
    "Jogador": "Player",
    "Nome de quem joga com este deck": "Name of whoever plays this deck",
    "Cor quando não há arte": "Colour when there's no art",
    "Perfil guardado": "Profile saved",
    "Veneno": "Poison",
    "Contadores de veneno": "Poison counters",
    "Mostra um contador de veneno em cada jogador (10 elimina).": "Shows a poison counter on each player (10 eliminates).",
    "Veneno — {name}": "Poison — {name}",
    "Com 10 ou mais contadores de veneno o jogador é eliminado.": "A player with 10 or more poison counters is eliminated.",
    "Menos um": "One less",
    "Mais um": "One more",
    "Começa já — o resto ajusta-se no tabuleiro": "Start right away — adjust the rest on the board",
    "Menos um jogador": "One fewer player",
    "Mais um jogador": "One more player",
    "Nomes, commanders e perfis: toca no lápis de cada jogador durante o jogo.": "Names, commanders and profiles: tap each player's pencil during the game.",
    "Começar já": "Start now",
    "Configurar jogadores primeiro": "Set up players first",
    "Lugar {n}": "Seat {n}",
    "Arrasta um lugar para trocar · os números são a ordem dos turnos": "Drag a seat to swap · numbers are the turn order",
    "Sortear lugares": "Shuffle seats",
    "Sortear equipas": "Shuffle teams",
    "Lugares sorteados": "Seats shuffled",
    "Equipas sorteadas": "Teams shuffled",
    "Perfis recentes": "Recent profiles",
    "Usar o perfil {name}": "Use the profile {name}",
    "Cor sem commander": "Colour without commander",
    "Cor {n}": "Colour {n}",
    "Este perfil já está no lugar {n} — as estatísticas contariam duas vezes.": "This profile is already in seat {n} — its stats would be counted twice.",
    "hoje": "today",
    "ontem": "yesterday",
    "há {n} dias": "{n} days ago",
    "{n} jogadores": "{n} players",
    "{n} vidas": "{n} life",
    "sem tempo": "untimed",
    "Repetir": "Play again",
    "Ajustar antes": "Adjust first",
    "Mais opções": "More options",
    "Tempo e turnos": "Time and turns",
    "Contador de dano de commander por oponente (21 elimina).": "Commander damage tracker per opponent (21 eliminates).",
  };

  const missing = new Set();
  function t(key, params) {
    let out;
    if (lang === "en") {
      out = EN[key];
      if (out == null) { missing.add(key); out = PT_BLOCKS[key] != null ? PT_BLOCKS[key] : key; }
    } else {
      out = PT_BLOCKS[key] != null ? PT_BLOCKS[key] : key;
    }
    if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return out;
  }

  document.documentElement.lang = lang === "en" ? "en" : "pt-PT";
  global.MTG = global.MTG || {};
  global.MTG.i18n = { lang, t, missing };
})(window);
