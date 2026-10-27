import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// 桌面 App（Electron）以 ?app=mac 打开：给红绿灯留位、开启标题栏拖拽
if (new URLSearchParams(location.search).get("app") === "mac") {
  document.documentElement.classList.add("mac-app");
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
