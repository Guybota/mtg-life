/* ===========================================================
   ui/main.js — Arranque: teclado, service worker e aviso de nova versão.

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
// ---------------------------------------------------------
// Arranque
// ---------------------------------------------------------
/** Teclado do iPhone/iPad: o browser não encolhe a página quando o
 *  teclado abre — tapa a parte de baixo. A área visível (visualViewport)
 *  fica em variáveis CSS, e as janelas passam a caber acima do teclado. */
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    const open = window.innerHeight - vv.height > 120;
    root.classList.toggle("kb-open", open);
    root.style.setProperty("--vv-h", vv.height + "px");
    root.style.setProperty("--vv-top", vv.offsetTop + "px");
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

document.addEventListener("DOMContentLoaded", () => {
  trackKeyboard();
  render();
  setupServiceWorker();
  // Sincronização na nuvem: atualiza o cartão de estado e, quando chegam
  // mudanças de outro aparelho, redesenha os ecrãs de perfis (nunca o jogo)
  let lastHandled = null;
  Cloud.onStatus((st) => {
    repaintSyncCard();
    const r = st.lastResult;
    if (!st.syncing && r && r !== lastHandled) {
      lastHandled = r;
      const changedHere = r.profiles || r.games || r.removed;
      if (changedHere && ["profiles", "profile-detail", "player-detail", "menu"].includes(currentScreen) && !document.querySelector(".modal-backdrop")) render();
    }
  });
  Cloud.init();
  // Pede ao browser para não apagar os dados desta app quando o
  // aparelho fica com pouco espaço (no iPhone ajuda sobretudo com a
  // app instalada no ecrã principal).
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then((ok) => ok || navigator.storage.persist()).catch(() => {});
    }
  } catch (e) {}
});

// Atualizações: o service worker novo instala-se sozinho; aqui só se
// procura uma versão nova sempre que a app volta ao ecrã e se avisa com
// um botão "Atualizar". Assim nunca é preciso apagar o ícone do ecrã
// principal para atualizar — o que, no iPhone, apaga também os dados.
function setupServiceWorker() {
  if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || location.hostname === "localhost")) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) showUpdateBanner(); // na 1.ª instalação não há nada a atualizar
  });
}

function showUpdateBanner() {
  if (document.querySelector(".update-banner")) return;
  const b = el(`
    <div class="update-banner" role="status">
      <span class="update-msg">${tr("Nova versão disponível")}</span>
      <button type="button" class="update-btn">${tr("Atualizar")}</button>
    </div>`);
  // os dados ficam todos no aparelho, por isso recarregar não perde nada
  // (nem o jogo em curso, que é guardado a cada alteração)
  b.querySelector(".update-btn").addEventListener("click", () => location.reload());
  document.body.appendChild(b);
}
