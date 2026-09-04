"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Users,
  Plus,
  Shield,
  User,
  Trash2,
  UserX,
  UserCheck,
  Pencil,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { APP_SCREENS } from "@/lib/screens";
import { NAV_TREE, isGroup } from "@/lib/navigation";

interface UserData {
  id: string;
  name: string;
  code: string;
  role: string;
  isActive: boolean;
  screenAccess: string[] | null;
  createdAt: string;
}

// Sélection des écrans autorisés, présentée dans les MÊMES groupes que le menu :
// une liste à plat de 23 cases ne se relit pas, et l'administrateur ne retrouvait pas
// l'écran qu'il cherchait.
//
// ⚠️ Les groupes ne servent qu'à l'affichage. Ce qui est enregistré reste la liste plate
// des clés `APP_SCREENS`, identique à avant : les droits déjà en base restent valides.
const SCREEN_GROUPS: { label: string; keys: string[] }[] = (() => {
  const label = new Map(APP_SCREENS.map((s) => [s.key, s.label]));
  const groups: { label: string; keys: string[] }[] = [];
  const placed = new Set<string>();
  for (const entry of NAV_TREE) {
    const items = isGroup(entry) ? entry.items : [entry];
    const keys = items.map((i) => i.href).filter((h) => label.has(h) && !placed.has(h));
    if (keys.length === 0) continue;
    keys.forEach((k) => placed.add(k));
    groups.push({ label: isGroup(entry) ? entry.label : "Accès direct", keys });
  }
  // Filet de sécurité : un écran ajouté à APP_SCREENS sans entrée de menu reste
  // attribuable (il resterait sinon invisible ici).
  const orphans = APP_SCREENS.map((s) => s.key).filter((k) => !placed.has(k));
  if (orphans.length) groups.push({ label: "Autres", keys: orphans });
  return groups;
})();

const SCREEN_LABEL = new Map(APP_SCREENS.map((s) => [s.key, s.label]));

function ScreenSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const allKeys = APP_SCREENS.map((s) => s.key);
  const allSelected = allKeys.every((k) => selected.includes(k));
  const toggle = (key: string) =>
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key]
    );
  const toggleGroup = (keys: string[]) => {
    const on = keys.every((k) => selected.includes(k));
    onChange(on ? selected.filter((k) => !keys.includes(k)) : [...new Set([...selected, ...keys])]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>
          Écrans accessibles
          <span className="ml-2 font-normal text-muted-foreground">
            {selected.length}/{allKeys.length}
          </span>
        </Label>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : allKeys)}
          className="text-xs text-primary hover:underline"
        >
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </button>
      </div>

      <div className="space-y-3">
        {SCREEN_GROUPS.map((g) => {
          const groupOn = g.keys.every((k) => selected.includes(k));
          const partial = !groupOn && g.keys.some((k) => selected.includes(k));
          return (
            <div key={g.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {g.label}
                  {partial && <span className="ml-1.5 font-normal normal-case">(partiel)</span>}
                </p>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.keys)}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {groupOn ? "Aucun" : "Tous"}
                </button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.keys.map((key) => {
                  const isOn = selected.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggle(key)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                                        isOn
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          isOn ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                        )}
                      >
                        {isOn && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{SCREEN_LABEL.get(key)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const allKeys = APP_SCREENS.map((s) => s.key);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newRole, setNewRole] = useState("USER");
  const [newScreens, setNewScreens] = useState<string[]>(allKeys);
  const [creating, setCreating] = useState(false);

  // Edit dialog state
  const [editUser, setEditUser] = useState<UserData | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("USER");
  const [editScreens, setEditScreens] = useState<string[]>(allKeys);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (currentUser && currentUser.role !== "ADMIN") {
      router.push("/dashboard");
    }
  }, [currentUser, router]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.data || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const createUser = async () => {
    if (!newName.trim() || !newCode.trim()) {
      toast.error("Nom et code requis");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          code: newCode,
          role: newRole,
          screenAccess: newRole === "ADMIN" ? null : newScreens,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast.success("Utilisateur créé");
      setDialogOpen(false);
      setNewName("");
      setNewCode("");
      setNewRole("USER");
      setNewScreens(allKeys);
      loadUsers();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (userId: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success(isActive ? "Compte désactivé" : "Compte réactivé");
      loadUsers();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const deleteUser = async (userId: string, name: string) => {
    if (!confirm(`Supprimer le compte de ${name} ?`)) return;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast.success("Compte supprimé");
      loadUsers();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const openEdit = (u: UserData) => {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    // null screenAccess (= all) → preselect everything
    setEditScreens(u.screenAccess ?? allKeys);
  };

  const saveEdit = async () => {
    if (!editUser) return;
    if (!editName.trim()) {
      toast.error("Nom requis");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          role: editRole,
          screenAccess: editRole === "ADMIN" ? null : editScreens,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast.success("Utilisateur mis à jour");
      setEditUser(null);
      loadUsers();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  if (currentUser?.role !== "ADMIN") return null;

  return (
    <div>
      <Topbar title="Utilisateurs" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Gestion des utilisateurs"
          description="Ajoutez, modifiez ou désactivez les comptes d'accès"
          action={
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2">
                <Plus className="h-4 w-4" />
                Ajouter un utilisateur
              </DialogTrigger>
              {/* `sm:max-w-lg` : la grille des écrans est à deux colonnes, elle étouffe
                  dans la largeur par défaut. Le défilement est géré par DialogContent. */}
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Nouvel utilisateur</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nom</Label>
                    <Input
                      id="name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nom de l'utilisateur"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="code">Code de connexion</Label>
                    <Input
                      id="code"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="Code à 4 chiffres minimum"
                      maxLength={8}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Rôle</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={newRole === "USER" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNewRole("USER")}
                        className="gap-2 flex-1"
                      >
                        <User className="h-4 w-4" />
                        Utilisateur
                      </Button>
                      <Button
                        type="button"
                        variant={newRole === "ADMIN" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNewRole("ADMIN")}
                        className="gap-2 flex-1"
                      >
                        <Shield className="h-4 w-4" />
                        Administrateur
                      </Button>
                    </div>
                  </div>
                  {newRole === "ADMIN" ? (
                    <p className="text-xs text-muted-foreground">
                      Les administrateurs ont accès à tous les écrans.
                    </p>
                  ) : (
                    <ScreenSelector
                      selected={newScreens}
                      onChange={setNewScreens}
                    />
                  )}
                  {/* Collé en bas : avec 23 écrans à cocher, le bouton se retrouvait
                      hors de portée en bas de la liste sur téléphone. */}
                  <div className="sticky bottom-0 -mx-4 -mb-4 border-t bg-popover px-4 py-3">
                    <Button
                      onClick={createUser}
                      disabled={creating}
                      className="w-full"
                    >
                      {creating ? "Création..." : "Créer le compte"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground animate-pulse">
              Chargement...
            </p>
          </div>
        ) : users.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Users className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Aucun utilisateur
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Créé le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow
                    key={u.id}
                    className={cn(!u.isActive && "opacity-50")}
                  >
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {u.code}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "text-xs",
                          u.role === "ADMIN"
                            ? "bg-violet-100 text-violet-700 hover:bg-violet-100"
                            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-100"
                        )}
                      >
                        {u.role === "ADMIN" ? (
                          <>
                            <Shield className="h-3 w-3 mr-1" />
                            Admin
                          </>
                        ) : (
                          <>
                            <User className="h-3 w-3 mr-1" />
                            Utilisateur
                          </>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          u.isActive
                            ? "border-emerald-300 text-emerald-700"
                            : "border-zinc-300 text-zinc-500"
                        )}
                      >
                        {u.isActive ? "Actif" : "Désactivé"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(u)}
                          title="Modifier les accès"
                          aria-label="Modifier les accès"
                        >
                          <Pencil className="h-4 w-4 text-zinc-600" />
                        </Button>
                        {u.id !== currentUser?.id && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => toggleActive(u.id, u.isActive)}
                              title={u.isActive ? "Désactiver" : "Réactiver"}
                              aria-label={u.isActive ? "Désactiver" : "Réactiver"}
                            >
                              {u.isActive ? (
                                <UserX className="h-4 w-4 text-amber-600" />
                              ) : (
                                <UserCheck className="h-4 w-4 text-emerald-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => deleteUser(u.id, u.name)}
                              title="Supprimer"
                              aria-label="Supprimer l'utilisateur"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </>
                        )}
                        {u.id === currentUser?.id && (
                          <span className="text-xs text-muted-foreground">
                            Vous
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* ─── Dialogue d'édition (rôle + accès écrans) ─── */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Modifier {editUser?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nom</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Rôle</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={editRole === "USER" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEditRole("USER")}
                  className="gap-2 flex-1"
                >
                  <User className="h-4 w-4" />
                  Utilisateur
                </Button>
                <Button
                  type="button"
                  variant={editRole === "ADMIN" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEditRole("ADMIN")}
                  className="gap-2 flex-1"
                >
                  <Shield className="h-4 w-4" />
                  Administrateur
                </Button>
              </div>
            </div>
            {editRole === "ADMIN" ? (
              <p className="text-xs text-muted-foreground">
                Les administrateurs ont accès à tous les écrans.
              </p>
            ) : (
              <ScreenSelector
                selected={editScreens}
                onChange={setEditScreens}
              />
            )}
            <div className="sticky bottom-0 -mx-4 -mb-4 border-t bg-popover px-4 py-3">
              <Button
                onClick={saveEdit}
                disabled={savingEdit}
                className="w-full"
              >
                {savingEdit ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
