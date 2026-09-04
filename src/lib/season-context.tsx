"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

interface Season {
  id: string;
  name: string;
  year: number;
  type: string;
  isActive: boolean;
}

interface SeasonContextValue {
  seasons: Season[];
  activeSeasonId: string;
  setActiveSeasonId: (id: string) => void;
  activeSeason: Season | null;
  refreshSeasons: () => void;
  loading: boolean;
}

/**
 * Saison à retenir, par ordre de priorité :
 *  1. celle déjà sélectionnée, si elle existe encore (une actualisation de la liste ne
 *     doit jamais déplacer l'utilisateur) ;
 *  2. celle qu'il avait choisie lors d'une session précédente ;
 *  3. la saison marquée active en base ;
 *  4. à défaut, la première de la liste.
 * Extrait du composant pour être testable.
 */
export function pickSeasonId(
  list: { id: string; isActive: boolean }[],
  current: string,
  remembered: string
): string {
  const exists = (id: string) => list.some((s) => s.id === id);
  if (current && exists(current)) return current;
  if (remembered && exists(remembered)) return remembered;
  return list.find((s) => s.isActive)?.id ?? list[0]?.id ?? "";
}

/**
 * Clé de mémorisation, PAR UTILISATEUR : plusieurs personnes se connectent depuis le même
 * poste, la saison de l'une ne doit pas s'imposer à l'autre.
 */
export const seasonStorageKey = (userId: string) => `gestlog.season.${userId}`;

const SeasonContext = createContext<SeasonContextValue>({
  seasons: [],
  activeSeasonId: "",
  setActiveSeasonId: () => {},
  activeSeason: null,
  refreshSeasons: () => {},
  loading: true,
});

export function SeasonProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [activeSeasonId, setActiveSeasonIdState] = useState<string>("");
  const [loading, setLoading] = useState(true);
  // Choix mémorisé, tenu dans une ref : `fetchSeasons` doit pouvoir le consulter sans
  // que la liste des saisons ne se recharge à chaque fois qu'il change.
  const rememberedRef = useRef<string>("");

  const storageKey = user?.id ? seasonStorageKey(user.id) : null;

  const fetchSeasons = useCallback(() => {
    setLoading(true);
    fetch("/api/seasons")
      .then((res) => res.json())
      .then((data) => {
        const list: Season[] = data.data || [];
        setSeasons(list);
        setActiveSeasonIdState((current) =>
          pickSeasonId(list, current, rememberedRef.current)
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSeasons();
  }, [fetchSeasons]);

  // Restauration du choix de l'utilisateur. ⚠️ Lecture dans un effet et non à
  // l'initialisation de l'état : `localStorage` n'existe pas au rendu serveur, et une
  // valeur lue au premier rendu client provoquerait une divergence d'hydratation.
  useEffect(() => {
    if (!storageKey) return;
    let stored = "";
    try {
      stored = window.localStorage.getItem(storageKey) ?? "";
    } catch {
      /* navigation privée : on reste en mémoire pour la session */
    }
    rememberedRef.current = stored;
    if (stored && seasons.some((s) => s.id === stored)) setActiveSeasonIdState(stored);
  }, [storageKey, seasons]);

  // Toute sélection est mémorisée : c'est elle qui sera reprise au prochain chargement.
  const setActiveSeasonId = useCallback(
    (id: string) => {
      setActiveSeasonIdState(id);
      rememberedRef.current = id;
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        /* idem : la sélection reste valable pour la session en cours */
      }
    },
    [storageKey]
  );

  const activeSeason = seasons.find((s) => s.id === activeSeasonId) || null;

  return (
    <SeasonContext.Provider
      value={{
        seasons,
        activeSeasonId,
        setActiveSeasonId,
        activeSeason,
        refreshSeasons: fetchSeasons,
        loading,
      }}
    >
      {children}
    </SeasonContext.Provider>
  );
}

export function useSeason() {
  return useContext(SeasonContext);
}

const SEASON_TYPE_LABELS: Record<string, string> = {
  AH: "Automne-Hiver",
  PE: "Printemps-Été",
};

export function formatSeasonLabel(season: { name: string; type: string; year: number }): string {
  const typeLabel = SEASON_TYPE_LABELS[season.type];
  if (typeLabel) return `${typeLabel} ${season.year}`;
  return season.name;
}
