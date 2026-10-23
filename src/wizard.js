const input = document.getElementById("folder")
const error = document.getElementById("error")
const create = document.getElementById("create")
const botError = document.getElementById("bot-error")
const check = document.getElementById("check")
const start = document.getElementById("start")

function showBotStep() {
  document.getElementById("folder-step").hidden = true
  document.getElementById("bot-step").hidden = false
}

window.wizard.hasFolder().then((has) => {
  if (has) showBotStep()
})

window.wizard.defaultFolder().then((folder) => {
  input.value = folder
})

document.getElementById("browse").addEventListener("click", async () => {
  const picked = await window.wizard.pickFolder()
  if (picked) input.value = picked
})

document.querySelector("#folder-step form").addEventListener("submit", async (event) => {
  event.preventDefault()
  error.textContent = ""
  create.disabled = true
  const result = await window.wizard.create(input.value)
  if (!result.ok) {
    error.textContent = result.error
    create.disabled = false
    return
  }
  showBotStep()
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
