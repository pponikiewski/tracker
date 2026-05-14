import type { ResourceType } from "@/lib/db/types";

const COLOR_FAMILIES = [
  { project: "#ef4444", stage: "#f87171", substage: "#fca5a5", task: "#fecaca" },
  { project: "#f97316", stage: "#fb923c", substage: "#fdba74", task: "#fed7aa" },
  { project: "#f59e0b", stage: "#fbbf24", substage: "#fcd34d", task: "#fde68a" },
  { project: "#eab308", stage: "#facc15", substage: "#fde047", task: "#fef08a" },
  { project: "#84cc16", stage: "#a3e635", substage: "#bef264", task: "#d9f99d" },
  { project: "#22c55e", stage: "#4ade80", substage: "#86efac", task: "#bbf7d0" },
  { project: "#10b981", stage: "#34d399", substage: "#6ee7b7", task: "#a7f3d0" },
  { project: "#14b8a6", stage: "#2dd4bf", substage: "#5eead4", task: "#99f6e4" },
  { project: "#06b6d4", stage: "#22d3ee", substage: "#67e8f9", task: "#a5f3fc" },
  { project: "#0ea5e9", stage: "#38bdf8", substage: "#7dd3fc", task: "#bae6fd" },
  { project: "#3b82f6", stage: "#60a5fa", substage: "#93c5fd", task: "#bfdbfe" },
  { project: "#6366f1", stage: "#818cf8", substage: "#a5b4fc", task: "#c7d2fe" },
  { project: "#8b5cf6", stage: "#a78bfa", substage: "#c4b5fd", task: "#ddd6fe" },
  { project: "#a855f7", stage: "#c084fc", substage: "#d8b4fe", task: "#e9d5ff" },
  { project: "#d946ef", stage: "#e879f9", substage: "#f0abfc", task: "#f5d0fe" },
  { project: "#ec4899", stage: "#f472b6", substage: "#f9a8d4", task: "#fbcfe8" },
] satisfies Array<Record<ResourceType, string>>;

const DEFAULT_FAMILY_INDEX = 10;

export const COLOR_PRESETS = getColorPresetsForType("project");

export function getColorPresetsForType(type: ResourceType): string[] {
  return COLOR_FAMILIES.map((family) => family[type]);
}

export function getDefaultColorForType(type: ResourceType): string {
  return COLOR_FAMILIES[DEFAULT_FAMILY_INDEX]?.[type] ?? COLOR_FAMILIES[0]![type];
}

export function getDefaultChildColor(parentColor: string | null, childType: ResourceType): string {
  const normalizedParentColor = parentColor?.toLowerCase();
  const familyIndex = COLOR_FAMILIES.findIndex((family) =>
    Object.values(family).some((color) => color.toLowerCase() === normalizedParentColor),
  );
  if (familyIndex === -1 && normalizedParentColor) {
    return softenHexColor(normalizedParentColor, childType);
  }

  const family = COLOR_FAMILIES[familyIndex === -1 ? DEFAULT_FAMILY_INDEX : familyIndex];
  return family?.[childType] ?? getDefaultColorForType(childType);
}

function softenHexColor(color: string, childType: ResourceType): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!match) return getDefaultColorForType(childType);

  const amountByType: Record<ResourceType, number> = {
    project: 0,
    stage: 0.25,
    substage: 0.45,
    task: 0.65,
  };

  const amount = amountByType[childType];
  const channels = match.slice(1).map((value) => {
    const channel = Number.parseInt(value, 16);
    return Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, "0");
  });

  return `#${channels.join("")}`;
}
