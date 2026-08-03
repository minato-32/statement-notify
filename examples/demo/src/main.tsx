import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { initNotifier } from "./store.js";
import "./styles.css";

// The notifier is created once, outside React (it is async — hydrates persisted
// state before first render), then passed in as a prop.
void initNotifier().then((notifier) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root not found");
  createRoot(root).render(
    <StrictMode>
      <App notifier={notifier} />
    </StrictMode>,
  );
});
