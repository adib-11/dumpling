const folderStep = document.getElementById("folder-step")
const keyStep = document.getElementById("key-step")
const input = document.getElementById("folder")
const error = document.getElementById("error")
const create = document.getElementById("create")
const keyInput = document.getElementById("key")
const keyError = document.getElementById("key-error")
const saveKey = document.getElementById("save-key")

function show(step) {
  folderStep.hidden = step !== "folder"
  keyStep.hidden = step !== "key"
}

window.wizard.start().then((step) => {
  show(step)
  if (step === "folder") {
    window.wizard.defaultFolder().then((folder) => {
      input.value = folder
    })
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
  show("key")
})

document.getElementById("key-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  keyError.textContent = ""
  saveKey.disabled = true
  const result = await window.wizard.saveKey(keyInput.value)
  if (!result.ok) {
    keyError.textContent = result.error
    saveKey.disabled = false
  }
})
