"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const [code, setCode] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!loading && user) {
      window.location.href = "/dashboard";
    }
  }, [user, loading]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

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
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <p className="text-sm text-muted-foreground animate-pulse">Chargement...</p>
      </div>
    );
  }

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
              Entrez votre code pour vous connecter
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-center gap-3">
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
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
