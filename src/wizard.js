const input = document.getElementById("folder")
const error = document.getElementById("error")
const create = document.getElementById("create")

window.wizard.defaultFolder().then((folder) => {
  input.value = folder
})

document.getElementById("browse").addEventListener("click", async () => {
  const picked = await window.wizard.pickFolder()
  if (picked) input.value = picked
})

document.querySelector("form").addEventListener("submit", async (event) => {
  event.preventDefault()
  error.textContent = ""
  create.disabled = true
  const result = await window.wizard.create(input.value)
  if (!result.ok) {
    error.textContent = result.error
    create.disabled = false
  }
})
