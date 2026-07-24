import { useState } from "react"
import { signUp, signIn } from "../lib/supabase"

export default function AuthPage() {

const [email, setEmail] = useState("")
const [password, setPassword] = useState("")
const [isSignUp, setIsSignUp] = useState(false)

const handleSubmit = async (e) => {
  e.preventDefault()
  if (!email.trim() || !password) {
  alert("Preencha o e-mail e a senha.")
  return
}

if (password.length < 6) {
  alert("A senha precisa ter pelo menos 6 caracteres.")
  return
}

  try {
    if (isSignUp) {
      const { error } = await signUp(email, password)
      if (error) {
        alert(error.message)
      } else {
        alert("Conta criada! Verifique seu e-mail.")
      }
    } else {
      const { error } = await signIn(email, password)
      if (error) {
        alert(error.message)
      } else {
        alert("Login realizado com sucesso!")
      }
    }
  } catch (err) {
    alert(err.message)
  }
}
  return (
    <main className="page">
      <section className="premium-card" style={{
        maxWidth: 420,
        margin: "80px auto",
        padding: 32,
        textAlign: "center"
      }}>
        <h1>🚚 Rota Certa PRO</h1>

        <p>
          Faça login para acessar suas entregas.
        </p>
<form onSubmit={handleSubmit}>
  <input
    type="email"
    placeholder="Seu e-mail"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    required
    style={{ width: "100%", padding: 12, marginTop: 20 }}
  />

  <input
    type="password"
    placeholder="Sua senha"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    required
    style={{ width: "100%", padding: 12, marginTop: 12 }}
  />

  <button
    type="submit"
    style={{ width: "100%", marginTop: 20 }}
  >
    {isSignUp ? "Criar conta" : "Entrar"}
  </button>

  <button
    type="button"
    onClick={() => setIsSignUp(!isSignUp)}
    style={{ width: "100%", marginTop: 12 }}
  >
    {isSignUp ? "Já tenho conta" : "Criar nova conta"}
  </button>
</form>
        
      </section>
    </main>
  )
}