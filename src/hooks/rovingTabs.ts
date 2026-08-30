export type HorizontalTabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export const getRovingTabTarget = (
  itemCount: number,
  currentIndex: number,
  key: string,
): number | null => {
  if (itemCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowLeft") return (currentIndex - 1 + itemCount) % itemCount;
  if (key === "ArrowRight") return (currentIndex + 1) % itemCount;
  return null;
};

