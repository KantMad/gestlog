"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, KeyRound, LogOut, Shield } from "lucide-react";
import { toast } from "sonner";

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

export default function AccountPage() {
  const { user, loading, refresh, logout } = useAuth();
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [savingCode, setSavingCode] = useState(false);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Le nom ne peut pas être vide");
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Échec de la mise à jour");
        return;
      }
      await refresh();
      toast.success("Nom mis à jour");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSavingName(false);
    }
  };

  const saveCode = async () => {
    if (!/^\d{4}$/.test(newCode)) {
      toast.error("Le code doit être composé de 4 chiffres");
      return;
    }
    if (newCode !== confirmCode) {
      toast.error("Les deux codes ne correspondent pas");
      return;
    }
    setSavingCode(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Échec de la mise à jour");
        return;
      }
      setNewCode("");
      setConfirmCode("");
      toast.success("Code mis à jour");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSavingCode(false);
    }
  };

  if (loading || !user) {
    return (
      <>
        <Topbar title="Mon compte" />
        <div className="p-4 sm:p-6 lg:p-8">
          <p className="text-sm text-muted-foreground animate-pulse">Chargement…</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Mon compte" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-2xl">
        <PageHeader
          title="Mon compte"
          description="Gérez votre nom, votre code de connexion et votre session."
        />

        {/* Nom */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> Nom
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nom affiché</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Votre nom"
                disabled={savingName}
              />
            </div>
            <Button
              onClick={saveName}
              disabled={savingName || name.trim() === "" || name.trim() === user.name}
            >
              {savingName ? "Enregistrement…" : "Enregistrer le nom"}
            </Button>
          </CardContent>
        </Card>

        {/* Code de connexion */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Code de connexion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="newCode">Nouveau code (4 chiffres)</Label>
                <Input
                  id="newCode"
                  inputMode="numeric"
                  autoComplete="off"
                  value={newCode}
                  onChange={(e) => setNewCode(onlyDigits(e.target.value))}
                  placeholder="••••"
                  disabled={savingCode}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmCode">Confirmer le code</Label>
                <Input
                  id="confirmCode"
                  inputMode="numeric"
                  autoComplete="off"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(onlyDigits(e.target.value))}
                  placeholder="••••"
                  disabled={savingCode}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Ce code vous servira à vous connecter. Choisissez 4 chiffres.
            </p>
            <Button
              onClick={saveCode}
              disabled={savingCode || newCode.length !== 4 || confirmCode.length !== 4}
            >
              {savingCode ? "Enregistrement…" : "Changer le code"}
            </Button>
          </CardContent>
        </Card>

        {/* Session */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connecté en tant que{" "}
              <span className="font-medium text-foreground">{user.name}</span>
              {user.role === "ADMIN" ? " (Administrateur)" : ""}.
            </p>
            <Button variant="outline" onClick={() => logout()} className="gap-2">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
