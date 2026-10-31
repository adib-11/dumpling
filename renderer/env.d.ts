/// <reference types="vite/client" />
import type { DumplingApi } from "../src/main-window"

declare global {
  interface Window {
    dumpling: DumplingApi
  }
}
