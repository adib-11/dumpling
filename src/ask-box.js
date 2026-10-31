const form = document.getElementById("ask-form")
const question = document.getElementById("question")
const error = document.getElementById("error")
const answer = document.getElementById("answer")
// Not named ask: the preload already defines window.ask, and a script-level const of that name throws.
const askButton = document.getElementById("ask-button")

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  error.textContent = ""
  answer.textContent = ""
  askButton.disabled = true
  askButton.textContent = "Asking…"
  const result = await window.ask.question(question.value)
  askButton.disabled = false
  askButton.textContent = "Ask"
  if (!result.ok) {
    error.textContent = result.error
    return
  }
  answer.textContent = result.answer
})
