"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

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

const SeasonContext = createContext<SeasonContextValue>({
  seasons: [],
  activeSeasonId: "",
  setActiveSeasonId: () => {},
  activeSeason: null,
  refreshSeasons: () => {},
  loading: true,
});

export function SeasonProvider({ children }: { children: React.ReactNode }) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchSeasons = useCallback(() => {
    setLoading(true);
    fetch("/api/seasons")
      .then((res) => res.json())
      .then((data) => {
        const list = data.data || [];
        setSeasons(list);
        if (!activeSeasonId || !list.find((s: Season) => s.id === activeSeasonId)) {
          const active = list.find((s: Season) => s.isActive);
          if (active) setActiveSeasonId(active.id);
          else if (list.length > 0) setActiveSeasonId(list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeSeasonId]);

  useEffect(() => {
    fetchSeasons();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
