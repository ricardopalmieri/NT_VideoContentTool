// Inicialização na ordem original: estilos e, em seguida, editor.
import "./ui/styles.css";
import "./ui/editor";

// Uso offline: só no build publicado (o servidor de desenvolvimento muda os arquivos o tempo todo).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Sem service worker (HTTP, navegação privada): o editor funciona igual, só não abre offline.
    });
  });
}
