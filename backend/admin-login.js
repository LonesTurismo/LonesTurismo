import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "segredo_super";

export function loginAdmin(req, res) {

  const { usuario, senha } = req.body;

  if (usuario === "admin" && senha === "admin123") {

    const token = jwt.sign(
      { usuario: "admin", role: "admin" },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      success: true,
      token
    });
  }

  return res.status(401).json({
    error: "Usuário ou senha inválidos"
  });
}