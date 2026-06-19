"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Lock, AlertCircle, ChevronDown, Clock, User } from "lucide-react";
import { cn } from "@/lib/utils";

// Clé du cache local : retient le dernier utilisateur choisi sur CETTE machine
// pour le pré-sélectionner à la prochaine connexion.
const LAST_USER_KEY = "gestlog_last_user_id";

interface LoginUser {
  id: string;
  name: string;
}

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const [code, setCode] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [expired, setExpired] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!loading && user) {
      window.location.href = "/dashboard";
    }
  }, [user, loading]);

  // Bannière si l'utilisateur a été déconnecté pour inactivité (?expired=1).
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("expired") === "1"
    ) {
      setExpired(true);
    }
  }, []);

  // Charge la liste des utilisateurs + pré-sélectionne le dernier choisi (cache local).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => {
        if (cancelled) return;
        const list: LoginUser[] = d.users || [];
        setUsers(list);
        const cached =
          typeof window !== "undefined" ? localStorage.getItem(LAST_USER_KEY) : null;
        if (cached && list.some((u) => u.id === cached)) setSelectedUserId(cached);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelectUser = (id: string) => {
    setSelectedUserId(id);
    setError("");
    setCode(["", "", "", ""]);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(LAST_USER_KEY, id);
      else localStorage.removeItem(LAST_USER_KEY);
    }
    inputRefs.current[0]?.focus();
  };

  const handleInput = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);
    setError("");

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    if (value && index === 3) {
      const fullCode = newCode.join("");
      if (fullCode.length === 4) {
        handleSubmit(fullCode);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length === 4) {
      const newCode = pasted.split("");
      setCode(newCode);
      handleSubmit(pasted);
    }
  };

  const handleSubmit = async (fullCode: string) => {
    setSubmitting(true);
    setError("");
    const result = await login(fullCode);
    if (result.error) {
      setError(result.error);
      setCode(["", "", "", ""]);
      inputRefs.current[0]?.focus();
      setSubmitting(false);
    }
    // Succès → redirection gérée par login(). Le cache utilisateur est déjà à jour
    // (mis lors de la sélection dans le menu déroulant).
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <p className="text-sm text-muted-foreground animate-pulse">Chargement...</p>
      </div>
    );
  }

  const selectedName = users.find((u) => u.id === selectedUserId)?.name;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <Card className="w-full max-w-sm mx-4 shadow-lg">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center">
            <Package className="h-7 w-7 text-white" />
          </div>
          <div>
            <CardTitle className="text-xl">GestLog</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {selectedName
                ? `Bonjour ${selectedName}, entrez votre code`
                : "Choisissez votre utilisateur et entrez votre code"}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {expired && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              <Clock className="h-4 w-4 shrink-0" />
              Vous avez été déconnecté pour inactivité.
            </div>
          )}

          {/* Menu déroulant des utilisateurs (facultatif — aide à choisir / mémorise). */}
          {users.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Utilisateur
              </label>
              <div className="relative">
                <select
                  value={selectedUserId}
                  onChange={(e) => onSelectUser(e.target.value)}
                  disabled={submitting}
                  className={cn(
                    "w-full appearance-none rounded-xl border-2 border-zinc-200 bg-white px-3 py-2.5 pr-10 text-sm font-medium",
                    "outline-none transition-all focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10",
                    "disabled:opacity-50"
                  )}
                >
                  <option value="">Sélectionner un utilisateur…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleInput(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={i === 0 ? handlePaste : undefined}
                disabled={submitting}
                className={cn(
                  "w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 bg-white transition-all outline-none",
                  "focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10",
                  error ? "border-red-300 shake" : "border-zinc-200",
                  submitting && "opacity-50"
                )}
              />
            ))}
          </div>

          {error && (
            <div className="flex items-center justify-center gap-2 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center">
            <Lock className="h-3 w-3" />
            Saisissez votre code à 4 chiffres
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
