import jwt from "jsonwebtoken";

// usa o mesmo segredo do server.js
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME";

export function loginAdmin(req, res) {
  // aceita os dois formatos para funcionar com seu frontend atual:
  // - app.js envia { user, pass }
  // - alguns testes enviam { usuario, senha }
  const usuario = (req.body?.usuario ?? req.body?.user ?? "").trim();
  const senha = (req.body?.senha ?? req.body?.pass ?? "").trim();

  if (usuario === "admin" && senha === "admin123") {
    const token = jwt.sign(
      { usuario: "admin", role: "admin" },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({ success: true, token });
  }

  return res.status(401).json({ error: "Usuário ou senha inválidos" });
}