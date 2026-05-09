"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getClientAuthToken, setAuthCookie } from "@/lib/session";

type User = { id: string; email: string; username: string };

const emailPattern = /.+@.+\..+/;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({
    email: false,
    password: false,
  });

  const router = useRouter();

  useEffect(() => {
    const token = window.localStorage.getItem("translateapp_token") || getClientAuthToken();
    if (token) {
      setAuthCookie(token);
      router.replace("/translate");
      return;
    }
    setAuthReady(true);
  }, [router]);

  const validate = () => {
    const nextErrors = {
      email: false,
      password: false,
    };

    if (!emailPattern.test(email)) {
      nextErrors.email = true;
      setFieldErrors(nextErrors);
      return "El mail debe tener un formato valido";
    }

    if (password.length < 8) {
      nextErrors.password = true;
      setFieldErrors(nextErrors);
      return "La contrasena debe tener al menos 8 caracteres";
    }

    setFieldErrors(nextErrors);
    return null;
  };

  const persistSession = (token: string, user: User) => {
    window.localStorage.setItem("translateapp_token", token);
    window.localStorage.setItem("translateapp_user", JSON.stringify(user));
    setAuthCookie(token);
  };

  const handleSubmit = async () => {
    setError(null);
    setFieldErrors({ email: false, password: false });
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const endpoint = "/api/auth/login";
    const payload = { email, password };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      if (data.code === "user_not_found" || data.code === "invalid_email") {
        setFieldErrors({ email: true, password: false });
      }
      if (data.code === "wrong_password" || data.code === "invalid_password") {
        setFieldErrors({ email: false, password: true });
      }
      setError(data.error || "No se pudo completar la solicitud");
      return;
    }

    persistSession(data.token, data.user);
    router.replace("/translate");
  };

  if (!authReady) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="note">Cargando sesion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <p className="eyebrow">TranslateApp</p>
        <h1>Iniciar sesion</h1>
        <p className="subtitle">Accede con tu correo y contrasena.</p>

        <div className="login-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldErrors.email ? "input-error" : ""}
            />
          </label>

          <label>
            Contraseña
            <span className="input-row">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={fieldErrors.password ? "input-error" : ""}
              />
              <button
                type="button"
                className="btn ghost toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </span>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="btn primary" onClick={handleSubmit}>
            Aceptar
          </button>
          <Link className="btn subtle" href="/register">
            Crear cuenta
          </Link>
        </div>
      </div>
    </div>
  );
}
