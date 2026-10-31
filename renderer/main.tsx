import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { Capture } from "./Capture"
import "./style.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.hash === "#capture" ? <Capture /> : <App />}
  </StrictMode>,
)
