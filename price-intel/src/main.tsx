import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./palette.css";
import "./palette-effects.css";
import "./ux-fixes.css";
import "./command-center-polish.css";

createRoot(document.getElementById("root")!).render(<App />);
