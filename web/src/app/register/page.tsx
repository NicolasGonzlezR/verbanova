"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getClientAuthToken, setAuthCookie } from "@/lib/session";

type User = { id: string; email: string; username: string };

const emailPattern = /.+@.+\..+/;

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({
    email: false,
    username: false,
    password: false,
    passwordConfirm: false,
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
      username: false,
      password: false,
      passwordConfirm: false,
    };

    if (!emailPattern.test(email)) {
      nextErrors.email = true;
      setFieldErrors(nextErrors);
      return "El mail debe tener un formato valido";
    }

    if (username.length < 3 || username.length > 20) {
      nextErrors.username = true;
      setFieldErrors(nextErrors);
      return "El nombre debe tener entre 3 y 20 caracteres";
    }

    if (password.length < 8) {
      nextErrors.password = true;
      setFieldErrors(nextErrors);
      return "La contrasena debe tener al menos 8 caracteres";
    }

    if (password !== passwordConfirm) {
      nextErrors.passwordConfirm = true;
      setFieldErrors(nextErrors);
      return "Las contrasenas no coinciden";
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
    setFieldErrors({ email: false, username: false, password: false, passwordConfirm: false });
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (data.code === "user_exists_email" || data.code === "invalid_email") {
        setFieldErrors({ email: true, username: false, password: false, passwordConfirm: false });
      }
      if (data.code === "user_exists_username" || data.code === "invalid_username") {
        setFieldErrors({ email: false, username: true, password: false, passwordConfirm: false });
      }
      if (data.code === "invalid_password") {
        setFieldErrors({ email: false, username: false, password: true, passwordConfirm: false });
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
        <h1>Crear cuenta</h1>
        <p className="subtitle">Crea tu perfil para gestionar voces privadas.</p>

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
            Nombre de usuario
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={fieldErrors.username ? "input-error" : ""}
            />
          </label>

          <label>
            Contrasena
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

          <label>
            Repetir contrasena
            <input
              type={showPassword ? "text" : "password"}
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              className={fieldErrors.passwordConfirm ? "input-error" : ""}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="btn primary" onClick={handleSubmit}>
            Crear cuenta
          </button>
          <Link className="btn subtle" href="/login">
            Volver a login
          </Link>
        </div>
      </div>
    </div>
  );
}
