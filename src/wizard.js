const folderStep = document.getElementById("folder-step")
const engineStep = document.getElementById("engine-step")
const keyStep = document.getElementById("key-step")
const botStep = document.getElementById("bot-step")
const input = document.getElementById("folder")
const error = document.getElementById("error")
const create = document.getElementById("create")
const keyInput = document.getElementById("key")
const keyError = document.getElementById("key-error")
const saveKey = document.getElementById("save-key")
const botError = document.getElementById("bot-error")
const check = document.getElementById("check")
const start = document.getElementById("start")
const remoteStep = document.getElementById("remote-step")
const remoteInput = document.getElementById("remote")
const remoteError = document.getElementById("remote-error")
const saveRemote = document.getElementById("save-remote")

function show(step) {
  folderStep.hidden = step !== "folder"
  engineStep.hidden = step !== "engine"
  keyStep.hidden = step !== "key"
  botStep.hidden = step !== "bot"
  remoteStep.hidden = step !== "remote"
}

window.wizard.start().then((step) => {
  show(step)
  if (step === "folder") {
    window.wizard.defaultFolder().then((folder) => {
      input.value = folder
    })
  }
  if (step === "remote") {
    window.wizard.backupRemote().then((set) => {
      document.getElementById("remote-current").textContent = set ? "A remote is set." : "No remote is set."
    })
  }
})

document.getElementById("remote-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  remoteError.textContent = ""
  saveRemote.disabled = true
  const result = await window.wizard.saveRemote(remoteInput.value)
  if (!result.ok) {
    remoteError.textContent = result.error
    saveRemote.disabled = false
  }
})

document.getElementById("browse").addEventListener("click", async () => {
  const picked = await window.wizard.pickFolder()
  if (picked) input.value = picked
})

document.getElementById("open-keys").addEventListener("click", () => {
  void window.wizard.openKeyPage()
})

document.getElementById("folder-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  error.textContent = ""
  create.disabled = true
  const result = await window.wizard.create(input.value)
  if (!result.ok) {
    error.textContent = result.error
    create.disabled = false
    return
  }
  show("engine")
})

document.getElementById("engine-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  if (new FormData(event.target).get("engine") === "key") {
    show("key")
    return
  }
  await window.wizard.startFree()
  show("bot")
})

document.getElementById("key-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  keyError.textContent = ""
  saveKey.disabled = true
  const result = await window.wizard.saveKey(keyInput.value)
  if (!result.ok) {
    keyError.textContent = result.error
    saveKey.disabled = false
    return
  }
  show("bot")
})

document.getElementById("botfather").addEventListener("click", () => window.wizard.openBotFather())

document.getElementById("token-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  botError.textContent = ""
  check.disabled = true
  const result = await window.wizard.checkToken(document.getElementById("token").value)
  if (!result.ok) {
    botError.textContent = result.error
    check.disabled = false
    return
  }
  start.textContent = `Now send /start to @${result.username} from your phone.`
  start.hidden = false
  const connected = await window.wizard.waitStart()
  if (!connected.ok) {
    botError.textContent = connected.error
    start.hidden = true
    check.disabled = false
  }
})
