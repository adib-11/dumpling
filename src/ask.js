const form = document.getElementById("ask-form")
const question = document.getElementById("question")
const error = document.getElementById("error")
const answer = document.getElementById("answer")
const ask = document.getElementById("ask-button")

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  error.textContent = ""
  answer.textContent = ""
  ask.disabled = true
  ask.textContent = "Asking…"
  const result = await window.ask.question(question.value)
  ask.disabled = false
  ask.textContent = "Ask"
  if (!result.ok) {
    error.textContent = result.error
    return
  }
  answer.textContent = result.answer
})
